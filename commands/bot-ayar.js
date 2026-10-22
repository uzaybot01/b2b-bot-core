const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { isValidHttpUrl } = require('../utils/validation');
const { sanitizeText } = require('../utils/input');
const { checkCommandAccess } = require('../utils/interaction-guard');

module.exports = client => {
    const command = new SlashCommandBuilder()
        .setName('bot-ayar')
        .setDescription('Sunucuya özel panel logosunu ayarlar.')
        .addStringOption(option =>
            option.setName('logo')
                .setDescription('Kullanılacak logo veya görselin HTTP/HTTPS bağlantısı')
                .setMaxLength(2048)
                .setRequired(true))
        .setDefaultMemberPermissions(0n);

    client.commands.set(command.name, command);

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return;
        if (!await checkCommandAccess(interaction, 'admin')) return;

        const logo = sanitizeText(interaction.options.getString('logo', true), { maxLength: 2048 });
        if (!isValidHttpUrl(logo)) {
            return interaction.reply({
                content: '❌ Logo için geçerli bir HTTP veya HTTPS URL’si girin.',
                flags: 64
            });
        }

        client.settings.updateGuildSettings(interaction.guildId, { customLogo: logo });

        return interaction.reply({
            embeds: [createEmbed({
                title: '✅ Sunucu logosu güncellendi',
                description: 'Kayıt paneli ve karşılama mesajı için bu sunucu logosu kullanılacak.',
                image: logo
            })],
            flags: 64
        });
    });
};
