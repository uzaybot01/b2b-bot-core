const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    GatewayIntentBits,
    PermissionFlagsBits
} = require('discord.js');
const { createEmbed } = require('../utils/embeds');
const { checkCooldown } = require('../utils/interaction-guard');
const { checkPermission } = require('../utils/permissions');
const { startRegistrationTimeout } = require('../utils/registration-timeout');

const DEFAULT_WELCOME_TITLE = '👋 Kayıt Odasına Hoş Geldiniz';
const DEFAULT_WELCOME_DESCRIPTION = 'Merhaba {user},\nYetkili ekibimiz çağrınızı aldı, birazdan sizinle ilgilenecekler. Bu kanal üzerinden yazışarak ya da sesli olarak görüşebilirsiniz.';
const CHANNEL_ACCESS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory
];

const intents = [
    GatewayIntentBits.GuildMembers
];

function getTicketChannelId(message) {
    return message.embeds[0]?.footer?.text
        ?.match(/(?:^|;)ticket-channel:(\d+)(?:;|$)/)?.[1] || null;
}

async function createRegistrationTicket(worker, data) {
    const guild = worker.guilds.cache.get(data.guildId);
    if (!guild || !worker.coordinator.guilds.cache.has(data.guildId)) {
        throw new Error(`Ana Bot veya kayıt worker'ı sunucuda bulunmuyor (${data.guildId})`);
    }

    const category = guild.channels.cache.get(data.categoryId)
        || await guild.channels.fetch(data.categoryId);
    const registrationRole = guild.roles.cache.get(data.roleId)
        || await guild.roles.fetch(data.roleId);
    const logChannel = guild.channels.cache.get(data.logChannelId)
        || await guild.channels.fetch(data.logChannelId);

    if (!category || category.type !== ChannelType.GuildCategory
        || !registrationRole
        || !logChannel || logChannel.type !== ChannelType.GuildText) {
        throw new Error(`Kayıt kategorisi, rol veya log kanalı worker ${worker.workerName} tarafından bulunamadı`);
    }

    const privateChannel = await guild.channels.create({
        name: data.channelName,
        type: ChannelType.GuildText,
        parent: category,
        permissionOverwrites: [
            {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: data.userId,
                allow: CHANNEL_ACCESS
            },
            {
                id: registrationRole.id,
                allow: CHANNEL_ACCESS
            },
            {
                id: worker.coordinator.user.id,
                allow: [...CHANNEL_ACCESS, PermissionFlagsBits.ManageChannels]
            },
            {
                id: worker.user.id,
                allow: [...CHANNEL_ACCESS, PermissionFlagsBits.ManageChannels]
            }
        ]
    });

    try {
        await privateChannel.send({
            embeds: [data.welcomeEmbed],
            allowedMentions: { parse: [] }
        });

        const activeStaff = registrationRole.members.filter(member => {
            const status = member.presence?.status;
            return status && status !== 'offline';
        });
        const claimButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`kayit_al_${data.userId}`)
                .setLabel('Kaydı Devral')
                .setStyle(ButtonStyle.Success)
        );
        const notificationEmbed = createEmbed({
            title: '🔔 Yeni Kişiye Özel Kayıt Talebi!',
            description: `**Kullanıcı:** <@${data.userId}> (${data.userTag})\n**Oda:** ${privateChannel}\n**Durum:** Beklemede (Devralınmadı)\nÇevrim içi yetkili sayısı: **${activeStaff.size}**`
        }).setFooter({ text: `ticket-channel:${privateChannel.id}` });

        await logChannel.send({
            content: `🔔 ${registrationRole}, yeni bir kayıt talebi açıldı!`,
            embeds: [notificationEmbed],
            components: [claimButton],
            allowedMentions: { roles: [registrationRole.id], users: [] }
        });

        return privateChannel;
    } catch (error) {
        try {
            await privateChannel.delete('Kayıt talebi oluşturulurken işlem tamamlanamadı');
        } catch (cleanupError) {
            console.error(`Eksik kayıt odası silinemedi (${privateChannel.id}):`, cleanupError);
        }
        throw error;
    }
}

