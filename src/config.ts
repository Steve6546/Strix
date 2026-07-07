import dotenv from "dotenv";
dotenv.config({ override: true });
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  ALLOWED_GUILDS: z.string().optional().transform((val) => val ? val.split(",").map(id => id.trim()).filter(id => id.length > 0) : []),
  DATABASE_URL: z.string().min(1),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  DASHBOARD_ADMIN_TOKEN: z.string().min(1)
});

export const config = envSchema.parse(process.env);
