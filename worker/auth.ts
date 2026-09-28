import { createMiddleware } from "hono/factory";
import { hashPassword, verifyCustomerPassword } from "./customer-auth";

type AppVars = {
  Bindings: import("./types").Env;
  Variables: { admin: boolean; adminEmail?: string };
};

const COOKIE = "hamilton_admin";
/** Display / seed email for the store owner account */
export const OWNER_EMAIL = "hamiltonsbikes216@gmail.com";

export type AdminAccount = {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  password_salt: string | null;
};

export function sessionCookie(token: string, maxAgeSec = 60 * 60 * 24 * 7) {
  // Secure helps Chromebook/Chrome keep the admin cookie on HTTPS store devices
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getSessionToken(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export async function ensureOwnerAccount(db: D1Database) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO admin_accounts (id, email, name)
       VALUES ('admin_owner', ?, 'Store Owner')`,
    )
    .bind(OWNER_EMAIL)
    .run();
}

export async function getAdminByEmail(db: D1Database, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return db
    .prepare(`SELECT * FROM admin_accounts WHERE lower(email) = ?`)
    .bind(normalized)
    .first<AdminAccount>();
}

export async function adminNeedsSetup(db: D1Database) {
  await ensureOwnerAccount(db);
  const row = await db
    .prepare(
      `SELECT COUNT(*) as n FROM admin_accounts
       WHERE password_hash IS NOT NULL AND password_hash != ''`,
    )
    .first<{ n: number }>();
  return (row?.n ?? 0) === 0;
}

export async function createSession(db: D1Database, adminId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO admin_sessions (token, expires_at, admin_id) VALUES (?, ?, ?)`,
    )
    .bind(token, expires, adminId)
    .run();
  return token;
}

export async function validateSession(db: D1Database, token: string | null) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.token, a.id as admin_id, a.email, a.name
       FROM admin_sessions s
       LEFT JOIN admin_accounts a ON a.id = s.admin_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .bind(token)
    .first<{ token: string; admin_id: string | null; email: string | null; name: string | null }>();
  if (!row) return null;
  return {
    email: row.email || OWNER_EMAIL,
    name: row.name,
    adminId: row.admin_id,
  };
}

export async function destroySession(db: D1Database, token: string | null) {
  if (!token) return;
  await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).bind(token).run();
}

export async function verifyAdminLogin(
  db: D1Database,
  email: string,
  password: string,
) {
  const admin = await getAdminByEmail(db, email);
  if (!admin?.password_hash || !admin.password_salt) return null;
  const ok = await verifyCustomerPassword(
    password,
    admin.password_hash,
    admin.password_salt,
  );
  return ok ? admin : null;
}

export async function setupAdminPassword(
  db: D1Database,
  email: string,
  password: string,
) {
  if (!(await adminNeedsSetup(db))) {
    return { error: "Admin account already set up" as const };
  }
  const admin = await getAdminByEmail(db, email);
  if (!admin) {
    return { error: "Unknown admin email" as const };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" as const };
  }
  const { hash, salt } = await hashPassword(password);
  await db
    .prepare(
      `UPDATE admin_accounts
       SET password_hash = ?, password_salt = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(hash, salt, admin.id)
    .run();
  return { admin };
}

export async function changeAdminPassword(
  db: D1Database,
  adminId: string,
  currentPassword: string,
  newPassword: string,
) {
  const admin = await db
    .prepare(`SELECT * FROM admin_accounts WHERE id = ?`)
    .bind(adminId)
    .first<AdminAccount>();
  if (!admin?.password_hash || !admin.password_salt) {
    return { error: "Admin account not found" as const };
  }
  const ok = await verifyCustomerPassword(
    currentPassword,
    admin.password_hash,
    admin.password_salt,
  );
  if (!ok) return { error: "Current password is incorrect" as const };
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters" as const };
  }
  const { hash, salt } = await hashPassword(newPassword);
  await db
    .prepare(
      `UPDATE admin_accounts
       SET password_hash = ?, password_salt = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(hash, salt, adminId)
    .run();
  return { ok: true as const };
}

export const requireAdmin = createMiddleware<AppVars>(async (c, next) => {
  const token = getSessionToken(c.req.header("Cookie"));
  const session = await validateSession(c.env.DB, token);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("admin", true);
  c.set("adminEmail", session.email);
  await next();
});
