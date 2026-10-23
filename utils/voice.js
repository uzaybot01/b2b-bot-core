const {
    entersState,
    joinVoiceChannel,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const { ChannelType, PermissionsBitField } = require('discord.js');

const persistentConnections = new Map();
const initialConnectionRetries = new Map();
const voiceStateRecoveryPromises = new Map();
const monitoredClients = new WeakSet();
const MAX_RECONNECT_DELAY_MS = 60_000;
const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 30_000;
const CONNECTION_RECOVERY_TIMEOUT_MS = 2_000;
const ADAPTER_READY_ATTEMPTS = 3;
const ADAPTER_RETRY_DELAY_MS = 1_000;
const GUILD_CACHE_ATTEMPTS = 5;
const GUILD_CACHE_RETRY_DELAY_MS = 1_000;

function getVoiceClientId(client) {
    return client?.user?.id || client?.workerName || 'master';
}

function getConnectionKey(client, guildId) {
    return `${getVoiceClientId(client)}:${guildId}`;
}

function getRetryKey(client, guildId, channelId) {
    return `${getVoiceClientId(client)}:${guildId}:${channelId}`;
}

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

function scheduleInitialConnectionRetry(client, guildId, channelId, error) {
    const retryKey = getRetryKey(client, guildId, channelId);
    if (initialConnectionRetries.has(retryKey)) {
        return;
    }

    console.error(`Voice connection to channel ${channelId} failed; retrying in 3 seconds:`, error);
    const timer = setTimeout(() => {
        initialConnectionRetries.delete(retryKey);
        connectPersistentVoiceChannelById(client, channelId).catch(retryError => {
            scheduleInitialConnectionRetry(client, guildId, channelId, retryError);
        });
    }, 3_000);
    timer.unref?.();
    initialConnectionRetries.set(retryKey, timer);
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
    if (!state.active || state.retryTimer) {
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
    if (state.connection !== connection || state.retryTimer || state.recoveryPromise) {
        return;
    }

    state.recoveryPromise = (async () => {
        try {
            await entersState(connection, VoiceConnectionStatus.Signalling, CONNECTION_RECOVERY_TIMEOUT_MS);
        } catch (error) {
            try {
                await entersState(connection, VoiceConnectionStatus.Connecting, CONNECTION_RECOVERY_TIMEOUT_MS);
            } catch (connectingError) {
                scheduleReconnect(state, connectingError || error);
            }
        }
    })();

    try {
        await state.recoveryPromise;
    } finally {
        state.recoveryPromise = null;
    }
}

function startConnectionHealthCheck(state) {
    if (state.healthCheckTimer) {
        return;
    }

    state.healthCheckTimer = setInterval(() => {
        if (!state.active || state.retryTimer || state.connectPromise) {
            return;
        }

        const connection = state.connection;
        if (!connection) {
            connectPersistentState(state).catch(error => scheduleReconnect(state, error));
            return;
        }

        if (connection.state.status === VoiceConnectionStatus.Disconnected) {
            recoverDisconnectedConnection(state, connection).catch(error => scheduleReconnect(state, error));
            return;
        }

        if (connection.state.status !== VoiceConnectionStatus.Ready) {
            scheduleReconnect(
                state,
                new Error(`Voice connection health check found status ${connection.state.status}`)
            );
            return;
        }

        entersState(connection, VoiceConnectionStatus.Ready, CONNECTION_RECOVERY_TIMEOUT_MS)
            .catch(error => scheduleReconnect(state, error));
    }, CONNECTION_HEALTH_CHECK_INTERVAL_MS);
    state.healthCheckTimer.unref?.();
}

function attachVoiceStateMonitor(client) {
    if (!client || monitoredClients.has(client)) {
        return;
    }

    monitoredClients.add(client);
    client.on('voiceStateUpdate', (_oldState, newState) => {
        if (newState.member?.id !== client.user?.id || !newState.guild?.id) {
            return;
        }

        const guildId = newState.guild.id;
        if (client.isMaster === false && !client.workerManager?.isMasterActiveForGuild(guildId)) {
            return;
        }

        const state = persistentConnections.get(getConnectionKey(client, guildId));
        if (!state
            || (client.isMaster === false
                && !client.workerManager.isWorkerActiveForVoiceChannel(client, guildId, state.channel.id))) {
            return;
        }

        if (newState.channelId === state.channel.id) {
            return;
        }

        const recoveryKey = getConnectionKey(client, guildId);
        const pendingRecovery = voiceStateRecoveryPromises.get(recoveryKey);
        if (pendingRecovery) {
            return;
        }

        if (!state.connectPromise) {
            scheduleReconnect(
                state,
                new Error(`Bot left assigned voice channel ${state.channel.id}`)
            );
            return;
        }

        const recovery = connectPersistentVoiceChannelById(client, state.channel.id)
            .catch(error => {
                console.error(
                    `Bot left assigned voice channel in guild ${guildId}; automatic reconnect is scheduled:`,
                    error
                );
            })
            .finally(() => {
                voiceStateRecoveryPromises.delete(recoveryKey);
            });
        voiceStateRecoveryPromises.set(recoveryKey, recovery);
    });
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
            group: getVoiceClientId(state.client),
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
        scheduleInitialConnectionRetry(client, guildId, channelId, error);
        throw error;
    }

    channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new Error(`Voice channel ${channelId} is unavailable after loading guild ${guildId}`);
    }

    const connectionKey = getConnectionKey(client, guildId);
    let state = persistentConnections.get(connectionKey);
    if (state && state.channel.id !== channel.id) {
        stopPersistentState(state);
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
            retryTimer: null,
            healthCheckTimer: null,
            recoveryPromise: null
        };
        persistentConnections.set(connectionKey, state);
        startConnectionHealthCheck(state);
    } else {
        state.client = client;
        state.guild = guild;
        state.channel = channel;
    }

    try {
        await connectPersistentState(state);
        const retryKey = getRetryKey(client, guildId, channelId);
        const retryTimer = initialConnectionRetries.get(retryKey);
        if (retryTimer) {
            clearTimeout(retryTimer);
            initialConnectionRetries.delete(retryKey);
        }
        return channel;
    } catch (error) {
        scheduleReconnect(state, error);
        scheduleInitialConnectionRetry(client, guildId, channelId, error);
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
    if (client.workerManager?.reconcileGuild) {
        return client.workerManager.reconcileGuild(guild.id);
    }

    const settings = client.settings.getGuildSettings(guild.id);
    const channelId = Array.isArray(settings.voiceChannelIds) && settings.voiceChannelIds.length
        ? settings.voiceChannelIds[0]
        : settings.voiceChannelId;
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

function stopPersistentState(state) {
    state.active = false;
    if (state.retryTimer) {
        clearTimeout(state.retryTimer);
    }
    if (state.healthCheckTimer) {
        clearInterval(state.healthCheckTimer);
    }

    const retryKey = getRetryKey(state.client, state.guild.id, state.channel.id);
    const initialRetry = initialConnectionRetries.get(retryKey);
    if (initialRetry) {
        clearTimeout(initialRetry);
        initialConnectionRetries.delete(retryKey);
    }
    state.connection?.destroy();
    const connectionKey = getConnectionKey(state.client, state.guild.id);
    if (persistentConnections.get(connectionKey) === state) {
        persistentConnections.delete(connectionKey);
    }
}

function disconnectPersistentVoiceChannelForGuild(guildId, client) {
    const states = [...persistentConnections.entries()]
        .filter(([, state]) => state.guild.id === guildId && (!client || state.client === client));
    for (const [, state] of states) {
        stopPersistentState(state);
    }

    const retryPrefix = client
        ? `${getVoiceClientId(client)}:${guildId}:`
        : null;
    for (const [retryKey, timer] of initialConnectionRetries) {
        if ((retryPrefix && retryKey.startsWith(retryPrefix))
            || (!client && retryKey.split(':')[1] === guildId)) {
            clearTimeout(timer);
            initialConnectionRetries.delete(retryKey);
        }
    }
    return states.length > 0;
}

function disconnectAllPersistentVoiceChannels() {
    const states = [...persistentConnections.values()];
    for (const state of states) {
        stopPersistentState(state);
    }
    for (const timer of initialConnectionRetries.values()) {
        clearTimeout(timer);
    }
    initialConnectionRetries.clear();
    return states.length;
}

async function joinMemberVoiceChannel(member) {
    const guildId = member?.guild?.id || member?.voice?.channel?.guild?.id;
    const client = member?.client || member?.guild?.client;
    const memberChannelId = member?.voice?.channelId || member?.voice?.channel?.id;
    if (memberChannelId && client?.voiceService) {
        return connectPersistentVoiceChannelById(client, memberChannelId);
    }

    const settings = client?.settings?.getGuildSettings(guildId);
    const configuredChannelId = Array.isArray(settings?.voiceChannelIds) && settings.voiceChannelIds.length
        ? settings.voiceChannelIds[0]
        : settings?.voiceChannelId;
    if (configuredChannelId && client?.voiceService) {
        return connectPersistentVoiceChannelById(client, configuredChannelId);
    }

    const persistentState = guildId
        ? persistentConnections.get(getConnectionKey(client, guildId))
        : null;
    if (persistentState) {
        await connectPersistentState(persistentState);
        return persistentState.channel;
    }

    const channel = member?.voice?.channel;
    if (!channel) {
        return null;
    }

    return connectPersistentVoiceChannelById(client, channel.id);
}

module.exports = {
    attachVoiceStateMonitor,
    connectConfiguredVoiceChannels,
    connectConfiguredVoiceChannelForGuild,
    connectPersistentVoiceChannelById,
    disconnectPersistentVoiceChannelForGuild,
    disconnectAllPersistentVoiceChannels,
    joinMemberVoiceChannel
};
