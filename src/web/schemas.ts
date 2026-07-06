import { z } from "zod";

export const snowflakeSchema = z.string().regex(/^\d{5,25}$/);

export const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  locale: z.enum(["ar", "en"]).optional(),
  timezone: z.string().min(1).max(64).optional(),
  mode: z.enum(["CALENDAR_RESET", "ROLLING_24H"]).optional(),
  resetTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  graceMinutes: z.number().int().min(0).max(1440).optional(),
  dailyRequiredWeight: z.number().int().min(1).max(100000).optional(),
  activityWeights: z.record(z.string(), z.number().int().min(0).max(100000)).optional(),
  messageRules: z.object({
    minLength: z.number().int().min(1).max(2000).optional(),
    ignoreBots: z.boolean().optional(),
    ignoreRepeated: z.boolean().optional()
  }).passthrough().optional(),
  voiceRules: z.object({
    minMinutes: z.number().int().min(1).max(1440).optional(),
    ignoreMuted: z.boolean().optional(),
    ignoreDeafened: z.boolean().optional()
  }).passthrough().optional(),
  ignoredChannelIds: z.array(snowflakeSchema).max(500).optional(),
  ignoredRoleIds: z.array(snowflakeSchema).max(500).optional()
});
