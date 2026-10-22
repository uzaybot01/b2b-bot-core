const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, 'settings.json');

// Kullanıcıların son talep zamanlarını tutmak için Map (Kullanıcı ID -> Zaman ms)
const cooldowns = new Map();
const COOLDOWN_SECONDS = 60; // Timeout / Bekleme süresi (Örn: 60 saniye)

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
            .setDescription('Kayıt botu kanal ve rol ayarlarını yapılandırır.')
            .addChannelOption(option => 
                option.setName('kanal')
                    .setDescription('Kayıt bildirimlerinin gideceği yetkili/log kanalı')
                    .setRequired(true))
            .addRoleOption(option => 
                option.setName('rol')
                    .setDescription('Kayıt ile ilgilenecek yetkili rolü (@kayıtsorumlusu)')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

        const panelCommand = new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Giriş kanalına sabit kayıt talep butonunu gönderir.')
            .addChannelOption(option =>
                option.setName('kanal')
                    .setDescription('Butonun gönderileceği giriş kanalı')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

        await client.application.commands.create(setupCommand);
        await client.application.commands.create(panelCommand);
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Bu komutu kullanmak için Yönetici yetkisine sahip olmalısın.', ephemeral: true });
        }

        const guildId = interaction.guild.id;

        if (interaction.commandName === 'setup') {
            const channel = interaction.options.getChannel('kanal');
            const role = interaction.options.getRole('rol');

            const settings = getSettings();
            settings[guildId] = {
                ...(settings[guildId] || {}),
                channelId: channel.id,
                roleId: role.id
            };
            saveSettings(settings);

            await interaction.reply({
                content: `✅ **Kurulum Başarılı!**\n📌 Bildirim Kanalı: ${channel}\n🛡️ Yetkili Rol: ${role}`,
                ephemeral: true
            });
        }

        if (interaction.commandName === 'panel') {
            const targetChannel = interaction.options.getChannel('kanal');

            const embed = new EmbedBuilder()
                .setTitle('👋 Sunucumuza Hoş Geldiniz!')
                .setDescription('Kayıt işlemlerinizi başlatmak ve yetkili ekibimize haber vermek için aşağıdaki **Kayıt Talep Et** butonuna tıklayabilirsiniz.')
                .setColor('#17161E')
                .setTimestamp();

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

            await interaction.reply({
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
            if (!guildSettings) {
                return interaction.reply({ content: '❌ Bu sunucuda bot henüz yapılandırılmamış! Lütfen yöneticiden /setup komutunu çalıştırmasını isteyin.', ephemeral: true });
            }

            const userId = interaction.user.id;
            const now = Date.now();

            // Timeout / Bekleme Süresi Kontrolü (Spam Önleme)
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + (COOLDOWN_SECONDS * 1000);
                if (now < expirationTime) {
                    const timeLeft = Math.ceil((expirationTime - now) / 1000);
                    return interaction.reply({ 
                        content: `⏳ Çok sık kayıt talebinde bulunuyorsunuz! Lütfen yeni bir talep açmak için **${timeLeft}** saniye bekleyin.`, 
                        ephemeral: true 
                    });
                }
            }

            // Süre dolduysa veya ilk kez açıyorsa süreyi güncelle
            cooldowns.set(userId, now);

            await interaction.reply({ content: '✅ Kayıt talebiniz başarıyla oluşturuldu ve yetkili ekibe iletildi.', ephemeral: true });

            const guild = interaction.guild;
            const logChannel = guild.channels.cache.get(guildSettings.channelId);
            const yetkiliRol = guild.roles.cache.get(guildSettings.roleId);

            if (!logChannel || !yetkiliRol) {
                return;
            }

            // Aktif çevrim içi yetkilileri filtreleme ve DM bildirimi
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
                .setTitle('🔔 Yeni Kayıt / Destek Talebi!')
                .setDescription(`**Kullanıcı:** ${interaction.user} (${interaction.user.tag})\nDurum: Yetkili ekibe ve online yetkililere bildirildi.`)
                .setColor('#17161E')
                .setTimestamp();

            // Bildirimi sadece belirlenen log / yetkili kanalına gönder (giriş kanalında kirlilik yaratmaz)
            await logChannel.send({
                content: `${yetkiliRol}, yeni bir kayıt talebi var!`,
                embeds: [embed],
                components: [aldimButonu]
            });

            // Online olan yetkililere özelden (DM) haber ver
            aktifYetkililer.forEach(async (yetkili) => {
                try {
                    await yetkili.send({
                        content: `🔔 **${guild.name}** sunucusunda çevrim içi olduğunuz için yeni bir kayıt talebi düştü!\nKullanıcı: **${interaction.user.tag}**`
                    });
                } catch (err) {
                    // Kullanıcının DM'leri kapalıysa hatayı yut
                }
            });
        }

        if (interaction.customId.startsWith('kayit_al_')) {
            if (!guildSettings || !guildSettings.roleId) {
                return interaction.reply({ content: '❌ Sunucu ayarları bulunamadı.', ephemeral: true });
            }

            // Yetki Güvenliği Kontrolü: Sadece yetkili rolüne sahip olanlar veya Adminler devralabilir
            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: '❌ Bu butonu yalnızca kayıt yetkilileri kullanabilir!', ephemeral: true });
            }

            // Butona basıldığında mesajı güncelleyerek diğer yetkililerin ekranında butonları devre dışı bırak
            await interaction.update({
                content: `✅ Bu kayıt süreci ${interaction.user} tarafından devralındı!`,
                components: []
            });
        }
    });
};