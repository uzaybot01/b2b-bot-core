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

// Modülleri güncel dosya adlarına göre bağlıyoruz
require('./allusermessage.js')(client);
require('./sigun-up.js')(client); // Dosya adınla birebir aynı

client.once('ready', () => {
    console.log(`Bot başarıyla aktif edildi: ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);