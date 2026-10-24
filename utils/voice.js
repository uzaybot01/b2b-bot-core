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
const MAX_RECONNECT_ATTEMPTS = 8;

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

function isPermanentVoiceError(error) {
    if (!error) return false;
    if (error.isPermissionError) return true;
    const message = error.message || '';
    const code = error.code;
    if (code === 50001 || code === 50013 || code === 10003) return true;
    if (message.includes('izin') || message.includes('permission') || message.includes('bulunamadı')) {
        return true;
    }
    return false;
}

function validateVoicePermissions(channel, botMember) {
    if (!channel) {
        const error = new Error('Ses kanalı bulunamadı veya erişilemez durumda');
        error.code = 10003;
        throw error;
    }

    if (!botMember) {
        const error = new Error('Bot üyesi sunucuda bulunamadı');
        error.code = 'BOT_MEMBER_NOT_FOUND';
        throw error;
    }

    const permissions = channel.permissionsFor(botMember);
    if (!permissions) {
        const error = new Error(`Kanal izinleri hesaplanamadı: ${channel.id}`);
        error.isPermissionError = true;
        throw error;
    }

    const missing = [];
    if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) {
        missing.push('Kanalı Görüntüle (ViewChannel)');
    }
    if (!permissions.has(PermissionsBitField.Flags.Connect)) {
        missing.push('Bağlan (Connect)');
    }

    if (missing.length > 0) {
        const error = new Error(`Botun '${channel.name}' ses kanalında gerekli izinleri eksik: ${missing.join(', ')}`);
        error.isPermissionError = true;
        error.missingPermissions = missing;
        throw error;
    }

    if (channel.userLimit > 0 && channel.members.size >= channel.userLimit && !permissions.has(PermissionsBitField.Flags.MoveMembers)) {
        const error = new Error(`'${channel.name}' kanalı dolu (Kapasite: ${channel.userLimit}) ve bot üyeleri taşıma yetkisine sahip değil`);
        error.isPermissionError = true;
        throw error;
    }

    return true;
}

async function resolveGuild(client, guildId) {
    if (!client || !guildId) {
        throw new Error('Ses kanalına bağlanılamıyor: İstemci veya sunucu kimliği geçersiz');
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
                `Sunucu ${guildId} ses adaptörü henüz hazır değil (Deneme ${attempt}/${GUILD_CACHE_ATTEMPTS}): ${error.message}`
            );
        }

        if (attempt < GUILD_CACHE_ATTEMPTS) {
            await delay(GUILD_CACHE_RETRY_DELAY_MS);
        }
    }

    throw new Error(`Sunucu ${guildId} veya ses adaptörü ${GUILD_CACHE_ATTEMPTS} deneme sonrasında kullanılamadı`);
}

function scheduleInitialConnectionRetry(client, guildId, channelId, error) {
    if (isPermanentVoiceError(error)) {
        return;
    }

    const retryKey = getRetryKey(client, guildId, channelId);
    if (initialConnectionRetries.has(retryKey)) {
        return;
    }

    console.warn(`[Ses Worker] ${channelId} kanalına ilk bağlantı başarısız; 3 saniye sonra yeniden denenecek:`, error.message || error);
    const timer = setTimeout(() => {
        initialConnectionRetries.delete(retryKey);
        connectVoiceChannelById(client, channelId).catch(retryError => {
            scheduleInitialConnectionRetry(client, guildId, channelId, retryError);
        });
    }, 3_000);
    timer.unref?.();
    initialConnectionRetries.set(retryKey, timer);
}

async function getVoiceAdapter(guild, channelId) {
    if (!guild || typeof guild.id !== 'string' || !guild.id) {
        throw new Error(`Ses kanalına (${channelId}) bağlanılamıyor: Sunucu bulunamadı`);
    }

    for (let attempt = 1; attempt <= ADAPTER_READY_ATTEMPTS; attempt += 1) {
        if (typeof guild.voiceAdapterCreator === 'function') {
            return guild.voiceAdapterCreator;
        }

        console.warn(
            `Sunucu ${guild.id} için ses adaptörü hazır değil (Deneme ${attempt}/${ADAPTER_READY_ATTEMPTS}); ${ADAPTER_RETRY_DELAY_MS}ms içinde yeniden denenecek`
        );

        if (attempt < ADAPTER_READY_ATTEMPTS) {
            await delay(ADAPTER_RETRY_DELAY_MS);
        }
    }

    throw new Error(`Sunucu ${guild.id}, kanal ${channelId} için ses adaptörü kullanılamıyor`);
}

