const fs = require('fs');
const path = require('path');

const settingsDirectory = path.join(__dirname, '..', 'data', 'settings');
const legacySettingsPath = path.join(__dirname, '..', 'settings.json');
const migrationMarkerPath = path.join(settingsDirectory, '.legacy-migration-complete');
const guildIdPattern = /^\d{1,20}$/;
let migrationChecked = false;

function ensureSettingsDirectory() {
    fs.mkdirSync(settingsDirectory, { recursive: true });
}

function validateGuildId(guildId) {
    if (typeof guildId !== 'string' || !guildIdPattern.test(guildId)) {
        throw new TypeError('A valid numeric Discord guild ID is required to access settings');
    }

    return guildId;
}

function getGuildSettingsPath(guildId) {
    return path.join(settingsDirectory, `${validateGuildId(guildId)}.json`);
}

function writeJsonAtomically(filePath, data) {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 4)}\n`, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
        }
        throw error;
    }
}

function migrateLegacySettings() {
    if (migrationChecked) {
        return;
    }

    ensureSettingsDirectory();
    if (fs.existsSync(migrationMarkerPath)) {
        migrationChecked = true;
        return;
    }

    if (fs.existsSync(legacySettingsPath)) {
        const legacySettings = JSON.parse(fs.readFileSync(legacySettingsPath, 'utf8'));
        if (!legacySettings || typeof legacySettings !== 'object' || Array.isArray(legacySettings)) {
            throw new TypeError('Legacy settings.json must contain an object keyed by guild ID');
        }

        for (const [guildId, guildSettings] of Object.entries(legacySettings)) {
            validateGuildId(guildId);
            if (!guildSettings || typeof guildSettings !== 'object' || Array.isArray(guildSettings)) {
                throw new TypeError(`Legacy settings for guild ${guildId} must be an object`);
            }

            const destinationPath = getGuildSettingsPath(guildId);
            if (!fs.existsSync(destinationPath)) {
                writeJsonAtomically(destinationPath, guildSettings);
            }
        }
    }

    fs.writeFileSync(migrationMarkerPath, 'Legacy settings migration completed.\n', 'utf8');
    migrationChecked = true;
}

function readGuildSettings(guildId) {
    const settingsPath = getGuildSettingsPath(guildId);
    if (!fs.existsSync(settingsPath)) {
        return {};
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new TypeError(`Settings for guild ${guildId} must contain a JSON object`);
    }

    return settings;
}

function getSettings() {
    migrateLegacySettings();

    const settings = {};
    for (const entry of fs.readdirSync(settingsDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }

        const guildId = entry.name.slice(0, -'.json'.length);
        if (guildIdPattern.test(guildId)) {
            settings[guildId] = readGuildSettings(guildId);
        }
    }

    return settings;
}

function getGuildSettings(guildId) {
    migrateLegacySettings();
    return readGuildSettings(guildId);
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
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Settings data must be an object keyed by guild ID');
    }

    migrateLegacySettings();
    for (const [guildId, guildSettings] of Object.entries(data)) {
        if (!guildSettings || typeof guildSettings !== 'object' || Array.isArray(guildSettings)) {
            throw new TypeError(`Settings for guild ${guildId} must be an object`);
        }
        writeJsonAtomically(getGuildSettingsPath(guildId), guildSettings);
    }
}

function updateGuildSettings(guildId, updates) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        throw new TypeError('Guild settings updates must be an object');
    }

    migrateLegacySettings();
    const guildSettings = {
        ...readGuildSettings(guildId),
        ...updates
    };

    writeJsonAtomically(getGuildSettingsPath(guildId), guildSettings);
    return guildSettings;
}

function deleteGuildSettings(guildId) {
    migrateLegacySettings();
    const settingsPath = getGuildSettingsPath(guildId);
    if (!fs.existsSync(settingsPath)) {
        return false;
    }

    fs.unlinkSync(settingsPath);
    return true;
}

migrateLegacySettings();

module.exports = {
    getSettings,
    getGuildSettings,
    getGuildWelcomeImage,
    getGuildVoicePreferences,
    saveSettings,
    updateGuildSettings,
    deleteGuildSettings
};
