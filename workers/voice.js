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
    async connectVoiceChannel(client, channelId, options) {
        return client.voiceService.connectVoiceChannelById(client, channelId, options);
    },
    async connectPersistentVoiceChannel(client, channelId, options) {
        return client.voiceService.connectVoiceChannelById(client, channelId, options);
    },
    async disconnectVoiceChannel(client, guildId) {
        return client.voiceService.disconnectPersistentVoiceChannelForGuild(guildId, client);
    },
    async disconnectPersistentVoiceChannel(client, guildId) {
        return client.voiceService.disconnectPersistentVoiceChannelForGuild(guildId, client);
    },
    async joinMemberVoiceChannel(client, guildId, userId, channelId) {
        if (channelId) {
            return client.voiceService.connectVoiceChannelById(client, channelId);
        }

        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            throw new Error(`Voice worker ${client.workerName || client.user?.tag} requires a guild-scoped member lookup`);
        }
        const member = await guild.members.fetch(userId).catch(() => null);
        return client.voiceService.joinMemberVoiceChannel(member);
    }
};
