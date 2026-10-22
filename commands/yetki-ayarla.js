const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { checkCommandAccess } = require('../utils/interaction-guard');

const command = new SlashCommandBuilder()
    .setName('yetki-ayarla')
    .setDescription('Sunucuya özel yönetici ve log/güvenlik rollerini ayarlar.')
    .addRoleOption(option =>
        option.setName('yonetici_rolu')
            .setDescription('Sistem ayarlarını kullanabilecek özel yönetici rolü')
            .setRequired(false))
    .addRoleOption(option =>
        option.setName('log_rolu')
            .setDescription('Log ayarlarını yönetebilecek log/güvenlik rolü')
            .setRequired(false))
    .addBooleanOption(option =>
        option.setName('yonetici_rolunu_kaldir')
            .setDescription('Kayıtlı özel yönetici rolünü kaldır')
            .setRequired(false))
    .addBooleanOption(option =>
        option.setName('log_rolunu_kaldir')
            .setDescription('Kayıtlı log/güvenlik rolünü kaldır')
            .setRequired(false))
    .setDefaultMemberPermissions(0n);

module.exports = client => {
    client.commands.set(command.name, command);

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return;
        if (!await checkCommandAccess(interaction, 'configureRoles')) return;

        const administratorRole = interaction.options.getRole('yonetici_rolu');
        const logRole = interaction.options.getRole('log_rolu');
        const removeAdministratorRole = interaction.options.getBoolean('yonetici_rolunu_kaldir') === true;
        const removeLogRole = interaction.options.getBoolean('log_rolunu_kaldir') === true;

        if (!administratorRole && !logRole && !removeAdministratorRole && !removeLogRole) {
            return interaction.reply({
                content: '❌ En az bir rol seçin veya kaldırılacak rol seçeneğini etkinleştirin.',
                flags: 64
            });
        }

        if ((administratorRole && removeAdministratorRole) || (logRole && removeLogRole)) {
            return interaction.reply({
                content: '❌ Aynı rol için hem yeni rol seçip hem kaldırma seçeneğini kullanamazsınız.',
                flags: 64
            });
        }

        if ([administratorRole, logRole].some(role => role?.id === interaction.guildId)) {
            return interaction.reply({
                content: '❌ @everyone rolü yetkili rolü olarak atanamaz.',
                flags: 64
            });
        }

        const updates = {};
        if (administratorRole || removeAdministratorRole) {
            updates.adminRoleId = administratorRole?.id || null;
        }
        if (logRole || removeLogRole) {
            updates.logSecurityRoleId = logRole?.id || null;
        }

        client.settings.updateGuildSettings(interaction.guildId, updates);

        const embed = createEmbed({
            title: '✅ Yetki rolleri güncellendi',
            description: 'Bu sunucudaki özel görev rolleri kaydedildi.'
        }).addFields(
            {
                name: 'Yönetici rolü',
                value: administratorRole
                    ? `${administratorRole}`
                    : (removeAdministratorRole ? 'Kaldırıldı' : 'Değiştirilmedi'),
                inline: true
            },
            {
                name: 'Log/güvenlik rolü',
                value: logRole
                    ? `${logRole}`
                    : (removeLogRole ? 'Kaldırıldı' : 'Değiştirilmedi'),
                inline: true
            },
            {
                name: 'Kayıt yetkilisi rolü',
                value: 'Mevcut `/setup` komutundaki `rol` ayarı kullanılır.',
                inline: false
            }
        );

        return interaction.reply({ embeds: [embed], flags: 64 });
    });
};
