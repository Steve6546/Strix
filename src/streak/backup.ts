import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db.js";

const BACKUP_DIR = path.resolve("./backups");

export async function createDatabaseBackup(guildId: string | null = null): Promise<string> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = guildId ? `backup-${guildId}-${dateStr}.json` : `backup-full-${dateStr}.json`;
  const backupPath = path.join(BACKUP_DIR, filename);

  const data: Record<string, any> = {};

  if (guildId) {
    data.guild = await prisma.guild.findUnique({ where: { id: guildId }, include: { settings: true } });
    data.memberStreaks = await prisma.memberStreak.findMany({ where: { guildId } });
    data.streakRoles = await prisma.streakRole.findMany({ where: { guildId } });
    data.rewards = await prisma.reward.findMany({ where: { guildId } });
  } else {
    data.guilds = await prisma.guild.findMany({ include: { settings: true } });
    data.memberStreaks = await prisma.memberStreak.findMany();
    data.streakRoles = await prisma.streakRole.findMany();
    data.rewards = await prisma.reward.findMany();
  }

  const jsonStr = JSON.stringify(data, null, 2);
  const hash = crypto.createHash("sha256").update(jsonStr).digest("hex");

  await fs.writeFile(backupPath, jsonStr, "utf8");

  const stat = await fs.stat(backupPath);

  await prisma.backupRecord.create({
    data: {
      guildId,
      kind: guildId ? "PARTIAL" : "FULL",
      path: backupPath,
      checksum: hash,
      sizeBytes: BigInt(stat.size)
    }
  });

  return backupPath;
}

export async function restoreDatabaseBackup(backupId: string): Promise<boolean> {
  const record = await prisma.backupRecord.findUnique({ where: { id: backupId } });
  if (!record) throw new Error("Backup record not found");

  const jsonStr = await fs.readFile(record.path, "utf8");
  const hash = crypto.createHash("sha256").update(jsonStr).digest("hex");

  if (hash !== record.checksum) {
    throw new Error("Backup file checksum mismatch. File is corrupted.");
  }

  const data = JSON.parse(jsonStr);

  await prisma.$transaction(async (tx) => {
    if (record.kind === "PARTIAL" && data.guild) {
      const guildId = data.guild.id;
      // Clear current structures for this guild (Atomic refresh)
      await tx.memberStreak.deleteMany({ where: { guildId } });
      await tx.streakRole.deleteMany({ where: { guildId } });
      await tx.reward.deleteMany({ where: { guildId } });

      await tx.guild.upsert({
        where: { id: guildId },
        create: { id: guildId, name: data.guild.name },
        update: { name: data.guild.name }
      });

      if (data.guild.settings) {
        await tx.guildSettings.upsert({
          where: { guildId },
          create: { ...data.guild.settings, guildId },
          update: { ...data.guild.settings }
        });
      }

      for (const member of data.memberStreaks) {
        await tx.memberStreak.create({ data: member });
      }
      for (const role of data.streakRoles) {
        await tx.streakRole.create({ data: role });
      }
      for (const reward of data.rewards) {
        await tx.reward.create({ data: reward });
      }
    } else if (record.kind === "FULL") {
      // Re-populate everything (careful, destructive full reset)
      await tx.backupRecord.deleteMany();
      await tx.restoreRequest.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.activityEvent.deleteMany();
      await tx.reward.deleteMany();
      await tx.streakRole.deleteMany();
      await tx.memberStreak.deleteMany();
      await tx.guildSettings.deleteMany();
      await tx.guild.deleteMany();

      for (const guild of data.guilds) {
        await tx.guild.create({ data: { id: guild.id, name: guild.name } });
        if (guild.settings) {
          await tx.guildSettings.create({ data: { ...guild.settings, guildId: guild.id } });
        }
      }

      for (const member of data.memberStreaks) {
        await tx.memberStreak.create({ data: member });
      }
      for (const role of data.streakRoles) {
        await tx.streakRole.create({ data: role });
      }
      for (const reward of data.rewards) {
        await tx.reward.create({ data: reward });
      }
    }
  });

  return true;
}
