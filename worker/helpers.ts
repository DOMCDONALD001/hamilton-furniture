import type { Context } from "hono";
import type { Env, Discount, Product } from "./types";
import { id } from "./types";

type AppC = Context<{ Bindings: Env }>;

export type DeliveryConfig = {
  enabled: boolean;
  pickup_enabled: boolean;
  /** Combined local + extended (for legacy callers) */
  allowed_zips: string[];
  /** Legacy alias of local fee */
  flat_fee_cents: number;
  local_zips: string[];
  local_fee_cents: number;
  extended_zips: string[];
  extended_fee_cents: number;
  per_item_cents: number;
  free_above_cents: number | null;
  eta_text: string;
  eta_local: string;
  eta_extended: string;
  outside_message: string;
};

export async function attachImages(c: AppC, products: Product[]) {
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY is_primary DESC, sort_order ASC`,
  )
    .bind(...ids)
    .all<{
      id: string;
      product_id: string;
      r2_key: string;
      alt_text: string | null;
      sort_order: number;
      is_primary: number;
    }>();

  const byProduct = new Map<string, typeof results>();
  for (const img of results || []) {
    const list = byProduct.get(img.product_id) || [];
    list.push(img);
    byProduct.set(img.product_id, list);
  }

  return products.map((p) => {
    const images = (byProduct.get(p.id) || []).map((img) => ({
      ...img,
      url: `/api/images/${img.r2_key}`,
    }));
    const colors = parseColors(p.color);
    return {
      ...p,
      tags: safeJson(p.tags, [] as string[]),
      colors,
      color: colors.length ? colors.join(", ") : null,
      images,
      primary_image: images[0]?.url ?? null,
    };
  });
}

export function parseColors(raw: string | null | undefined): string[] {
  if (!raw || !String(raw).trim()) return [];
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("[")) {
    const parsed = safeJson<unknown>(trimmed, []);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (trimmed.includes(",")) {
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [trimmed];
}

export function serializeColors(
  colors: string[] | string | null | undefined,
): string | null {
  if (colors == null || colors === "") return null;
  const list = Array.isArray(colors)
    ? colors.map((s) => String(s).trim()).filter(Boolean)
    : parseColors(colors);
  if (!list.length) return null;
  return JSON.stringify(list);
}

export function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getSetting(db: D1Database, key: string, fallback = "") {
  const row = await db
    .prepare(`SELECT value FROM store_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? fallback;
}

/** Official customer-facing origin for emails, hang-tag QR codes, and pay links. */
export const DEFAULT_PUBLIC_SITE_URL = "https://hamiltonsoddsandends.com";

