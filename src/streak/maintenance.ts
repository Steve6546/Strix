import { prisma } from "../db.js";
import { getDayKey, previousDayKey } from "./calendar.js";

export function startStreakMaintenance() {
  void breakExpiredStreaks();
  const timer = setInterval(() => {
    void breakExpiredStreaks();
  }, 15 * 60 * 1000);
  timer.unref();
}

async function breakExpiredStreaks() {
  const guilds = await prisma.guild.findMany({
    include: { settings: true }
  });

  for (const guild of guilds) {
    if (!guild.settings?.enabled) {
      continue;
    }

    const today = getDayKey(new Date(), guild.settings);
    const yesterday = previousDayKey(today);
    const expired = await prisma.memberStreak.findMany({
      where: {
        guildId: guild.id,
        currentStreak: { gt: 0 },
        deletedAt: null,
        NOT: [
          { lastCompletedDay: today },
          { lastCompletedDay: yesterday }
        ]
      },
      take: 500
    });

    for (const member of expired) {
      await prisma.$transaction([
        prisma.memberStreak.update({
          where: { id: member.id },
          data: {
            currentStreak: 0,
            currentDayWeight: 0,
            currentDayKey: today,
            totalBrokenStreaks: { increment: 1 }
          }
        }),
        prisma.auditLog.create({
          data: {
            guildId: guild.id,
            actorId: member.userId,
            action: "STREAK_BROKEN",
            entity: "MemberStreak",
            entityId: member.id,
            before: {
              currentStreak: member.currentStreak,
              lastCompletedDay: member.lastCompletedDay
            },
            after: {
              currentStreak: 0,
              dayKey: today
            }
          }
        })
      ]);
    }
  }
}
