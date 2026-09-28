/** Public storefront content driven by admin Settings. */
export type StoreContent = {
  name?: string;
  brand_name?: string;
  brand_sub?: string;
  topbar_text?: string;
  hero_kicker?: string;
  hero_headline?: string;
  hero_subtext?: string;
  hero_cta_primary?: string;
  hero_cta_secondary?: string;
  hero_image?: string | null;
  hero_image_key?: string;
  hero_image_position?: string;
  featured_title?: string;
  featured_subtitle?: string;
  auctions_title?: string;
  auctions_subtitle?: string;
  offers_title?: string;
  offers_subtitle?: string;
  footer_blurb?: string;
  store_phone?: string;
  store_email?: string;
  store_address?: string;
  site_url?: string;
};

export const STORE_CONTENT_DEFAULTS: Required<
  Pick<
    StoreContent,
    | "brand_name"
    | "brand_sub"
    | "topbar_text"
    | "hero_kicker"
    | "hero_headline"
    | "hero_subtext"
    | "hero_cta_primary"
    | "hero_cta_secondary"
    | "featured_title"
    | "featured_subtitle"
    | "auctions_title"
    | "auctions_subtitle"
    | "offers_title"
    | "offers_subtitle"
    | "footer_blurb"
  >
> = {
  brand_name: "Hamilton's Odds N Ends",
  brand_sub: "Furniture",
  topbar_text:
    "Local delivery across the Tupelo area · Members: use MEMBER15 · Guests: WELCOME10",
  hero_kicker: "Hamilton's · Odds N Ends · Furniture",
  hero_headline: "Hamilton's Odds N Ends Furniture",
  hero_subtext:
    "Browse living room, bedroom, dining, and one-of-a-kind finds — buy now or bid in our live auctions.",
  hero_cta_primary: "Shop inventory",
  hero_cta_secondary: "View auctions",
  featured_title: "Featured picks",
  featured_subtitle: "Hand-selected pieces ready for delivery or pickup",
  auctions_title: "Live auctions",
  auctions_subtitle: "Bid before the clock runs out",
  offers_title: "Active offers",
  offers_subtitle: "Promo codes at checkout — some are members only",
  footer_blurb:
    "Quality furniture and unique finds for every room — buy, sell, and deliver with a hometown marketplace feel.",
};

export function withStoreDefaults(raw: StoreContent = {}): StoreContent & typeof STORE_CONTENT_DEFAULTS {
  const merged = { ...STORE_CONTENT_DEFAULTS };
  for (const key of Object.keys(STORE_CONTENT_DEFAULTS) as (keyof typeof STORE_CONTENT_DEFAULTS)[]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) merged[key] = value;
  }
  return {
    ...raw,
    ...merged,
    name: raw.brand_name || raw.name || `${merged.brand_name} ${merged.brand_sub}`.trim(),
    hero_image: raw.hero_image || null,
    hero_image_position: raw.hero_image_position || "center",
  };
}
