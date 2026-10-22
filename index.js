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

client.once('ready', () => {
    console.log(`Bot başarıyla aktif edildi: ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);