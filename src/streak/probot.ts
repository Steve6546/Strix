import { prisma } from "../db.js";
import { getDayKey } from "./calendar.js";

/**
 * Handles incoming ProBot credit transfers by parsing message content.
 * ProBot transfer messages usually look like:
 * "**:moneybag: | User, has transferred `1,000` credits to recipient**"
 */
export async function handleProBotMessage(message: any) {
  try {
    if (!message.guild) return;

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: message.guild.id }
    });

    if (!settings || !settings.restoreEnabled) return;

    // Verify message sender is the actual ProBot bot ID
    // ProBot Bot ID is typically 282859044593598464 or we can match bot name
    if (!message.author.bot || !message.author.username.toLowerCase().includes("probot")) {
      return;
    }

    const content = message.content;
    const transferRegex = /has transferred\s+`([\d,]+)`\s+credits\s+to\s+<@!?(\d+)>/i;
    const match = content.match(transferRegex);
    if (!match) return;

    const amount = parseInt(match[1].replace(/,/g, ""), 10);
    const recipientId = match[2];

    // Read the user ID from the transfer initiator (often mentioned at start of message)
    const initiatorMatch = content.match(/<@!?(\d+)>\s*,?\s*has transferred/i) || content.match(/\*\*<@!?(\d+)>\*\*,\s*has/);
    if (!initiatorMatch) return;
    const senderId = initiatorMatch[1];

    // Check configuration requirements
    if (recipientId !== settings.restoreRecipientId) return;
    if (amount < settings.restorePrice) return;

    // Idempotency Check using the event message ID as externalEventId
    const existing = await prisma.restoreRequest.findUnique({
      where: {
        guildId_provider_externalEventId: {
          guildId: message.guild.id,
          provider: "PROBOT",
          externalEventId: message.id
        }
      }
    });

    if (existing) return;

    await prisma.$transaction(async (tx) => {
      // Find expired member streak to restore
      const member = await tx.memberStreak.findUnique({
        where: { guildId_userId: { guildId: message.guild.id, userId: senderId } }
      });

      if (!member || member.currentStreak > 0) return;

      // Create restore log
      await tx.restoreRequest.create({
        data: {
          guildId: message.guild.id,
          userId: senderId,
          provider: "PROBOT",
          amount,
          status: "COMPLETED",
          externalEventId: message.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          completedAt: new Date()
        }
      });

      // Restore last computed streak, set day key to today
      const today = getDayKey(new Date(), settings);
      await tx.memberStreak.update({
        where: { id: member.id },
        data: {
          currentStreak: member.highestStreak > 0 ? Math.max(1, Math.floor(member.highestStreak / 2)) : 1, // Restore to half of highest streak or 1
          currentDayKey: today,
          currentDayWeight: settings.dailyRequiredWeight
        }
      });

      await tx.auditLog.create({
        data: {
          guildId: message.guild.id,
          actorId: senderId,
          action: "STREAK_RESTORED_PROBOT",
          entity: "MemberStreak",
          entityId: member.id,
          after: {
            amount,
            externalEventId: message.id
          }
        }
      });
    });

    // Send confirmation message to channel
    await message.reply(`🎉 تم استرجاع الستريك بنجاح للعضو <@${senderId}>!`);
  } catch (error) {
    console.error("ProBot restoration parsing error:", error);
  }
}
