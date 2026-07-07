-- CreateEnum
CREATE TYPE "StreakMode" AS ENUM ('CALENDAR_RESET', 'ROLLING_24H');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('MESSAGE', 'IMAGE', 'VIDEO', 'FILE', 'REACTION', 'VOICE', 'THREAD', 'COMMAND', 'CUSTOM');

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildSettings" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Baghdad',
    "mode" "StreakMode" NOT NULL DEFAULT 'CALENDAR_RESET',
    "resetTime" TEXT NOT NULL DEFAULT '03:00',
    "graceMinutes" INTEGER NOT NULL DEFAULT 60,
    "dailyRequiredWeight" INTEGER NOT NULL DEFAULT 1,
    "activityWeights" JSONB NOT NULL DEFAULT '{"MESSAGE":1}',
    "messageRules" JSONB NOT NULL DEFAULT '{"minLength":2,"ignoreBots":true,"ignoreRepeated":true}',
    "voiceRules" JSONB NOT NULL DEFAULT '{"minMinutes":10,"ignoreMuted":true,"ignoreDeafened":true}',
    "ignoredChannelIds" JSONB NOT NULL DEFAULT '[]',
    "ignoredRoleIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "MemberStreak" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "highestStreak" INTEGER NOT NULL DEFAULT 0,
    "totalCompletedDays" INTEGER NOT NULL DEFAULT 0,
    "totalActivities" INTEGER NOT NULL DEFAULT 0,
    "totalBrokenStreaks" INTEGER NOT NULL DEFAULT 0,
    "currentDayKey" TEXT,
    "currentDayWeight" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedDay" TEXT,
    "lastActivityAt" TIMESTAMP(3),
    "lastRewardAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MemberStreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "weight" INTEGER NOT NULL,
    "dayKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreakRole" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "requiredDays" INTEGER NOT NULL,
    "removeOnBreak" BOOLEAN NOT NULL DEFAULT true,
    "allowStacking" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StreakRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requiredDays" INTEGER NOT NULL,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreRequest" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalEventId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestoreRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberStreak_guildId_currentStreak_idx" ON "MemberStreak"("guildId", "currentStreak");

-- CreateIndex
CREATE INDEX "MemberStreak_guildId_highestStreak_idx" ON "MemberStreak"("guildId", "highestStreak");

-- CreateIndex
CREATE UNIQUE INDEX "MemberStreak_guildId_userId_key" ON "MemberStreak"("guildId", "userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_guildId_userId_dayKey_idx" ON "ActivityEvent"("guildId", "userId", "dayKey");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEvent_guildId_sourceEventId_key" ON "ActivityEvent"("guildId", "sourceEventId");

-- CreateIndex
CREATE INDEX "StreakRole_guildId_requiredDays_idx" ON "StreakRole"("guildId", "requiredDays");

-- CreateIndex
CREATE UNIQUE INDEX "StreakRole_guildId_roleId_key" ON "StreakRole"("guildId", "roleId");

-- CreateIndex
CREATE INDEX "Reward_guildId_requiredDays_idx" ON "Reward"("guildId", "requiredDays");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "RestoreRequest_guildId_userId_status_idx" ON "RestoreRequest"("guildId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RestoreRequest_guildId_provider_externalEventId_key" ON "RestoreRequest"("guildId", "provider", "externalEventId");

-- CreateIndex
CREATE INDEX "BackupRecord_guildId_createdAt_idx" ON "BackupRecord"("guildId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuildSettings" ADD CONSTRAINT "GuildSettings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberStreak" ADD CONSTRAINT "MemberStreak_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreakRole" ADD CONSTRAINT "StreakRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreRequest" ADD CONSTRAINT "RestoreRequest_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupRecord" ADD CONSTRAINT "BackupRecord_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
