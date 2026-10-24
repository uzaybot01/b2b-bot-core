const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');

const WORKER_READY_TIMEOUT_MS = 30_000;
const MAX_VOICE_WORKERS = 4;

function getWorkerConfigurations(environment) {
    const configurations = [];

    for (const [name, token] of Object.entries(environment)) {
        const match = name.match(/^WORKER_([A-Z0-9_]+)_TOKEN$/);
        if (!match || typeof token !== 'string' || !token.trim()) {
            continue;
        }

        const workerName = match[1];
        const tasks = (environment[`WORKER_${workerName}_TASKS`] || '')
            .split(',')
            .map(task => task.trim().toLowerCase())
            .filter(Boolean);

        configurations.push({
            name: workerName,
            token: token.trim(),
            tasks: [...new Set(tasks)]
        });
    }

    return configurations.sort((left, right) => left.name.localeCompare(right.name));
}

function getWorkerTaskModules() {
    const workersDirectory = path.join(__dirname, '..', 'workers');
    const modules = new Map();

    if (!fs.existsSync(workersDirectory)) {
        return modules;
    }

    for (const file of fs.readdirSync(workersDirectory).filter(name => name.endsWith('.js')).sort()) {
        const taskModule = require(path.join(workersDirectory, file));
        if (typeof taskModule.task !== 'string'
            || typeof taskModule.register !== 'function'
            || modules.has(taskModule.task)) {
            throw new TypeError(`Invalid or duplicate worker task module: ${file}`);
        }
        modules.set(taskModule.task, taskModule);
    }

    return modules;
}

function limitVoiceWorkerConfigurations(configurations, maxVoiceWorkers = MAX_VOICE_WORKERS) {
    let voiceWorkerCount = 0;
    return configurations.map(configuration => {
        if (!configuration.tasks.includes('voice')) {
            return configuration;
        }

        voiceWorkerCount += 1;
        if (voiceWorkerCount <= maxVoiceWorkers) {
            return configuration;
        }

        console.warn(
            `Worker ${configuration.name} ses görevi başlatılmadı; en fazla ${maxVoiceWorkers} ses worker'ı etkin olabilir.`
        );
        return {
            ...configuration,
            tasks: configuration.tasks.filter(task => task !== 'voice')
        };
    }).filter(configuration => configuration.tasks.length > 0);
}

class WorkerManager {
    constructor(masterClient, masterToken) {
        this.masterClient = masterClient;
        this.masterToken = masterToken;
        this.workers = [];
        this.taskModules = getWorkerTaskModules();
        this.guildAssignments = new Map();
        this.nextWorkerIndex = new Map();
        this.voiceAssignments = new Map();
        this.voiceWorkerChannels = new Map();
        this.nextVoiceWorkerIndex = new Map();
        this.started = false;
        this.destroyed = false;

        this.masterClient.on('guildCreate', guild => {
            this.reconcileGuild(guild.id).catch(error => {
                console.error(`Worker sunucuya bağlanamadı (${guild.id}):`, error);
            });
        });
        this.masterClient.on('guildDelete', guild => {
            this.pauseGuild(guild.id);
        });
        this.masterClient.on('shardDisconnect', () => {
            this.pauseAllGuilds();
        });
        this.masterClient.on('shardReady', () => {
            for (const guildId of this.masterClient.guilds.cache.keys()) {
                this.reconcileGuild(guildId).catch(error => {
                    console.error(`Ana Bot bağlantısı geldikten sonra worker görevi başlatılamadı (${guildId}):`, error);
                });
            }
        });
    }

