-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'STICKER';
ALTER TYPE "ActivityType" ADD VALUE 'VOICE_STREAM';
ALTER TYPE "ActivityType" ADD VALUE 'SCREEN_SHARE';
ALTER TYPE "ActivityType" ADD VALUE 'REPLY';
ALTER TYPE "ActivityType" ADD VALUE 'BOT_INTERACTION';
ALTER TYPE "ActivityType" ADD VALUE 'TICKET_OPEN';

-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "backupSettings" JSONB NOT NULL DEFAULT '{"enabled":false,"interval":"DAILY","keepCount":5}',
ALTER COLUMN "activityWeights" SET DEFAULT '{"MESSAGE":1,"IMAGE":3,"VIDEO":3,"FILE":2,"STICKER":2,"REACTION":1,"VOICE":1,"VOICE_STREAM":3,"SCREEN_SHARE":3,"THREAD":2,"REPLY":1,"COMMAND":1,"BOT_INTERACTION":1,"TICKET_OPEN":5,"CUSTOM":1}',
ALTER COLUMN "voiceRules" SET DEFAULT '{"minMinutes":10,"ignoreMuted":true,"ignoreDeafened":true,"ignoreAFK":true,"realTimeOnly":true,"limitOneSessionPerDay":false}';
