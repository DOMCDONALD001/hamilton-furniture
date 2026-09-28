import { createMiddleware } from "hono/factory";
import { hashPassword, verifyCustomerPassword } from "./customer-auth";
import { id } from "./types";

type AppVars = {
  Bindings: import("./types").Env;
  Variables: {
    driver: boolean;
    driverId?: string;
    driverEmail?: string;
    driverName?: string;
  };
};

const COOKIE = "hamilton_driver";

export type DriverAccount = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  password_hash: string;
  password_salt: string;
  active: number;
};

export function driverSessionCookie(token: string, maxAgeSec = 60 * 60 * 24 * 7) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearDriverSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getDriverSessionToken(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export async function getDriverByEmail(db: D1Database, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return db
    .prepare(`SELECT * FROM drivers WHERE lower(email) = ?`)
    .bind(normalized)
    .first<DriverAccount>();
}

export async function createDriver(
  db: D1Database,
  input: { email: string; name: string; phone?: string; password: string },
) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email || !name) return { error: "Name and email are required" as const };
  if (input.password.length < 8) {
    return { error: "Password must be at least 8 characters" as const };
  }
  const existing = await getDriverByEmail(db, email);
  if (existing) return { error: "A driver with that email already exists" as const };

  const { hash, salt } = await hashPassword(input.password);
  const driverId = id("drv");
  await db
    .prepare(
      `INSERT INTO drivers (id, email, name, phone, password_hash, password_salt, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(driverId, email, name, input.phone?.trim() || null, hash, salt)
    .run();

  const driver = await db
    .prepare(
      `SELECT id, email, name, phone, active, created_at, updated_at FROM drivers WHERE id = ?`,
    )
    .bind(driverId)
    .first();
  return { driver };
}

export async function verifyDriverLogin(db: D1Database, email: string, password: string) {
  const driver = await getDriverByEmail(db, email);
  if (!driver || !driver.active) return null;
  const ok = await verifyCustomerPassword(password, driver.password_hash, driver.password_salt);
  return ok ? driver : null;
}

export async function createDriverSession(db: D1Database, driverId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`INSERT INTO driver_sessions (token, driver_id, expires_at) VALUES (?, ?, ?)`)
    .bind(token, driverId, expires)
    .run();
  return token;
}

export async function validateDriverSession(db: D1Database, token: string | null) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.token, d.id as driver_id, d.email, d.name, d.active
       FROM driver_sessions s
       JOIN drivers d ON d.id = s.driver_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .bind(token)
    .first<{
      token: string;
      driver_id: string;
      email: string;
      name: string;
      active: number;
    }>();
  if (!row || !row.active) return null;
  return {
    driverId: row.driver_id,
    email: row.email,
    name: row.name,
  };
}

export async function destroyDriverSession(db: D1Database, token: string | null) {
  if (!token) return;
  await db.prepare(`DELETE FROM driver_sessions WHERE token = ?`).bind(token).run();
}

export async function setDriverPassword(
  db: D1Database,
  driverId: string,
  newPassword: string,
) {
  if (newPassword.length < 8) {
    return { error: "Password must be at least 8 characters" as const };
  }
  const { hash, salt } = await hashPassword(newPassword);
  await db
    .prepare(
      `UPDATE drivers
       SET password_hash = ?, password_salt = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(hash, salt, driverId)
    .run();
  return { ok: true as const };
}

/** Drivers may only move stops through these statuses. */
export const DRIVER_STOP_STATUSES = ["pending", "en_route", "delivered", "failed", "skipped"] as const;
export type DriverStopStatus = (typeof DRIVER_STOP_STATUSES)[number];

export const DRIVER_ISSUE_TYPES = [
  "customer_not_home",
  "wrong_address",
  "access_issue",
  "damaged",
  "refused",
  "other",
] as const;

export const requireDriver = createMiddleware<AppVars>(async (c, next) => {
  const token = getDriverSessionToken(c.req.header("Cookie"));
  const session = await validateDriverSession(c.env.DB, token);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("driver", true);
  c.set("driverId", session.driverId);
  c.set("driverEmail", session.email);
  c.set("driverName", session.name);
  await next();
});