function register(client, workerManager) {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()
            || !['kayit_al_', 'kayit_basarili_', 'kayit_iptal_']
                .some(prefix => interaction.customId.startsWith(prefix))) {
            return;
        }

        const guildId = interaction.guildId;
        const master = client.isMaster ? client : client.coordinator;
        if (!guildId || !master?.isReady() || !master.guilds.cache.has(guildId)) {
            await interaction.reply({
                content: '⏸️ Ana Bot bu sunucuda etkin değil. Kayıt işlemleri geçici olarak durduruldu.',
                flags: 64
            }).catch(error => console.error('Ana Bot yokluğu için kayıt etkileşimi yanıtlanamadı:', error));
            return;
        }

        if (!client.isMaster
            && !workerManager.isWorkerActiveForGuild(client, guildId, 'registration')) {
            await interaction.reply({
                content: '⏸️ Bu sunucu için kayıt worker\'ı şu anda kullanılamıyor. Biraz sonra tekrar deneyin.',
                flags: 64
            }).catch(error => console.error('Worker yokluğu için kayıt etkileşimi yanıtlanamadı:', error));
            return;
        }

        if (!await checkCooldown(interaction)) {
            return;
        }
        if (!await checkPermission(interaction, 'registration')) {
            return;
        }

        if (interaction.customId.startsWith('kayit_al_')) {
            await interaction.deferUpdate().catch(error => {
                console.error('Kayıt devralma etkileşimi ertelenemedi:', error);
            });

            const settings = client.settings.getGuildSettings(guildId);
            if (!settings.roleId) {
                await interaction.followUp({ content: '❌ Sunucu kayıt ayarları bulunamadı.', flags: 64 });
                return;
            }

            const targetUserId = interaction.customId.slice('kayit_al_'.length);
            const claimStartedAt = Date.now();
            let voiceNotice = '';
            try {
                const voiceChannel = await workerManager.joinMemberVoiceChannel(
                    guildId,
                    interaction.user.id
                );
                voiceNotice = voiceChannel
                    ? ` Bot ${voiceChannel} ses kanalında bağlı.`
                    : ' Worker bot bu işlem için ses kanalına bağlanamadı.';
            } catch (error) {
                console.error('Kayıt devralınırken ses worker bağlantısı kurulamadı:', error);
                voiceNotice = ' Ses worker bağlantısı kurulamadı; kanal izinlerini veya worker atamasını kontrol edin.';
            }

            const resultButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`kayit_basarili_${targetUserId}`)
                    .setLabel('Başarılı')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`kayit_iptal_${targetUserId}`)
                    .setLabel('İptal')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            const oldEmbed = interaction.message.embeds[0];
            if (!oldEmbed?.description) {
                await interaction.followUp({ content: '❌ Kayıt paneli beklenen bilgileri içermiyor.', flags: 64 });
                return;
            }

            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setDescription(oldEmbed.description.replace(
                    'Durum: Beklemede (Devralınmadı)',
                    `Durum: İşlem Devralındı (${interaction.user.tag})`
                ))
                .setColor('#5865F2');
            const claimedMessage = await interaction.message.edit({
                content: `📌 Bu kayıt süreci ${interaction.user} tarafından yürütülüyor. Sonucu seçin:${voiceNotice}`,
                embeds: [updatedEmbed],
                components: [resultButtons]
            }).catch(error => {
                console.error('Kayıt devralma paneli güncellenemedi:', error);
                return null;
            });
            if (!claimedMessage) {
                return;
            }

            const ticketChannelId = getTicketChannelId(claimedMessage);
            const ticketChannel = ticketChannelId
                ? await interaction.guild.channels.fetch(ticketChannelId).catch(error => {
                    console.error('Kayıt odası bulunamadı; zaman aşımı bildirimi log kanalına gönderilecek:', error);
                    return null;
                })
                : null;
            startRegistrationTimeout({
                client,
                message: claimedMessage,
                ticketChannel,
                user: targetUserId,
                timeoutMs: 120_000,
                startedAt: claimStartedAt
            });
            return;
        }

        client.registrationTimeouts?.get(interaction.message.id)?.stop('resolved');
        const isSuccess = interaction.customId.startsWith('kayit_basarili_');
        await interaction.reply({
            content: isSuccess
                ? '✅ Kayıt başarıyla tamamlandı, kanal kapatılıyor...'
                : '❌ Kayıt iptal edildi, kanal kapatılıyor...',
            flags: 64
        }).catch(error => console.error('Kayıt sonucu etkileşimi yanıtlanamadı:', error));

        const ticketChannelId = getTicketChannelId(interaction.message);
        if (ticketChannelId) {
            const ticketChannel = await interaction.guild.channels.fetch(ticketChannelId).catch(error => {
                console.error(`Kayıt odası bulunamadı (${ticketChannelId}):`, error);
                return null;
            });
            if (ticketChannel) {
                await ticketChannel.delete().catch(error => {
                    console.error(`Kayıt odası silinemedi (${ticketChannelId}):`, error);
                });
            }
        }
        await interaction.message.delete().catch(error => {
            console.error(`Kayıt paneli silinemedi (${interaction.message.id}):`, error);
        });
    });
}

module.exports = {
    task: 'registration',
    intents,
    register,
    registerControlHandlers: register,
    createRegistrationTicket
};
