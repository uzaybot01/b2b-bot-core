module.exports = (client) => {
    client.on('messageCreate', async message => {
        if (message.author.bot) return;

        // Bu modülün mevcut duyuru tetikleyicisi.
        if (message.content.startsWith('!duyuru')) {
            message.channel.send('Toplu mesaj modülü aktif ve çalışıyor!');
        }
    });
};