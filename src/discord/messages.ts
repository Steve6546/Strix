import type { Message } from "discord.js";
import { createHash } from "node:crypto";
import { recordActivity } from "../streak/service.js";
import { prisma } from "../db.js";
import type { ActivityType } from "@prisma/client";

// Anti-spam in-memory tracking
const lastUserMessages = new Map<string, { textHash: string; time: number }>();

export async function handleMessageCreate(message: Message) {
  try {
    if (!message.guild || message.author.bot) {
      return;
    }

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: message.guild.id }
    });

    if (!settings || !settings.enabled) return;

    // Check Ignored Roles
    const memberRoles = message.member?.roles.cache.keys() || [];
    const ignoredRoles = settings.ignoredRoleIds as string[];
    if ([...memberRoles].some(r => ignoredRoles.includes(r))) {
      return;
    }

    // Check Ignored Channels
    const ignoredChannels = settings.ignoredChannelIds as string[];
    if (ignoredChannels.includes(message.channel.id)) {
      return;
    }

    const messageRules = settings.messageRules as Record<string, any>;

    // Anti-spam verification
    if (messageRules.ignoreSpam) {
      const now = Date.now();
      const last = lastUserMessages.get(message.author.id);
      if (last && now - last.time < 1000) {
        // More than 1 message per second is ignored
        return;
      }
      
      const currentHash = hashMessage(message.content);
      if (messageRules.ignoreRepeated && last && last.textHash === currentHash) {
        return;
      }

      lastUserMessages.set(message.author.id, { textHash: currentHash, time: now });
    }

    const isImage = message.attachments.some(a => a.contentType?.startsWith("image/"));
    const isVideo = message.attachments.some(a => a.contentType?.startsWith("video/"));
    const isFile = message.attachments.size > 0 && !isImage && !isVideo;
    const isSticker = message.stickers.size > 0;
    const isReply = message.reference !== null;

    let isBotInt = message.mentions.users.some(u => u.bot);
    if (!isBotInt && message.reference && message.reference.messageId) {
      const repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (repliedMsg?.author.bot) {
        isBotInt = true;
      }
    }

    let activityType: ActivityType = "MESSAGE";
    if (isBotInt) activityType = "BOT_INTERACTION";
    else if (isSticker) activityType = "STICKER";
    else if (isReply) activityType = "REPLY";
    else if (isImage) activityType = "IMAGE";
    else if (isVideo) activityType = "VIDEO";
    else if (isFile) activityType = "FILE";

    await recordActivity({
      guildId: message.guild.id,
      guildName: message.guild.name,
      userId: message.author.id,
      sourceEventId: `discord:message:${message.id}`,
      type: activityType,
      occurredAt: message.createdAt,
      metadata: {
        channelId: message.channel.id,
        length: message.content.length,
        contentHash: hashMessage(message.content),
        hasAttachments: message.attachments.size > 0
      }
    });
  } catch (error) {
    console.error(error);
  }
}

function hashMessage(content: string) {
  return createHash("sha256")
    .update(content.trim().replace(/\s+/g, " ").toLowerCase())
    .digest("hex");
}
