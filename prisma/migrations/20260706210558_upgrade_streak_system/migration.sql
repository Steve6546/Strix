-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "restoreEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restorePrice" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "restoreRecipientId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "restoreTimeoutHours" INTEGER NOT NULL DEFAULT 24,
ALTER COLUMN "activityWeights" SET DEFAULT '{"MESSAGE":1,"IMAGE":3,"VIDEO":3,"FILE":2,"REACTION":1,"VOICE":1,"THREAD":2,"COMMAND":1,"CUSTOM":1}',
ALTER COLUMN "messageRules" SET DEFAULT '{"minLength":2,"ignoreBots":true,"ignoreRepeated":true,"ignoreSpam":true,"ignoreDeleted":true,"ignoreEdited":true}',
ALTER COLUMN "voiceRules" SET DEFAULT '{"minMinutes":10,"ignoreMuted":true,"ignoreDeafened":true,"ignoreAFK":true,"realTimeOnly":true}';