function scheduleReconnect(state, error) {
    if (!state.active || state.retryTimer) {
        return;
    }

    if (isPermanentVoiceError(error)) {
        console.warn(
            `[Ses Worker] Sunucu ${state.guild.id} için izin eksikliği veya geçersiz kanal nedeniyle yeniden bağlanma durduruldu: ${error.message}`
        );
        stopPersistentState(state);
        return;
    }

    if (state.retryCount >= MAX_RECONNECT_ATTEMPTS) {
        console.error(
            `[Ses Worker] Sunucu ${state.guild.id} için maksimum yeniden bağlanma denemesine (${MAX_RECONNECT_ATTEMPTS}) ulaşıldı; bağlantı durduruldu.`
        );
        stopPersistentState(state);
        return;
    }

    console.warn(`[Ses Worker] Sunucu ${state.guild.id} ses bağlantısı kesildi; yeniden deneniyor (Deneme ${state.retryCount + 1}/${MAX_RECONNECT_ATTEMPTS}):`, error?.message || error);

    const previousConnection = state.connection;
    state.connection = null;

    const backoffDelay = Math.min(1_000 * (2 ** state.retryCount), MAX_RECONNECT_DELAY_MS);
    state.retryCount += 1;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        if (!state.active) {
            return;
        }
        connectPersistentState(state).catch(reconnectError => {
            scheduleReconnect(state, reconnectError);
        });
    }, backoffDelay);
    state.retryTimer.unref?.();

    if (previousConnection && previousConnection.state.status !== VoiceConnectionStatus.Destroyed) {
        try {
            previousConnection.destroy();
        } catch {
            // sessizce geç
        }
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
                new Error(`Ses bağlantı sağlık kontrolü beklenen durumda değil: ${connection.state.status}`)
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
        if (!state) {
            return;
        }

        // 1. Durum: Bot aynı kanalda (yalnızca durum/deaf/mute değişikliği)
        if (newState.channelId === state.channel.id) {
            return;
        }

        // 2. Durum: Bot sunucu içinde başka bir ses kanalına dinamik olarak taşındı (Move / Drag)
        if (newState.channelId) {
            const newChannel = newState.channel || client.channels.cache.get(newState.channelId);
            console.log(
                `[Ses Worker] ${client.workerName || client.user.tag} yeni kanala taşındı: ${newChannel?.name || newState.channelId} (${guildId})`
            );
            state.channel = newChannel || { id: newState.channelId, guildId, type: ChannelType.GuildVoice };
            state.retryCount = 0;
            if (client.workerManager?.updateWorkerVoiceChannel) {
                client.workerManager.updateWorkerVoiceChannel(client, guildId, newState.channelId);
            }
            return;
        }

        // 3. Durum: Bot kanaldan çıkarıldı / bağlantı koptu (newState.channelId === null)
        if (!state.active) {
            return;
        }

        const recoveryKey = getConnectionKey(client, guildId);
        const pendingRecovery = voiceStateRecoveryPromises.get(recoveryKey);
        if (pendingRecovery) {
            return;
        }

        console.warn(
            `[Ses Worker] ${client.workerName || client.user.tag} ses kanalından ayrıldı (${state.channel.id}); yeniden bağlanma tetikleniyor.`
        );

        if (!state.connectPromise) {
            scheduleReconnect(
                state,
                new Error(`Bot ses kanalından ayrıldı (${state.channel.id})`)
            );
            return;
        }

        const recovery = connectVoiceChannelById(client, state.channel.id)
            .catch(error => {
                console.warn(
                    `[Ses Worker] Otomatik yeniden bağlanma başarısız (${guildId}, ${state.channel.id}):`,
                    error.message || error
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
        const voicePreferences = state.client.settings?.getGuildVoicePreferences?.(state.guild.id) || {
            selfDeaf: true,
            selfMute: true
        };
        const preferencesChanged = state.appliedVoicePreferences
            && (state.appliedVoicePreferences.selfDeaf !== voicePreferences.selfDeaf
                || state.appliedVoicePreferences.selfMute !== voicePreferences.selfMute);

        if (preferencesChanged && state.connection) {
            const previousConnection = state.connection;
            state.connection = null;
            try {
                previousConnection.destroy();
            } catch {
                // sessizce geç
            }
        }

        if (state.connection && state.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000);
            return state.connection;
        }

        const adapterCreator = await getVoiceAdapter(state.guild, state.channel.id);
        const botMember = await state.guild.members.fetchMe().catch(() => null);
        validateVoicePermissions(state.channel, botMember);

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
                scheduleReconnect(state, new Error('Ses bağlantısı yok edildi (Destroyed)'));
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
            try {
                state.connection.destroy();
            } catch {
                // sessizce geç
            }
        }
        state.connection = null;
        throw error;
    } finally {
        state.connectPromise = null;
    }
}

