import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const SECRET = config.DASHBOARD_ADMIN_TOKEN;

export type SessionUser = {
  id: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  manageableGuilds: string[]; // Whitelist of guilds they can manage
};

export function signSession(user: SessionUser): string {
  const data = Buffer.from(JSON.stringify(user)).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifySession(token: string): SessionUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [data, signature] = parts;
    
    const expectedSignature = createHmac("sha256", SECRET).update(data).digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionUser;
  } catch {
    return null;
  }
}
