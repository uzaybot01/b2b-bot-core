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
                name: '/kayit-ayar `<kategori>` `<rol>`',
                value: 'Yönetici kayıt kategorisini ve kayıt yetkilisi rolünü ayarlar.'
            },
            {
                name: '/ses-kanal `<kanal>` `[islem]`',
                value: 'Yönetici boşta bir ses worker’ını kanala bağlar veya kalıcı kanal listesinden çıkarır.'
            },
            {
                name: '/ses-durum `[durum]` `[mikrofon_acik]` `[kulaklik_acik]`',
                value: 'Yönetici ses worker’larının mikrofon ve kulaklık tercihlerini ayarlar.'
            },
            {
                name: '/log-kanal `<kanal>`',
                value: 'Yönetici veya log/güvenlik yetkilisi kayıt bildirim kanalını ayarlayabilir.'
            },
            {
                name: '/kayit-talep-butonu `<kanal>`',
                value: 'Sunucu sahibi, yönetici veya özel yönetici rolü kullanabilir. Kayıt talep butonunu gönderir; panel, buton ve oda karşılama içeriğini özelleştirir.'
            },
            {
                name: '/yetki-ayarla `[yonetici_rolu]` `[log_rolu]`',
                value: 'Yalnızca sunucu sahibi veya Discord Administrator özel yönetici ve log/güvenlik rollerini atayabilir veya kaldırabilir. Kayıt rolü `/kayit-ayar` içinden ayarlanır.'
            },
            {
                name: 'Kayıt süresi',
                value: 'Kayıt yetkilisi talebi devralınca 2 dakikalık geri sayım başlar. Devralma ve sonuçlandırma işlemlerinde kayıt rolü denetlenir. Süre dolarsa oda bilgilendirilir.'
            },
            {
                name: '/kayit-mesaj-gorseli `<logo>`',
                value: 'Kayıt paneli ve karşılama mesajı için bu sunucuya özel varsayılan görsel URL’sini kaydeder.'
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
                name: 'Slash olmayan tetikleyici',
                value: '`!duyuru` mesajı toplu mesaj göndermez; yalnızca `allusermessage.js` modülünün aktif olduğuna dair yanıt verir.'
            }
        );

        return interaction.reply({ embeds: [embed] });
    });
};
