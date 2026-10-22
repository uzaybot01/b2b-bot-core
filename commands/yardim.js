const { SlashCommandBuilder } = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { checkCommandAccess } = require('../utils/interaction-guard');

const command = new SlashCommandBuilder()
    .setName('yardim')
    .setDescription('Bot komutlarını ve kayıt sistemi kullanımını gösterir.');

module.exports = client => {
    client.commands.set(command.name, command);

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return;
        if (!await checkCommandAccess(interaction, 'public')) return;

        const embed = createEmbed({
            title: 'Uzay Bot | Komut Rehberi',
            description: 'Yönetim komutları sunucu yöneticileri tarafından kullanılabilir.'
        }).addFields(
            {
                name: '/setup `<kategori>` `<rol>` `[ses_kanali]`',
                value: 'Sunucu sahibi, yöneticisi veya özel yönetici rolü kullanabilir. Kayıt kategorisi ve kayıt yetkilisi rolünü ayarlar; `ses_kanali` sabit kanalı, ses seçenekleri botun ses durumunu belirler.'
            },
            {
                name: '/log `<kanal>`',
                value: 'Yönetici veya log/güvenlik yetkilisi kayıt bildirim kanalını ayarlayabilir.'
            },
            {
                name: '/panel `<kanal>`',
                value: 'Sunucu sahibi, yönetici veya özel yönetici rolü kullanabilir. Kayıt panelini gönderir; metin, buton ve görselleri özelleştirir.'
            },
            {
                name: '/yetki-ayarla `[yonetici_rolu]` `[log_rolu]`',
                value: 'Yalnızca sunucu sahibi veya Discord Administrator özel yönetici ve log/güvenlik rollerini atayabilir veya kaldırabilir. Kayıt rolü `/setup` içinden ayarlanır.'
            },
            {
                name: 'Kayıt süresi',
                value: 'Kayıt yetkilisi talebi devralınca 2 dakikalık geri sayım başlar. Devralma ve sonuçlandırma işlemlerinde kayıt rolü denetlenir. Süre dolarsa oda bilgilendirilir.'
            },
            {
                name: '/bot-ayar `<logo>`',
                value: 'Sunucuya özel logo URL’sini kaydeder. Panel ve oda görseli ayrıca belirtilmediyse bu logo kullanılır.'
            },
            {
                name: '/bot-profil [`gorsel`] [`url`]',
                value: 'Sunucu yöneticileri bir görsel dosyası veya görsel URL’si vererek botun genel profil fotoğrafını güncelleyebilir. İkisinden yalnızca biri kullanılmalıdır; Discord değişiklik sıklığını sınırlayabilir.'
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
