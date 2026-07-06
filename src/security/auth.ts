import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

export function requireDashboardAuth(req: Request, res: Response, next: NextFunction) {
  const token = readBearerToken(req) ?? readBasicPassword(req);

  if (!token || !safeEqual(token, config.DASHBOARD_ADMIN_TOKEN)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Daily Streak Dashboard", charset="UTF-8"');
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
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