    async start() {
        if (this.started) {
            return;
        }
        if (!this.masterClient.isReady()) {
            throw new Error('Worker havuzu yalnızca Ana Bot Discord bağlantısı hazır olduktan sonra başlatılabilir');
        }
        this.started = true;

        const configurations = getWorkerConfigurations(process.env);
        if (configurations.length === 0) {
            console.warn('Worker tokenı bulunamadı. WORKER_<AD>_TOKEN ve WORKER_<AD>_TASKS tanımlanıncaya kadar worker görevleri kapalıdır.');
            return;
        }

        const usedTokens = new Set([this.masterToken]);
        const uniqueConfigurations = configurations.filter(configuration => {
            if (usedTokens.has(configuration.token)) {
                console.error(`Worker ${configuration.name} tokenı Ana Bot veya başka bir worker ile tekrar ediyor; başlatılmadı.`);
                return false;
            }
            usedTokens.add(configuration.token);
            return true;
        });
        const limitedConfigurations = limitVoiceWorkerConfigurations(uniqueConfigurations);
        await Promise.all(limitedConfigurations.map(configuration => this.startWorker(configuration)));

        for (const guild of this.masterClient.guilds.cache.values()) {
            await this.reconcileGuild(guild.id);
        }
    }

    async startWorker(configuration) {
        const { name, token, tasks } = configuration;
        const taskModules = [];
        for (const task of tasks) {
            const taskModule = this.taskModules.get(task);
            if (!taskModule) {
                console.error(`Worker ${name} için tanımsız görev '${task}'; görev yüklenmeyecek.`);
                continue;
            }
            taskModules.push(taskModule);
        }

        if (taskModules.length === 0) {
            console.error(`Worker ${name} için kullanılabilir görev yok; istemci başlatılmadı.`);
            return;
        }

        const worker = new Client({
            intents: [...new Set([
                GatewayIntentBits.Guilds,
                ...taskModules.flatMap(taskModule => taskModule.intents || [])
            ])]
        });
        worker.isMaster = false;
        worker.workerName = name;
        worker.workerTasks = new Set(taskModules.map(taskModule => taskModule.task));
        worker.coordinator = this.masterClient;
        worker.workerManager = this;
        worker.settings = this.masterClient.settings;
        worker.voiceService = this.masterClient.voiceService;
        worker.commands = new Collection();

        worker.on('error', error => {
            console.error(`Worker ${name} Discord istemci hatası:`, error);
        });
        worker.on('guildCreate', guild => {
            this.reconcileGuild(guild.id).catch(error => {
                console.error(`Worker ${name} için sunucu görevi başlatılamadı (${guild.id}):`, error);
            });
        });
        worker.on('guildDelete', guild => {
            this.removeWorkerFromGuild(worker, guild.id);
            this.reconcileGuild(guild.id).catch(error => {
                console.error(`Worker yeniden atanamadı (${guild.id}):`, error);
            });
        });
        worker.on('shardDisconnect', () => {
            worker.clusterAvailable = false;
            for (const [key, assignedWorker] of this.guildAssignments) {
                if (assignedWorker === worker) {
                    const separator = key.indexOf(':');
                    const guildId = key.slice(0, separator);
                    const task = key.slice(separator + 1);
                    this.pauseTask(guildId, task);
                    this.reconcileGuild(guildId).catch(error => {
                        console.error(`Worker kesintisi sırasında görev yeniden atanamadı (${guildId}, ${task}):`, error);
                    });
                }
            }
            const voiceGuildIds = new Set(
                [...this.voiceAssignments.entries()]
                    .filter(([, assignedWorker]) => assignedWorker === worker)
                    .map(([key]) => key.slice(0, key.indexOf(':')))
            );
            for (const guildId of voiceGuildIds) {
                this.pauseVoiceWorker(worker, guildId);
                this.reconcileGuild(guildId).catch(error => {
                    console.error(`Ses worker kesintisi sırasında görev yeniden atanamadı (${guildId}):`, error);
                });
            }
        });
        worker.on('shardReady', () => {
            worker.clusterAvailable = true;
            for (const guildId of this.masterClient.guilds.cache.keys()) {
                this.reconcileGuild(guildId).catch(error => {
                    console.error(`Worker bağlantısı geri geldikten sonra görev başlatılamadı (${guildId}):`, error);
                });
            }
        });

        try {
            for (const taskModule of taskModules) {
                taskModule.register(worker, this);
            }
        } catch (error) {
            worker.destroy();
            console.error(`Worker ${name} görev eklentileri başlatılamadı:`, error);
            return;
        }

        let readyTimer;
        let onReady;
        let onLoginError;
        const readyPromise = new Promise((resolve, reject) => {
            onReady = resolve;
            onLoginError = reject;
            worker.once('ready', onReady);
            worker.once('error', onLoginError);
            readyTimer = setTimeout(() => {
                reject(new Error(`Worker ${name} ${WORKER_READY_TIMEOUT_MS / 1000} saniye içinde hazır olmadı`));
            }, WORKER_READY_TIMEOUT_MS);
            readyTimer.unref?.();
        });

        try {
            await Promise.all([worker.login(token), readyPromise]);
            if (worker.user.id === this.masterClient.user.id
                || this.workers.some(existingWorker => existingWorker.user.id === worker.user.id)) {
                throw new Error(`Worker ${name} Ana Bot veya başka bir worker ile aynı bot hesabını kullanıyor`);
            }

            this.workers.push(worker);
            console.log(`Worker hazır: ${worker.user.tag} [${[...worker.workerTasks].join(', ')}]`);
        } catch (error) {
            worker.destroy();
            console.error(`Worker ${name} başlatılamadı; bu token ile worker görevleri kullanılamayacak:`, error);
        } finally {
            clearTimeout(readyTimer);
            worker.removeListener('ready', onReady);
            worker.removeListener('error', onLoginError);
        }
    }

