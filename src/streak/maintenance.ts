import { prisma } from "../db.js";
import { getDayKey, previousDayKey } from "./calendar.js";

export function startStreakMaintenance() {
  void breakExpiredStreaks();
  void checkAndRunScheduledBackups();
  const timer = setInterval(() => {
    void breakExpiredStreaks();
    void checkAndRunScheduledBackups();
  }, 15 * 60 * 1000);
  timer.unref();
}

async function checkAndRunScheduledBackups() {
  try {
    const settingsList = await prisma.guildSettings.findMany({
      where: { enabled: true }
    });
    for (const settings of settingsList) {
      const backupOpts = (settings.backupSettings || {}) as Record<string, any>;
      if (!backupOpts.enabled) continue;

      const lastBackup = await prisma.backupRecord.findFirst({
        where: { guildId: settings.guildId, kind: "PARTIAL" },
        orderBy: { createdAt: "desc" }
      });

      const now = new Date();
      let shouldBackup = false;
      if (!lastBackup) {
        shouldBackup = true;
      } else {
        const diffMs = now.getTime() - lastBackup.createdAt.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        if (backupOpts.interval === "DAILY" && diffHours >= 23.5) {
          shouldBackup = true;
        } else if (backupOpts.interval === "WEEKLY" && diffHours >= 24 * 7 - 0.5) {
          shouldBackup = true;
        }
      }

      if (shouldBackup) {
        const { createDatabaseBackup } = await import("./backup.js");
        const backupPath = await createDatabaseBackup(settings.guildId);
        console.log(`[Backup Scheduler] Created automated backup for guild ${settings.guildId}: ${backupPath}`);

        // Prune old backups
        const keepCount = typeof backupOpts.keepCount === "number" ? backupOpts.keepCount : 5;
        const backups = await prisma.backupRecord.findMany({
          where: { guildId: settings.guildId, kind: "PARTIAL" },
          orderBy: { createdAt: "desc" }
        });
        if (backups.length > keepCount) {
          const toPrune = backups.slice(keepCount);
          const fs = await import("node:fs/promises");
          for (const b of toPrune) {
            await fs.unlink(b.path).catch(() => {});
            await prisma.backupRecord.delete({ where: { id: b.id } });
            console.log(`[Backup Scheduler] Pruned old backup: ${b.path}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("[Backup Scheduler] Error running scheduled backups:", error);
  }
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
