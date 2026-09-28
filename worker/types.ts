export type Env = {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  STORE_NAME: string;
  PUBLIC_SITE_URL?: string;
  SQUARE_APPLICATION_ID?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  description: string;
  category_id: string | null;
  price_cents: number;
  compare_at_cents: number | null;
  cost_cents: number | null;
  stock: number;
  low_stock_threshold: number;
  condition: string;
  brand: string | null;
  dimensions: string | null;
  weight_lbs: number | null;
  material: string | null;
  color: string | null;
  featured: number;
  status: string;
  tags: string;
  created_at: string;
  updated_at: string;
};

export type ProductImage = {
  id: string;
  product_id: string;
  r2_key: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: number;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
};

export type Discount = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  min_order_cents: number;
  max_uses: number | null;
  used_count: number;
  product_id: string | null;
  category_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: number;
  members_only?: number;
  show_on_home?: number;
};

export type DeliveryZone = {
  id: string;
  name: string;
  zip_prefixes: string;
  base_cents: number;
  per_item_cents: number;
  free_above_cents: number | null;
  estimated_days_min: number;
  estimated_days_max: number;
  active: number;
  sort_order: number;
};

export type Order = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address1: string;
  shipping_address2: string | null;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  shipping_notes: string | null;
  delivery_zone_id: string | null;
  delivery_method: string;
  subtotal_cents: number;
  discount_cents: number;
  delivery_cents: number;
  tax_cents: number;
  total_cents: number;
  discount_id: string | null;
  discount_code: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export function cents(n: number) {
  return Math.round(n);
}

export function money(centsValue: number) {
  return (centsValue / 100).toFixed(2);
}

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function timingSafeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.byteLength !== bb.byteLength) {
    const padded = new Uint8Array(aa.byteLength);
    crypto.getRandomValues(padded);
    await crypto.subtle.timingSafeEqual(aa, padded);
    return false;
  }
  return crypto.subtle.timingSafeEqual(aa, bb);
}
