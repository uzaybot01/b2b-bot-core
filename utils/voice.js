const {
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const { ChannelType, PermissionsBitField } = require('discord.js');

const persistentConnections = new Map();
const initialConnectionRetries = new Map();
const MAX_RECONNECT_DELAY_MS = 60_000;
const ADAPTER_READY_ATTEMPTS = 3;
const ADAPTER_RETRY_DELAY_MS = 1_000;
const GUILD_CACHE_ATTEMPTS = 5;
const GUILD_CACHE_RETRY_DELAY_MS = 1_000;

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function resolveGuild(client, guildId) {
    if (!client || !guildId) {
        throw new Error('Cannot connect to voice channel: client or guild ID is unavailable');
    }

    for (let attempt = 1; attempt <= GUILD_CACHE_ATTEMPTS; attempt += 1) {
        const cachedGuild = client.guilds?.cache?.get(guildId);
        if (cachedGuild && typeof cachedGuild.voiceAdapterCreator === 'function') {
            return cachedGuild;
        }

        try {
            const fetchedGuild = await client.guilds?.fetch(guildId);
            const guild = client.guilds?.cache?.get(guildId) || fetchedGuild;
            if (guild && typeof guild.voiceAdapterCreator === 'function') {
                return guild;
            }
        } catch (error) {
            console.warn(
                `Guild ${guildId} is not ready for voice connection (attempt ${attempt}/${GUILD_CACHE_ATTEMPTS}): ${error.message}`
            );
        }

        if (attempt < GUILD_CACHE_ATTEMPTS) {
            await delay(GUILD_CACHE_RETRY_DELAY_MS);
        }
    }

    throw new Error(`Guild ${guildId} or its voice adapter is unavailable after ${GUILD_CACHE_ATTEMPTS} attempts`);
}

function scheduleInitialConnectionRetry(client, channelId, error) {
    if (initialConnectionRetries.has(channelId)) {
        return;
    }

    console.error(`Voice connection to channel ${channelId} failed; retrying in 3 seconds:`, error);
    const timer = setTimeout(() => {
        initialConnectionRetries.delete(channelId);
        connectPersistentVoiceChannelById(client, channelId).catch(retryError => {
            scheduleInitialConnectionRetry(client, channelId, retryError);
        });
    }, 3_000);
    timer.unref?.();
    initialConnectionRetries.set(channelId, timer);
}

async function getVoiceAdapter(guild, channelId) {
    if (!guild || typeof guild.id !== 'string' || !guild.id) {
        throw new Error(`Cannot connect to voice channel ${channelId}: guild is not available`);
    }

    for (let attempt = 1; attempt <= ADAPTER_READY_ATTEMPTS; attempt += 1) {
        if (typeof guild.voiceAdapterCreator === 'function') {
            return guild.voiceAdapterCreator;
        }

        console.warn(
            `Voice adapter is not ready for guild ${guild.id} (attempt ${attempt}/${ADAPTER_READY_ATTEMPTS}); retrying in ${ADAPTER_RETRY_DELAY_MS}ms`
        );

        if (attempt < ADAPTER_READY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, ADAPTER_RETRY_DELAY_MS));
        }
    }

    throw new Error(`Voice adapter is unavailable for guild ${guild.id}, channel ${channelId}`);
}

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
        const voicePreferences = state.client.settings.getGuildVoicePreferences(state.guild.id);
        const preferencesChanged = state.appliedVoicePreferences
            && (state.appliedVoicePreferences.selfDeaf !== voicePreferences.selfDeaf
                || state.appliedVoicePreferences.selfMute !== voicePreferences.selfMute);

        if (preferencesChanged && state.connection) {
            const previousConnection = state.connection;
            state.connection = null;
            previousConnection.destroy();
        }

        if (state.connection && state.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
            return state.connection;
        }

        const adapterCreator = await getVoiceAdapter(state.guild, state.channel.id);
        const botMember = await state.guild.members.fetchMe();
        const permissions = state.channel.permissionsFor(botMember);
        if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
            throw new Error(`Bot does not have permission to connect to voice channel ${state.channel.id}`);
        }

        const connection = joinVoiceChannel({
            channelId: state.channel.id,
            guildId: state.guild.id,
            adapterCreator,
            ...voicePreferences
        });

        state.connection = connection;
        state.appliedVoicePreferences = voicePreferences;
        connection.on('error', error => {
            scheduleReconnect(state, error);
        });
        connection.on('stateChange', (_oldState, newState) => {
            if (newState.status === VoiceConnectionStatus.Ready) {
                state.retryCount = 0;
            } else if (newState.status === VoiceConnectionStatus.Disconnected) {
                recoverDisconnectedConnection(state, connection);
            } else if (newState.status === VoiceConnectionStatus.Destroyed && state.connection === connection) {
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
    let channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new Error(`Configured voice channel ${channelId} was not found or is not a standard voice channel`);
    }

    const guildId = channel.guildId || channel.guild?.id;
    if (!guildId) {
        throw new Error(`Configured voice channel ${channelId} does not have a guild ID`);
    }

    let guild;
    try {
        guild = await resolveGuild(client, guildId);
    } catch (error) {
        scheduleInitialConnectionRetry(client, channelId, error);
        throw error;
    }

    channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new Error(`Voice channel ${channelId} is unavailable after loading guild ${guildId}`);
    }

    let state = persistentConnections.get(guildId);
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
            client,
            guild,
            channel,
            connection: null,
            connectPromise: null,
            active: true,
            retryCount: 0,
            retryTimer: null
        };
        persistentConnections.set(guildId, state);
    } else {
        state.client = client;
        state.guild = guild;
        state.channel = channel;
    }

    try {
        await connectPersistentState(state);
        const retryTimer = initialConnectionRetries.get(channelId);
        if (retryTimer) {
            clearTimeout(retryTimer);
            initialConnectionRetries.delete(channelId);
        }
        return channel;
    } catch (error) {
        scheduleReconnect(state, error);
        scheduleInitialConnectionRetry(client, channelId, error);
        throw error;
    }
}

