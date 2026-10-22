const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
require('dotenv').config();

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

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);