module.exports = (client) => {
    client.on('messageCreate', async message => {
        if (message.author.bot) return;

        // Örnek: !duyuru komutu veya genel mesaj dinleme işlemleri buraya yazılacak
        if (message.content.startsWith('!duyuru')) {
            message.channel.send('Toplu mesaj modülü aktif ve çalışıyor!');
        }
    });
};