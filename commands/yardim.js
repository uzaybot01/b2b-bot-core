const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { checkCommandAccess } = require('../utils/interaction-guard');

const COMMAND_MATRIX = [
    {
        name: '/bildiri',
        aliases: ['!bildiri', '!duyuru'],
        description: 'Hedef role form penceresi (Modal) üzerinden kişiselleştirilmiş toplu bildiri (DM) gönderir.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Yönetim & Bildiri'
    },
    {
        name: '/kayit-ayar',
        description: 'Kayıt odalarının açılacağı kategoriyi ve kayıt yetkilisi rolünü yapılandırır.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Kayıt Sistemi'
    },
    {
        name: '/kayit-talep-butonu',
        description: 'Kullanıcıların kayıt başvurusu yapabileceği butonlu kayıt panelini belirlenen kanala gönderir.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Kayıt Sistemi'
    },
    {
        name: '/ses-kanal',
        description: 'Ses worker botunun bağlanacağı ses kanalını dinamik olarak ayarlar veya ayrılmasını sağlar.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Ses Sistemi'
    },
    {
        name: '/ses-durum',
        description: 'Ses worker botlarının mikrofon (mute) ve kulaklık (deaf) tercihlerini yapılandırır.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Ses Sistemi'
    },
    {
        name: '/log-kanal',
        description: 'Kayıt bildirimlerinin ve güvenlik loglarının iletileceği bildirim kanalını ayarlar.',
        type: 'SLASH',
        requiredPermission: 'LOG_YETKILISI',
        category: 'Denetim & Log'
    },
    {
        name: '/yetki-ayarla',
        description: 'Sunucuya özel yönetici ve log/güvenlik yetkili rollerini tanımlar veya günceller.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Yetkilendirme'
    },
    {
        name: '/kayit-mesaj-gorseli',
        description: 'Kayıt paneli ve karşılama mesajlarında kullanılacak sunucuya özel görsel URL\'sini kaydeder.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Özelleştirme'
    },
    {
        name: '/bot-profil',
        description: 'Görsel dosyası veya bağlantı ile botun genel profil fotoğrafını (avatar) günceller.',
        type: 'SLASH',
        requiredPermission: 'ADMIN',
        category: 'Özelleştirme'
    },
    {
        name: '[Kayıt Odası Yönetimi]',
        description: 'Kayıt talebini devralma (2 dk zaman aşımı), onaylama veya iptal etme buton kontrolleri.',
        type: 'BUTON',
        requiredPermission: 'KAYIT_YETKILISI',
        category: 'Kayıt Operasyonları'
    },
    {
        name: '/komutlar',
        aliases: ['/yardim', '/komut'],
        description: 'Yetki seviyenize uygun olarak kullanabileceğiniz tüm bot komutlarını listeler.',
        type: 'SLASH',
        requiredPermission: 'PUBLIC',
        category: 'Genel'
    },
    {
        name: '[Kayıt Ol Butonu]',
        description: 'Sunucuya yeni katılan üyelerin yetkililerle özel kayıt odası açmasını sağlar.',
        type: 'BUTON',
        requiredPermission: 'PUBLIC',
        category: 'Genel'
    }
];

function getUserAccess(member, guild, client) {
    if (!member || !guild) {
        return {
            isAdmin: false,
            isRegistrationStaff: false,
            isLogStaff: false,
            roleName: 'Sunucu Üyesi'
        };
    }

    const isOwner = guild.ownerId === member.id || guild.ownerId === member.user?.id;
    const isDiscordAdmin = member.permissions?.has(PermissionFlagsBits.Administrator) || false;

    const guildSettings = client.settings?.getGuildSettings?.(guild.id) || {};
    const adminRoleId = guildSettings.adminRoleId;
    const hasAdminRole = adminRoleId && (
        member.roles?.cache?.has(adminRoleId) ||
        (Array.isArray(member.roles) && member.roles.includes(adminRoleId))
    );

    const isAdmin = isOwner || isDiscordAdmin || Boolean(hasAdminRole);
    if (isAdmin) {
        return {
            isAdmin: true,
            isRegistrationStaff: true,
            isLogStaff: true,
            roleName: isOwner ? '👑 Sunucu Sahibi' : '🛡️ Yönetici'
        };
    }

    const registrationRoleId = guildSettings.roleId;
    const isRegistrationStaff = registrationRoleId && (
        member.roles?.cache?.has(registrationRoleId) ||
        (Array.isArray(member.roles) && member.roles.includes(registrationRoleId))
    );

    const logRoleId = guildSettings.logSecurityRoleId;
    const isLogStaff = logRoleId && (
        member.roles?.cache?.has(logRoleId) ||
        (Array.isArray(member.roles) && member.roles.includes(logRoleId))
    );

    let roleName = '👤 Sunucu Üyesi';
    if (isRegistrationStaff && isLogStaff) {
        roleName = '📋 Kayıt & Log Sorumlusu';
    } else if (isRegistrationStaff) {
        roleName = '📝 Kayıt / Alım Sorumlusu';
    } else if (isLogStaff) {
        roleName = '📜 Log / Güvenlik Sorumlusu';
    }

    return {
        isAdmin: false,
        isRegistrationStaff: Boolean(isRegistrationStaff),
        isLogStaff: Boolean(isLogStaff),
        roleName
    };
}

