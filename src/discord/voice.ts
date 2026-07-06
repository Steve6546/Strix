import type { VoiceState } from "discord.js";
import { recordActivity } from "../streak/service.js";

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

    const key = `${newState.guild.id}:${newState.id}`;
    const leftChannel = oldState.channelId && oldState.channelId !== newState.channelId;
    const joinedChannel = newState.channelId && oldState.channelId !== newState.channelId;

    if (leftChannel) {
      const session = sessions.get(key);
      sessions.delete(key);
      if (session) {
        const leftAt = new Date();
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
            durationSeconds: Math.max(0, Math.floor((leftAt.getTime() - session.joinedAt.getTime()) / 1000)),
            selfMuted: session.selfMuted,
            selfDeafened: session.selfDeafened
          }
        });
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
