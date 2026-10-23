const { GatewayIntentBits } = require('discord.js');

module.exports = {
    task: 'voice',
    intents: [
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ],
    register(client) {
        client.voiceService.attachVoiceStateMonitor(client);
    },
    async connectPersistentVoiceChannel(client, channelId) {
        return client.voiceService.connectPersistentVoiceChannelById(client, channelId);
    },
    async joinMemberVoiceChannel(client, guildId, userId, channelId) {
        if (channelId) {
            return client.voiceService.connectPersistentVoiceChannelById(client, channelId);
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            throw new Error(`Voice worker ${client.workerName} requires a guild-scoped member lookup`);
        }
        const member = await guild.members.fetch(userId);
        return client.voiceService.joinMemberVoiceChannel(member);
    }
};
