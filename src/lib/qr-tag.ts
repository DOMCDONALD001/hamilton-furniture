import QRCode from "qrcode";
import { money } from "./api";
import { resolveSiteOrigin } from "./site-url";

export function productBuyUrl(slug: string, origin?: string) {
  const base = resolveSiteOrigin(origin);
  return `${base}/product/${slug}`;
}

export async function qrDataUrl(text: string, size = 280) {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#141916", light: "#ffffff" },
  });
}

export type QrTagProduct = {
  name: string;
  sku: string;
  slug: string;
  price_cents: number;
  brand?: string | null;
};

export type HangTagSize = "small" | "full";

export async function buildProductTagHtml(
  products: QrTagProduct[],
  opts?: {
    storeName?: string;
    storeLocation?: string;
    origin?: string;
    size?: HangTagSize;
  },
) {
  const storeName = opts?.storeName || "Hamilton's Odds N Ends Furniture";
  const storeLocation = opts?.storeLocation || "Tupelo, MS 38801";
  const origin = resolveSiteOrigin(opts?.origin);
  const size: HangTagSize = opts?.size === "full" ? "full" : "small";
  const qrPx = size === "full" ? 520 : 280;

  const cards = await Promise.all(
    products.map(async (p) => {
      const url = productBuyUrl(p.slug, origin);
      const qr = await qrDataUrl(url, qrPx);
      const priceText = money(p.price_cents);
      // Scale type so $1,599.00 / $12,499.00 don't collide with edges or footers
      const priceLen = priceText.replace(/\s/g, "").length;
      const priceSize =
        priceLen >= 11 ? "price-xl" : priceLen >= 9 ? "price-lg" : priceLen >= 7 ? "price-md" : "price-sm";
      return `
        <article class="tag tag-${size}">
          <div class="tag-brand">${escapeHtml(storeName)}</div>
          <div class="tag-location">${escapeHtml(storeLocation)}</div>

          <div class="tag-hero">SCAN TO BUY</div>
          <div class="tag-how">
            <div class="tag-how-title">HOW IT WORKS</div>
            <ol class="tag-steps">
              <li>Open your phone camera</li>
              <li>Point at this QR code</li>
              <li>Tap the link → buy online</li>
            </ol>
          </div>

          <img class="tag-qr" src="${qr}" alt="QR code for ${escapeHtml(p.name)}" />

          <div class="tag-footer-block">
            <h2 class="tag-name">${escapeHtml(p.name)}</h2>
            <div class="tag-price ${priceSize}">${escapeHtml(priceText)}</div>
            <div class="tag-meta">SKU ${escapeHtml(p.sku)}${p.brand ? ` · ${escapeHtml(p.brand)}` : ""}</div>
          </div>
        </article>
      `;
    }),
  );

  const sheetClass = size === "full" ? "sheet sheet-full" : "sheet sheet-small";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Product hang tags (${size === "full" ? "full page" : "small"})</title>
  <style>
    @page { margin: ${size === "full" ? "0.5in" : "0.35in"}; size: letter; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #141916;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Small: several tags per page ── */
    .sheet-small {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(2.75in, 1fr));
      gap: 0.3in;
    }
    .tag-small {
      border: 2.5pt solid #141916;
      border-radius: 8px;
      padding: 0.22in 0.2in 0.2in;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
      min-height: 4.55in;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
    }
    .tag-small .tag-brand {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 10pt;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 700;
      line-height: 1.15;
    }
    .tag-small .tag-location {
      margin-top: 0.04in;
      font-size: 11pt;
      font-weight: 800;
    }
    .tag-small .tag-hero {
      margin-top: 0.14in;
      width: 100%;
      padding: 0.1in 0.08in;
      background: #141916;
      color: #fff;
      font-size: 18pt;
      font-weight: 900;
      letter-spacing: 0.06em;
      line-height: 1.05;
      border-radius: 4px;
      border: 2.5pt solid #141916;
    }
    .tag-small .tag-how { width: 100%; margin-top: 0.12in; text-align: left; }
    .tag-small .tag-how-title {
      font-size: 11pt;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-align: center;
      margin-bottom: 0.06in;
    }
    .tag-small .tag-steps {
      margin: 0;
      padding: 0 0 0 0.22in;
      font-size: 11.5pt;
      font-weight: 800;
      line-height: 1.35;
    }
    .tag-small .tag-steps li { margin: 0.02in 0; }
    .tag-small .tag-qr {
      margin-top: 0.12in;
      width: 1.45in;
      height: 1.45in;
      image-rendering: pixelated;
      border: 1.5pt solid #141916;
      padding: 0.04in;
      background: #fff;
    }
    .tag-small .tag-footer-block {
      width: 100%;
      margin-top: 0.1in;
      padding: 0 0.05in;
    }
    .tag-small .tag-name {
      margin: 0.08in 0 0.06in;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 12pt;
      line-height: 1.15;
      max-width: 100%;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .tag-small .tag-price {
      font-weight: 900;
      line-height: 1.05;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
    }
    .tag-small .tag-price.price-sm { font-size: 20pt; }
    .tag-small .tag-price.price-md { font-size: 17pt; }
    .tag-small .tag-price.price-lg { font-size: 14pt; }
    .tag-small .tag-price.price-xl { font-size: 12pt; letter-spacing: -0.02em; }
    .tag-small .tag-meta { margin-top: 0.06in; font-size: 8.5pt; font-weight: 600; color: #3a413c; }

    /* ── Full page: one tag fills the whole letter page ── */
    .sheet-full {
      display: block;
    }
    .tag-full {
      width: 100%;
      min-height: calc(11in - 1in);
      height: calc(11in - 1in);
      border: 4pt solid #141916;
      border-radius: 12px;
      padding: 0.4in 0.5in 0.45in;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      overflow: hidden;
    }
    .tag-full:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .tag-full .tag-brand {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 18pt;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      line-height: 1.15;
      flex-shrink: 0;
    }
    .tag-full .tag-location {
      margin-top: 0.08in;
      font-size: 16pt;
      font-weight: 800;
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }
    .tag-full .tag-hero {
      margin-top: 0.28in;
      width: 100%;
      max-width: 7.2in;
      padding: 0.22in 0.18in;
      background: #141916;
      color: #fff;
      font-size: 42pt;
      font-weight: 900;
      letter-spacing: 0.08em;
      line-height: 1;
      border-radius: 8px;
      border: 4pt solid #141916;
      flex-shrink: 0;
    }
    .tag-full .tag-how {
      width: 100%;
      max-width: 6.5in;
      margin-top: 0.28in;
      text-align: left;
      flex-shrink: 0;
    }
    .tag-full .tag-how-title {
      font-size: 16pt;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-align: center;
      margin-bottom: 0.12in;
    }
    .tag-full .tag-steps {
      margin: 0 auto;
      padding: 0 0 0 0.4in;
      font-size: 18pt;
      font-weight: 800;
      line-height: 1.4;
      max-width: 5.8in;
    }
    .tag-full .tag-steps li { margin: 0.05in 0; }
    .tag-full .tag-qr {
      margin-top: 0.28in;
      width: 2.9in;
      height: 2.9in;
      image-rendering: pixelated;
      border: 3pt solid #141916;
      padding: 0.08in;
      background: #fff;
      flex-shrink: 0;
    }
    .tag-full .tag-footer-block {
      width: 100%;
      max-width: 7.2in;
      margin-top: auto;
      padding-top: 0.25in;
      padding-bottom: 0.05in;
    }
    .tag-full .tag-name {
      margin: 0 0 0.1in;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 24pt;
      line-height: 1.15;
      max-width: 100%;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .tag-full .tag-price {
      font-weight: 900;
      line-height: 1.05;
      white-space: nowrap;
      max-width: 100%;
      margin: 0 auto;
      letter-spacing: -0.01em;
    }
    .tag-full .tag-price.price-sm { font-size: 40pt; }
    .tag-full .tag-price.price-md { font-size: 34pt; }
    .tag-full .tag-price.price-lg { font-size: 28pt; }
    .tag-full .tag-price.price-xl { font-size: 22pt; letter-spacing: -0.03em; }
    .tag-full .tag-meta {
      margin-top: 0.12in;
      font-size: 13pt;
      font-weight: 600;
      color: #3a413c;
    }

    @media print {
      .no-print { display: none !important; }
      body { background: #fff; }
      .tag-full {
        min-height: calc(11in - 1in);
        height: calc(11in - 1in);
      }
      .tag-hero {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="${sheetClass}">
    ${cards.join("\n")}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Repeat each product `copies` times for mass pricing sheets. */
export function expandTagCopies<T>(products: T[], copies = 1): T[] {
  const n = Math.max(1, Math.min(200, Math.floor(copies) || 1));
  if (n === 1) return products;
  const out: T[] = [];
  for (const p of products) {
    for (let i = 0; i < n; i++) out.push(p);
  }
  return out;
}

/** Print via hidden iframe — no popup window required. */
export async function printProductTags(
  products: QrTagProduct[],
  storeName?: string,
  opts?: { copies?: number; size?: HangTagSize; origin?: string },
) {
  const sheet = expandTagCopies(products, opts?.copies ?? 1);
  if (!sheet.length) throw new Error("No products to print");

  const html = await buildProductTagHtml(sheet, {
    storeName,
    size: opts?.size || "small",
    origin: opts?.origin,
  });

  // Remove any previous print frame
  document.getElementById("hamilton-print-frame")?.remove();

  const frame = document.createElement("iframe");
  frame.id = "hamilton-print-frame";
  frame.title = "Print hang tags";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(frame);

  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error("Could not open print frame");
  }

  doc.open();
  doc.write(html);
  doc.close();

  await waitForImages(doc);
  // Let layout settle
  await new Promise((r) => setTimeout(r, 150));

  try {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } finally {
    // Keep frame briefly so some browsers finish print dialog setup
    setTimeout(() => frame.remove(), 60_000);
  }
}

function waitForImages(doc: Document) {
  const images = Array.from(doc.images || []);
  if (!images.length) return Promise.resolve();
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
          setTimeout(() => resolve(), 3000);
        }),
    ),
  ).then(() => undefined);
}

export async function downloadQrPng(
  product: QrTagProduct,
  filename?: string,
  origin?: string,
) {
  const url = productBuyUrl(product.slug, origin);
  const dataUrl = await qrDataUrl(url, 512);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename || `qr-${product.sku || product.slug}.png`;
  a.click();
}

/** Compact shelf / price labels (≈2×1.25 in). */
export async function buildShelfLabelHtml(
  products: QrTagProduct[],
  opts?: { storeName?: string; storeLocation?: string; origin?: string },
) {
  const storeName = opts?.storeName || "Hamilton's Odds N Ends";
  const storeLocation = opts?.storeLocation || "Tupelo, MS 38801";
  const origin = resolveSiteOrigin(opts?.origin);
  const cards = await Promise.all(
    products.map(async (p) => {
      const url = productBuyUrl(p.slug, origin);
      const qr = await qrDataUrl(url, 120);
      return `
        <article class="shelf">
          <div class="shelf-brand">${escapeHtml(storeName)}</div>
          <div class="shelf-location">${escapeHtml(storeLocation)}</div>
          <div class="shelf-row">
            <img class="shelf-qr" src="${qr}" alt="" />
            <div class="shelf-copy">
              <div class="shelf-scan">SCAN TO BUY</div>
              <div class="shelf-name">${escapeHtml(p.name)}</div>
              <div class="shelf-price">${money(p.price_cents)}</div>
              <div class="shelf-sku">SKU ${escapeHtml(p.sku)}</div>
            </div>
          </div>
        </article>
      `;
    }),
  );

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Shelf price labels</title>
  <style>
    @page { margin: 0.35in; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #141916; }
    .sheet {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(2.2in, 1fr));
      gap: 0.2in;
    }
    .shelf {
      border: 1.5pt solid #141916;
      border-radius: 6px;
      padding: 0.1in 0.12in;
      break-inside: avoid;
      page-break-inside: avoid;
      min-height: 1.25in;
    }
    .shelf-brand {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 7.5pt;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .shelf-location {
      font-size: 8.5pt;
      font-weight: 800;
      margin-bottom: 0.05in;
    }
    .shelf-row { display: flex; gap: 0.1in; align-items: center; }
    .shelf-qr { width: 0.7in; height: 0.7in; border: 1pt solid #141916; }
    .shelf-scan {
      font-size: 9pt;
      font-weight: 900;
      letter-spacing: 0.04em;
      margin-bottom: 0.03in;
    }
    .shelf-name { font-size: 10pt; font-weight: 700; line-height: 1.15; margin-bottom: 0.03in; }
    .shelf-price { font-size: 15pt; font-weight: 900; }
    .shelf-sku { font-size: 7.5pt; color: #444; margin-top: 0.02in; }
  </style>
</head>
<body>
  <div class="sheet">${cards.join("")}</div>
</body>
</html>`;
}

export async function printShelfLabels(
  products: QrTagProduct[],
  opts?: { storeName?: string; origin?: string; copies?: number },
) {
  const sheet = expandTagCopies(products, opts?.copies ?? 1);
  if (!sheet.length) throw new Error("No products to print");
  const html = await buildShelfLabelHtml(sheet, opts);

  document.getElementById("hamilton-print-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "hamilton-print-frame";
  frame.title = "Print shelf labels";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  await waitForImages(doc);
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
}
