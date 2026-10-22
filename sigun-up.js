const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
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
            .setDescription('Kayıt botu kanal ve rol ayarlarını yapılandırır.')
            .addChannelOption(option => 
                option.setName('kanal')
                    .setDescription('Kayıt bildirimlerinin gideceği ekip metin kanalı')
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
                content: `✅ **Kurulum Başarılı!**\n📌 Kayıt Ekip Kanalı: ${channel}\n🛡️ Yetkili Rol: ${role}`,
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
                return interaction.reply({ content: '❌ Bu sunucuda bot henüz yapılandırılmamış!', ephemeral: true });
            }

            const userId = interaction.user.id;
            const now = Date.now();

            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + (COOLDOWN_SECONDS * 1000);
                if (now < expirationTime) {
                    const timeLeft = Math.ceil((expirationTime - now) / 1000);
                    const minutes = Math.floor(timeLeft / 60);
                    const seconds = timeLeft % 60;
                    return interaction.reply({ 
                        content: `⏳ Çok sık kayıt talebinde bulunuyorsunuz! Lütfen yeni bir talep açmak için **${minutes} dakika ${seconds} saniye** bekleyiniz.`, 
                        ephemeral: true 
                    });
                }
            }

            cooldowns.set(userId, now);

            await interaction.reply({ content: '✅ Kayıt talebiniz başarıyla oluşturuldu ve ekibe iletildi.', ephemeral: true });

            const guild = interaction.guild;
            const logChannel = guild.channels.cache.get(guildSettings.channelId);
            const yetkiliRol = guild.roles.cache.get(guildSettings.roleId);

            if (!logChannel || !yetkiliRol) return;

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
                .setDescription(`**Kullanıcı:** ${interaction.user} (${interaction.user.tag})\n**Durum:** Beklemede (İlgilenilmeyen)\nÇevrim içi yetkili sayısı: **${aktifYetkililer.size}**`)
                .setColor('#17161E')
                .setTimestamp();

            const sentMessage = await logChannel.send({
                content: `${yetkiliRol}, yeni bir kayıt talebi var!`,
                embeds: [embed],
                components: [aldimButonu]
            });

            // 2 dakika boyunca kimse devralmazsa "İlgilenilmeyen" olarak işaretleme takibi
            setTimeout(async () => {
                try {
                    const fetchedMsg = await logChannel.messages.fetch(sentMessage.id).catch(() => null);
                    if (fetchedMsg && fetchedMsg.components.length > 0) {
                        // Hala buton duruyorsa ve devralınmadıysa
                        const oldEmbed = fetchedMsg.embeds[0];
                        const updatedEmbed = EmbedBuilder.from(oldEmbed)
                            .setDescription(oldEmbed.description.replace('Durum: Beklemede (İlgilenilmeyen)', 'Durum: ⚠️ **İlgilenilmedi (Süre Aşımı / Kimse Almadı)**'))
                            .setColor('#FFA500');
                        
                        await fetchedMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
                    }
                } catch (e) {}
            }, 120000);

            aktifYetkililer.forEach(async (yetkili) => {
                try {
                    await yetkili.send({
                        content: `🔔 **${guild.name}** sunucusunda çevrim içi olduğunuz için ekibe yeni bir kayıt talebi düştü!\nKullanıcı: **${interaction.user.tag}**`
                    });
                } catch (err) {}
            });
        }

        // 1. Aşama: Kaydı Devral
        if (interaction.customId.startsWith('kayit_al_')) {
            if (!guildSettings || !guildSettings.roleId) {
                return interaction.reply({ content: '❌ Sunucu ayarları bulunamadı.', ephemeral: true });
            }

            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: '❌ Bu butonu yalnızca kayıt yetkilileri kullanabilir!', ephemeral: true });
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

            // Devralındıktan sonra Başarılı ve İptal butonlarını ekle
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

            await interaction.update({
                content: `📌 Bu kayıt süreci ${interaction.user} tarafından yürütülüyor. Sonucu seçin:`,
                embeds: [updatedEmbed],
                components: [sonucButonlari]
            });
        }

        // 2. Aşama: Başarılı Butonu
        if (interaction.customId.startsWith('kayit_basarili_')) {
            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: '❌ Bu işlem için yetkiniz yok!', ephemeral: true });
            }

            const targetUserId = interaction.customId.split('_')[2];
            const oldEmbed = interaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setDescription(`**Kullanıcı:** <@${targetUserId}>\n**İşlem Sorumlusu:** ${interaction.user}\n**Durum:** ✅ **BAŞARILI** (Tamamlandı)`)
                .setColor('#2ECC71');

            await interaction.update({
                content: `✅ Kayıt işlemi ${interaction.user} tarafından **BAŞARILI** olarak sonuçlandırıldı.`,
                embeds: [updatedEmbed],
                components: []
            });
        }

        // 3. Aşama: İptal Butonu
        if (interaction.customId.startsWith('kayit_iptal_')) {
            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: '❌ Bu işlem için yetkiniz yok!', ephemeral: true });
            }

            const targetUserId = interaction.customId.split('_')[2];
            const oldEmbed = interaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setDescription(`**Kullanıcı:** <@${targetUserId}>\n**İşlem Sorumlusu:** ${interaction.user}\n**Durum:** ❌ **İPTAL EDİLDİ**`)
                .setColor('#ED4245');

            await interaction.update({
                content: `❌ Kayıt işlemi ${interaction.user} tarafından **İPTAL** edildi.`,
                embeds: [updatedEmbed],
                components: []
            });
        }
    });
};