    getWorkerForGuild(guildId, task) {
        if (task === 'voice') {
            throw new Error('Ses worker yönlendirmesi için hedef kanal belirtilmelidir');
        }

        if (!this.isMasterActiveForGuild(guildId)) {
            throw new Error(`Ana Bot bu sunucuda hazır değil (${guildId}); worker görevi durduruldu`);
        }

        const assignmentKey = `${guildId}:${task}`;
        const assignedWorker = this.guildAssignments.get(assignmentKey);
        if (assignedWorker?.isReady()
            && assignedWorker.workerTasks.has(task)
            && assignedWorker.guilds.cache.has(guildId)
            && assignedWorker.clusterAvailable !== false) {
            return assignedWorker;
        }

        if (assignedWorker) {
            this.pauseTask(guildId, task);
        }

        const availableWorkers = this.workers.filter(worker =>
            worker.isReady()
            && worker.workerTasks.has(task)
            && worker.guilds.cache.has(guildId)
            && worker.clusterAvailable !== false
        );
        if (availableWorkers.length === 0) {
            throw new Error(`Bu sunucuda '${task}' görevi için kullanılabilir worker yok (${guildId}); uygun worker botunu sunucuya ekleyip görevini yapılandırın`);
        }

        const nextIndex = this.nextWorkerIndex.get(task) || 0;
        const worker = availableWorkers[nextIndex % availableWorkers.length];
        this.nextWorkerIndex.set(task, nextIndex + 1);
        this.guildAssignments.set(assignmentKey, worker);
        return worker;
    }

