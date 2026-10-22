const {
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const { ChannelType, PermissionsBitField } = require('discord.js');

const persistentConnections = new Map();
const MAX_RECONNECT_DELAY_MS = 60_000;

function scheduleReconnect(state, error) {
    if (!state.active || state.retryTimer || state.connectPromise) {
        return;
    }

    console.error(`Reconnecting voice connection for guild ${state.guild.id}:`, error);

    const previousConnection = state.connection;
    state.connection = null;

    const delay = Math.min(1_000 * (2 ** state.retryCount), MAX_RECONNECT_DELAY_MS);
    state.retryCount += 1;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        if (!state.active) {
            return;
        }
        connectPersistentState(state).catch(reconnectError => {
            scheduleReconnect(state, reconnectError);
        });
    }, delay);
    state.retryTimer.unref?.();

    if (previousConnection && previousConnection.state.status !== VoiceConnectionStatus.Destroyed) {
        previousConnection.destroy();
    }
}

async function recoverDisconnectedConnection(state, connection) {
    if (state.connection !== connection || state.retryTimer) {
        return;
    }

    try {
        await entersState(connection, VoiceConnectionStatus.Signalling, 5_000);
    } catch {
        try {
            await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
        } catch (error) {
            scheduleReconnect(state, error);
        }
    }
}

async function connectPersistentState(state) {
    if (state.connectPromise) {
        return state.connectPromise;
    }

    if (state.retryTimer) {
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
    }

    state.connectPromise = (async () => {
        if (state.connection && state.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
            return state.connection;
        }

        const botMember = await state.guild.members.fetchMe();
        const permissions = state.channel.permissionsFor(botMember);
        if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
            throw new Error(`Bot does not have permission to connect to voice channel ${state.channel.id}`);
        }

        const connection = joinVoiceChannel({
            channelId: state.channel.id,
            guildId: state.guild.id,
            adapterCreator: state.guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: true
        });

        state.connection = connection;
        connection.on('error', error => {
            scheduleReconnect(state, error);
        });
        connection.on('stateChange', (_oldState, newState) => {
            if (newState.status === VoiceConnectionStatus.Ready) {
                state.retryCount = 0;
            } else if (newState.status === VoiceConnectionStatus.Disconnected) {
                recoverDisconnectedConnection(state, connection);
            } else if (newState.status === VoiceConnectionStatus.Destroyed) {
                scheduleReconnect(state, new Error('Voice connection was destroyed'));
            }
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        state.retryCount = 0;
        return connection;
    })();

    try {
        return await state.connectPromise;
    } catch (error) {
        if (state.connection && state.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            state.connection.destroy();
        }
        state.connection = null;
        throw error;
    } finally {
        state.connectPromise = null;
    }
}

async function connectPersistentVoiceChannelById(client, channelId) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new Error(`Configured voice channel ${channelId} was not found or is not a standard voice channel`);
    }

    let state = persistentConnections.get(channel.guild.id);
    if (state && state.channel.id !== channel.id) {
        state.active = false;
        if (state.retryTimer) {
            clearTimeout(state.retryTimer);
        }
        state.connection?.destroy();
        state = null;
    }

    if (!state) {
        state = {
            guild: channel.guild,
            channel,
            connection: null,
            connectPromise: null,
            active: true,
            retryCount: 0,
            retryTimer: null
        };
        persistentConnections.set(channel.guild.id, state);
    }

    try {
        await connectPersistentState(state);
        return channel;
    } catch (error) {
        scheduleReconnect(state, error);
        throw error;
    }
}

async function connectConfiguredVoiceChannels(client) {
    await Promise.all([...client.guilds.cache.values()].map(async guild => {
        const channelId = client.settings.getGuildSettings(guild.id).voiceChannelId;
        if (!channelId) {
            return;
        }

        try {
            const channel = await connectPersistentVoiceChannelById(client, channelId);
            console.log(`Sabit ses kanalına bağlandı: ${guild.name} / ${channel.name} (${channel.id})`);
        } catch (error) {
            console.error(`Sabit ses kanalına bağlanılamadı (${guild.name}, ${channelId}); yeniden denenecek:`, error);
        }
    }));
}

async function joinMemberVoiceChannel(member) {
    const guildId = member?.guild?.id || member?.voice?.channel?.guild?.id;
    const configuredChannelId = member?.guild?.client?.settings?.getGuildSettings(guildId)?.voiceChannelId;
    if (configuredChannelId && member.guild.client.voice) {
        return connectPersistentVoiceChannelById(member.guild.client, configuredChannelId);
    }

    const persistentState = guildId ? persistentConnections.get(guildId) : null;
    if (persistentState) {
        await connectPersistentState(persistentState);
        return persistentState.channel;
    }

    const channel = member?.voice?.channel;
    if (!channel) {
        return null;
    }

    const botMember = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
        throw new Error(`Bot does not have permission to connect to voice channel ${channel.id}`);
    }

    const existingConnection = getVoiceConnection(channel.guild.id);
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false
    });

    if (!existingConnection) {
        connection.on('error', error => {
            console.error(`Voice connection error in guild ${channel.guild.id}:`, error);
        });
    }

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (error) {
        if (connection.state.status !== VoiceConnectionStatus.Ready) {
            connection.destroy();
        }
        throw error;
    }

    return channel;
}

module.exports = {
    connectConfiguredVoiceChannels,
    connectPersistentVoiceChannelById,
    joinMemberVoiceChannel
};
