-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "leaderboardSettings" JSONB NOT NULL DEFAULT '{"limit":25,"excludeBots":true,"ignoredRoleIds":[],"channelId":"","autoUpdate":false,"intervalMinutes":60,"messageId":""}';
