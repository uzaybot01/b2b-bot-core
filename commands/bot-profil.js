const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { isValidHttpUrl } = require('../utils/validation');

const command = new SlashCommandBuilder()
    .setName('bot-profil')
    .setDescription('Botun profil fotoğrafını günceller.')
    .addAttachmentOption(option =>
        option.setName('gorsel')
            .setDescription('Bot profilinde kullanılacak görsel dosyası')
            .setRequired(false))
    .addStringOption(option =>
        option.setName('url')
            .setDescription('Bot profilinde kullanılacak görselin HTTP/HTTPS bağlantısı')
            .setMaxLength(2048)
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

function isRateLimitError(error) {
    return error.status === 429
        || error.code === 429
        || error.rawError?.code === 429
        || error.message?.toLowerCase().includes('rate limit');
}

module.exports = client => {
    client.commands.set(command.name, command);

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ Bu komutu yalnızca sunucu yöneticileri kullanabilir.',
                flags: 64
            });
        }

        const image = interaction.options.getAttachment('gorsel');
        const imageUrl = interaction.options.getString('url');

        if (Boolean(image) === Boolean(imageUrl)) {
            return interaction.reply({
                content: '❌ Profil görseli için ya bir dosya yükleyin ya da bir URL girin.',
                flags: 64
            });
        }

        if (image?.contentType && !image.contentType.startsWith('image/')) {
            return interaction.reply({
                content: '❌ Lütfen geçerli bir görsel dosyası yükleyin.',
                flags: 64
            });
        }

        const avatarUrl = image?.url || imageUrl;
        if (!isValidHttpUrl(avatarUrl)) {
            return interaction.reply({
                content: '❌ Görsel için geçerli bir HTTP veya HTTPS URL’si girin.',
                flags: 64
            });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            await client.user.setAvatar(avatarUrl);
            return interaction.editReply({
                embeds: [createEmbed({
                    title: '✅ Bot profil fotoğrafı güncellendi',
                    description: 'Gönderdiğiniz görsel botun genel profil fotoğrafı olarak ayarlandı.',
                    image: avatarUrl
                })]
            });
        } catch (error) {
            console.error('Bot profil fotoğrafı güncellenemedi:', error);

            const message = isRateLimitError(error)
                ? '⏳ Discord profil fotoğrafı değişikliklerini sınırlıyor. Lütfen bir süre bekleyip tekrar deneyin.'
                : '❌ Profil fotoğrafı güncellenemedi. Görselin geçerli olduğundan emin olun ve daha sonra tekrar deneyin.';

            return interaction.editReply({ content: message });
        }
    });
};