async function connectConfiguredVoiceChannels(client) {
    try {
        await client.guilds.fetch();
    } catch (error) {
        console.error('Guild cache could not be populated before persistent voice setup:', error);
    }

    await Promise.all([...client.guilds.cache.values()].map(async guild => {
        await connectConfiguredVoiceChannelForGuild(client, guild);
    }));
}

async function connectConfiguredVoiceChannelForGuild(client, guild) {
    const channelId = client.settings.getGuildSettings(guild.id).voiceChannelId;
    if (!channelId) {
        return;
    }

    try {
        const channel = await connectPersistentVoiceChannelById(client, channelId);
        console.log(`Sabit ses kanalına bağlandı: ${guild.name} / ${channel.name} (${channel.id})`);
    } catch (error) {
        console.error(`Yeni sunucuda sabit ses kanalına bağlanılamadı (${guild.name}, ${channelId}); yeniden denenecek:`, error);
    }
}

function disconnectPersistentVoiceChannelForGuild(guildId) {
    const state = persistentConnections.get(guildId);
    if (!state) {
        return false;
    }

    state.active = false;
    if (state.retryTimer) {
        clearTimeout(state.retryTimer);
    }

    const initialRetry = initialConnectionRetries.get(state.channel.id);
    if (initialRetry) {
        clearTimeout(initialRetry);
        initialConnectionRetries.delete(state.channel.id);
    }

    state.connection?.destroy();
    persistentConnections.delete(guildId);
    return true;
}

async function joinMemberVoiceChannel(member) {
    const guildId = member?.guild?.id || member?.voice?.channel?.guild?.id;
    const client = member?.client || member?.guild?.client;
    const configuredChannelId = client?.settings?.getGuildSettings(guildId)?.voiceChannelId;
    if (configuredChannelId && client.voiceService) {
        return connectPersistentVoiceChannelById(client, configuredChannelId);
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

    const adapterCreator = await getVoiceAdapter(channel.guild, channel.id);
    const botMember = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
        throw new Error(`Bot does not have permission to connect to voice channel ${channel.id}`);
    }

    const existingConnection = getVoiceConnection(channel.guild.id);
    const voicePreferences = client?.settings?.getGuildVoicePreferences
        ? client.settings.getGuildVoicePreferences(channel.guild.id)
        : { selfDeaf: true, selfMute: true };
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator,
        ...voicePreferences
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
    connectConfiguredVoiceChannelForGuild,
    connectPersistentVoiceChannelById,
    disconnectPersistentVoiceChannelForGuild,
    joinMemberVoiceChannel
};
