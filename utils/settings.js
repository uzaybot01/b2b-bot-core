const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '..', 'settings.json');

function getSettings() {
    if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, '{}');
    }

    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function saveSettings(data) {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 4));
}

module.exports = {
    getSettings,
    saveSettings
};
