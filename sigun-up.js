const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, 'settings.json');

// Ayarları okuma fonksiyonu
function getSettings() {
    if (!fs.existsSync(settingsPath)) fs.writeFileSync(settingsPath, '{}');
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

// Ayarları kaydetme fonksiyonu
function saveSettings(data) {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 4));
}

module.exports = (client) => {
    // 1. Komutları Discord'a kaydetme (Bot açıldığında çalışır)
    client.once('ready', async () => {
        const data = new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Kayıt botu kanal ve rol ayarlarını yapılandırır.')
            .addChannelOption(option => 
                option.setName('kanal')
                    .setDescription('Kayıt bildirimlerinin gideceği log kanalı')
                    .setRequired(true))
            .addRoleOption(option => 
                option.setName('rol')
                    .setDescription('Kayıt ile ilgilenecek yetkili rolü')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

        // Komutu tüm sunuculara global olarak kaydet
        await client.application.commands.create(data);
    });

    // 2. /setup komutu çalıştırıldığında
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'setup') {
            const guildId = interaction.guild.id;
            const channel = interaction.options.getChannel('kanal');
            const role = interaction.options.getRole('rol');

            const settings = getSettings();
            settings[guildId] = {
                channelId: channel.id,
                roleId: role.id
            };
            saveSettings(settings);

            await interaction.reply({
                content: `✅ **Kurulum Başarılı!**\n📌 Kayıt Kanalı: ${channel}\n🛡️ Yetkili Rol: ${role}`,
                ephemeral: true
            });
        }
    });

    // 3. Buton ve Kayıt İşlemleri (Dinamik Ayarlarla Çalışır)
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;

        const guildId = interaction.guild.id;
        const settings = getSettings();
        const guildSettings = settings[guildId];

        if (interaction.customId === 'kayit_talep_et') {
            if (!guildSettings) {
                return interaction.reply({ content: '❌ Bu sunucuda bot henüz yapılandırılmamış! Lütfen bir yetkili `/setup` komutunu kullansın.', ephemeral: true });
            }

            await interaction.reply({ content: 'Kayıt talebiniz alındı, yetkililere haber veriliyor...', ephemeral: true });

            const guild = interaction.guild;
            const logChannel = guild.channels.cache.get(guildSettings.channelId);
            const yetkiliRol = guild.roles.cache.get(guildSettings.roleId);

            if (!logChannel || !yetkiliRol) {
                return interaction.followUp({ content: 'Hata: Ayarlanan kanal veya rol artık sunucuda bulunmuyor!', ephemeral: true });
            }

            const yetkililer = yetkiliRol.members.map(m => m);
            if (yetkililer.length === 0) {
                return interaction.followUp({ content: 'Şu anda bu role sahip aktif bir yetkili bulunmuyor.', ephemeral: true });
            }

            const aldimButonu = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`kayit_al_${interaction.user.id}`)
                    .setLabel('Kaydı Devral')
                    .setStyle(ButtonStyle.Success)
            );

            let secilenYetkili = yetkililer[0];

            const embed = new EmbedBuilder()
                .setTitle('🔔 Yeni Kayıt / Destek Talebi!')
                .setDescription(`**Kullanıcı:** ${interaction.user} (${interaction.user.tag})\n**Sorumlu Yetkili:** ${secilenYetkili}`)
                .setColor('#17161E')
                .setTimestamp();

            await logChannel.send({
                content: `${secilenYetkili}, yeni bir kayıt talebi var!`,
                embeds: [embed],
                components: [aldimButonu]
            });
        }

        if (interaction.customId.startsWith('kayit_al_')) {
            await interaction.update({
                content: `✅ Bu kayıt süreci ${interaction.user} tarafından devralındı!`,
                embeds: [],
                components: []
            });
        }
    });
};