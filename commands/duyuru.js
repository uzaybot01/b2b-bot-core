const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isValidHttpUrl(string) {
    if (!string || typeof string !== 'string') return false;
    try {
        const url = new URL(string.trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function hasPermission(member, guild, client) {
    if (!member || !guild) return false;

    if (guild.ownerId === member.id || guild.ownerId === member.user?.id) {
        return true;
    }

    if (member.permissions?.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    const guildSettings = client.settings?.getGuildSettings?.(guild.id) || {};
    const adminRoleId = guildSettings.adminRoleId;
    if (adminRoleId && member.roles?.cache?.has(adminRoleId)) {
        return true;
    }

    return false;
}

const bildiriCommand = new SlashCommandBuilder()
    .setName('bildiri')
    .setDescription('Hedef role form penceresi (Modal) üzerinden kişiselleştirilmiş toplu bildiri gönderir.')
    .addRoleOption(option =>
        option.setName('rol')
            .setDescription('Bildirinin gönderileceği hedef rol')
            .setRequired(true))
    .setDefaultMemberPermissions(0n);

module.exports = (client) => {
    client.commands.set(bildiriCommand.name, bildiriCommand);

    client.on('interactionCreate', async interaction => {
        // 1. Slash Komut: /bildiri rol:@HedefRol
        if (interaction.isChatInputCommand() && interaction.commandName === bildiriCommand.name) {
            if (!hasPermission(interaction.member, interaction.guild, client)) {
                return interaction.reply({
                    content: '🔒 Bu komutu kullanabilmek için **Yönetici (Administrator)** yetkisine veya tanımlı yönetici rolüne sahip olmanız gerekir.',
                    flags: 64
                });
            }

            const targetRole = interaction.options.getRole('rol');
            if (!targetRole) {
                return interaction.reply({
                    content: '❌ Lütfen geçerli bir hedef rol seçin.',
                    flags: 64
                });
            }

            // Form Penceresi (Modal) Oluştur
            const modal = new ModalBuilder()
                .setCustomId(`bildiri_modal_${targetRole.id}`)
                .setTitle(`Toplu Bildiri • @${targetRole.name}`.slice(0, 45));

            const baslikInput = new TextInputBuilder()
                .setCustomId('bildiri_baslik')
                .setLabel('Bildiri Başlığı')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Örn: Toplantı Duyurusu / Önemli Bilgilendirme')
                .setRequired(true)
                .setMaxLength(256);

            const aciklamaInput = new TextInputBuilder()
                .setCustomId('bildiri_aciklama')
                .setLabel('Bildiri Açıklaması')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Üyelere iletilecek bildiri detaylarını girin...')
                .setRequired(true)
                .setMaxLength(2000);

            const gorselInput = new TextInputBuilder()
                .setCustomId('bildiri_gorsel')
                .setLabel('Görsel URL (İsteğe Bağlı)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://example.com/gorsel.png')
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(baslikInput),
                new ActionRowBuilder().addComponents(aciklamaInput),
                new ActionRowBuilder().addComponents(gorselInput)
            );

            return interaction.showModal(modal);
        }

        // 2. Modal Onayı: Form Gönderildiğinde
        if (interaction.isModalSubmit() && interaction.customId.startsWith('bildiri_modal_')) {
            const targetRoleId = interaction.customId.replace('bildiri_modal_', '');

            // İşlemi zaman aşımına uğramadan hemen ertele
            await interaction.deferReply({ flags: 64 });

            const title = interaction.fields.getTextInputValue('bildiri_baslik').trim();
            const descriptionText = interaction.fields.getTextInputValue('bildiri_aciklama').trim();
            const rawImageUrl = interaction.fields.getTextInputValue('bildiri_gorsel')?.trim() || null;
            let imageUrl = null;

            if (rawImageUrl) {
                if (isValidHttpUrl(rawImageUrl)) {
                    imageUrl = rawImageUrl;
                } else {
                    return interaction.editReply({
                        content: '⚠️ Belirttiğiniz görsel linki geçerli bir URL (`http://` veya `https://`) değil. Bildiri gönderimi iptal edildi.'
                    });
                }
            }

            const targetRole = interaction.guild.roles.cache.get(targetRoleId)
                || await interaction.guild.roles.fetch(targetRoleId).catch(() => null);

            if (!targetRole) {
                return interaction.editReply({
                    content: '❌ Hedef rol sunucuda bulunamadı veya silinmiş.'
                });
            }

            // Üyeleri eksiksiz önbelleğe al
            try {
                await interaction.guild.members.fetch();
            } catch (fetchError) {
                console.error('Üye önbelleği çekilirken hata:', fetchError);
            }

            const allRoleMembers = targetRole.members
                ? (typeof targetRole.members.values === 'function' ? [...targetRole.members.values()] : [...targetRole.members])
                : [];
            const targetMembers = allRoleMembers.filter(member => !member.user?.bot);

            if (targetMembers.length === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setTitle('⚠️ Gönderilecek Üye Bulunamadı')
                    .setDescription(`**${targetRole.name}** rolünde bot olmayan gerçek bir kullanıcı bulunmuyor.`)
                    .setTimestamp();

                return interaction.editReply({ embeds: [emptyEmbed] });
            }

            await interaction.editReply({
                content: `🚀 **${targetRole.name}** rolündeki **${targetMembers.length}** üyeye özel mesaj (DM) iletimi başlatıldı... Lütfen işlem tamamlanana kadar bekleyin.`
            });

            let successCount = 0;
            let failCount = 0;

            for (const member of targetMembers) {
                const recipientName = member.user?.displayName || member.user?.username || 'Değerli Üyemiz';
                const personalizedDescription = `Sayın **${recipientName}**,\n\n${descriptionText}`;

                const dmEmbed = new EmbedBuilder()
                    .setColor('#17161E') // Kurumsal dark tema rengi
                    .setTitle(title)
                    .setDescription(personalizedDescription)
                    .setFooter({
                        text: `${interaction.guild.name} • Toplu Bilgilendirme`,
                        iconURL: interaction.guild.iconURL() || undefined
                    })
                    .setTimestamp();

                if (imageUrl) {
                    dmEmbed.setImage(imageUrl);
                }

                try {
                    await member.send({ embeds: [dmEmbed] });
                    successCount += 1;
                } catch (dmError) {
                    failCount += 1;
                }

                // Rate limit koruması
                await delay(350);
            }

            const reportEmbed = new EmbedBuilder()
                .setColor(successCount > 0 ? '#57F287' : '#ED4245')
                .setTitle('📢 Toplu Bildiri Tamamlandı')
                .setDescription(`**${targetRole.name}** grubuna yönelik bildiri gönderimi tamamlandı.`)
                .addFields(
                    { name: '👥 Hedef Rol', value: `${targetRole} (${targetRole.name})`, inline: true },
                    { name: '✅ Başarılı', value: `${successCount} üye`, inline: true },
                    { name: '❌ Ulaşılamayan', value: `${failCount} üye`, inline: true },
                    { name: '📝 Başlık', value: title, inline: false },
                    { name: '🖼️ Görsel', value: imageUrl ? `[Görüntüle](${imageUrl})` : 'Belirtilmedi', inline: false }
                )
                .setFooter({
                    text: `İşlemi gerçekleştiren: ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL() || undefined
                })
                .setTimestamp();

            return interaction.editReply({
                content: null,
                embeds: [reportEmbed]
            });
        }
    });

    // 3. Prefix Rehberliği (!bildiri, !duyuru)
    client.on('messageCreate', async message => {
        if (message.author.bot || !message.guild) return;

        const content = message.content.trim().toLowerCase();
        if (content.startsWith('!bildiri') || content.startsWith('!duyuru')) {
            const infoEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('💡 Bildiri Sistemi Form Penceresine Taşındı!')
                .setDescription(
                    'Toplu bildiri gönderimi kullanıcı hatalarını sıfıra indirmek için artık **Discord Form Penceresi (Modal)** ile çalışmaktadır.\n\n' +
                    'Kullanmak için lütfen **`/bildiri`** komutunu yazıp hedef rolü seçin; ardından açılan form penceresini doldurun.'
                )
                .setFooter({ text: 'Uzay Bot • Güvenli Form Altyapısı' });

            return message.reply({ embeds: [infoEmbed] });
        }
    });
};

module.exports.bildiriCommand = bildiriCommand;