export async function getPublicOrigin(
  env: { DB: D1Database; PUBLIC_SITE_URL?: string },
  requestUrl?: string,
) {
  const fromSettings = (await getSetting(env.DB, "site_url", "")).trim().replace(/\/$/, "");
  if (fromSettings) return fromSettings;
  const fromEnv = (env.PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (requestUrl) {
    try {
      const host = new URL(requestUrl).hostname;
      // Prefer the official domain when admin/API traffic is still on workers.dev or localhost.
      if (host && !host.includes("workers.dev") && host !== "localhost" && host !== "127.0.0.1") {
        return new URL(requestUrl).origin;
      }
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_PUBLIC_SITE_URL;
}

export async function setSetting(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .bind(key, value)
    .run();
}

function parseZipList(raw: string) {
  return safeJson<string[]>(raw, [])
    .map((z) => String(z).replace(/\D/g, "").slice(0, 5))
    .filter((z) => z.length === 5);
}

export async function getDeliveryConfig(db: D1Database): Promise<DeliveryConfig> {
  const legacyZips = parseZipList(await getSetting(db, "delivery_allowed_zips", "[]"));
  let localZips = parseZipList(await getSetting(db, "delivery_local_zips", "[]"));
  let extendedZips = parseZipList(await getSetting(db, "delivery_extended_zips", "[]"));

  if (!localZips.length && !extendedZips.length && legacyZips.length) {
    localZips = legacyZips;
  }

  const freeRaw = await getSetting(db, "delivery_free_above_cents", "");
  const freeAbove = freeRaw === "" || freeRaw === "null" ? null : Number(freeRaw);
  const flat = Number(await getSetting(db, "delivery_flat_fee_cents", "7500")) || 0;
  const localFee =
    Number(await getSetting(db, "delivery_local_fee_cents", String(flat || 4900))) ||
    flat ||
    4900;
  const extendedFee =
    Number(await getSetting(db, "delivery_extended_fee_cents", "8900")) || 8900;
  const allZips = [...new Set([...localZips, ...extendedZips])];

  return {
    enabled: (await getSetting(db, "delivery_enabled", "1")) === "1",
    pickup_enabled: (await getSetting(db, "delivery_pickup_enabled", "1")) === "1",
    allowed_zips: allZips,
    flat_fee_cents: localFee,
    local_zips: localZips,
    local_fee_cents: localFee,
    extended_zips: extendedZips,
    extended_fee_cents: extendedFee,
    per_item_cents: Number(await getSetting(db, "delivery_per_item_cents", "0")) || 0,
    free_above_cents: Number.isFinite(freeAbove as number) ? (freeAbove as number) : null,
    eta_text: await getSetting(db, "delivery_eta_text", "1–3 business days"),
    eta_local: await getSetting(db, "delivery_eta_local", "1–2 business days"),
    eta_extended: await getSetting(db, "delivery_eta_extended", "2–4 business days"),
    outside_message: await getSetting(
      db,
      "delivery_outside_message",
      "We only deliver to selected ZIP codes in our service area.",
    ),
  };
}

export function normalizeZip(zip: string) {
  return String(zip || "").replace(/\D/g, "").slice(0, 5);
}

export function zipZone(
  config: DeliveryConfig,
  zip: string,
): "local" | "extended" | null {
  const z = normalizeZip(zip);
  if (z.length < 5) return null;
  if (config.local_zips.includes(z)) return "local";
  if (config.extended_zips.includes(z)) return "extended";
  if (config.allowed_zips.includes(z)) return "local";
  return null;
}

export function isZipAllowed(config: DeliveryConfig, zip: string) {
  return zipZone(config, zip) != null;
}

export function resolveDelivery(opts: {
  config: DeliveryConfig;
  method: string;
  zip: string;
  subtotalAfterDiscount: number;
  freeShippingPromo: boolean;
  item_count?: number;
}): {
  ok: boolean;
  delivery_cents: number;
  error?: string;
  in_area?: boolean;
  zone?: "local" | "extended" | "pickup" | null;
  eta_text?: string;
  breakdown?: { base_cents: number; per_item_cents: number; items: number };
} {
  const method = opts.method || "delivery";
  const items = Math.max(1, opts.item_count || 1);

  if (method === "pickup") {
    if (!opts.config.pickup_enabled) {
      return { ok: false, delivery_cents: 0, error: "Store pickup is not available right now." };
    }
    return {
      ok: true,
      delivery_cents: 0,
      in_area: true,
      zone: "pickup",
      eta_text: "Ready for pickup",
    };
  }

  if (!opts.config.enabled) {
    return {
      ok: false,
      delivery_cents: 0,
      error: "Delivery is temporarily unavailable. Please choose store pickup.",
    };
  }

  const zone = zipZone(opts.config, opts.zip);
  if (!zone) {
    return {
      ok: false,
      delivery_cents: 0,
      in_area: false,
      zone: null,
      error: opts.config.outside_message,
    };
  }

  const eta = zone === "local" ? opts.config.eta_local : opts.config.eta_extended;

  if (opts.freeShippingPromo) {
    return { ok: true, delivery_cents: 0, in_area: true, zone, eta_text: eta };
  }

  if (
    opts.config.free_above_cents != null &&
    opts.subtotalAfterDiscount >= opts.config.free_above_cents
  ) {
    return { ok: true, delivery_cents: 0, in_area: true, zone, eta_text: eta };
  }

  const base =
    zone === "local" ? opts.config.local_fee_cents : opts.config.extended_fee_cents;
  const extraItems = Math.max(0, items - 1);
  const perItemTotal = opts.config.per_item_cents * extraItems;

  return {
    ok: true,
    delivery_cents: base + perItemTotal,
    in_area: true,
    zone,
    eta_text: eta,
    breakdown: {
      base_cents: base,
      per_item_cents: opts.config.per_item_cents,
      items,
    },
  };
}

export function isDiscountValid(d: Discount, now = new Date()) {
  if (!d.active) return false;
  if (d.max_uses != null && d.used_count >= d.max_uses) return false;
  if (d.starts_at && new Date(d.starts_at) > now) return false;
  if (d.ends_at && new Date(d.ends_at) < now) return false;
  return true;
}

export function calcDiscountCents(
  d: Discount,
  subtotalCents: number,
  itemCount: number,
  productIds: string[],
  categoryIds: string[],
) {
  if (!isDiscountValid(d)) return 0;
  if (subtotalCents < d.min_order_cents) return 0;
  if (d.product_id && !productIds.includes(d.product_id)) return 0;
  if (d.category_id && !categoryIds.includes(d.category_id)) return 0;

  if (d.type === "percent") {
    return Math.min(subtotalCents, Math.round((subtotalCents * d.value) / 100));
  }
  if (d.type === "fixed") {
    return Math.min(subtotalCents, d.value);
  }
  void itemCount;
  return 0;
}

export function orderNumber() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `HOE-${y}${m}${day}-${rand}`;
}

export { id };
