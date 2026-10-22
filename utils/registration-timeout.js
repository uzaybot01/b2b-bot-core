const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require('discord.js');

function formatRemaining(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function createCountdownComponents(message, remainingMs, disabled = false) {
    const labelTime = formatRemaining(remainingMs);

    return message.components.map(row => new ActionRowBuilder().addComponents(
        row.components.map(button => {
            const label = button.label || button.data?.label || 'Sonuç';
            return ButtonBuilder.from(button)
                .setLabel(`${label.replace(/\s+\(\d+:\d{2}\)$/, '')} (${labelTime})`)
                .setDisabled(disabled);
        })
    ));
}

function startRegistrationTimeout({ client, message, ticketChannel, user, timeoutMs, startedAt = Date.now() }) {
    if (!client.registrationTimeouts) {
        client.registrationTimeouts = new Map();
    }

    client.registrationTimeouts.get(message.id)?.stop('replaced');

    const expiresAt = startedAt + timeoutMs;
    const collector = message.createMessageComponentCollector({
        time: Math.max(0, expiresAt - Date.now()),
        filter: interaction => ['kayit_basarili_', 'kayit_iptal_']
            .some(prefix => interaction.customId.startsWith(prefix))
    });

    client.registrationTimeouts.set(message.id, collector);

    const updateCountdown = () => {
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
            return;
        }

        message.edit({
            components: createCountdownComponents(message, remainingMs)
        }).catch(error => {
            console.error(`Geri sayım butonları güncellenemedi (${message.id}):`, error);
        });
    };

    const countdownInterval = setInterval(updateCountdown, 1_000);
    countdownInterval.unref?.();

    collector.on('collect', () => {
        collector.stop('resolved');
    });

    collector.on('end', async (_collected, reason) => {
        clearInterval(countdownInterval);
        client.registrationTimeouts.delete(message.id);

        if (reason !== 'time') {
            return;
        }

        const originalDescription = message.embeds[0]?.description || message.embeds[0]?.data?.description || '';
        const timeoutDescription = originalDescription
            .replace(/Durum: .+/, 'Durum: Zaman Aşımı İptal') || 'Durum: Zaman Aşımı İptal';
        try {
            const timeoutEmbed = EmbedBuilder.from(message.embeds[0])
                .setDescription(timeoutDescription);
            await message.edit({
                content: '⏰ Kayıt işlemi 2 dakika içinde tamamlanmadığı için zaman aşımına uğradı.',
                embeds: [timeoutEmbed],
                components: createCountdownComponents(message, 0, true)
            });
        } catch (error) {
            console.error(`Kayıt zaman aşımı paneli güncellenemedi (${message.id}):`, error);
        }

        try {
            const notificationChannel = ticketChannel || message.channel;
            await notificationChannel.send({
                content: `<@${user}> işlem sonuçlanmadı; kayıt talebi zaman aşımı nedeniyle iptal edildi.`,
                allowedMentions: { users: [user] }
            });
        } catch (error) {
            console.error(`Kayıt zaman aşımı bildirimi gönderilemedi (${message.id}):`, error);
        }
    });

    updateCountdown();
    return collector;
}

module.exports = { startRegistrationTimeout };
