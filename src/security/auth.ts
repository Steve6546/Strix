import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { verifySession, type SessionUser } from "./session.js";

export function requireDashboardAuth(req: Request, res: Response, next: NextFunction) {
  // 1. Check for session cookie
  const cookieHeader = req.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const sessionToken = cookies["session"];

  if (sessionToken) {
    const user = verifySession(sessionToken);
    if (user) {
      res.locals.user = user;
      return next();
    }
  }

  // 2. Fallback: Check Basic/Bearer Authorization header
  const token = readBearerToken(req) ?? readBasicPassword(req);
  if (token && safeEqual(token, config.DASHBOARD_ADMIN_TOKEN)) {
    const adminUser: SessionUser = {
      id: "admin",
      username: "Admin",
      avatar: null,
      isAdmin: true,
      manageableGuilds: []
    };
    res.locals.user = adminUser;
    return next();
  }

  // 3. Unauthorized handling
  if (req.path.startsWith("/api")) {
    res.status(401).json({ error: "Unauthorized" });
  } else {
    // Redirect to login page for HTML requests
    res.redirect("/login");
  }
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const name = parts.shift()?.trim();
    const value = parts.join("=").trim();
    if (name) {
      list[name] = decodeURIComponent(value);
    }
  });
  return list;
}

function readBearerToken(req: Request): string | null {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

function readBasicPassword(req: Request): string | null {
  const header = req.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return null;
  }

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return null;
  }
  return decoded.slice(separator + 1);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

