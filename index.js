const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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
client.settings = require('./utils/settings');
client.voiceService = require('./utils/voice');

let shuttingDown = false;
function handleFatalError(error, source) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.error(`Kritik süreç hatası (${source}); bot güvenli biçimde kapatılıyor:`, error);
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
    client.voiceService.connectConfiguredVoiceChannels(client).catch(error => {
        console.error('Sunucuların sabit ses kanalı ayarları yüklenemedi:', error);
    });

    try {
        const commands = [...client.commands.values()].map(command => command.toJSON());
        await client.application.commands.set(commands);
        console.log(`Slash komutları yüklendi: ${commands.length}`);
    } catch (error) {
        console.error('Slash komutları yüklenirken hata oluştu:', error);
    }

    console.log(`Bot başarıyla aktif edildi: ${client.user.tag}`);
});

client.on('guildCreate', guild => {
    client.voiceService.connectConfiguredVoiceChannelForGuild(client, guild).catch(error => {
        console.error(`Yeni sunucunun sabit ses ayarı yüklenemedi (${guild.id}):`, error);
    });
});

client.on('guildDelete', guild => {
    client.voiceService.disconnectPersistentVoiceChannelForGuild(guild.id);

    try {
        const removed = client.settings.deleteGuildSettings(guild.id);
        if (removed) {
            console.log(`Sunucudan ayrılındı; sunucu ayar dosyası silindi (${guild.id}).`);
        }
    } catch (error) {
        console.error(`Sunucudan ayrılırken ayar dosyası silinemedi (${guild.id}):`, error);
    }
});

const botToken = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!botToken) {
    throw new Error('Bot token bulunamadı. .env içinde BOT_TOKEN veya DISCORD_TOKEN tanımlayın.');
}

client.login(botToken).catch(error => {
    console.error('Discord bot oturumu açılamadı. Token ve ağ ayarlarını kontrol edin:', error);
    client.destroy();
    process.exitCode = 1;
});