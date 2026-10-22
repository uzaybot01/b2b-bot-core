const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, 'settings.json');

const cooldowns = new Map();
const COOLDOWN_SECONDS = 120; // 2 dakika timeout

function getSettings() {
    if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, '{}');
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function saveSettings(data) {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 4));
}

module.exports = (client) => {
    client.once('ready', async () => {
        const setupCommand = new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Kayıt botu kategori ve rol ayarlarını yapılandırır.')
            .addChannelOption(option => 
                option.setName('kategori')
                    .setDescription('Kişiye özel kayıt kanallarının açılacağı Kategori')
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(true))
            .addRoleOption(option => 
                option.setName('rol')
                    .setDescription('Kayıt ile ilgilenecek yetkili rolü (@kayıtsorumlusu)')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

        const panelCommand = new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Giriş kanalına özel tasarımlı kayıt talep butonunu gönderir.')
            .addChannelOption(option =>
                option.setName('kanal')
                    .setDescription('Butonun gönderileceği giriş kanalı')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('baslik')
                    .setDescription('Embed başlığı')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('aciklama')
                    .setDescription('Panel açıklama metni')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('gorsel')
                    .setDescription('Logo veya GIF bağlantısı (URL linki)')
                    .setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

        try {
            await client.application.commands.set([setupCommand, panelCommand]);
            console.log('✅ Kayıt komutları başarıyla yüklendi!');
        } catch (error) {
            console.error('❌ Komutlar yüklenirken hata oluştu:', error);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Bu komutu kullanmak için Yönetici yetkisine sahip olmalısın.', ephemeral: true });
        }

        const guildId = interaction.guild.id;

        if (interaction.commandName === 'setup') {
            const category = interaction.options.getChannel('kategori');
            const role = interaction.options.getRole('rol');

            const settings = getSettings();
            settings[guildId] = {
                ...(settings[guildId] || {}),
                categoryId: category.id,
                roleId: role.id
            };
            saveSettings(settings);

            return interaction.reply({
                content: `✅ **Kurulum Başarılı!**\n📌 Kayıt Kategorisi: **${category.name}**\n🛡️ Yetkili Rol: **${role.name}**`,
                ephemeral: true
            });
        }

        if (interaction.commandName === 'panel') {
            const targetChannel = interaction.options.getChannel('kanal');
            const baslik = interaction.options.getString('baslik') || '🌟 Yeşilsancak Sunucumuza Hoş Geldiniz! 🌟';
            const aciklama = interaction.options.getString('aciklama') || 'Kayıt işlemlerinizi başlatmak ve kişiye özel kayıt odanızı oluşturmak için aşağıdaki **Kayıt Talep Et** butonuna tıklayabilirsiniz.';
            const gorsel = interaction.options.getString('gorsel');

            const embed = new EmbedBuilder()
                .setTitle(baslik)
                .setDescription(aciklama)
                .setColor('#17161E')
                .setTimestamp();

            if (gorsel) {
                embed.setImage(gorsel);
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('kayit_talep_et')
                    .setLabel('Kayıt Talep Et')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📥')
            );

            await targetChannel.send({
                embeds: [embed],
                components: [row]
            });

            return interaction.reply({
                content: `✅ Kayıt paneli başarıyla ${targetChannel} kanalına gönderildi!`,
                ephemeral: true
            });
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;

        const guildId = interaction.guild.id;
        const settings = getSettings();
        const guildSettings = settings[guildId];

        if (interaction.customId === 'kayit_talep_et') {
            // Zaman aşımını önlemek için hemen gizli bir yanıt veriyoruz
            await interaction.reply({ content: '⏳ Kayıt talebiniz işleniyor, size özel oda hazırlanıyor...', ephemeral: true }).catch(() => {});

            if (!guildSettings || !guildSettings.categoryId) {
                return interaction.editReply({ content: '❌ Bu sunucuda bot henüz tamamen yapılandırılmamış! Lütfen /setup komutunu çalıştırın.' }).catch(() => {});
            }

            const userId = interaction.user.id;
            const now = Date.now();

            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + (COOLDOWN_SECONDS * 1000);
                if (now < expirationTime) {
                    const timeLeft = Math.ceil((expirationTime - now) / 1000);
                    const minutes = Math.floor(timeLeft / 60);
                    const seconds = timeLeft % 60;
                    return interaction.editReply({ 
                        content: `⏳ Çok sık kayıt talebinde bulunuyorsunuz! Lütfen yeni bir talep açmak için **${minutes} dakika ${seconds} saniye** bekleyiniz.` 
                    }).catch(() => {});
                }
            }

            cooldowns.set(userId, now);

            const guild = interaction.guild;
            const category = guild.channels.cache.get(guildSettings.categoryId);
            const yetkiliRol = guild.roles.cache.get(guildSettings.roleId);

            if (!category || !yetkiliRol) {
                return interaction.editReply({ content: '❌ Ayarlanan kategori veya yetkili rolü bulunamadı! Lütfen tekrar /setup yapın.' }).catch(() => {});
            }

            try {
                // Kullanıcıya özel metin kanalı oluşturma
                const privateChannel = await guild.channels.create({
                    name: `kayıt-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: category,
                    permissionOverwrites: [
                        {
                            id: guild.id, // @everyone
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: interaction.user.id, // Sadece talep açan kullanıcı
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                        },
                        {
                            id: yetkiliRol.id, // Sadece @kayıtsorumlusu ekibi
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                        },
                        {
                            id: client.user.id, // Bot
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
                        }
                    ]
                });

                await interaction.editReply({ content: `✅ Size özel kayıt odası başarıyla oluşturuldu: ${privateChannel}` }).catch(() => {});

                const aktifYetkililer = yetkiliRol.members.filter(member => {
                    const status = member.presence?.status;
                    return status && status !== 'offline';
                });

                const aldimButonu = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`kayit_al_${userId}`)
                        .setLabel('Kaydı Devral')
                        .setStyle(ButtonStyle.Success)
                );

                const embed = new EmbedBuilder()
                    .setTitle('🔔 Yeni Kişiye Özel Kayıt Talebi!')
                    .setDescription(`**Kullanıcı:** ${interaction.user} (${interaction.user.tag})\n**Durum:** Beklemede (İlgilenilmeyen)\nÇevrim içi yetkili sayısı: **${aktifYetkililer.size}**`)
                    .setColor('#17161E')
                    .setTimestamp();

                await privateChannel.send({
                    content: `${yetkiliRol}, ${interaction.user} için yeni bir kayıt odası açıldı!`,
                    embeds: [embed],
                    components: [aldimButonu]
                });

                aktifYetkililer.forEach(async (yetkili) => {
                    try {
                        await yetkili.send({
                            content: `🔔 **${guild.name}** sunucusunda ${interaction.user.tag} için kişiye özel kayıt odası açıldı: <#${privateChannel.id}>`
                        });
                    } catch (err) {}
                });

            } catch (error) {
                console.error(error);
                await interaction.editReply({ content: '❌ Özel kanal oluşturulurken bir hata oluştu. Botun "Kanalları Yönet" yetkisine sahip olduğundan emin olun.' }).catch(() => {});
            }
        }

        if (interaction.customId.startsWith('kayit_al_')) {
            await interaction.deferUpdate().catch(() => {});

            if (!guildSettings || !guildSettings.roleId) {
                return interaction.followUp({ content: '❌ Sunucu ayarları bulunamadı.', ephemeral: true });
            }

            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasRole && !isAdmin) {
                return interaction.followUp({ content: '❌ Bu butonu yalnızca kayıt yetkilileri kullanabilir!', ephemeral: true });
            }

            const targetUserId = interaction.customId.split('_')[2];
            const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

            if (targetMember && targetMember.voice.channel) {
                const targetVoiceChannel = targetMember.voice.channel;
                if (interaction.member.voice.channel) {
                    try {
                        await interaction.member.voice.setChannel(targetVoiceChannel);
                    } catch (err) {}
                }
            }

            const sonucButonlari = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`kayit_basarili_${targetUserId}`)
                    .setLabel('Başarılı')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`kayit_iptal_${targetUserId}`)
                    .setLabel('İptal')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            const oldEmbed = interaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setDescription(`**Kullanıcı:** <@${targetUserId}>\n**İşlem Sorumlusu:** ${interaction.user}\n**Durum:** İşlem Devralındı (Görüşülüyor)`)
                .setColor('#5865F2');

            await interaction.message.edit({
                content: `📌 Bu kayıt süreci ${interaction.user} tarafından yürütülüyor. Sonucu seçin:`,
                embeds: [updatedEmbed],
                components: [sonucButonlari]
            }).catch(() => {});
        }

        if (interaction.customId.startsWith('kayit_basarili_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.editReply({ content: '❌ Bu işlem için yetkiniz yok!' });
            }

            await interaction.editReply({ content: `✅ Kayıt başarıyla tamamlandı. Bu kanal 5 saniye içinde kapatılacaktır.` });
            
            setTimeout(async () => {
                await interaction.channel.delete().catch(() => {});
            }, 5000);
        }

        if (interaction.customId.startsWith('kayit_iptal_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => {});
            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin =ahn = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.editReply({ content: '❌ Bu işlem için yetkiniz yok!' });
            }

            await interaction.editReply({ content: `❌ Kayıt iptal edildi. Bu kanal 5 saniye içinde kapatılacaktır.` });
            
            setTimeout(async () => {
                await interaction.channel.delete().catch(() => {});
            }, 5000);
        }
    });
};