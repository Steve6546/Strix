import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requireDashboardAuth } from "../security/auth.js";
import { errorHandler, notFoundHandler } from "../security/errors.js";
import { snowflakeSchema, updateSettingsSchema } from "./schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../public");

export function createWebServer() {
  const app = express();

  app.disable("x-powered-by");
  app.use(compression());
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(express.json({ limit: "64kb" }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.get("/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  app.use(requireDashboardAuth);
  app.use("/assets", express.static(publicDir, {
    fallthrough: false,
    immutable: true,
    maxAge: "1h"
  }));
  app.use("/api", apiLimiter);

  app.get("/", (_req, res) => {
    res.type("html").send(renderDashboardShell());
  });

  app.get("/api/guilds", async (_req, res) => {
    const guilds = await prisma.guild.findMany({
      include: { settings: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ guilds });
  });

  app.get("/api/guilds/:guildId/leaderboard", async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const members = await prisma.memberStreak.findMany({
      where: { guildId, deletedAt: null },
      orderBy: [{ currentStreak: "desc" }, { highestStreak: "desc" }],
      take: 25
    });
    res.json({ members });
  });

  app.patch("/api/guilds/:guildId/settings", async (req, res) => {
    const guildId = snowflakeSchema.parse(req.params.guildId);
    const body = updateSettingsSchema.parse(req.body);
    const before = await prisma.guildSettings.findUnique({ where: { guildId } });

    const data: Prisma.GuildSettingsUpdateInput = {
      ...body,
      activityWeights: body.activityWeights as Prisma.InputJsonValue | undefined,
      messageRules: body.messageRules as Prisma.InputJsonValue | undefined,
      voiceRules: body.voiceRules as Prisma.InputJsonValue | undefined,
      ignoredChannelIds: body.ignoredChannelIds as Prisma.InputJsonValue | undefined,
      ignoredRoleIds: body.ignoredRoleIds as Prisma.InputJsonValue | undefined
    };

    const settings = await prisma.guildSettings.update({
      where: { guildId },
      data
    });

    await prisma.auditLog.create({
      data: {
        guildId,
        actorId: "dashboard",
        action: "SETTINGS_UPDATED",
        entity: "GuildSettings",
        entityId: guildId,
        before: before ?? undefined,
        after: settings
      }
    });

    res.json({ settings });
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

function renderDashboardShell() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Daily Streak Dashboard</title>
  <link rel="stylesheet" href="/assets/dashboard.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">DS</span><span>Daily Streak</span></div>
    <span class="status"><span class="dot"></span><span data-status>جار التحميل</span></span>
  </header>
  <div class="layout">
    <nav aria-label="Dashboard navigation">
      <button class="active" type="button" data-view="overview">Overview</button>
      <button type="button" data-view="settings">Settings</button>
      <button type="button" data-view="leaderboard">Leaderboard</button>
    </nav>
    <section>
      <div class="toolbar">
        <h1>لوحة التحكم</h1>
        <label>السيرفر
          <select data-guild-select aria-label="Guild"></select>
        </label>
      </div>

      <div data-panel="overview">
        <div class="grid">
          <div class="card"><div class="label">السيرفرات المسجلة</div><div class="value" data-guild-count>0</div></div>
          <div class="card"><div class="label">حالة النظام</div><div class="value">جاهز</div></div>
          <div class="card"><div class="label">قاعدة البيانات</div><div class="value">PostgreSQL</div></div>
        </div>
      </div>

      <div class="panel" data-panel="settings" hidden>
        <h2>الإعدادات العامة</h2>
        <form data-settings-form>
          <div class="form-grid">
            <label class="checkbox"><input type="checkbox" name="enabled" /> تشغيل النظام</label>
            <label>المنطقة الزمنية <input name="timezone" autocomplete="off" /></label>
            <label>وقت إعادة التعيين <input name="resetTime" inputmode="numeric" placeholder="03:00" /></label>
            <label>الحد اليومي <input name="dailyRequiredWeight" type="number" min="1" max="100000" /></label>
          </div>
          <p><button class="primary" type="submit">حفظ الإعدادات</button></p>
        </form>
      </div>

      <div class="panel" data-panel="leaderboard" hidden>
        <h2>المتصدرون</h2>
        <ol data-leaderboard></ol>
      </div>
    </section>
  </div>
  <script src="/assets/dashboard.js" defer></script>
</body>
</html>`;
}