    getWorkerForVoiceChannel(guildId, channelId, options = {}) {
        const { allowReassign = true } = options;

        if (!this.isMasterActiveForGuild(guildId)) {
            throw new Error(`Ana Bot bu sunucuda hazır değil (${guildId}); worker görevi durduruldu`);
        }

        const assignmentKey = `${guildId}:${channelId}`;
        const assignedWorker = this.voiceAssignments.get(assignmentKey);
        if (assignedWorker?.isReady()
            && assignedWorker.workerTasks.has('voice')
            && assignedWorker.guilds.cache.has(guildId)
            && assignedWorker.clusterAvailable !== false
            && this.voiceWorkerChannels.get(`${guildId}:${assignedWorker.user.id}`) === channelId) {
            return assignedWorker;
        }

        if (assignedWorker) {
            this.releaseVoiceAssignment(guildId, channelId, assignedWorker);
        }

        // 1. Aşama: Bu sunucuda boşta (herhangi bir kanalda olmayan) bir ses worker'ı bul
        const idleWorkers = this.workers.filter(worker => {
            if (!worker.isReady()
                || !worker.workerTasks.has('voice')
                || !worker.guilds.cache.has(guildId)
                || worker.clusterAvailable === false) {
                return false;
            }

            const occupiedChannelId = this.voiceWorkerChannels.get(`${guildId}:${worker.user.id}`);
            return !occupiedChannelId;
        });

        if (idleWorkers.length > 0) {
            const indexKey = `${guildId}:voice`;
            const nextIndex = this.nextVoiceWorkerIndex.get(indexKey) || 0;
            const worker = idleWorkers[nextIndex % idleWorkers.length];
            this.nextVoiceWorkerIndex.set(indexKey, nextIndex + 1);
            this.voiceAssignments.set(assignmentKey, worker);
            this.voiceWorkerChannels.set(`${guildId}:${worker.user.id}`, channelId);
            return worker;
        }

        // 2. Aşama: Boşta worker yoksa fakat dinamik yeniden atama izinliyse:
        // Bu sunucuya atanmış mevcut worker'lardan birini yeni kanala yönlendir
        if (allowReassign) {
            const serverWorkers = this.workers.filter(worker =>
                worker.isReady()
                && worker.workerTasks.has('voice')
                && worker.guilds.cache.has(guildId)
                && worker.clusterAvailable !== false
            );

            if (serverWorkers.length > 0) {
                const indexKey = `${guildId}:voice:reassign`;
                const nextIndex = this.nextVoiceWorkerIndex.get(indexKey) || 0;
                const worker = serverWorkers[nextIndex % serverWorkers.length];
                this.nextVoiceWorkerIndex.set(indexKey, nextIndex + 1);

                const oldChannelId = this.voiceWorkerChannels.get(`${guildId}:${worker.user.id}`);
                if (oldChannelId) {
                    this.releaseVoiceAssignment(guildId, oldChannelId, worker);
                }

                this.voiceAssignments.set(assignmentKey, worker);
                this.voiceWorkerChannels.set(`${guildId}:${worker.user.id}`, channelId);
                return worker;
            }
        }

        throw new Error(
            `Bu sunucuda (${guildId}) ses görevi için uygun ses worker'ı bulunamadı. Lütfen ses görevi tanımlı bir worker botunun sunucuya eklendiğinden emin olun.`
        );
    }

    updateWorkerVoiceChannel(worker, guildId, newChannelId) {
        if (!worker?.user?.id || !guildId || !newChannelId) {
            return;
        }
        const workerKey = `${guildId}:${worker.user.id}`;
        const previousChannelId = this.voiceWorkerChannels.get(workerKey);
        if (previousChannelId && previousChannelId !== newChannelId) {
            const prevAssignmentKey = `${guildId}:${previousChannelId}`;
            if (this.voiceAssignments.get(prevAssignmentKey) === worker) {
                this.voiceAssignments.delete(prevAssignmentKey);
            }
        }
        this.voiceWorkerChannels.set(workerKey, newChannelId);
        this.voiceAssignments.set(`${guildId}:${newChannelId}`, worker);
    }

    async reconcileGuild(guildId) {
        if (!this.isMasterActiveForGuild(guildId)) {
            return false;
        }

        const settings = this.masterClient.settings.getGuildSettings(guildId);
        for (const task of this.taskModules.keys()) {
            if (task === 'voice') {
                continue;
            }
            if (!this.workers.some(worker => worker.workerTasks.has(task))) {
                continue;
            }
            try {
                this.getWorkerForGuild(guildId, task);
            } catch (error) {
                console.warn(`Worker görevi '${task}' beklemede (${guildId}): ${error.message}`);
            }
        }

        const configuredVoiceChannelIds = Array.isArray(settings.voiceChannelIds)
            && settings.voiceChannelIds.length
            ? settings.voiceChannelIds
            : settings.voiceChannelId
                ? [settings.voiceChannelId]
                : [];
        
        // Sabit ses kanalı yapılandırılmamışsa bot hata vermez, sessizce devam eder (Sabit kanal zorunlu değildir)
        if (configuredVoiceChannelIds.length === 0) {
            return true;
        }

        const results = await Promise.all(configuredVoiceChannelIds.map(async channelId => {
            try {
                await this.connectVoiceChannel(guildId, channelId, { allowReassign: false });
                return true;
            } catch (error) {
                console.warn(`Ses worker görevi beklemede (${guildId}, ${channelId}): ${error.message}`);
                return false;
            }
        }));
        return results.every(Boolean);
    }

