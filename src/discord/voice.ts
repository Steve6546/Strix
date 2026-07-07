import type { VoiceState } from "discord.js";
import { recordActivity } from "../streak/service.js";
import { prisma } from "../db.js";

type VoiceSession = {
  guildId: string;
  guildName: string | null;
  userId: string;
  channelId: string;
  joinedAt: Date;
  selfMuted: boolean;
  selfDeafened: boolean;
};

const sessions = new Map<string, VoiceSession>();

export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
  try {
    if (newState.member?.user.bot || oldState.member?.user.bot) {
      return;
    }

    const guildId = newState.guild.id;
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId }
    });

    if (!settings || !settings.enabled) return;

    // Check if streaming started
    if (newState.channelId && !oldState.streaming && newState.streaming) {
      await recordActivity({
        guildId: newState.guild.id,
        guildName: newState.guild.name,
        userId: newState.id,
        sourceEventId: `discord:voice_stream:${newState.guild.id}:${newState.id}:${Date.now()}`,
        type: "VOICE_STREAM",
        occurredAt: new Date(),
        metadata: { channelId: newState.channelId }
      }).catch(console.error);
    }

    // Check if video/screen share started
    if (newState.channelId && !oldState.selfVideo && newState.selfVideo) {
      await recordActivity({
        guildId: newState.guild.id,
        guildName: newState.guild.name,
        userId: newState.id,
        sourceEventId: `discord:screen_share:${newState.guild.id}:${newState.id}:${Date.now()}`,
        type: "SCREEN_SHARE",
        occurredAt: new Date(),
        metadata: { channelId: newState.channelId }
      }).catch(console.error);
    }

    const key = `${guildId}:${newState.id}`;
    const leftChannel = oldState.channelId && oldState.channelId !== newState.channelId;
    const joinedChannel = newState.channelId && oldState.channelId !== newState.channelId;

    const voiceRules = settings.voiceRules as Record<string, any>;

    // Anti-abuse: check rapid join/leave spam
    if (leftChannel) {
      const session = sessions.get(key);
      sessions.delete(key);
      if (session) {
        const leftAt = new Date();
        const durationSeconds = Math.max(0, Math.floor((leftAt.getTime() - session.joinedAt.getTime()) / 1000));
        
        // Skip AFK channels if configured
        const isAFK = newState.guild.afkChannelId === oldState.channelId;
        const ignoreAFK = voiceRules.ignoreAFK !== false;

        if (!(isAFK && ignoreAFK)) {
          await recordActivity({
            guildId: session.guildId,
            guildName: session.guildName,
            userId: session.userId,
            sourceEventId: `discord:voice:${session.guildId}:${session.userId}:${session.joinedAt.getTime()}`,
            type: "VOICE",
            occurredAt: leftAt,
            metadata: {
              channelId: session.channelId,
              joinedAt: session.joinedAt.toISOString(),
              leftAt: leftAt.toISOString(),
              durationSeconds,
              selfMuted: session.selfMuted,
              selfDeafened: session.selfDeafened
            }
          });
        }
      }
    }

    if (joinedChannel && newState.channelId) {
      sessions.set(key, {
        guildId: newState.guild.id,
        guildName: newState.guild.name,
        userId: newState.id,
        channelId: newState.channelId,
        joinedAt: new Date(),
        selfMuted: Boolean(newState.selfMute || newState.serverMute),
        selfDeafened: Boolean(newState.selfDeaf || newState.serverDeaf)
      });
    }
  } catch (error) {
    console.error(error);
  }
}