function filterCommandsForUser(access) {
    return COMMAND_MATRIX.filter(cmd => {
        if (access.isAdmin) return true;
        if (cmd.requiredPermission === 'PUBLIC') return true;
        if (cmd.requiredPermission === 'KAYIT_YETKILISI' && access.isRegistrationStaff) return true;
        if (cmd.requiredPermission === 'LOG_YETKILISI' && access.isLogStaff) return true;
        return false;
    });
}

function buildCommandHelpEmbed(member, guild, client) {
    const access = getUserAccess(member, guild, client);
    const visibleCommands = filterCommandsForUser(access);

    const formattedList = visibleCommands
        .map(cmd => `• \`${cmd.name}\` - ${cmd.description}`)
        .join('\n');

    const embed = new EmbedBuilder()
        .setColor('#17161E')
        .setTitle('Uzay Bot | Komut Rehberi')
        .setDescription(
            `Yetki Seviyeniz: **${access.roleName}**\n` +
            `Aşağıda rolünüze ve yetki düzeyinize uygun kullanılabilir komutlar listelenmiştir:\n\n` +
            formattedList
        )
        .setFooter({
            text: `${guild?.name || 'Uzay Bot'} • Toplam ${visibleCommands.length} komut erişiminize açık`,
            iconURL: guild?.iconURL?.() || undefined
        })
        .setTimestamp();

    return embed;
}

const komutlarCommand = new SlashCommandBuilder()
    .setName('komutlar')
    .setDescription('Yetki seviyenize uygun olarak kullanabileceğiniz bot komutlarını listeler.');

const yardimCommand = new SlashCommandBuilder()
    .setName('yardim')
    .setDescription('Yetki seviyenize uygun olarak kullanabileceğiniz bot komutlarını listeler.');

const komutCommand = new SlashCommandBuilder()
    .setName('komut')
    .setDescription('Yetki seviyenize uygun olarak kullanabileceğiniz bot komutlarını listeler.');

module.exports = client => {
    client.commands.set(komutlarCommand.name, komutlarCommand);
    client.commands.set(yardimCommand.name, yardimCommand);
    client.commands.set(komutCommand.name, komutCommand);

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const supportedCommands = [komutlarCommand.name, yardimCommand.name, komutCommand.name];
        if (!supportedCommands.includes(interaction.commandName)) return;

        if (!await checkCommandAccess(interaction, 'public')) return;

        const embed = buildCommandHelpEmbed(interaction.member, interaction.guild, client);
        return interaction.reply({ embeds: [embed], flags: 64 });
    });

    client.on('messageCreate', async message => {
        if (message.author.bot || !message.guild) return;

        const content = message.content.trim().toLowerCase();
        const prefixTriggers = ['!komutlar', '!yardim', '!komut'];
        if (prefixTriggers.includes(content)) {
            const embed = buildCommandHelpEmbed(message.member, message.guild, client);
            return message.reply({ embeds: [embed] });
        }
    });
};

module.exports.COMMAND_MATRIX = COMMAND_MATRIX;
module.exports.getUserAccess = getUserAccess;
module.exports.filterCommandsForUser = filterCommandsForUser;
module.exports.buildCommandHelpEmbed = buildCommandHelpEmbed;
