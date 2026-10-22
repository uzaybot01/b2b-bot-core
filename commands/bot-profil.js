const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embeds');

const command = new SlashCommandBuilder()
    .setName('bot-profil')
    .setDescription('Botun profil fotoğrafını günceller.')
    .addAttachmentOption(option =>
        option.setName('gorsel')
            .setDescription('Bot profilinde kullanılacak görsel dosyası')
            .setRequired(true))
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

        const image = interaction.options.getAttachment('gorsel', true);
        if (image.contentType && !image.contentType.startsWith('image/')) {
            return interaction.reply({
                content: '❌ Lütfen geçerli bir görsel dosyası yükleyin.',
                flags: 64
            });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            const response = await fetch(image.url);
            if (!response.ok) {
                throw new Error(`Profil görseli indirilemedi (HTTP ${response.status})`);
            }

            const contentType = image.contentType || response.headers.get('content-type');
            if (!contentType?.startsWith('image/')) {
                throw new Error('Yüklenen dosya geçerli bir görsel değil');
            }

            const imageData = Buffer.from(await response.arrayBuffer());
            if (imageData.length === 0) {
                throw new Error('Yüklenen görsel boş');
            }

            const avatar = `data:${contentType};base64,${imageData.toString('base64')}`;
            await client.user.setAvatar(avatar);
            return interaction.editReply({
                embeds: [createEmbed({
                    title: '✅ Bot profil fotoğrafı güncellendi',
                    description: 'Yüklediğiniz görsel botun yeni profil fotoğrafı olarak ayarlandı.',
                    image: image.url
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
