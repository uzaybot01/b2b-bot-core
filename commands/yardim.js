const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embeds');

const command = new SlashCommandBuilder()
    .setName('yardim')
    .setDescription('Bot komutlarını ve kayıt sistemi kullanımını gösterir.');

module.exports = client => {
    client.commands.set(command.name, command);

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return;

        const embed = createEmbed({
            title: 'Uzay Bot | Komut Rehberi',
            description: 'Yönetim komutları sunucu yöneticileri tarafından kullanılabilir.'
        }).addFields(
            {
                name: '/setup `<kategori>` `<rol>`',
                value: 'Kayıt odalarının açılacağı kategoriyi ve kayıt yetkilisi rolünü ayarlar.'
            },
            {
                name: '/log `<kanal>`',
                value: 'Kayıt taleplerinin ve yönetim butonlarının gönderileceği log kanalını ayarlar.'
            },
            {
                name: '/panel `<kanal>`',
                value: 'Kayıt panelini gönderir; başlık, açıklama, buton, görsel ve oda karşılama metnini özelleştirir.'
            },
            {
                name: '/bot-ayar `<logo>`',
                value: 'Sunucuya özel logo URL’sini kaydeder. Panel ve oda görseli ayrıca belirtilmediyse bu logo kullanılır.'
            },
            {
                name: '/yardim',
                value: 'Bu komut rehberini gösterir.'
            },
            {
                name: 'Mesaj modülü durumu',
                value: '`allusermessage.js` şu anda `!duyuru` tetikleyicisine yalnızca modülün aktif olduğuna dair yanıt verir. `/all-user-message` komutu veya toplu mesaj gönderimi henüz uygulanmış değildir.'
            }
        );

        return interaction.reply({ embeds: [embed] });
    });
};
