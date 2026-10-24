const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

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

function hasPermission(message, client) {
    if (message.guild.ownerId === message.author.id) {
        return true;
    }

    if (message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    const guildSettings = client.settings?.getGuildSettings?.(message.guild.id) || {};
    const adminRoleId = guildSettings.adminRoleId;
    if (adminRoleId && message.member?.roles?.cache?.has(adminRoleId)) {
        return true;
    }

    return false;
}

module.exports = (client) => {
    client.on('messageCreate', async message => {
        if (message.author.bot || !message.guild) return;

        const content = message.content.trim();
        const triggers = ['!bildiri', '!duyuru'];
        const matchedTrigger = triggers.find(trigger =>
            content === trigger || content.startsWith(`${trigger} `)
        );

        if (!matchedTrigger) return;

        // 1. Yetki Kontrolü
        if (!hasPermission(message, client)) {
            const unauthorizedEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('🔒 Yetersiz Yetki')
                .setDescription('Bu komutu kullanabilmek için **Yönetici (Administrator)** yetkisine veya tanımlı yönetici rolüne sahip olmanız gerekir.')
                .setTimestamp();

            return message.reply({ embeds: [unauthorizedEmbed] });
        }

        // 2. Argümanları Ayrıştırma
        const rawArgs = content.slice(matchedTrigger.length).trim();
        if (!rawArgs) {
            const usageEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📖 Toplu Bildiri Komut Kullanımı')
                .setDescription(
                    'Rol bazlı toplu özel mesaj göndermek için aşağıdaki formatı kullanın:\n\n' +
                    '`!bildiri @HedefRol Başlık | Açıklama metni | Görsel_Linki`\n\n' +
                    '**Örnekler:**\n' +
                    '• `!bildiri @Ekip Toplantı Hatırlatması | Akşam 21:00\'da sesli odada toplanıyoruz.`\n' +
                    '• `!bildiri @VIP Özel Etkinlik | Sunucumuza özel turnuva başlıyor! | https://example.com/gorsel.png`'
                )
                .setFooter({ text: 'Not: Görsel linki isteğe bağlıdır; | işaretiyle ayrılır.' });

            return message.reply({ embeds: [usageEmbed] });
        }

        // Rol tespiti: İlk mention edilen rol veya ilk kelimedeki rol ID'si
        const roleMentionMatch = rawArgs.match(/^<@&(\d+)>|^(\d+)/);
        let targetRole = null;

        if (roleMentionMatch) {
            const roleId = roleMentionMatch[1] || roleMentionMatch[2];
            targetRole = message.guild.roles.cache.get(roleId);
        }

        if (!targetRole && message.mentions?.roles) {
            targetRole = typeof message.mentions.roles.first === 'function'
                ? message.mentions.roles.first()
                : [...message.mentions.roles.values()][0];
        }

        if (!targetRole) {
            return message.reply({
                content: '❌ Lütfen geçerli bir rol etiketleyin veya rol ID\'si belirtin.\n**Örnek:** `!bildiri @HedefRol Başlık | Açıklama metni | Görsel_Linki`'
            });
        }

        // Rol etiketini metinden temizle
        let textAfterRole = rawArgs;
        if (roleMentionMatch) {
            textAfterRole = rawArgs.slice(roleMentionMatch[0].length).trim();
        } else {
            textAfterRole = rawArgs.replace(new RegExp(`^<@&?${targetRole.id}>|^${targetRole.id}`), '').trim();
        }

        // Pipe (|) işaretlerine göre ayır: Başlık | Açıklama | Görsel
        const parts = textAfterRole.split('|').map(part => part.trim()).filter(Boolean);

        if (parts.length < 2) {
            return message.reply({
                content: '❌ Hatalı format! Başlık ve açıklama alanları zorunludur ve `|` işareti ile ayrılmalıdır.\n**Format:** `!bildiri @HedefRol Başlık | Açıklama metni | [İsteğe Bağlı Görsel Linki]`'
            });
        }

        const title = parts[0];
        const descriptionText = parts[1];
        const rawImageUrl = parts[2] || null;
        let imageUrl = null;

        if (rawImageUrl) {
            if (isValidHttpUrl(rawImageUrl)) {
                imageUrl = rawImageUrl;
            } else {
                return message.reply({
                    content: '⚠️ Belirttiğiniz görsel linki geçerli bir URL (`http://` veya `https://`) değil.'
                });
            }
        }

        // 3. Hedef Rolden Bot Olmayan Üyeleri Filtreleme
        let statusMessage = null;
        try {
            statusMessage = await message.reply({
                content: `⏳ **${targetRole.name}** rolündeki üyeler listeleniyor, lütfen bekleyin...`
            });

            // Sunucu üyelerini eksiksiz önbelleğe al
            await message.guild.members.fetch();
        } catch (fetchError) {
            console.error('Üye listesi çekilirken hata oluştu:', fetchError);
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

            if (statusMessage) {
                return statusMessage.edit({ content: null, embeds: [emptyEmbed] });
            }
            return message.reply({ embeds: [emptyEmbed] });
        }

        if (statusMessage) {
            await statusMessage.edit({
                content: `🚀 **${targetRole.name}** rolündeki **${targetMembers.length}** üyeye özel mesaj (DM) iletimi başlatıldı...`
            }).catch(() => null);
        }

        // 4. Kişiselleştirilmiş DM Gönderimi ve İlerleme Raporu
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
                    text: `${message.guild.name} • Toplu Bilgilendirme`,
                    iconURL: message.guild.iconURL() || undefined
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
                // DM'leri kapalı veya botu engellemiş üyeler sistem akışını bozmaz
            }

            // Discord rate limit'i önlemek için kısa bekleme
            await delay(350);
        }

        // 5. Yetkiliye Sonuç Raporu
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
                text: `İşlemi gerçekleştiren: ${message.author.tag}`,
                iconURL: message.author.displayAvatarURL() || undefined
            })
            .setTimestamp();

        if (statusMessage) {
            await statusMessage.edit({ content: null, embeds: [reportEmbed] }).catch(() => {
                message.reply({ embeds: [reportEmbed] });
            });
        } else {
            await message.reply({ embeds: [reportEmbed] });
        }
    });
};