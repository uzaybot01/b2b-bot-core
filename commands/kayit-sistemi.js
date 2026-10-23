const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, ChannelType } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { isValidHttpUrl } = require('../utils/validation');
const { sanitizeText } = require('../utils/input');
const { checkCommandAccess, checkCooldown } = require('../utils/interaction-guard');
const registrationTask = require('../workers/registration');

const cooldowns = new Map();
const COOLDOWN_SECONDS = 120; // 2 dakika timeout
const DEFAULT_PANEL_TITLE = '🌟 Yeşilsancak Sunucumuza Hoş Geldiniz! 🌟';
const DEFAULT_PANEL_DESCRIPTION = 'Kayıt işlemlerinizi başlatmak ve kişiye özel kayıt odanızı oluşturmak için aşağıdaki **Kayıt Talep Et** butonuna tıklayabilirsiniz.';
const DEFAULT_WELCOME_TITLE = '👋 Kayıt Odasına Hoş Geldiniz';
const DEFAULT_WELCOME_DESCRIPTION = 'Merhaba {user},\nYetkili ekibimiz çağrınızı aldı, birazdan sizinle ilgilenecekler. Bu kanal üzerinden yazışarak ya da sesli olarak görüşebilirsiniz.';

module.exports = (client) => {
    const registrationSettingsCommand = new SlashCommandBuilder()
        .setName('kayit-ayar')
        .setDescription('Kayıt kategorisi ve yetkili rolünü yapılandırır.')
        .addChannelOption(option =>
            option.setName('kategori')
                .setDescription('Kişiye özel kayıt kanallarının açılacağı Kategori')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('rol')
                .setDescription('Kayıt ile ilgilenecek yetkili rolü (@kayıtsorumlusu)')
                .setRequired(true))
        .setDefaultMemberPermissions(0n);

    const voiceChannelCommand = new SlashCommandBuilder()
        .setName('ses-kanal')
        .setDescription('Boşta bir ses botunu kanala bağlar veya kalıcı kanal listesinden çıkarır.')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Ses botunun bağlanacağı standart ses kanalı')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true))
        .addStringOption(option =>
            option.setName('islem')
                .setDescription('Kalıcı kanal listesine ekle (varsayılan) veya listeden çıkar')
                .addChoices(
                    { name: 'Ekle ve bağlan', value: 'ekle' },
                    { name: 'Çıkar ve bağlantıyı kes', value: 'cikar' }
                )
                .setRequired(false))
        .setDefaultMemberPermissions(0n);

    const voiceStatusCommand = new SlashCommandBuilder()
        .setName('ses-durum')
        .setDescription('Botun ses kanalındaki mikrofon ve kulaklık durumunu ayarlar.')
        .addStringOption(option =>
            option.setName('durum')
                .setDescription('İki ses tercihini birlikte ayarla')
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

    const logChannelCommand = new SlashCommandBuilder()
        .setName('log-kanal')
        .setDescription('Kayıt talep bildirimlerinin ve butonların gideceği log kanalını ayarlar.')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Kayıt log metin kanalı')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .setDefaultMemberPermissions(0n);

    const panelCommand = new SlashCommandBuilder()
        .setName('panel-kur')
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

    client.commands.set(registrationSettingsCommand.name, registrationSettingsCommand);
    client.commands.set(voiceChannelCommand.name, voiceChannelCommand);
    client.commands.set(voiceStatusCommand.name, voiceStatusCommand);
    client.commands.set(logChannelCommand.name, logChannelCommand);
    client.commands.set(panelCommand.name, panelCommand);

    client.on('interactionCreate', async interaction => {
        if (!client.isMaster) return;
        const commandNames = [
            registrationSettingsCommand.name,
            voiceChannelCommand.name,
            voiceStatusCommand.name,
            logChannelCommand.name,
            panelCommand.name
        ];
        if (!interaction.isChatInputCommand() || !commandNames.includes(interaction.commandName)) return;

        const requiredPermission = interaction.commandName === logChannelCommand.name ? 'log' : 'admin';
        if (!await checkCommandAccess(interaction, requiredPermission)) {
            return;
        }

        const guildId = interaction.guild.id;

        if (interaction.commandName === registrationSettingsCommand.name) {
            const category = interaction.options.getChannel('kategori');
            const role = interaction.options.getRole('rol');
            if (role.id === guildId) {
                return interaction.reply({
                    content: '❌ @everyone rolü kayıt yetkilisi olarak atanamaz.',
                    flags: 64
                });
            }

            client.settings.updateGuildSettings(guildId, {
                categoryId: category.id,
                roleId: role.id
            });

            return interaction.reply({
                content: `✅ **Kayıt ayarları kaydedildi!**\n📌 Kayıt kategorisi: **${category.name}**\n🛡️ Yetkili rol: **${role.name}**`,
                flags: 64
            });
        }

        if (interaction.commandName === voiceChannelCommand.name) {
            const voiceChannel = interaction.options.getChannel('kanal');
            const action = interaction.options.getString('islem') || 'ekle';
            const settings = client.settings.getGuildSettings(guildId);
            const configuredChannels = Array.isArray(settings.voiceChannelIds)
                && settings.voiceChannelIds.length
                ? [...settings.voiceChannelIds]
                : settings.voiceChannelId
                    ? [settings.voiceChannelId]
                    : [];

            if (action === 'cikar') {
                if (!configuredChannels.includes(voiceChannel.id)) {
                    return interaction.reply({
                        content: `ℹ️ **${voiceChannel.name}** kalıcı ses kanalları listesinde bulunmuyor.`,
                        flags: 64
                    });
                }

                const remainingChannels = configuredChannels.filter(channelId => channelId !== voiceChannel.id);
                client.settings.updateGuildSettings(guildId, {
                    voiceChannelIds: remainingChannels,
                    voiceChannelId: remainingChannels[0] || null
                });
                client.workerManager.disconnectPersistentVoiceChannel(guildId, voiceChannel.id);
                return interaction.reply({
                    content: `✅ **${voiceChannel.name}** kalıcı ses kanalları listesinden çıkarıldı ve bağlantısı kesildi.`,
                    flags: 64
                });
            }

            if (configuredChannels.includes(voiceChannel.id)) {
                try {
                    await client.workerManager.connectPersistentVoiceChannel(guildId, voiceChannel.id);
                } catch (error) {
                    console.error(`Kayıtlı ses kanalına worker bağlanamadı (${interaction.guild.name}, ${voiceChannel.id}):`, error);
                    return interaction.reply({
                        content: `⚠️ **${voiceChannel.name}** kayıtlı kanal olarak korundu ancak şu anda bağlantı kurulamadı. Worker ve kanal izinlerini kontrol edin; birkaç saniye sonra komutu yeniden deneyebilirsiniz.`,
                        flags: 64
                    });
                }
                return interaction.reply({
                    content: `✅ **${voiceChannel.name}** zaten kalıcı listede; worker bağlantısı doğrulandı.`,
                    flags: 64
                });
            }
            if (configuredChannels.length >= 4) {
                return interaction.reply({
                    content: '❌ Sunucu başına en fazla dört kalıcı ses kanalı yapılandırılabilir.',
                    flags: 64
                });
            }

            const updatedChannels = [...configuredChannels, voiceChannel.id];
            let settingsSaved = false;
            try {
                client.settings.updateGuildSettings(guildId, {
                    voiceChannelIds: updatedChannels,
                    voiceChannelId: updatedChannels[0]
                });
                settingsSaved = true;
                await client.workerManager.connectPersistentVoiceChannel(guildId, voiceChannel.id);
            } catch (error) {
                console.error(`Kalıcı ses kanalı yapılandırılamadı (${interaction.guild.name}, ${voiceChannel.id}):`, error);
                return interaction.reply({
                    content: settingsSaved
                        ? '⚠️ Kanal ayarı kaydedildi ancak şu anda boşta worker bağlanamadı. Worker/kanal izinlerini kontrol edin ve bağlantıyı yeniden denemek için aynı komutu tekrar çalıştırın.'
                        : '❌ Kanal ayarı kaydedilemedi. Botun sunucu ayar dosyasına yazma iznini kontrol edin.',
                    flags: 64
                });
            }

            return interaction.reply({
                content: `✅ Boşta bir ses botu **${voiceChannel.name}** kanalına bağlandı ve kanal kalıcı listeye eklendi (${updatedChannels.length}/4).`,
                flags: 64
            });
        }

        if (interaction.commandName === voiceStatusCommand.name) {
            const voiceStatus = interaction.options.getString('durum');
            const microphoneOpen = interaction.options.getBoolean('mikrofon_acik');
            const headsetOpen = interaction.options.getBoolean('kulaklik_acik');
            if (!voiceStatus && microphoneOpen === null && headsetOpen === null) {
                return interaction.reply({
                    content: '❌ En az bir ses tercihi belirtin.',
                    flags: 64
                });
            }

            const voicePreferences = client.settings.getGuildVoicePreferences(guildId);
            if (voiceStatus) {
                voicePreferences.selfDeaf = voiceStatus === 'deaf_muted';
                voicePreferences.selfMute = voiceStatus === 'deaf_muted';
            }
            if (microphoneOpen !== null) voicePreferences.selfMute = !microphoneOpen;
            if (headsetOpen !== null) voicePreferences.selfDeaf = !headsetOpen;

            client.settings.updateGuildSettings(guildId, {
                voiceSelfDeaf: voicePreferences.selfDeaf,
                voiceSelfMute: voicePreferences.selfMute
            });

            const savedSettings = client.settings.getGuildSettings(guildId);
            const savedVoiceChannelIds = Array.isArray(savedSettings.voiceChannelIds)
                && savedSettings.voiceChannelIds.length
                ? savedSettings.voiceChannelIds
                : savedSettings.voiceChannelId
                    ? [savedSettings.voiceChannelId]
                    : [];
            for (const channelId of savedVoiceChannelIds) {
                try {
                    await client.workerManager.connectPersistentVoiceChannel(guildId, channelId);
                } catch (error) {
                    console.error(`Ses tercihleri kaydedildi ancak worker bağlantısı kurulamadı (${interaction.guild.name}, ${channelId}):`, error);
                    return interaction.reply({
                        content: '⚠️ Ses tercihleri kaydedildi ancak kalıcı ses kanallarından birine worker bağlanamadı. Worker kapasitesini ve kanal izinlerini kontrol edin.',
                        flags: 64
                    });
                }
            }

            return interaction.reply({
                content: `✅ Ses durumu kaydedildi.\n🎤 Mikrofon: **${voicePreferences.selfMute ? 'Susturulmuş' : 'Açık'}**\n🎧 Kulaklık: **${voicePreferences.selfDeaf ? 'Sağır' : 'Açık'}**`,
                flags: 64
            });
        }

        if (interaction.commandName === logChannelCommand.name) {
            const logChannel = interaction.options.getChannel('kanal');

            client.settings.updateGuildSettings(guildId, {
                logChannelId: logChannel.id
            });

            return interaction.reply({
                content: `✅ **Log Kanalı Ayarlandı!**\n📢 Kayıt Bildirim Kanalı: **${logChannel.name}**`,
                flags: 64
            });
        }

        if (interaction.commandName === panelCommand.name) {
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

    registrationTask.registerControlHandlers(client, client.workerManager);
    client.on('interactionCreate', async interaction => {
        if (!client.isMaster || !interaction.isButton() || interaction.customId !== 'kayit_talep_et') {
            return;
        }

        if (!await checkCooldown(interaction)) {
            return;
        }

        await interaction.deferReply({ flags: 64 });
        const guildId = interaction.guildId;
        const guildSettings = client.settings.getGuildSettings(guildId);
        if (!guildSettings.categoryId || !guildSettings.roleId || !guildSettings.logChannelId) {
            await interaction.editReply({
                content: '❌ Bu sunucuda bot eksik yapılandırılmış! Önce `/kayit-ayar` ve `/log-kanal` komutlarını çalıştırın.'
            });
            return;
        }

        const userId = interaction.user.id;
        const now = Date.now();
        if (cooldowns.has(userId)) {
            const expirationTime = cooldowns.get(userId) + (COOLDOWN_SECONDS * 1000);
            if (now < expirationTime) {
                const timeLeft = Math.ceil((expirationTime - now) / 1000);
                const minutes = Math.floor(timeLeft / 60);
                const seconds = timeLeft % 60;
                await interaction.editReply({
                    content: `⏳ Çok sık kayıt talebinde bulunuyorsunuz! Yeni talep için **${minutes} dakika ${seconds} saniye** bekleyin.`
                });
                return;
            }
        }

        const guild = interaction.guild;
        const category = guild.channels.cache.get(guildSettings.categoryId);
        const registrationRole = guild.roles.cache.get(guildSettings.roleId);
        const logChannel = guild.channels.cache.get(guildSettings.logChannelId);
        if (!category || !registrationRole || !logChannel) {
            await interaction.editReply({
                content: '❌ Ayarlanan kategori, rol veya log kanalı bulunamadı! Lütfen sunucu ayarlarını kontrol edin.'
            });
            return;
        }

        cooldowns.set(userId, now);
        const channelUsername = sanitizeText(interaction.user.username, { maxLength: 80 })
            .replace(/[^\p{L}\p{N}_-]+/gu, '-');
        const welcomeDescription = (guildSettings.welcomeDescription || DEFAULT_WELCOME_DESCRIPTION)
            .replaceAll('{user}', `${interaction.user}`);
        const welcomeEmbed = createEmbed({
            title: guildSettings.welcomeTitle || DEFAULT_WELCOME_TITLE,
            description: welcomeDescription,
            image: client.settings.getGuildWelcomeImage(guildId)
        }).toJSON();

        try {
            const privateChannel = await client.workerManager.createRegistrationTicket(guildId, {
                guildId,
                categoryId: category.id,
                roleId: registrationRole.id,
                logChannelId: logChannel.id,
                userId,
                userTag: interaction.user.tag,
                channelName: `kayıt-${channelUsername || userId}`,
                welcomeEmbed
            });

            let voiceNotice = '';
            if (interaction.member?.voice?.channelId) {
                try {
                    const voiceChannel = await client.workerManager.joinMemberVoiceChannel(guildId, userId);
                    voiceNotice = voiceChannel
                        ? `\n🔊 Ses görevi worker tarafından ${voiceChannel} kanalında başlatıldı.`
                        : '\n⚠️ Worker ses kanalına bağlanamadı.';
                } catch (error) {
                    console.error('Kayıt talebi sırasında ses worker görevi başarısız oldu:', error);
                    voiceNotice = '\n⚠️ Bu sunucuda uygun bir ses worker\'ı bulunamadı veya bağlantı kurulamadı.';
                }
            }

            await interaction.editReply({
                content: `✅ Size özel kayıt odası oluşturuldu: <#${privateChannel.id}>${voiceNotice}`
            });
        } catch (error) {
            console.error(`Worker kayıt talebini işleyemedi (${guildId}, ${userId}):`, error);
            await interaction.editReply({
                content: '❌ Bu sunucuda kayıt worker\'ı kullanılamıyor veya kayıt odası oluşturulamadı. Ana Bot ve kayıt worker botlarının sunucuda bulunduğunu kontrol edin.'
            });
        }
    });
};