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
                name: '/setup `<kategori>` `<rol>` `[ses_kanali]`',
                value: 'Kayıt kategorisi ve yetkili rolünü ayarlar. `ses_kanali` sabit kanalı; `ses_durumu` birlikte ayarı, `mikrofon_acik` ve `kulaklik_acik` ise ayrı tercihleri belirler.'
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
                name: 'Kayıt süresi',
                value: 'Yetkili bir talebi devralınca 2 dakikalık geri sayım başlar. Süre dolarsa talep zaman aşımıyla iptal edilir ve oda bilgilendirilir.'
            },
            {
                name: '/bot-ayar `<logo>`',
                value: 'Sunucuya özel logo URL’sini kaydeder. Panel ve oda görseli ayrıca belirtilmediyse bu logo kullanılır.'
            },
            {
                name: '/bot-profil `<gorsel>`',
                value: 'Sunucu yöneticileri botun ortak profil fotoğrafını yüklenen görselle güncelleyebilir. Discord değişiklik sıklığını sınırlayabilir.'
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
