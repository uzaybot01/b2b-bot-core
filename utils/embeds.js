const { EmbedBuilder } = require('discord.js');

function createEmbed({ title, description, color = '#17161E', image, timestamp = true }) {
    const embed = new EmbedBuilder()
        .setColor(color);

    if (title) {
        embed.setTitle(title);
    }

    if (description) {
        embed.setDescription(description);
    }

    if (image) {
        embed.setImage(image);
    }

    if (timestamp) {
        embed.setTimestamp();
    }

    return embed;
}

module.exports = { createEmbed };
