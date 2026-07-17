import type { Env } from "./types";
import { id, timingSafeEqual } from "./types";

const COOKIE = "hamilton_customer";

export type Customer = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
};

function b64(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64
    ? fromB64(saltB64)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return { hash: b64(bits), salt: b64(salt) };
}

export async function verifyCustomerPassword(
  password: string,
  hash: string,
  salt: string,
) {
  const next = await hashPassword(password, salt);
  return timingSafeEqual(next.hash, hash);
}

export function customerSessionCookie(token: string, maxAgeSec = 60 * 60 * 24 * 30) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearCustomerSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getCustomerSessionToken(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export async function createCustomerSession(db: D1Database, customerId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)`,
    )
    .bind(token, customerId, expires)
    .run();
  return token;
}

export async function getCustomerFromRequest(
  db: D1Database,
  cookieHeader: string | undefined,
): Promise<Customer | null> {
  const token = getCustomerSessionToken(cookieHeader);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT c.id, c.email, c.name, c.phone
       FROM customer_sessions s
       JOIN customers c ON c.id = s.customer_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .bind(token)
    .first<Customer>();
  return row || null;
}

export async function destroyCustomerSession(
  db: D1Database,
  cookieHeader: string | undefined,
) {
  const token = getCustomerSessionToken(cookieHeader);
  if (!token) return;
  await db.prepare(`DELETE FROM customer_sessions WHERE token = ?`).bind(token).run();
}

export function newCustomerId() {
  return id("cust");
}

export type { Env };
