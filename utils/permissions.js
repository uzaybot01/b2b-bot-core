const { PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('./embeds');

const permissionMessages = {
    admin: 'Bu işlem için sunucu yöneticisi veya sunucuda tanımlanmış yönetici rolü gerekir.',
    configureRoles: 'Yetki rollerini yalnızca sunucu sahibi veya Administrator iznine sahip üyeler yapılandırabilir.',
    log: 'Bu işlem için log/güvenlik yetkilisi, özel yönetici veya sunucu yöneticisi olmanız gerekir.',
    registration: 'Bu işlem yalnızca kayıt yetkilileri, özel yöneticiler veya sunucu yöneticileri tarafından yapılabilir.'
};

function hasAdministratorPermission(interaction) {
    if (interaction.guild?.ownerId === interaction.user?.id) {
        return true;
    }

    return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
        || false;
}

function hasRole(interaction, roleId) {
    if (!roleId) {
        return false;
    }

    const roles = interaction.member?.roles;
    if (roles?.cache?.has(roleId)) {
        return true;
    }

    return Array.isArray(roles) && roles.includes(roleId);
}

async function checkPermission(interaction, requiredPermission) {
    if (requiredPermission === 'public') {
        return true;
    }

    const isDiscordAdministrator = hasAdministratorPermission(interaction);
    const guildSettings = interaction.guildId
        ? interaction.client.settings.getGuildSettings(interaction.guildId)
        : {};
    const isAdministrator = isDiscordAdministrator
        || hasRole(interaction, guildSettings.adminRoleId);
    let allowed = false;

    if (requiredPermission === 'configureRoles') {
        allowed = isDiscordAdministrator;
    } else if (requiredPermission === 'admin') {
        allowed = isAdministrator;
    } else if (requiredPermission === 'log') {
        allowed = isAdministrator || hasRole(interaction, guildSettings.logSecurityRoleId);
    } else if (requiredPermission === 'registration') {
        allowed = isAdministrator || hasRole(interaction, guildSettings.roleId);
    }

    if (allowed) {
        return true;
    }

    const embed = createEmbed({
        title: '🔒 Yetersiz yetki',
        description: permissionMessages[requiredPermission]
            || 'Bu işlemi gerçekleştirmek için gerekli yetkiye sahip değilsiniz.',
        color: '#ED4245',
        timestamp: false
    });
    const response = { embeds: [embed], flags: 64 };

    if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response);
    } else {
        await interaction.reply(response);
    }

    return false;
}

module.exports = { checkPermission };
