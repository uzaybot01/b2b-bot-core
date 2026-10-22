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
            .setDescription('Kayıt botu kanal ve rol ayarlarını yapılandırır.')
            .addChannelOption(option => 
                option.setName('kategori')
                    .setDescription('Kişiye özel kayıt kanallarının açılacağı Kategori')
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
            const category = interaction.options.getChannel('kategori');
            const role = interaction.options.getRole('rol');

            const settings = getSettings();
            settings[guildId] = {
                ...(settings[guildId] || {}),
                categoryId: category.id,
                roleId: role.id
            };
            saveSettings(settings);

            await interaction.reply({
                content: `✅ **Kurulum Başarılı!**\n📌 Kayıt Kategorisi: ${category.name}\n🛡️ Yetkili Rol: ${role}`,
                ephemeral: true
            });
        }

        if (interaction.commandName === 'panel') {
            const targetChannel = interaction.options.getChannel('kanal');
            const baslik = interaction.options.getString('baslik') || '🌟 @Yeşilsancak Sunucumuza Hoş Geldiniz! 🌟';
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
            if (!guildSettings || !guildSettings.categoryId) {
                return interaction.reply({ content: '❌ Bu sunucuda bot henüz tamamen yapılandırılmamış! Lütfen yöneticiden /setup komutunu çalıştırmasını isteyin.', ephemeral: true });
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

            const guild = interaction.guild;
            const category = guild.channels.cache.get(guildSettings.categoryId);
            const yetkiliRol = guild.roles.cache.get(guildSettings.roleId);

            if (!category || !yetkiliRol) {
                return interaction.reply({ content: '❌ Ayarlanan kategori veya yetkili rolü bulunamadı!', ephemeral: true });
            }

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

            await interaction.reply({ content: `✅ Size özel kayıt odası oluşturuldu: ${privateChannel}`, ephemeral: true });

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

            const sentMessage = await privateChannel.send({
                content: `${yetkiliRol}, ${interaction.user} için yeni bir kayıt odası açıldı!`,
                embeds: [embed],
                components: [aldimButonu]
            });

            // Online yetkililere DM bildirimi
            aktifYetkililer.forEach(async (yetkili) => {
                try {
                    await yetkili.send({
                        content: `🔔 **${guild.name}** sunucusunda ${interaction.user.tag} için kişiye özel kayıt odası açıldı: <#${privateChannel.id}>`
                    });
                } catch (err) {}
            });
        }

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

        // Başarılı olunca kanal otomatik silinir
        if (interaction.customId.startsWith('kayit_basarili_')) {
            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: '❌ Bu işlem için yetkiniz yok!', ephemeral: true });
            }

            await interaction.reply({ content: `✅ Kayıt başarıyla tamamlandı. Bu kanal 5 saniye içinde kapatılacaktır.`, ephemeral: true });
            
            setTimeout(async () => {
                await interaction.channel.delete().catch(() => {});
            }, 5000);
        }

        // İptal olunca kanal otomatik silinir
        if (interaction.customId.startsWith('kayit_iptal_')) {
            const hasRole = interaction.member.roles.cache.has(guildSettings.roleId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: '❌ Bu işlem için yetkiniz yok!', ephemeral: true });
            }

            await interaction.reply({ content: `❌ Kayıt iptal edildi. Bu kanal 5 saniye içinde kapatılacaktır.`, ephemeral: true });
            
            setTimeout(async () => {
                await interaction.channel.delete().catch(() => {});
            }, 5000);
        }
    });
};