async function connectVoiceChannelById(client, channelId, _options = {}) {
    let channel;
    try {
        channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    } catch (fetchError) {
        const error = new Error(`Ses kanalı (${channelId}) bulunamadı veya erişilemez: ${fetchError.message}`);
        error.code = fetchError.code;
        throw error;
    }

    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
        throw new Error(`Hedef kanal (${channelId}) geçerli bir ses kanalı değil.`);
    }

    const guildId = channel.guildId || channel.guild?.id;
    if (!guildId) {
        throw new Error(`Ses kanalı (${channelId}) için sunucu kimliği bulunamadı.`);
    }

    let guild;
    try {
        guild = await resolveGuild(client, guildId);
    } catch (error) {
        scheduleInitialConnectionRetry(client, guildId, channelId, error);
        throw error;
    }

    channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
    if (!channel) {
        throw new Error(`Ses kanalı (${channelId}) sunucu yüklendikten sonra bulunamadı.`);
    }

    const botMember = await guild.members.fetchMe().catch(() => null);
    validateVoicePermissions(channel, botMember);

    const connectionKey = getConnectionKey(client, guildId);
    let state = persistentConnections.get(connectionKey);

    // Eğer farklı bir kanala geçiş yapılıyorsa eski durumu temizle
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
        state.active = true;
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
        console.warn('[Ses Worker] Sunucu önbelleği tam yüklenemedi:', error.message);
    }

    await Promise.all([...client.guilds.cache.values()].map(async guild => {
        await connectConfiguredVoiceChannelForGuild(client, guild);
    }));
}

async function connectConfiguredVoiceChannelForGuild(client, guild) {
    if (client.workerManager?.reconcileGuild) {
        return client.workerManager.reconcileGuild(guild.id);
    }

    const settings = client.settings?.getGuildSettings?.(guild.id) || {};
    const channelId = Array.isArray(settings.voiceChannelIds) && settings.voiceChannelIds.length
        ? settings.voiceChannelIds[0]
        : settings.voiceChannelId;
    
    // Sabit kanal yapılandırılmamışsa sessizce çık, zorunlu değil!
    if (!channelId) {
        return;
    }

    try {
        const channel = await connectVoiceChannelById(client, channelId);
        console.log(`[Ses Worker] Sabit ses kanalına bağlandı: ${guild.name} / ${channel.name} (${channel.id})`);
    } catch (error) {
        console.warn(`[Ses Worker] Sunucuda ses kanalına bağlanılamadı (${guild.name}, ${channelId}):`, error.message);
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
    try {
        state.connection?.destroy();
    } catch {
        // sessizce geç
    }
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

async function joinMemberVoiceChannel(member, targetChannelId = null) {
    const guildId = member?.guild?.id || member?.voice?.channel?.guild?.id;
    const client = member?.client || member?.guild?.client;
    if (!client?.voiceService) {
        return null;
    }

    // 1. Öncelik: Açıkça belirtilmiş hedef kanal
    if (targetChannelId) {
        return connectVoiceChannelById(client, targetChannelId);
    }

    // 2. Öncelik: Üyenin o an bulunduğu ses kanalı
    const memberChannelId = member?.voice?.channelId || member?.voice?.channel?.id;
    if (memberChannelId) {
        return connectVoiceChannelById(client, memberChannelId);
    }

    // 3. Öncelik: Sunucu ayarlarındaki kanal (opsiyonel fallback)
    const settings = client?.settings?.getGuildSettings?.(guildId) || {};
    const configuredChannelId = Array.isArray(settings?.voiceChannelIds) && settings.voiceChannelIds.length
        ? settings.voiceChannelIds[0]
        : settings?.voiceChannelId;
    if (configuredChannelId) {
        return connectVoiceChannelById(client, configuredChannelId).catch(() => null);
    }

    // 4. Öncelik: Zaten aktif olan bağlantı kanalı
    const persistentState = guildId
        ? persistentConnections.get(getConnectionKey(client, guildId))
        : null;
    if (persistentState?.connection && persistentState.connection.state.status === VoiceConnectionStatus.Ready) {
        return persistentState.channel;
    }

    const channel = member?.voice?.channel;
    if (!channel) {
        return null;
    }

    return connectVoiceChannelById(client, channel.id);
}

module.exports = {
    attachVoiceStateMonitor,
    connectConfiguredVoiceChannels,
    connectConfiguredVoiceChannelForGuild,
    connectVoiceChannelById,
    connectPersistentVoiceChannelById: connectVoiceChannelById,
    disconnectPersistentVoiceChannelForGuild,
    disconnectVoiceChannelForGuild: disconnectPersistentVoiceChannelForGuild,
    disconnectAllPersistentVoiceChannels,
    joinMemberVoiceChannel,
    validateVoicePermissions
};
