const {
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const { PermissionsBitField } = require('discord.js');

async function joinMemberVoiceChannel(member) {
    const channel = member?.voice?.channel;
    if (!channel) {
        return null;
    }

    const botMember = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(botMember);
    if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
        throw new Error(`Bot does not have permission to connect to voice channel ${channel.id}`);
    }

    const existingConnection = getVoiceConnection(channel.guild.id);
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false
    });

    if (!existingConnection) {
        connection.on('error', error => {
            console.error(`Voice connection error in guild ${channel.guild.id}:`, error);
        });
    }

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (error) {
        if (connection.state.status !== VoiceConnectionStatus.Ready) {
            connection.destroy();
        }
        throw error;
    }

    return channel;
}

module.exports = { joinMemberVoiceChannel };
