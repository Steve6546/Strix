import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { Client, EmbedBuilder, ChannelType } from "discord.js";
import { prisma } from "../db.js";
import { requireDashboardAuth } from "../security/auth.js";
import { errorHandler, notFoundHandler } from "../security/errors.js";
import { snowflakeSchema, updateSettingsSchema } from "./schemas.js";
import { signSession, type SessionUser } from "../security/session.js";
import { config } from "../config.js";
import { isGuildAllowed } from "../discord/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../public");

export function createWebServer(discordClient: Client) {
  const app = express();

  app.disable("x-powered-by");
  app.use(compression());
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-elem": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "style-src-elem": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "https://cdn.discordapp.com"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'none'"],
        "frame-ancestors": ["'none'"]
      }
    }
  }));
  app.use(express.json({ limit: "5mb" })); // Increased limit for JSON imports

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300, // Increased limit for rich dashboard queries
    standardHeaders: true,
    legacyHeaders: false
  });

  // Health endpoint
  app.get("/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  // Login page
  app.get("/login", (req, res) => {
    const error = req.query.error ? String(req.query.error) : undefined;
    res.type("html").send(renderLoginShell(error));
  });

  // Logout endpoint
  app.get("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
    res.redirect("/login");
  });

  // Discord OAuth2 Callback
  app.get("/auth/callback", async (req, res) => {
    const code = req.query.code;
    if (!code) {
      res.redirect("/login?error=" + encodeURIComponent("لم يتم توفير رمز مصادقة Discord"));
      return;
    }

    try {
      if (!config.DISCORD_CLIENT_SECRET || !config.DISCORD_CLIENT_ID) {
        res.redirect("/login?error=" + encodeURIComponent("OAuth2 غير مفعّل على الخادم"));
        return;
      }

      // Exchange code for token
      const tokenParams = new URLSearchParams({
        client_id: config.DISCORD_CLIENT_ID,
        client_secret: config.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: config.PUBLIC_BASE_URL + "/auth/callback"
      });

      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenParams
      });

      if (!tokenRes.ok) {
        const errData = await tokenRes.text();
        console.error("Token exchange failed:", errData);
        res.redirect("/login?error=" + encodeURIComponent("فشل تبادل رموز المصادقة"));
        return;
      }

      const tokenData = await tokenRes.json() as any;

      // Fetch user profile
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { "Authorization": `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json() as any;

      // Fetch user guilds
      const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { "Authorization": `Bearer ${tokenData.access_token}` }
      });
      const userGuilds = await guildsRes.json() as any[];

      // Check if user is the bot owner
      let isBotOwner = false;
      const appInfo = discordClient.application;
      if (appInfo) {
        if (appInfo.owner?.id === userData.id) {
          isBotOwner = true;
        } else if (appInfo.owner && 'members' in appInfo.owner && appInfo.owner.members?.has(userData.id)) {
          isBotOwner = true;
        }
      }

      // Filter guilds where user has MANAGE_GUILD (0x20) or ADMINISTRATOR (0x8)
      // and where the bot is present
      const manageableGuilds = userGuilds
        .filter((g: any) => {
          const permissions = BigInt(g.permissions);
          const hasPermission = (permissions & 0x20n) === 0x20n || (permissions & 0x8n) === 0x8n;
          return hasPermission && discordClient.guilds.cache.has(g.id);
        })
        .map((g: any) => g.id);

      const sessionUser: SessionUser = {
        id: userData.id,
        username: userData.username,
        avatar: userData.avatar,
        isAdmin: isBotOwner,
        manageableGuilds
      };

      const sessionToken = signSession(sessionUser);
      res.setHeader("Set-Cookie", `session=${sessionToken}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
      res.redirect("/");
    } catch (error) {
      console.error("OAuth2 Callback Error:", error);
      res.redirect("/login?error=" + encodeURIComponent("حدث خطأ أثناء تسجيل الدخول"));
    }
  });

  // Token-based Login (Fallback Mode)
  app.post("/api/auth/token-login", async (req, res) => {
    const { token } = req.body;
    if (token === config.DASHBOARD_ADMIN_TOKEN) {
      const adminUser: SessionUser = {
        id: "admin",
        username: "مدير النظام",
        avatar: null,
        isAdmin: true,
        manageableGuilds: []
      };
      const sessionToken = signSession(adminUser);
      res.setHeader("Set-Cookie", `session=${sessionToken}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Authenticated routes
  app.use(requireDashboardAuth);

  // Serve static files
  app.use("/assets", express.static(publicDir, {
    fallthrough: false,
    immutable: true,
    maxAge: "1h"
  }));
  app.use("/api", apiLimiter);

  // Helper middleware to check if user has access to a specific guild
  function requireGuildAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
    const guildId = req.params.guildId;
    const user = res.locals.user as SessionUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.isAdmin) {
      return next();
    }
    if (user.manageableGuilds.includes(guildId)) {
      return next();
    }
    res.status(403).json({ error: "Forbidden: No access to this server" });
  }

  // Dashboard landing page
  app.get("/", (_req, res) => {
    res.type("html").send(renderDashboardShell(res.locals.user));
  });

  // Status check endpoint
  app.get("/api/status", async (_req, res) => {
    let dbConnected = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbConnected = true;
    } catch {}

    const botOnline = discordClient.readyAt !== null;
    const botUser = botOnline && discordClient.user
      ? {
          username: discordClient.user.username,
          tag: discordClient.user.tag,
          avatarUrl: discordClient.user.displayAvatarURL({ size: 64 })
        }
      : null;

    res.json({
      botOnline,
      botUser,
      dbConnected
    });
  });

  // Retrieve manageable guilds
  app.get("/api/guilds", async (_req, res) => {
    const user = res.locals.user as SessionUser;
    let dbGuilds = await prisma.guild.findMany({
      include: { settings: true },
      orderBy: { createdAt: "desc" }
    });

    if (!user.isAdmin) {
      dbGuilds = dbGuilds.filter(g => user.manageableGuilds.includes(g.id));
    }

    const guilds = dbGuilds.map(g => {
      const discordGuild = discordClient.guilds.cache.get(g.id);
      return {
        ...g,
        name: discordGuild ? discordGuild.name : (g.name || g.id),
        iconUrl: discordGuild ? discordGuild.iconURL({ size: 64 }) : null
      };
    });

    res.json({ guilds });
  });

  // Retrieve live guild roles from Discord client cache
  app.get("/api/guilds/:guildId/discord-roles", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
      res.json({ roles: [] });
      return;
    }

    const botMember = await guild.members.fetch(discordClient.user!.id).catch(() => null);
    const botHighestRolePosition = botMember ? botMember.roles.highest.position : 0;

    const roles = guild.roles.cache.map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor,
      isHigherThanBot: r.position >= botHighestRolePosition && r.name !== "@everyone"
    })).filter(r => r.name !== "@everyone");

    res.json({ roles, botHighestRolePosition });
  });

  // Retrieve live guild text channels from Discord client cache
  app.get("/api/guilds/:guildId/discord-channels", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) {
      res.json({ channels: [] });
      return;
    }
    const channels = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText)
      .map(c => ({
        id: c.id,
        name: c.name
      }));
    res.json({ channels });
  });

  // Get guild leaderboard
  app.get("/api/guilds/:guildId/leaderboard", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
    const opts = (settings?.leaderboardSettings || {}) as Record<string, any>;
    const limit = typeof opts.limit === "number" ? opts.limit : 25;

    const members = await prisma.memberStreak.findMany({
      where: { guildId, deletedAt: null },
      orderBy: [{ currentStreak: "desc" }, { highestStreak: "desc" }],
      take: limit
    });
    res.json({ members, settings: opts });
  });

  // Publish leaderboard manually
  app.post("/api/guilds/:guildId/leaderboard/publish", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    try {
      await publishLeaderboard(guildId, discordClient);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update Settings
  app.patch("/api/guilds/:guildId/settings", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const body = updateSettingsSchema.parse(req.body);
    const before = await prisma.guildSettings.findUnique({ where: { guildId } });

    const data: Prisma.GuildSettingsUpdateInput = {
      ...body,
      activityWeights: body.activityWeights as Prisma.InputJsonValue | undefined,
      messageRules: body.messageRules as Prisma.InputJsonValue | undefined,
      voiceRules: body.voiceRules as Prisma.InputJsonValue | undefined,
      leaderboardSettings: body.leaderboardSettings as Prisma.InputJsonValue | undefined,
      ignoredChannelIds: body.ignoredChannelIds as Prisma.InputJsonValue | undefined,
      ignoredRoleIds: body.ignoredRoleIds as Prisma.InputJsonValue | undefined,
      backupSettings: body.backupSettings as Prisma.InputJsonValue | undefined
    };

    const settings = await prisma.guildSettings.update({
      where: { guildId },
      data
    });

    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: res.locals.user.id || "dashboard",
        action: "SETTINGS_UPDATED",
        entity: "GuildSettings",
        entityId: guildId,
        before: before ?? undefined,
        after: settings
      }
    });

    res.json({ settings });
  });

  // Create Backup
  app.post("/api/guilds/:guildId/backups", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const { createDatabaseBackup } = await import("../streak/backup.js");
    const backupPath = await createDatabaseBackup(guildId);
    res.json({ ok: true, path: backupPath });
  });

  // Import Backup via JSON
  app.post("/api/guilds/:guildId/backups/import", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const data = req.body;

    if (!data || (typeof data !== "object")) {
      res.status(400).json({ error: "Invalid backup data" });
      return;
    }

    try {
      const jsonStr = JSON.stringify(data, null, 2);
      const hash = crypto.createHash("sha256").update(jsonStr).digest("hex");
      
      const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `backup-imported-${guildId}-${dateStr}.json`;
      const BACKUP_DIR = path.resolve("./backups");
      await fs.mkdir(BACKUP_DIR, { recursive: true });
      const backupPath = path.join(BACKUP_DIR, filename);
      await fs.writeFile(backupPath, jsonStr, "utf8");
      
      const stat = await fs.stat(backupPath);
      
      const record = await prisma.backupRecord.create({
        data: {
          guildId,
          kind: data.guilds ? "FULL" : "PARTIAL",
          path: backupPath,
          checksum: hash,
          sizeBytes: BigInt(stat.size)
        }
      });
      
      res.json({ ok: true, backupId: record.id });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to import backup: " + err.message });
    }
  });

  // Get Backups List
  app.get("/api/guilds/:guildId/backups", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const backups = await prisma.backupRecord.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" }
    });
    
    const verifiedBackups = await Promise.all(backups.map(async (b) => {
      let isHealthy = false;
      try {
        const fileContent = await fs.readFile(b.path, "utf8");
        const hash = crypto.createHash("sha256").update(fileContent).digest("hex");
        isHealthy = hash === b.checksum;
      } catch {}
      return {
        ...b,
        sizeBytes: b.sizeBytes.toString(),
        isHealthy
      };
    }));
    
    res.json({ backups: verifiedBackups });
  });

  // Download Backup File
  app.get("/api/backups/:backupId/download", async (req, res) => {
    const record = await prisma.backupRecord.findUnique({ where: { id: req.params.backupId } });
    if (!record) {
      res.status(404).json({ error: "Backup not found" });
      return;
    }
    
    // Authorization Check
    const user = res.locals.user as SessionUser;
    if (!user.isAdmin && record.guildId && !user.manageableGuilds.includes(record.guildId)) {
      res.status(403).json({ error: "Forbidden: No access to this server" });
      return;
    }
    
    res.download(record.path);
  });

  // Restore Backup
  app.post("/api/backups/:backupId/restore", async (req, res) => {
    const backupId = req.params.backupId;
    const record = await prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!record) {
      res.status(404).json({ error: "Backup not found" });
      return;
    }

    // Authorization Check
    const user = res.locals.user as SessionUser;
    if (!user.isAdmin && record.guildId && !user.manageableGuilds.includes(record.guildId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { restoreDatabaseBackup } = await import("../streak/backup.js");
    await restoreDatabaseBackup(backupId);
    res.json({ ok: true });
  });

  // Delete Backup File & Record
  app.delete("/api/backups/:backupId", async (req, res) => {
    const backupId = req.params.backupId;
    const record = await prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!record) {
      res.status(404).json({ error: "Backup not found" });
      return;
    }

    // Authorization Check
    const user = res.locals.user as SessionUser;
    if (!user.isAdmin && record.guildId && !user.manageableGuilds.includes(record.guildId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      await fs.unlink(record.path).catch(() => {});
      await prisma.backupRecord.delete({ where: { id: backupId } });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Roles Endpoints
  app.get("/api/guilds/:guildId/roles", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const roles = await prisma.streakRole.findMany({ where: { guildId, deletedAt: null } });
    res.json({ roles });
  });

  app.post("/api/guilds/:guildId/roles", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const body = z.object({
      roleId: snowflakeSchema,
      requiredDays: z.number().int().positive(),
      removeOnBreak: z.boolean().default(true),
      allowStacking: z.boolean().default(false),
      priority: z.number().int().default(0)
    }).parse(req.body);

    const role = await prisma.streakRole.upsert({
      where: { guildId_roleId: { guildId, roleId: body.roleId } },
      create: { ...body, guildId, deletedAt: null },
      update: { ...body, deletedAt: null }
    });
    res.json({ role });
  });

  app.delete("/api/guilds/:guildId/roles/:roleId", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const roleId = req.params.roleId;
    await prisma.streakRole.update({
      where: { guildId_roleId: { guildId, roleId } },
      data: { deletedAt: new Date() }
    });
    res.json({ ok: true });
  });

  // Rewards Endpoints
  app.get("/api/guilds/:guildId/rewards", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const rewards = await prisma.reward.findMany({ where: { guildId, deletedAt: null } });
    res.json({ rewards });
  });

  app.post("/api/guilds/:guildId/rewards", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const body = z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      requiredDays: z.number().int().positive(),
      repeatable: z.boolean().default(false),
      payload: z.record(z.string(), z.any()).default({})
    }).parse(req.body);

    const reward = await prisma.reward.create({
      data: { ...body, guildId }
    });
    res.json({ reward });
  });

  app.delete("/api/guilds/:guildId/rewards/:rewardId", requireGuildAccess, async (req, res) => {
    const rewardId = req.params.rewardId;
    await prisma.reward.update({
      where: { id: rewardId },
      data: { deletedAt: new Date() }
    });
    res.json({ ok: true });
  });

  // Audit Logs Endpoint
  app.get("/api/guilds/:guildId/logs", requireGuildAccess, async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const logs = await prisma.auditLog.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
      take: 250
    });

    const guild = discordClient.guilds.cache.get(guildId);
    const logsWithActors = await Promise.all(logs.map(async (l) => {
      let actor = null;
      if (l.actorId) {
        if (l.actorId === "dashboard" || l.actorId === "admin") {
          actor = { username: "مدير النظام", avatarUrl: null };
        } else {
          const member = guild ? await guild.members.fetch(l.actorId).catch(() => null) : null;
          actor = member ? {
            username: member.user.displayName || member.user.username,
            avatarUrl: member.user.displayAvatarURL({ size: 32 })
          } : { username: `عضو (${l.actorId})`, avatarUrl: null };
        }
      }
      return { ...l, actor };
    }));

    res.json({ logs: logsWithActors });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", issues: error.issues });
      return;
    }
    next(error);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Publish Leaderboard Embed to channel
async function publishLeaderboard(guildId: string, discordClient: Client) {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
  if (!settings) throw new Error("إعدادات السيرفر غير موجودة.");

  const leaderboardOpts = (settings.leaderboardSettings || {}) as Record<string, any>;
  const channelId = leaderboardOpts.channelId;
  if (!channelId) throw new Error("قناة لوحة المتصدرين غير مهيأة.");

  const limit = typeof leaderboardOpts.limit === "number" ? leaderboardOpts.limit : 25;
  const excludeBots = leaderboardOpts.excludeBots !== false;

  const members = await prisma.memberStreak.findMany({
    where: { guildId, deletedAt: null },
    orderBy: [{ currentStreak: "desc" }, { highestStreak: "desc" }],
    take: limit
  });

  const guild = discordClient.guilds.cache.get(guildId);
  const lines: string[] = [];
  let count = 1;
  
  for (const m of members) {
    const discordMember = guild ? await guild.members.fetch(m.userId).catch(() => null) : null;
    if (excludeBots && discordMember?.user.bot) {
      continue;
    }
    const username = discordMember ? discordMember.user.displayName || discordMember.user.username : `العضو (${m.userId})`;
    lines.push(`**#${count}** <@${m.userId}> (${username}) — الستريك: **${m.currentStreak}** يوم (أعلى: ${m.highestStreak})`);
    count++;
  }

  const embedDescription = lines.length > 0 ? lines.join("\n") : "لا توجد بيانات بعد.";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Daily Streak Leaderboard | لوحة المتصدرين")
    .setDescription(embedDescription)
    .setTimestamp();

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    throw new Error("لم يتم العثور على القناة المحددة أو أنها ليست قناة نصية.");
  }

  let messageId = leaderboardOpts.messageId;
  let message: any = null;
  if (messageId) {
    message = await (channel as any).messages.fetch(messageId).catch(() => null);
  }

  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    const newMsg = await (channel as any).send({ embeds: [embed] });
    messageId = newMsg.id;
    const updatedOpts = { ...leaderboardOpts, messageId };
    await prisma.guildSettings.update({
      where: { guildId },
      data: { leaderboardSettings: updatedOpts }
    });
  }
}

