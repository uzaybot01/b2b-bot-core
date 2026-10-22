const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { isValidHttpUrl } = require('../utils/validation');
const { sanitizeText } = require('../utils/input');
const { checkCommandAccess, checkCooldown } = require('../utils/interaction-guard');
const { checkPermission } = require('../utils/permissions');
const { startRegistrationTimeout } = require('../utils/registration-timeout');

const cooldowns = new Map();
const COOLDOWN_SECONDS = 120; // 2 dakika timeout
const DEFAULT_PANEL_TITLE = '🌟 Yeşilsancak Sunucumuza Hoş Geldiniz! 🌟';
const DEFAULT_PANEL_DESCRIPTION = 'Kayıt işlemlerinizi başlatmak ve kişiye özel kayıt odanızı oluşturmak için aşağıdaki **Kayıt Talep Et** butonuna tıklayabilirsiniz.';
const DEFAULT_WELCOME_TITLE = '👋 Kayıt Odasına Hoş Geldiniz';
const DEFAULT_WELCOME_DESCRIPTION = 'Merhaba {user},\nYetkili ekibimiz çağrınızı aldı, birazdan sizinle ilgilenecekler. Bu kanal üzerinden yazışarak ya da sesli olarak görüşebilirsiniz.';

module.exports = (client) => {
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
        .addChannelOption(option =>
            option.setName('ses_kanali')
                .setDescription('Botun bu sunucuda sabit bağlanacağı ses kanalı')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('ses_durumu')
                .setDescription('Her iki ses tercihini birlikte ayarlar')
                .addChoices(
                    { name: 'Sağır ve susturulmuş', value: 'deaf_muted' },
                    { name: 'Kulaklık ve mikrofon açık', value: 'open' }
                )
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('mikrofon_acik')
                .setDescription('Botun mikrofonu açık olsun mu?')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('kulaklik_acik')
                .setDescription('Botun kulaklığı açık olsun mu?')
                .setRequired(false))
        .setDefaultMemberPermissions(0n);

    const logCommand = new SlashCommandBuilder()
        .setName('log')
        .setDescription('Kayıt talep bildirimlerinin ve butonların gideceği log kanalını ayarlar.')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Kayıt log metin kanalı')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .setDefaultMemberPermissions(0n);

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
            option.setName('buton_yazi')
                .setDescription('Buton üzerinde görünecek yazı')
                .setMaxLength(80)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('buton_renk')
                .setDescription('Buton rengi')
                .addChoices(
                    { name: 'Mavi (Primary)', value: 'primary' },
                    { name: 'Yeşil (Success)', value: 'success' },
                    { name: 'Kırmızı (Danger)', value: 'danger' },
                    { name: 'Gri (Secondary)', value: 'secondary' }
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('gorsel')
                .setDescription('Panel görseli URL’si; boş bırakılırsa sunucu logosu kullanılır')
                .setMaxLength(2048)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('oda_baslik')
                .setDescription('Kayıt odasındaki karşılama mesajının başlığı')
                .setMaxLength(256)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('oda_aciklama')
                .setDescription('Karşılama mesajı; kullanıcıyı etiketlemek için {user} yazın')
                .setMaxLength(4096)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('oda_gorsel')
                .setDescription('Kayıt odası karşılama görseli URL’si; boş bırakılırsa sunucu logosu kullanılır')
                .setMaxLength(2048)
                .setRequired(false))
        .setDefaultMemberPermissions(0n);

    client.commands.set(setupCommand.name, setupCommand);
    client.commands.set(logCommand.name, logCommand);
    client.commands.set(panelCommand.name, panelCommand);

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() || !['setup', 'log', 'panel'].includes(interaction.commandName)) return;

        const requiredPermission = interaction.commandName === 'log' ? 'log' : 'admin';
        if (!await checkCommandAccess(interaction, requiredPermission)) {
            return;
        }

        const guildId = interaction.guild.id;

        if (interaction.commandName === 'setup') {
            const category = interaction.options.getChannel('kategori');
            const role = interaction.options.getRole('rol');
            const voiceChannel = interaction.options.getChannel('ses_kanali');
            if (role.id === guildId) {
                return interaction.reply({
                    content: '❌ @everyone rolü kayıt yetkilisi olarak atanamaz.',
                    flags: 64
                });
            }

            const voiceStatus = interaction.options.getString('ses_durumu');
            const microphoneOpen = interaction.options.getBoolean('mikrofon_acik');
            const headsetOpen = interaction.options.getBoolean('kulaklik_acik');
            const voicePreferences = client.settings.getGuildVoicePreferences(guildId);

            if (voiceStatus) {
                voicePreferences.selfDeaf = voiceStatus === 'deaf_muted';
                voicePreferences.selfMute = voiceStatus === 'deaf_muted';
            }
            if (microphoneOpen !== null) {
                voicePreferences.selfMute = !microphoneOpen;
            }
            if (headsetOpen !== null) {
                voicePreferences.selfDeaf = !headsetOpen;
            }

            const voicePreferencesProvided = Boolean(voiceStatus)
                || microphoneOpen !== null
                || headsetOpen !== null;
            const voiceSettings = voicePreferencesProvided ? {
                voiceSelfDeaf: voicePreferences.selfDeaf,
                voiceSelfMute: voicePreferences.selfMute
            } : {};

            client.settings.updateGuildSettings(guildId, {
                categoryId: category.id,
                roleId: role.id,
                ...(voiceChannel ? { voiceChannelId: voiceChannel.id } : {}),
                ...voiceSettings
            });

            const savedVoiceChannelId = voiceChannel?.id
                || (voicePreferencesProvided ? client.settings.getGuildSettings(guildId).voiceChannelId : null);
            if (savedVoiceChannelId) {
                client.voiceService.connectPersistentVoiceChannelById(client, savedVoiceChannelId)
                    .then(() => {
                        console.log(`Sunucu sabit ses kanalına bağlandı: ${interaction.guild.name} / ${savedVoiceChannelId}`);
                    })
                    .catch(error => {
                        console.error(`Sunucu sabit ses kanalına bağlanılamadı (${interaction.guild.name}):`, error);
                    });
            }

            const microphoneLabel = microphoneOpen === null
                ? null
                : (microphoneOpen ? 'Açık' : 'Susturulmuş');
            const headsetLabel = headsetOpen === null
                ? null
                : (headsetOpen ? 'Açık' : 'Sağır');
            const combinedStatusLabel = voiceStatus
                ? (voiceStatus === 'deaf_muted' ? 'Sağır ve susturulmuş' : 'Kulaklık ve mikrofon açık')
                : null;

            return interaction.reply({
                content: `✅ **Kurulum Başarılı!**\n📌 Kayıt Kategorisi: **${category.name}**\n🛡️ Yetkili Rol: **${role.name}**${voiceChannel ? `\n🔊 Sabit ses kanalı: **${voiceChannel.name}**` : ''}${combinedStatusLabel ? `\n🎙️ Ses durumu: **${combinedStatusLabel}**` : ''}${microphoneLabel ? `\n🎤 Mikrofon: **${microphoneLabel}**` : ''}${headsetLabel ? `\n🎧 Kulaklık: **${headsetLabel}**` : ''}`,
                flags: 64
            });
        }

        if (interaction.commandName === 'log') {
            const logChannel = interaction.options.getChannel('kanal');

            client.settings.updateGuildSettings(guildId, {
                logChannelId: logChannel.id
            });

            return interaction.reply({
                content: `✅ **Log Kanalı Ayarlandı!**\n📢 Kayıt Bildirim Kanalı: **${logChannel.name}**`,
                flags: 64
            });
        }

        if (interaction.commandName === 'panel') {
            const targetChannel = interaction.options.getChannel('kanal');
            const baslik = sanitizeText(interaction.options.getString('baslik') || DEFAULT_PANEL_TITLE, { maxLength: 256 }) || DEFAULT_PANEL_TITLE;
            const aciklama = sanitizeText(interaction.options.getString('aciklama') || DEFAULT_PANEL_DESCRIPTION, { maxLength: 4096, allowNewlines: true }) || DEFAULT_PANEL_DESCRIPTION;
            const buttonLabel = sanitizeText(interaction.options.getString('buton_yazi') || 'Kayıt Talep Et', { maxLength: 80 }) || 'Kayıt Talep Et';
            const buttonStyleName = interaction.options.getString('buton_renk') || 'primary';
            const panelImage = sanitizeText(interaction.options.getString('gorsel') || '', { maxLength: 2048 }) || null;
            const welcomeTitle = sanitizeText(interaction.options.getString('oda_baslik') || '', { maxLength: 256 });
            const welcomeDescription = sanitizeText(interaction.options.getString('oda_aciklama') || '', { maxLength: 4096, allowNewlines: true });
            const welcomeImage = sanitizeText(interaction.options.getString('oda_gorsel') || '', { maxLength: 2048 }) || null;

            const guildSettings = client.settings.getGuildSettings(guildId);
            const panelImageUrl = panelImage || guildSettings.customLogo;
            const welcomeImageUrl = welcomeImage || guildSettings.customLogo || null;

            if (panelImageUrl && !isValidHttpUrl(panelImageUrl)) {
                return interaction.reply({ content: '❌ Panel görseli için geçerli bir HTTP veya HTTPS URL’si girin.', flags: 64 });
            }

            if (welcomeImageUrl && !isValidHttpUrl(welcomeImageUrl)) {
                return interaction.reply({ content: '❌ Oda görseli veya sunucu logosu geçerli bir HTTP ya da HTTPS URL’si olmalıdır.', flags: 64 });
            }

            guildSettings.welcomeTitle = welcomeTitle || sanitizeText(guildSettings.welcomeTitle, { maxLength: 256 }) || DEFAULT_WELCOME_TITLE;
            guildSettings.welcomeDescription = welcomeDescription
                || sanitizeText(guildSettings.welcomeDescription, { maxLength: 4096, allowNewlines: true })
                || DEFAULT_WELCOME_DESCRIPTION;

            const embed = createEmbed({
                title: baslik,
                description: aciklama,
                image: panelImageUrl
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('kayit_talep_et')
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle[buttonStyleName.charAt(0).toUpperCase() + buttonStyleName.slice(1)])
            );

            await targetChannel.send({
                embeds: [embed],
                components: [row],
                allowedMentions: { parse: [] }
            });

            client.settings.updateGuildSettings(guildId, {
                welcomeTitle: guildSettings.welcomeTitle,
                welcomeDescription: guildSettings.welcomeDescription,
                welcomeImage: welcomeImageUrl
            });

            return interaction.reply({
                content: `✅ Kayıt paneli başarıyla ${targetChannel} kanalına gönderildi. Oda karşılama ayarları da sunucuya kaydedildi!`,
                flags: 64
            });
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;

        const guildId = interaction.guild.id;
        const guildSettings = client.settings.getGuildSettings(guildId);

        if (interaction.customId === 'kayit_talep_et') {
            if (!await checkCooldown(interaction)) return;

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
                const channelUsername = sanitizeText(interaction.user.username, { maxLength: 80 }).replace(/[^\p{L}\p{N}_-]+/gu, '-');
                const privateChannel = await guild.channels.create({
                    name: `kayıt-${channelUsername || interaction.user.id}`,
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

                let voiceNotice = '';
                if (interaction.member.voice.channel) {
                    try {
                        const voiceChannel = await client.voiceService.joinMemberVoiceChannel(interaction.member);
                        voiceNotice = `\n🔊 Bot ${voiceChannel} ses kanalında bağlı.`;
                    } catch (error) {
                        console.error('Kayıt talebi sırasında ses kanalına bağlanılamadı:', error);
                        voiceNotice = '\n⚠️ Bot ses kanalına bağlanamadı. Ses kanalı izinlerini kontrol edin.';
                    }
                }

                await interaction.editReply({
                    content: `✅ Size özel kayıt odası başarıyla oluşturuldu: ${privateChannel}${voiceNotice}`
                }).catch(() => {});

                const welcomeDescription = (guildSettings.welcomeDescription || DEFAULT_WELCOME_DESCRIPTION)
                    .replaceAll('{user}', `${interaction.user}`);
                const welcomeImage = client.settings.getGuildWelcomeImage(guildId);
                const uyeEmbed = createEmbed({
                    title: guildSettings.welcomeTitle || DEFAULT_WELCOME_TITLE,
                    description: welcomeDescription,
                    image: welcomeImage
                });

                await privateChannel.send({
                    embeds: [uyeEmbed],
                    allowedMentions: { parse: [] }
                });

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

                const yetkiliEmbed = createEmbed({
                    title: '🔔 Yeni Kişiye Özel Kayıt Talebi!',
                    description: `**Kullanıcı:** ${interaction.user} (${interaction.user.tag})\n**Oda:** ${privateChannel}\n**Durum:** Beklemede (Devralınmadı)\nÇevrim içi yetkili sayısı: **${aktifYetkililer.size}**`
                }).setFooter({ text: `ticket-channel:${privateChannel.id}` });

                await logKanali.send({
                    content: `🔔 ${yetkiliRol}, yeni bir kayıt talebi açıldı!`,
                    embeds: [yetkiliEmbed],
                    components: [aldimButonu],
                    allowedMentions: { roles: [yetkiliRol.id], users: [] }
                });

            } catch (error) {
                console.error(error);
                await interaction.editReply({ content: '❌ Özel kanal oluşturulurken bir hata oluştu.' }).catch(() => {});
            }
        }

        if (interaction.customId.startsWith('kayit_al_')) {
            if (!await checkCooldown(interaction)) return;
            if (!await checkPermission(interaction, 'registration')) {
                return;
            }

            await interaction.deferUpdate().catch(() => {});

            if (!guildSettings || !guildSettings.roleId) {
                return interaction.followUp({ content: '❌ Sunucu ayarları bulunamadı.', flags: 64 });
            }

            const targetUserId = interaction.customId.split('_')[2];
            const claimStartedAt = Date.now();
            let voiceNotice = '';
            try {
                const voiceChannel = await client.voiceService.joinMemberVoiceChannel(interaction.member);
                voiceNotice = voiceChannel
                    ? ` Bot ${voiceChannel} ses kanalında bağlı.`
                    : ' Bir ses kanalında olmadığınız ve sabit ses kanalı ayarlanmadığı için bot ses bağlantısı kuramadı.';
            } catch (error) {
                console.error('Kayıt devralınırken ses kanalına bağlanılamadı:', error);
                voiceNotice = ' Bot ses kanalına bağlanamadı; kanal izinlerini kontrol edin.';
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
                .setDescription(sanitizeText(oldEmbed.description.replace('Durum: Beklemede (Devralınmadı)', `Durum: İşlem Devralındı (${interaction.user.tag})`), { maxLength: 4096, allowNewlines: true }))
                .setColor('#5865F2');

            const claimedMessage = await interaction.message.edit({
                content: `📌 Bu kayıt süreci ${interaction.user} tarafından yürütülüyor. Sonucu seçin:${voiceNotice}`,
                embeds: [updatedEmbed],
                components: [sonucButonlari]
            }).catch(error => {
                console.error('Kayıt devralma paneli güncellenemedi:', error);
                return null;
            });
            if (!claimedMessage) return;

            const ticketChannelId = claimedMessage.embeds[0]?.footer?.text
                ?.match(/(?:^|;)ticket-channel:(\d+)(?:;|$)/)?.[1];
            const ticketChannel = ticketChannelId
                ? await interaction.guild.channels.fetch(ticketChannelId).catch(error => {
                    console.error('Kayıt odası bulunamadı; zaman aşımı bildirimi log kanalına gönderilecek:', error);
                    return null;
                })
                : null;

            startRegistrationTimeout({
                client,
                message: claimedMessage,
                ticketChannel,
                user: targetUserId,
                timeoutMs: 120_000,
                startedAt: claimStartedAt
            });
        }

        if (interaction.customId.startsWith('kayit_basarili_')) {
            if (!await checkCooldown(interaction)) return;
            if (!await checkPermission(interaction, 'registration')) {
                return;
            }

            interaction.client.registrationTimeouts?.get(interaction.message.id)?.stop('resolved');
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
            if (!await checkCooldown(interaction)) return;
            if (!await checkPermission(interaction, 'registration')) {
                return;
            }

            interaction.client.registrationTimeouts?.get(interaction.message.id)?.stop('resolved');
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