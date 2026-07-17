import { createMiddleware } from "hono/factory";
import type { Env } from "./types";
import { timingSafeEqual } from "./types";

type AppVars = {
  Bindings: Env;
  Variables: { admin: boolean };
};

const COOKIE = "hamilton_admin";

export function sessionCookie(token: string, maxAgeSec = 60 * 60 * 24 * 7) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getSessionToken(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export async function createSession(db: D1Database) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)`,
    )
    .bind(token, expires)
    .run();
  return token;
}

export async function validateSession(db: D1Database, token: string | null) {
  if (!token) return false;
  const row = await db
    .prepare(
      `SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')`,
    )
    .bind(token)
    .first();
  return !!row;
}

export async function destroySession(db: D1Database, token: string | null) {
  if (!token) return;
  await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).bind(token).run();
}

export function getAdminPassword(env: Env) {
  return env.ADMIN_PASSWORD || "hamilton-admin";
}

export async function verifyPassword(env: Env, password: string) {
  return timingSafeEqual(password, getAdminPassword(env));
}

export const requireAdmin = createMiddleware<AppVars>(async (c, next) => {
  const token = getSessionToken(c.req.header("Cookie"));
  const ok = await validateSession(c.env.DB, token);
  if (!ok) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("admin", true);
  await next();
});
