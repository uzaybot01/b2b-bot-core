const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = (client) => {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;

        if (interaction.customId === 'kayit_talep_et') {
            await interaction.reply({ content: 'Kayıt talebiniz alındı, yetkililere haber veriliyor...', ephemeral: true });

            const guild = interaction.guild;
            const logChannel = guild.channels.cache.find(c => c.name === 'kayıt-takip' || c.name === 'kayit-takip');

            if (!logChannel) {
                return interaction.followUp({ content: 'Hata: `kayıt-takip` adında bir kanal bulunamadı!', ephemeral: true });
            }

            const yetkiliRol = guild.roles.cache.find(r => r.name === 'Kayıt Sorumlusu' || r.name === 'Kayıt Yetkilisi');
            
            if (!yetkiliRol) {
                return interaction.followUp({ content: 'Hata: Sunucuda `Kayıt Sorumlusu` rolü bulunamadı!', ephemeral: true });
            }

            const yetkililer = yetkiliRol.members.map(m => m);

            if (yetkililer.length === 0) {
                return interaction.followUp({ content: 'Şu anda aktif kayıt yetkilisi bulunmuyor.', ephemeral: true });
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