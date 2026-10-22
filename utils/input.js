const DISALLOWED_TEXT_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

function sanitizeText(value, { maxLength, allowNewlines = false } = {}) {
    if (typeof value !== 'string') {
        return '';
    }

    let sanitized = value
        .normalize('NFC')
        .replace(DISALLOWED_TEXT_CHARACTERS, '');

    if (!allowNewlines) {
        sanitized = sanitized.replace(/[\r\n\t]+/g, ' ');
    } else {
        sanitized = sanitized.replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n');
    }

    sanitized = sanitized.trim();
    if (Number.isInteger(maxLength) && maxLength >= 0) {
        let limited = '';
        for (const character of sanitized) {
            if (limited.length + character.length > maxLength) {
                break;
            }
            limited += character;
        }
        sanitized = limited;
    }

    return sanitized;
}

module.exports = { sanitizeText };