// Serves the beautiful login interface
function renderLoginShell(error?: string) {
  const oauthEnabled = !!config.DISCORD_CLIENT_SECRET && !!config.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(config.PUBLIC_BASE_URL + "/auth/callback");
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify+guilds`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Daily Streak - تسجيل الدخول</title>
  <link rel="stylesheet" href="/assets/dashboard.css" />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet" />
</head>
<body class="login-body">
  <div class="login-card">
    <div class="brand-large">
      <div class="brand-mark-large">DS</div>
      <h1>Daily Streak System</h1>
      <p>لوحة التحكم الإدارية</p>
    </div>
    
    ${error ? `<div class="error-banner">${error}</div>` : ""}
    
    ${oauthEnabled ? `
      <a href="${discordUrl}" class="btn-discord">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="svg-icon-inline">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.094 13.094 0 0 1-1.873-.894.077.077 0 0 1-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 0 1 .077-.011c3.92 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.009c.12.099.246.195.373.289a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.156 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.156 2.418z"/>
        </svg>
        تسجيل الدخول باستخدام Discord
      </a>
      <div class="divider"><span>أو</span></div>
    ` : `
      <div class="warning-banner">⚠️ تسجيل دخول Discord OAuth2 غير مفعّل (يرجى إعداد DISCORD_CLIENT_SECRET)</div>
    `}
    
    <form id="token-login-form">
      <div class="login-form-group">
        <label class="login-form-label">الدخول المباشر عبر رمز المدير (Admin Token)</label>
        <input name="token" type="password" required placeholder="أدخل رمز DASHBOARD_ADMIN_TOKEN" class="w-full" />
      </div>
      <button class="primary w-full" type="submit">تسجيل الدخول</button>
    </form>
  </div>
  <script>
    document.getElementById("token-login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = e.target.token.value;
      const res = await fetch("/api/auth/token-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        alert("رمز الدخول غير صحيح!");
      }
    });
  </script>
</body>
</html>`;
}

