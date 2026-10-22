const { checkPermission } = require('./permissions');

const DEFAULT_COOLDOWN_MS = 3_000;
const MAX_COOLDOWN_ENTRIES = 10_000;
const cooldowns = new Map();

function getCooldownKey(interaction) {
    if (!interaction.user?.id) {
        throw new Error('Cannot apply interaction cooldown without a user ID');
    }

    return `${interaction.guildId || 'direct'}:${interaction.user.id}`;
}

function checkCooldown(interaction, cooldownMs = DEFAULT_COOLDOWN_MS) {
    const now = Date.now();
    const key = getCooldownKey(interaction);
    const expiresAt = cooldowns.get(key) || 0;

    if (expiresAt > now) {
        const secondsRemaining = Math.ceil((expiresAt - now) / 1000);
        const response = {
            content: `⏳ Çok hızlı işlem yapıyorsunuz. Lütfen ${secondsRemaining} saniye sonra tekrar deneyin.`,
            flags: 64
        };
        const respond = interaction.deferred || interaction.replied
            ? interaction.followUp(response)
            : interaction.reply(response);

        return Promise.resolve(respond).then(() => false);
    }

    cooldowns.delete(key);
    if (cooldowns.size >= MAX_COOLDOWN_ENTRIES) {
        const oldestKey = cooldowns.keys().next().value;
        if (oldestKey) {
            cooldowns.delete(oldestKey);
        }
    }
    cooldowns.set(key, now + cooldownMs);

    return true;
}

async function checkCommandAccess(interaction, requiredPermission) {
    if (!await checkCooldown(interaction)) {
        return false;
    }

    return checkPermission(interaction, requiredPermission);
}

module.exports = { checkCommandAccess, checkCooldown };
