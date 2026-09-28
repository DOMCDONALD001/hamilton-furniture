/** Official storefront origin used for hang-tag QR codes and share links. */
export const DEFAULT_SITE_URL = "https://hamiltonsoddsandends.com";

export function resolveSiteOrigin(siteUrl?: string | null) {
  const configured = (siteUrl || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return DEFAULT_SITE_URL;
}