    async connectVoiceChannel(guildId, channelId, options = {}) {
        const masterChannel = this.masterClient.channels.cache.get(channelId)
            || await this.masterClient.channels.fetch(channelId).catch(() => null);
        if (!masterChannel || masterChannel.guildId !== guildId) {
            throw new Error(`Ses kanalı (${channelId}) bu sunucuya ait değil veya erişilemiyor`);
        }

        const worker = this.getWorkerForVoiceChannel(guildId, channelId, options);
        try {
            return await this.runTaskOnWorker(
                worker,
                'voice',
                'connectVoiceChannel',
                channelId,
                options
            );
        } catch (error) {
            console.error(
                `Ses worker ${worker.workerName || worker.user?.tag} ${channelId} kanalına bağlanamadı:`,
                error.message || error
            );
            this.releaseVoiceAssignment(guildId, channelId, worker);
            throw error;
        }
    }

    async connectPersistentVoiceChannel(guildId, channelId, options = {}) {
        return this.connectVoiceChannel(guildId, channelId, options);
    }

    disconnectVoiceChannel(guildId, channelId) {
        const assignmentKey = `${guildId}:${channelId}`;
        const worker = this.voiceAssignments.get(assignmentKey);
        if (!worker) {
            return false;
        }

        this.releaseVoiceAssignment(guildId, channelId, worker);
        return worker.voiceService.disconnectPersistentVoiceChannelForGuild(guildId, worker);
    }

    disconnectPersistentVoiceChannel(guildId, channelId) {
        return this.disconnectVoiceChannel(guildId, channelId);
    }

    async createRegistrationTicket(guildId, data) {
        return this.runTask(guildId, 'registration', 'createRegistrationTicket', data);
    }

    async joinMemberVoiceChannel(guildId, userId, targetChannelId = null) {
        if (!this.isMasterActiveForGuild(guildId)) {
            throw new Error(`Ana Bot bu sunucuda hazır değil (${guildId}); worker görevi durduruldu`);
        }

        let channelId = targetChannelId;
        if (!channelId) {
            try {
                const guild = this.masterClient.guilds.cache.get(guildId) || await this.masterClient.guilds.fetch(guildId);
                const member = await guild.members.fetch(userId);
                channelId = member?.voice?.channelId;
            } catch {
                // Üye fetch edilemezse devam et
            }
        }

        if (!channelId) {
            const settings = this.masterClient.settings?.getGuildSettings?.(guildId) || {};
            channelId = Array.isArray(settings.voiceChannelIds) && settings.voiceChannelIds.length
                ? settings.voiceChannelIds[0]
                : settings.voiceChannelId;
        }

        if (!channelId) {
            return null;
        }

        return this.connectVoiceChannel(guildId, channelId, { allowReassign: true });
    }

    async runTask(guildId, task, operation, ...args) {
        const worker = this.getWorkerForGuild(guildId, task);
        return this.runTaskOnWorker(worker, task, operation, ...args);
    }

    async runTaskOnWorker(worker, task, operation, ...args) {
        const taskModule = this.taskModules.get(task);
        if (typeof taskModule?.[operation] !== 'function') {
            throw new Error(`Worker task '${task}' does not implement operation '${operation}'`);
        }
        return taskModule[operation](worker, ...args);
    }

