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

        const logCommand = new SlashCommandBuilder()
            .setName('log')
            .setDescription('Kayıt talep bildirimlerinin ve butonların gideceği log kanalını ayarlar.')
            .addChannelOption(option =>
                option.setName('kanal')
                    .setDescription('Kayıt log metin kanalı')
                    .addChannelTypes(ChannelType.GuildText)
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
            await client.application.commands.set([setupCommand, logCommand, panelCommand]);
            console.log('✅ Kayıt komutları (setup, log, panel) başarıyla yüklendi!');
        } catch (error) {
            console.error('❌ Komutlar yüklenirken hata oluştu:', error);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Bu komutu kullanmak için Yönetici yetkisine sahip olmalısın.', flags: 64 });
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
                flags: 64
            });
        }

        if (interaction.commandName === 'log') {
            const logChannel = interaction.options.getChannel('kanal');

            const settings = getSettings();
            settings[guildId] = {
                ...(settings[guildId] || {}),
                logChannelId: logChannel.id
            };
            saveSettings(settings);

            return interaction.reply({
                content: `✅ **Log Kanalı Ayarlandı!**\n📢 Kayıt Bildirim Kanalı: **${logChannel.name}**`,
                flags: 64
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
                flags: 64
            });
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;

        const guildId = interaction.guild.id;
        const settings = getSettings();
        const guildSettings = settings[guildId];

        if (interaction.customId === 'kayit_talep_et') {
            await interaction.reply({ content: '⏳ Kayıt talebiniz işleniyor, size özel oda hazırlanıyor...', flags: 64 }).catch(() => {});

            if (!guildSettings || !guildSettings.categoryId || !guildSettings.logChannelId) {
                return interaction.editReply({ content: '❌ Bu sunucuda bot eksik yapılandırılmış! Lütfen önce **/setup** ve **/log** komutlarını çalıştırın.' }).catch(() => {});
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
            const logKanali = guild.channels.cache.get(guildSettings.logChannelId);

            if (!category || !yetkiliRol || !logKanali) {
                return interaction.editReply({ content: '❌ Ayarlanan kategori, rol veya log kanalı bulunamadı! Lütfen ayarları kontrol edin.' }).catch(() => {});
            }

            try {
                const privateChannel = await guild.channels.create({
                    name: `kayıt-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: category,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                        },
                        {
                            id: yetkiliRol.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                        },
                        {
                            id: client.user.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
                        }
                    ]
                });

                await interaction.editReply({ content: `✅ Size özel kayıt odası başarıyla oluşturuldu: ${privateChannel}` }).catch(() => {});

                const uyeEmbed = new EmbedBuilder()
                    .setTitle('👋 Kayıt Odasına Hoş Geldiniz')
                    .setDescription(`Merhaba ${interaction.user},\nYetkili ekibimiz çağrınızı aldı, birazdan sizinle ilgilenecekler. Bu kanal üzerinden yazışarak ya da sesli olarak görüşebilirsiniz.`)
                    .setColor('#17161E')
                    .setTimestamp();

                await privateChannel.send({ embeds: [uyeEmbed] });

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

                const yetkiliEmbed = new EmbedBuilder()
                    .setTitle('🔔 Yeni Kişiye Özel Kayıt Talebi!')
                    .setDescription(`**Kullanıcı:** ${interaction.user} (${interaction.user.tag})\n**Oda:** ${privateChannel}\n**Durum:** Beklemede (Devralınmadı)\nÇevrim içi yetkili sayısı: **${aktifYetkililer.size}**`)
                    .setColor('#17161E')
                    .setTimestamp();

                await logKanali.send({
                    content: `🔔 ${yetkiliRol}, yeni bir kayıt talebi açıldı!`,
                    embeds: [yetkiliEmbed],
                    components: [aldimButonu]
                });

            } catch (error) {
                console.error(error);
                await interaction.editReply({ content: '❌ Özel kanal oluşturulurken bir hata oluştu.' }).catch(() => {});
            }
        }

        if (interaction.customId.startsWith('kayit_al_')) {
            await interaction.deferUpdate().catch(() => {});

            if (!guildSettings || !guildSettings.roleId) {
                return interaction.followUp({ content: '❌ Sunucu ayarları bulunamadı.', flags: 64 });
            }

            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasRole && !isAdmin) {
                return interaction.followUp({ content: '❌ Bu butonu yalnızca kayıt yetkilileri kullanabilir!', flags: 64 });
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
                .setDescription(oldEmbed.description.replace('Durum: Beklemede (Devralınmadı)', `Durum: İşlem Devralındı (${interaction.user.tag})`))
                .setColor('#5865F2');

            await interaction.message.edit({
                content: `📌 Bu kayıt süreci ${interaction.user} tarafından yürütülüyor. Sonucu seçin:`,
                embeds: [updatedEmbed],
                components: [sonucButonlari]
            }).catch(() => {});
        }

        if (interaction.customId.startsWith('kayit_basarili_')) {
            await interaction.reply({ content: `✅ Kayıt başarıyla tamamlandı, kanal kapatılıyor...`, flags: 64 }).catch(() => {});
            
            const targetUserId = interaction.customId.split('_')[2];
            const guild = interaction.guild;
            
            const targetChannel = guild.channels.cache.find(c => c.name === `kayıt-${guild.members.cache.get(targetUserId)?.user.username}`);
            if (targetChannel) {
                await targetChannel.delete().catch(() => {});
            }
            await interaction.message.delete().catch(() => {});
        }

        if (interaction.customId.startsWith('kayit_iptal_')) {
            await interaction.reply({ content: `❌ Kayıt iptal edildi, kanal kapatılıyor...`, flags: 64 }).catch(() => {});
            
            const targetUserId = interaction.customId.split('_')[2];
            const guild = interaction.guild;
            
            const targetChannel = guild.channels.cache.find(c => c.name === `kayıt-${guild.members.cache.get(targetUserId)?.user.username}`);
            if (targetChannel) {
                await targetChannel.delete().catch(() => {});
            }
            await interaction.message.delete().catch(() => {});
        }
    });
};