// Renders the redesigned Dashboard interface with zero inline styles in elements
function renderDashboardShell(user: SessionUser) {
  const avatarUrl = user.avatar 
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Daily Streak Dashboard</title>
  <link rel="stylesheet" href="/assets/dashboard.css" />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet" />
</head>
<body>
  <!-- Toast notification system container -->
  <div class="toast-container" id="toast-container"></div>

  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">DS</span>
      <span>Daily Streak System</span>
    </div>
    
    <div id="topbar-guild-indicator" class="topbar-guild">
      <img id="topbar-guild-icon" src="" alt="Server Icon" class="hidden" />
      <span id="topbar-guild-name">جاري جلب السيرفر المختار...</span>
    </div>
    
    <div class="status-group">
      <span class="status">
        <span class="dot loading" id="bot-status-dot"></span>
        <span id="bot-status-text" data-status>جاري الفحص...</span>
      </span>
      <span class="status">
        <span class="dot loading" id="data-status-dot"></span>
        <span id="data-status-text">جاري الاتصال...</span>
      </span>
      <button type="button" id="btn-retry-load" class="btn-retry" title="إعادة المحاولة">🔄</button>
    </div>
    
    <div class="user-display">
      <img src="${avatarUrl}" alt="User Avatar" class="user-avatar" />
      <span class="username">${user.username}</span>
      <a href="/logout" class="btn-logout-link" title="تسجيل الخروج">🚪</a>
    </div>
  </header>
  
  <div class="layout">
    <nav aria-label="Dashboard navigation">
      <div class="nav-label">الرئيسية</div>
      <button class="active" type="button" data-view="overview">
        <span class="nav-icon">📊</span> العامة
      </button>
      <button type="button" data-view="settings">
        <span class="nav-icon">🎯</span> الأنشطة
      </button>
      
      <div class="nav-label">القواعد والتتبع</div>
      <button type="button" data-view="voice">
        <span class="nav-icon">🔊</span> إعدادات الصوت
      </button>
      <button type="button" data-view="messages">
        <span class="nav-icon">💬</span> إعدادات الرسائل
      </button>
      
      <div class="nav-label">المكافآت والرتب</div>
      <button type="button" data-view="rewards">
        <span class="nav-icon">🎁</span> المكافآت و ProBot
      </button>
      <button type="button" data-view="roles">
        <span class="nav-icon">🎖️</span> إدارة الرتب
      </button>
      
      <div class="nav-label">المجتمع والنظام</div>
      <button type="button" data-view="leaderboard">
        <span class="nav-icon">🏆</span> المتصدرون
      </button>
      <button type="button" data-view="backup">
        <span class="nav-icon">💾</span> النسخ الاحتياطي
      </button>
      <button type="button" data-view="logs">
        <span class="nav-icon">📜</span> سجلات الأحداث
      </button>
    </nav>
    
    <section>
      <div class="toolbar">
        <h1>لوحة التحكم الاحترافية</h1>
        <div class="server-selector-container">
          <label for="guild-select-element">السيرفر النشط:</label>
          <select id="guild-select-element" data-guild-select aria-label="Guild Selector">
            <option value="">-- اختر سيرفراً لإدارته --</option>
          </select>
        </div>
      </div>

      <!-- Overview Panel -->
      <div data-panel="overview">
        <div class="grid">
          <div class="card"><div class="label">السيرفرات المتاحة</div><div class="value" data-guild-count>0</div></div>
          <div class="card"><div class="label">حالة قاعدة البيانات</div><div class="value" id="db-status-badge">جاري الفحص</div></div>
          <div class="card"><div class="label">المنصة المحركة</div><div class="value">PostgreSQL</div></div>
        </div>
        <form data-settings-form>
          <fieldset class="form-fieldset" disabled>
            <div class="panel">
              <h2>إعدادات الستريك العامة</h2>
              <div class="form-grid">
                <label class="checkbox">
                  <input type="checkbox" name="enabled" /> تشغيل نظام الستريك في السيرفر
                </label>
                <label>اللغة المفضلة للبوت
                  <select name="locale">
                    <option value="ar">العربية (ar)</option>
                    <option value="en">الإنجليزية (en)</option>
                  </select>
                </label>
                <label>المنطقة الزمنية للسيرفر 
                  <input name="timezone" autocomplete="off" placeholder="Asia/Baghdad" required />
                </label>
                <label>نظام احتساب اليوم
                  <select name="mode">
                    <option value="CALENDAR_RESET">Calendar Reset (وقت محدد يومياً)</option>
                    <option value="ROLLING_24H">Rolling 24 Hours (24 ساعة متحركة)</option>
                  </select>
                </label>
                <label>وقت إعادة التعيين اليومي
                  <input name="resetTime" placeholder="03:00" pattern="^([01]\\d|2[0-3]):[0-5]\\d$" title="الصيغة يجب أن تكون HH:MM" required />
                </label>
                <label>فترة السماح التلقائي (بالدقائق) 
                  <input name="graceMinutes" type="number" min="0" max="1440" required />
                </label>
              </div>
              <p><button class="primary" type="submit">حفظ الإعدادات العامة</button></p>
            </div>
          </fieldset>
        </form>
      </div>

      <!-- Activity Weights Panel -->
      <div class="panel" data-panel="settings" hidden>
        <h2>أوزان الأنشطة اليومية وطاقة الاستحقاق</h2>
        <p class="panel-desc">تحكم بأوزان كل نشاط على حدة؛ عند تفعيل النشاط، يُحسب وزنه ضمن مجموع نقاط العضو اليومية للوصول للحد الأدنى المسموح به للستريك.</p>
        <form data-activity-form>
          <fieldset class="form-fieldset" disabled>
            <div class="form-grid required-weight-grid">
              <label class="highlight-label">الحد الأدنى للأوزان اليومية المطلوبة لاحتساب الستريك
                <input name="dailyRequiredWeight" type="number" min="1" max="100000" required />
                <span class="field-help">مجموع أوزان الأنشطة اليومية التي يجب على العضو تحقيقها حتى يتم حماية/زيادة الستريك الخاص به.</span>
              </label>
            </div>
            <hr class="section-divider" />
            <div class="activities-grid" id="activity-weights-container">
              <!-- Dynamically populated activity rows with toggles and greyed-out weight inputs -->
            </div>
            <p><button class="primary" type="submit">حفظ أوزان الأنشطة</button></p>
          </fieldset>
        </form>
      </div>

      <!-- Voice settings -->
      <div class="panel" data-panel="voice" hidden>
        <h2>إعدادات وتتبع المحادثات الصوتية (Voice Activity)</h2>
        <form data-voice-form>
          <fieldset class="form-fieldset" disabled>
            <div class="form-grid">
              <label>أقل مدة اتصال متصلة/مجموعة في اليوم (بالدقائق) 
                <input name="minMinutes" type="number" min="1" max="1440" required />
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreMuted" /> تجاهل الأعضاء المكتومين (Muted)
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreDeafened" /> تجاهل الأعضاء المغلق سماعهم (Deafened)
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreAFK" /> تجاهل غرف الانتظار والخمول (AFK Channels)
              </label>
              <label class="checkbox">
                <input type="checkbox" name="realTimeOnly" /> احتساب وقت الحضور الفعلي فقط
              </label>
              <label class="checkbox">
                <input type="checkbox" name="limitOneSessionPerDay" /> احتساب جلسة صوتية واحدة فقط في اليوم
              </label>
            </div>
            <p><button class="primary" type="submit">حفظ إعدادات الصوت</button></p>
          </fieldset>
        </form>
      </div>

      <!-- Messages settings -->
      <div class="panel" data-panel="messages" hidden>
        <h2>إعدادات وتتبع الرسائل النصية</h2>
        <form data-messages-form>
          <fieldset class="form-fieldset" disabled>
            <div class="form-grid">
              <label>الحد الأدنى لعدد حروف الرسالة
                <input name="minLength" type="number" min="1" max="2000" placeholder="افتراضي: 5" required />
                <span class="field-help">لن يتم احتساب أي رسالة يحتوي نصها على عدد أحرف أقل من هذا الحد.</span>
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreBots" /> تجاهل رسائل البوتات تماماً
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreRepeated" /> تجاهل الرسائل المكررة (بنفس المحتوى)
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreSpam" /> منع السبام والكتابة السريعة العشوائية
                <span class="field-help">يمنع الأعضاء من إرسال أكثر من رسالة واحدة في الثانية بشكل عشوائي للتحايل على الستريك.</span>
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreDeleted" /> تجاهل الرسائل المحذوفة (سحب النقاط عند الحذف)
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ignoreEdited" /> تجاهل الرسائل المعدلة
              </label>
            </div>
            <p><button class="primary" type="submit">حفظ إعدادات الرسائل</button></p>
          </fieldset>
        </form>
      </div>

      <!-- Rewards Panel -->
      <div class="panel" data-panel="rewards" hidden>
        <h2>المكافآت التلقائية ونظام استعادة الستريك</h2>
        <div class="rewards-layout">
          <div class="rewards-creator">
            <form data-add-reward-form>
              <fieldset class="form-fieldset" disabled>
                <h3>إضافة مكافأة جديدة</h3>
                <label>اسم المكافأة 
                  <input name="name" required placeholder="مثال: رتبة النشيط البرونزية" />
                </label>
                <label>نوع المكافأة
                  <select name="type" required>
                    <option value="ROLE">منح رتبة سيرفر (Role)</option>
                    <option value="POINTS">منح نقاط للنظام (Points)</option>
                    <option value="XP">منح نقاط خبرة (XP)</option>
                    <option value="CUSTOM_COMMAND">تنفيذ أمر مخصص (Command)</option>
                  </select>
                </label>
                <label>عدد الأيام المطلوب تحقيقها متتالية
                  <input name="requiredDays" type="number" min="1" required placeholder="مثال: 7" />
                </label>
                <label class="checkbox">
                  <input type="checkbox" name="repeatable" /> مكافأة متكررة (تُمنح كلما تكرر الإنجاز)
                </label>
                <p><button class="primary" type="submit">إضافة المكافأة</button></p>
              </fieldset>
            </form>
          </div>
          <div class="rewards-list-container">
            <h3>المكافآت الحالية في السيرفر</h3>
            <div class="list-wrapper" id="rewards-list-wrapper">
              <ul id="rewards-list" class="list-container"></ul>
            </div>
          </div>
        </div>

        <hr class="section-divider" />

        <h2>استعادة الستريك المكسور عبر ProBot Credits</h2>
        <p class="panel-desc">يسمح هذا الإعداد للأعضاء بدفع عملات كريديتس عبر بوت ProBot لاستعادة الستريك الخاص بهم إذا تم كسره بسبب الغياب.</p>
        
        <div class="probot-notice-box">
          <div class="notice-title">💡 شروط عمل خاصية استرداد ProBot:</div>
          <ul>
            <li>يجب أن يتواجد بوت ProBot وبوت Daily Streak في نفس السيرفر.</li>
            <li>يجب إرسال المبلغ إلى الحساب المستلم المحدد بالأسفل.</li>
            <li>سيقوم البوت بمراقبة رسائل التحويل وتلقائياً استعادة الستريك المكسور فور نجاح العملية.</li>
          </ul>
        </div>

        <form data-probot-form>
          <fieldset class="form-fieldset" disabled>
            <div class="form-grid">
              <label class="checkbox">
                <input type="checkbox" name="restoreEnabled" /> تفعيل ميزة الاستعادة بالعملات
              </label>
              <label>سعر استرجاع الستريك (Credits)
                <input name="restorePrice" type="number" min="0" max="10000000" placeholder="مثال: 5000" required />
              </label>
              <label>معرف حساب الاستلام (Recipient Discord ID)
                <input name="restoreRecipientId" placeholder="مثال: 1523464297253179502" required pattern="^\\d{17,20}$" title="معرف ديسكورد يجب أن يحتوي على أرقام فقط وبطول 17-20 حرفاً" />
              </label>
              <label>المهلة الزمنية المتاحة للاسترجاع (بالساعات)
                <input name="restoreTimeoutHours" type="number" min="1" max="168" placeholder="مثال: 24" required />
                <span class="field-help">أقصى وقت متاح للعضو لاستعادة ستريك بعد كسرها.</span>
              </label>
            </div>
            <p><button class="primary" type="submit">حفظ إعدادات ProBot</button></p>
          </fieldset>
        </form>
      </div>

      <!-- Roles Panel -->
      <div class="panel" data-panel="roles" hidden>
        <h2>إدارة رتب الستريك (Streak Roles)</h2>
        <p class="panel-desc">تحكم بالرتب التلقائية التي يحصل عليها العضو عند الحفاظ على الستريك لعدد معين من الأيام.</p>
        
        <div id="role-hierarchy-warning" class="warning-banner hidden">
          ⚠️ <strong>تنبيه الصلاحيات:</strong> تم الكشف أن رتبة البوت أدنى من بعض الرتب المحددة أدناه في قائمة الرتب بالسيرفر. لن يتمكن البوت من منح هذه الرتب تلقائياً إلا إذا قمت برفع رتبته (Daily Streak Role) لتصبح أعلى منها في إعدادات السيرفر بـ Discord.
        </div>

        <div class="roles-layout">
          <div class="roles-creator">
            <form data-add-role-form>
              <fieldset class="form-fieldset" disabled>
                <h3>إضافة رتبة ستريك جديدة</h3>
                <label>اختر الرتبة من السيرفر
                  <select name="roleId" id="discord-roles-dropdown" required>
                    <option value="">-- اختر رتبة --</option>
                  </select>
                </label>
                <label>عدد الأيام المطلوب 
                  <input name="requiredDays" type="number" min="1" required placeholder="مثال: 30" />
                </label>
                <label class="checkbox">
                  <input type="checkbox" name="removeOnBreak" checked /> إزالة الرتبة فور كسر الستريك
                </label>
                <label class="checkbox">
                  <input type="checkbox" name="allowStacking" /> السماح بتراكم الرتب (عدم إزالة الرتب السابقة)
                </label>
                <label>أولوية الرتبة (في الترتيب البصري باللوحة)
                  <input name="priority" type="number" placeholder="مثال: 0" required />
                  <span class="field-help">الأرقام الأكبر تعني أولوية أعلى عند الترتيب.</span>
                </label>
                <p><button class="primary" type="submit">إضافة الرتبة</button></p>
              </fieldset>
            </form>
          </div>
          <div class="roles-list-container">
            <h3>الرتب النشطة حالياً</h3>
            <div class="list-wrapper" id="roles-list-wrapper">
              <ul id="roles-list" class="list-container"></ul>
            </div>
          </div>
        </div>
      </div>

      <!-- Leaderboard Panel -->
      <div class="panel" data-panel="leaderboard" hidden>
        <h2>لوحة المتصدرين والنشر التلقائي</h2>
        <div class="leaderboard-layout">
          <div class="leaderboard-settings-form">
            <form id="leaderboard-settings-form">
              <fieldset class="form-fieldset" disabled>
                <h3>إعدادات لوحة المتصدرين</h3>
                
                <label>عدد الأعضاء المعروضين في الترتيب
                  <input name="limit" type="number" min="1" max="100" placeholder="افتراضي: 25" required />
                </label>
                
                <label class="checkbox">
                  <input type="checkbox" name="excludeBots" /> استبعاد حسابات البوتات من الترتيب
                </label>
                
                <label>قناة نشر وتحديث اللوحة بالديسكورد
                  <select name="channelId" id="discord-channels-dropdown" required>
                    <option value="">-- اختر القناة النصية --</option>
                  </select>
                </label>
                
                <label class="checkbox">
                  <input type="checkbox" name="autoUpdate" /> تحديث اللوحة تلقائياً
                </label>
                
                <label>فترة التحديث التلقائي (بالدقائق)
                  <input name="intervalMinutes" type="number" min="5" max="1440" placeholder="مثال: 60" required />
                </label>
                
                <div class="action-buttons-group">
                  <button class="primary" type="submit">حفظ الإعدادات</button>
                  <button class="success" type="button" id="btn-publish-leaderboard">نشر / تحديث الآن 🚀</button>
                </div>
              </fieldset>
            </form>
          </div>
          
          <div class="leaderboard-preview-container">
            <h3>المعاينة الحية (Live Preview)</h3>
            <p class="preview-help">شكل اللوحة التقديري كما ستظهر داخل الديسكورد:</p>
            <div class="embed-preview">
              <div class="embed-header">Daily Streak Leaderboard | لوحة المتصدرين</div>
              <div class="embed-body">
                <ol id="leaderboard-preview-list" class="preview-list">
                  <!-- Loaded preview list items -->
                </ol>
              </div>
              <div class="embed-footer">نظام Daily Streak • تحديث حي</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Backup Panel -->
      <div class="panel" data-panel="backup" hidden>
        <h2>النسخ الاحتياطي وإصلاح الأعطال الطارئة</h2>
        <p class="panel-desc">قم بإنشاء واستعادة نسخ كاملة أو جزئية من إعدادات الستريك وبيانات الأعضاء لضمان عدم ضياع الإحصائيات.</p>
        
        <fieldset class="form-fieldset" disabled>
          <div class="backup-actions">
            <button class="primary" id="btn-create-backup">📸 إنشاء نسخة احتياطية جديدة</button>
            
            <div class="backup-upload-box">
              <label for="backup-file-uploader" class="file-uploader-label">📤 استيراد نسخة احتياطية (ملف JSON)</label>
              <input type="file" id="backup-file-uploader" accept=".json" class="hidden" />
            </div>
          </div>
        </fieldset>

        <hr class="section-divider" />

        <h3>جدولة النسخ الاحتياطي التلقائي</h3>
        <form id="backup-schedule-form">
          <fieldset class="form-fieldset" disabled>
            <div class="form-grid">
              <label>تكرار النسخ الاحتياطي
                <select name="frequency" id="backup-frequency">
                  <option value="NONE">معطّل (يدوي فقط)</option>
                  <option value="DAILY">يومي</option>
                  <option value="WEEKLY">أسبوعي</option>
                </select>
              </label>
              <label>عدد النسخ المحتفظ بها
                <input name="retentionCount" id="backup-retention" type="number" min="1" max="50" placeholder="مثال: 7" value="7" />
                <span class="field-help">يتم حذف النسخ الأقدم تلقائياً عند تجاوز هذا العدد.</span>
              </label>
            </div>
            <p><button class="primary" type="submit">حفظ جدول النسخ الاحتياطي</button></p>
          </fieldset>
        </form>

        <hr class="section-divider" />
        
        <h3>النسخ الاحتياطية المتوفرة</h3>
        <div class="backups-table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>تاريخ الإنشاء</th>
                <th>النوع</th>
                <th>الحجم</th>
                <th>فحص السلامة (Checksum)</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody id="backups-table-body">
              <!-- Dynamically populated backups -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- Audit Logs Panel -->
      <div class="panel" data-panel="logs" hidden>
        <h2>سجلات النظام والعمليات الإدارية (Audit Logs)</h2>
        <p class="panel-desc">سجل مالي بجميع الإجراءات التي تمت داخل لوحة التحكم أو العمليات التلقائية الصادرة عن النظام.</p>
        
        <div class="logs-filter-toolbar">
          <div class="filter-group">
            <label for="log-filter-action">الحدث:</label>
            <select id="log-filter-action">
              <option value="">جميع الأحداث</option>
              <option value="SETTINGS_UPDATED">تعديل الإعدادات</option>
              <option value="STREAK_DAY_COMPLETED">إكمال الستريك اليومي</option>
              <option value="REWARD_EARNED">الحصول على مكافأة</option>
              <option value="ROLES_MATCHED">مطابقة رتب الستريك</option>
              <option value="STREAK_BROKEN">كسر الستريك</option>
            </select>
          </div>
          
          <div class="filter-group">
            <label for="log-filter-user">معرف العضو:</label>
            <input type="text" id="log-filter-user" placeholder="أدخل معرف العضو (ID)" />
          </div>
          
          <div class="filter-group">
            <label for="log-filter-date-start">من تاريخ:</label>
            <input type="date" id="log-filter-date-start" />
          </div>
          <div class="filter-group">
            <label for="log-filter-date-end">إلى تاريخ:</label>
            <input type="date" id="log-filter-date-end" />
          </div>

          <button type="button" class="btn-csv-export" id="btn-export-logs">📥 تصدير السجلات CSV</button>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>الوقت والتاريخ</th>
                <th>نوع العملية</th>
                <th>المسؤول (Actor)</th>
                <th>الهدف (Target)</th>
                <th>تفاصيل التعديل</th>
              </tr>
            </thead>
            <tbody id="logs-table-body">
              <!-- Dynamically populated logs -->
            </tbody>
          </table>
        </div>
        
        <div id="logs-pagination" class="pagination-controls"></div>
      </div>
    </section>
  </div>

  <script src="/assets/dashboard.js" defer></script>
</body>
</html>`;
}