    removeWorkerFromGuild(worker, guildId) {
        for (const [key, assignedWorker] of this.guildAssignments) {
            if (assignedWorker === worker && key.startsWith(`${guildId}:`)) {
                this.pauseTask(guildId, key.slice(guildId.length + 1));
            }
        }
        this.pauseVoiceWorker(worker, guildId);
    }

    pauseTask(guildId, task) {
        this.guildAssignments.delete(`${guildId}:${task}`);
    }

    releaseVoiceAssignment(guildId, channelId, worker) {
        const assignmentKey = `${guildId}:${channelId}`;
        const workerKey = `${guildId}:${worker.user.id}`;
        if (this.voiceAssignments.get(assignmentKey) === worker) {
            this.voiceAssignments.delete(assignmentKey);
        }
        if (this.voiceWorkerChannels.get(workerKey) === channelId) {
            this.voiceWorkerChannels.delete(workerKey);
        }
    }

    pauseVoiceWorker(worker, guildId) {
        for (const [key, assignedWorker] of this.voiceAssignments) {
            if (assignedWorker === worker && key.startsWith(`${guildId}:`)) {
                const channelId = key.slice(guildId.length + 1);
                this.releaseVoiceAssignment(guildId, channelId, worker);
            }
        }
        worker.voiceService.disconnectPersistentVoiceChannelForGuild(guildId, worker);
    }

    isWorkerActiveForVoiceChannel(worker, guildId, channelId) {
        return this.voiceAssignments.get(`${guildId}:${channelId}`) === worker
            && this.isMasterActiveForGuild(guildId)
            && worker?.isReady()
            && worker.guilds.cache.has(guildId)
            && worker.clusterAvailable !== false;
    }

    pauseGuild(guildId) {
        for (const key of [...this.guildAssignments.keys()]) {
            if (key.startsWith(`${guildId}:`)) {
                this.pauseTask(guildId, key.slice(guildId.length + 1));
            }
        }
        for (const worker of this.workers) {
            this.pauseVoiceWorker(worker, guildId);
        }
        for (const key of [...this.voiceAssignments.keys()]) {
            if (key.startsWith(`${guildId}:`)) {
                const channelId = key.slice(guildId.length + 1);
                const worker = this.voiceAssignments.get(key);
                if (worker) {
                    this.releaseVoiceAssignment(guildId, channelId, worker);
                }
            }
        }
    }

    isWorkerActiveForGuild(worker, guildId, task) {
        if (task === 'voice') {
            return [...this.voiceAssignments.entries()].some(([key, assignedWorker]) =>
                assignedWorker === worker && key.startsWith(`${guildId}:`)
            );
        }
        if (!worker || this.guildAssignments.get(`${guildId}:${task}`) !== worker) {
            return false;
        }

        try {
            return this.getWorkerForGuild(guildId, task) === worker;
        } catch {
            return false;
        }
    }

    isMasterActiveForGuild(guildId) {
        return !this.destroyed
            && this.masterClient.isReady()
            && this.masterClient.guilds.cache.has(guildId);
    }

    pauseAllGuilds() {
        const guildIds = new Set(
            [...this.guildAssignments.keys(), ...this.voiceAssignments.keys()]
                .map(key => key.slice(0, key.indexOf(':')))
        );
        for (const guildId of guildIds) {
            this.pauseGuild(guildId);
        }
        this.masterClient.voiceService.disconnectAllPersistentVoiceChannels();
        for (const worker of this.workers) {
            for (const collector of worker.registrationTimeouts?.values() || []) {
                collector.stop('coordinator-unavailable');
            }
        }
    }

    destroy() {
        this.destroyed = true;
        this.pauseAllGuilds();
        for (const worker of this.workers) {
            worker.destroy();
        }
        this.workers = [];
    }
}

module.exports = {
    WorkerManager,
    getWorkerConfigurations,
    limitVoiceWorkerConfigurations,
    MAX_VOICE_WORKERS
};
