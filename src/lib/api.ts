export type ProductImage = {
  id: string;
  url: string;
  alt_text?: string | null;
  is_primary?: number;
  r2_key?: string;
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
  cost_cents?: number | null;
  stock: number;
  low_stock_threshold?: number;
  condition: string;
  brand: string | null;
  dimensions: string | null;
  weight_lbs?: number | null;
  material: string | null;
  /** Display string (joined colors) from API */
  color: string | null;
  /** Available color options */
  colors?: string[];
  featured: number;
  status: string;
  tags: string[] | string;
  images?: ProductImage[];
  primary_image?: string | null;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
};

export type CartItem = {
  product_id: string;
  name: string;
  price_cents: number;
  quantity: number;
  image?: string | null;
  slug: string;
  color?: string | null;
};

export type Offer = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: string;
  value: number;
  min_order_cents: number;
  ends_at?: string | null;
  members_only?: boolean;
  locked?: boolean;
};

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function conditionLabel(c: string) {
  const map: Record<string, string> = {
    new: "New",
    like_new: "Like New",
    good: "Good",
    fair: "Fair",
    refurbished: "Refurbished",
  };
  return map[c] || c;
}

export function productColors(p: { colors?: string[]; color?: string | null }): string[] {
  if (p.colors?.length) return p.colors;
  if (!p.color) return [];
  const raw = p.color.trim();
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  if (raw.includes(",")) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [raw];
}

/** Normalize product search tags from API (array or JSON string). */
export function productTags(p: { tags?: string[] | string | null }): string[] {
  if (Array.isArray(p.tags)) return p.tags.map(String).map((t) => t.trim()).filter(Boolean);
  if (!p.tags || typeof p.tags !== "string") return [];
  const raw = p.tags.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).map((t) => t.trim()).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Common shopper search terms — tap to tag so “couch” finds a “sectional”, etc. */
export const SEARCH_TAG_PRESETS = [
  "couch",
  "sofa",
  "sectional",
  "loveseat",
  "recliner",
  "chair",
  "dining table",
  "dining chair",
  "coffee table",
  "end table",
  "bed",
  "mattress",
  "dresser",
  "nightstand",
  "desk",
  "office chair",
  "bookshelf",
  "tv stand",
  "entertainment",
  "lamp",
  "lighting",
  "outdoor",
  "patio",
  "buffet",
  "cabinet",
  "storage",
  "mirror",
  "rug",
  "accent",
  "vintage",
] as const;

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers: optionHeaders, ...rest } = options;
  const headers = new Headers(optionHeaders);
  if (rest.body && !(rest.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    credentials: "include",
    ...rest,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText || `Request failed (${res.status})`);
  }
  return data as T;
}
