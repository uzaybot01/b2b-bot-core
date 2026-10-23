const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const masterToken = process.env.MASTER_TOKEN || process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!masterToken) {
    throw new Error('Ana Bot token bulunamadı. .env içinde MASTER_TOKEN veya DISCORD_TOKEN tanımlayın.');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.commands = new Collection();
client.isMaster = true;
client.settings = require('./utils/settings');
client.voiceService = require('./utils/voice');
client.workerManager = new (require('./utils/worker-manager').WorkerManager)(client, masterToken);

let shuttingDown = false;
function handleFatalError(error, source) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.error(`Kritik süreç hatası (${source}); bot güvenli biçimde kapatılıyor:`, error);
    client.workerManager.destroy();
    client.destroy();
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 1_000);
}

process.on('unhandledRejection', reason => {
    handleFatalError(reason, 'unhandledRejection');
});

process.on('uncaughtException', error => {
    handleFatalError(error, 'uncaughtException');
});

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'))
    .sort();

for (const file of commandFiles) {
    const commandPath = path.join(commandsPath, file);
    const registerModule = require(commandPath);

    if (typeof registerModule !== 'function') {
        throw new TypeError(`Komut modülü bir kayıt fonksiyonu dışa aktarmalı: ${file}`);
    }

    registerModule(client);
    console.log(`Modül yüklendi: ${file}`);
}

client.once('ready', async () => {
    try {
        await client.workerManager.start();
    } catch (error) {
        console.error('Worker havuzu başlatılırken hata oluştu:', error);
    }

    try {
        const commands = [...client.commands.values()].map(command => command.toJSON());
        await client.application.commands.set(commands);
        console.log(`Slash komutları yüklendi: ${commands.length}`);
    } catch (error) {
        console.error('Slash komutları yüklenirken hata oluştu:', error);
    }

    console.log(`Bot başarıyla aktif edildi: ${client.user.tag}`);
});

client.on('guildDelete', guild => {
    try {
        const removed = client.settings.deleteGuildSettings(guild.id);
        if (removed) {
            console.log(`Sunucudan ayrılındı; sunucu ayar dosyası silindi (${guild.id}).`);
        }
    } catch (error) {
        console.error(`Sunucudan ayrılırken ayar dosyası silinemedi (${guild.id}):`, error);
    }
});

client.login(masterToken).catch(error => {
    console.error('Discord bot oturumu açılamadı. Token ve ağ ayarlarını kontrol edin:', error);
    client.destroy();
    process.exitCode = 1;
});