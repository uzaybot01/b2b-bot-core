const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '..', 'settings.json');

function getSettings() {
    if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, '{}');
    }

    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function getGuildSettings(guildId) {
    return getSettings()[guildId] || {};
}

function getGuildWelcomeImage(guildId) {
    const guildSettings = getGuildSettings(guildId);
    return guildSettings.welcomeImage || guildSettings.customLogo || null;
}

function getGuildVoicePreferences(guildId) {
    const guildSettings = getGuildSettings(guildId);

    return {
        selfDeaf: guildSettings.voiceSelfDeaf ?? true,
        selfMute: guildSettings.voiceSelfMute ?? true
    };
}

function saveSettings(data) {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 4));
}

function updateGuildSettings(guildId, updates) {
    const settings = getSettings();
    const guildSettings = {
        ...(settings[guildId] || {}),
        ...updates
    };

    settings[guildId] = guildSettings;
    saveSettings(settings);

    return guildSettings;
}

module.exports = {
    getSettings,
    getGuildSettings,
    getGuildWelcomeImage,
    getGuildVoicePreferences,
    saveSettings,
    updateGuildSettings
};
