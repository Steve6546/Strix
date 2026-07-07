import type { ActivityType, GuildSettings, Prisma, MemberStreak } from "@prisma/client";
import { prisma } from "../db.js";
import { getDayKey, previousDayKey } from "./calendar.js";

type RecordActivityInput = {
  guildId: string;
  guildName?: string | null;
  userId: string;
  sourceEventId: string;
  type: ActivityType;
  occurredAt: Date;
  metadata?: Prisma.InputJsonValue;
};

export async function recordActivity(input: RecordActivityInput) {
  return prisma.$transaction(async (tx) => {
    await tx.guild.upsert({
      where: { id: input.guildId },
      create: {
        id: input.guildId,
        name: input.guildName,
        settings: { create: {} }
      },
      update: { name: input.guildName }
    });

    const settings = await tx.guildSettings.findUniqueOrThrow({
      where: { guildId: input.guildId }
    });

    if (!settings.enabled) {
      return { status: "disabled" as const };
    }

    if (shouldIgnoreActivity(settings, input)) {
      return { status: "ignored" as const };
    }

    // limitOneSessionPerDay check for VOICE activities
    if (input.type === "VOICE") {
      const voiceRules = settings.voiceRules as Record<string, any>;
      if (voiceRules.limitOneSessionPerDay) {
        const dayKey = getDayKey(input.occurredAt, settings);
        const existingVoice = await tx.activityEvent.findFirst({
          where: {
            guildId: input.guildId,
            userId: input.userId,
            type: "VOICE",
            dayKey
          }
        });
        if (existingVoice) {
          return { status: "ignored" as const };
        }
      }
    }

    const weight = resolveWeight(settings, input.type);
    if (weight <= 0) {
      return { status: "ignored" as const };
    }

    const dayKey = getDayKey(input.occurredAt, settings);

    try {
      await tx.activityEvent.create({
        data: {
          guildId: input.guildId,
          userId: input.userId,
          sourceEventId: input.sourceEventId,
          type: input.type,
          weight,
          dayKey,
          occurredAt: input.occurredAt,
          metadata: input.metadata ?? {}
        }
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        return { status: "duplicate" as const };
      }
      throw error;
    }

    const member = await tx.memberStreak.upsert({
      where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
      create: {
        guildId: input.guildId,
        userId: input.userId,
        currentDayKey: dayKey,
        currentDayWeight: 0,
        lastActivityAt: input.occurredAt
      },
      update: {
        lastActivityAt: input.occurredAt,
        totalActivities: { increment: 1 }
      }
    });

    const sameDay = member.currentDayKey === dayKey;
    const nextWeight = (sameDay ? member.currentDayWeight : 0) + weight;
    const completesDay = nextWeight >= settings.dailyRequiredWeight && member.lastCompletedDay !== dayKey;

    let currentStreak = member.currentStreak;
    let highestStreak = member.highestStreak;
    let totalCompletedDays = member.totalCompletedDays;

    if (completesDay) {
      const previous = previousDayKey(dayKey);
      currentStreak = member.lastCompletedDay === previous ? member.currentStreak + 1 : 1;
      highestStreak = Math.max(member.highestStreak, currentStreak);
      totalCompletedDays = member.totalCompletedDays + 1;
    }

    const updated = await tx.memberStreak.update({
      where: { id: member.id },
      data: {
        currentDayKey: dayKey,
        currentDayWeight: nextWeight,
        currentStreak,
        highestStreak,
        totalCompletedDays,
        lastCompletedDay: completesDay ? dayKey : member.lastCompletedDay,
        lastActivityAt: input.occurredAt
      }
    });

    if (completesDay) {
      await tx.auditLog.create({
        data: {
          guildId: input.guildId,
          actorId: input.userId,
          action: "STREAK_DAY_COMPLETED",
          entity: "MemberStreak",
          entityId: updated.id,
          after: {
            dayKey,
            currentStreak,
            highestStreak
          }
        }
      });

      // Apply Rewards & Roles if streak increases
      await checkAndApplyRewards(tx, updated, currentStreak);
    }

    return { status: completesDay ? "completed" : "recorded", member: updated };
  });
}

function resolveWeight(settings: GuildSettings, type: ActivityType): number {
  const weights = settings.activityWeights as Record<string, unknown>;
  const value = weights[type];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function shouldIgnoreActivity(settings: GuildSettings, input: RecordActivityInput): boolean {
  const metadata = (input.metadata ?? {}) as Record<string, unknown>;
  const ignoredChannelIds = settings.ignoredChannelIds as string[];

  if (typeof metadata.channelId === "string" && ignoredChannelIds.includes(metadata.channelId)) {
    return true;
  }

  if (input.type === "MESSAGE") {
    const rules = settings.messageRules as Record<string, unknown>;
    const minLength = typeof rules.minLength === "number" ? rules.minLength : 2;
    return typeof metadata.length === "number" && metadata.length < minLength;
  }

  if (input.type === "VOICE") {
    const rules = settings.voiceRules as Record<string, unknown>;
    const minMinutes = typeof rules.minMinutes === "number" ? rules.minMinutes : 10;
    const ignoreMuted = rules.ignoreMuted !== false;
    const ignoreDeafened = rules.ignoreDeafened !== false;
    const durationSeconds = typeof metadata.durationSeconds === "number" ? metadata.durationSeconds : 0;
    const selfMuted = metadata.selfMuted === true;
    const selfDeafened = metadata.selfDeafened === true;
    return durationSeconds < minMinutes * 60 || (ignoreMuted && selfMuted) || (ignoreDeafened && selfDeafened);
  }

  return false;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function checkAndApplyRewards(tx: any, member: MemberStreak, currentStreak: number) {
  // Fetch rewards configured for this guild at this specific milestone
  const rewards = await tx.reward.findMany({
    where: { guildId: member.guildId, requiredDays: currentStreak, deletedAt: null }
  });

  for (const reward of rewards) {
    // Record audit log for rewards received
    await tx.auditLog.create({
      data: {
        guildId: member.guildId,
        actorId: member.userId,
        action: "REWARD_EARNED",
        entity: "Reward",
        entityId: reward.id,
        after: {
          name: reward.name,
          type: reward.type,
          requiredDays: reward.requiredDays
        }
      }
    });
  }

  // Fetch roles configuration
  const streakRoles = await tx.streakRole.findMany({
    where: { guildId: member.guildId, requiredDays: { lte: currentStreak }, deletedAt: null },
    orderBy: { priority: "desc" }
  });

  if (streakRoles.length > 0) {
    // Find matching role rules
    const rolesToAward = [];
    const highestPriorityRole = streakRoles[0];

    for (const role of streakRoles) {
      if (role.allowStacking || role.roleId === highestPriorityRole.roleId) {
        rolesToAward.push(role.roleId);
      }
    }

    // These role updates will be handled by external workers or events, 
    // we log this in AuditLogs for later processing.
    await tx.auditLog.create({
      data: {
        guildId: member.guildId,
        actorId: member.userId,
        action: "ROLES_MATCHED",
        entity: "MemberStreak",
        entityId: member.id,
        after: {
          rolesToAward,
          currentStreak
        }
      }
    });
  }
}

