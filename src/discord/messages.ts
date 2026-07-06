import type { Message } from "discord.js";
import { createHash } from "node:crypto";
import { recordActivity } from "../streak/service.js";

export async function handleMessageCreate(message: Message) {
  try {
    if (!message.guild || message.author.bot) {
      return;
    }

    await recordActivity({
      guildId: message.guild.id,
      guildName: message.guild.name,
      userId: message.author.id,
      sourceEventId: `discord:message:${message.id}`,
      type: "MESSAGE",
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
