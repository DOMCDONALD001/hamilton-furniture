/**
 * One master owner report: how the system works + ops + cost estimates.
 * Run: node scripts/generate-master-report.mjs
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const { jsPDF } = require("jspdf");

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "docs");
const outPath = join(outDir, "Hamilton-Odds-N-Ends-Owner-Master-Report.pdf");
const desktopPath = join(homedir(), "Desktop", "Hamilton-Odds-N-Ends-Owner-Master-Report.pdf");

mkdirSync(outDir, { recursive: true });

const doc = new jsPDF({ unit: "pt", format: "letter" });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const margin = 52;
const maxW = pageW - margin * 2;
const bottom = pageH - 56;
const lineH = 13.5;
let y = margin;

function newPage() {
  doc.addPage();
  y = margin;
}

function need(space) {
  if (y + space > bottom) newPage();
}

function writeLines(lines, opts = {}) {
  const h = opts.lineHeight || lineH;
  const font = opts.font || "normal";
  const size = opts.size || 10.5;
  const color = opts.color || [32, 36, 34];
  for (const line of lines) {
    if (y + h > bottom) newPage();
    doc.setFont("helvetica", font);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(line, margin, y);
    y += h;
  }
}

function p(text) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  writeLines(doc.splitTextToSize(text, maxW), { font: "normal", size: 10.5, lineHeight: lineH });
  y += 7;
}

function h1(text) {
  need(42);
  y += 12;
  writeLines([text], { font: "bold", size: 13.5, color: [26, 35, 30], lineHeight: 17 });
  y += 5;
}

function h2(text) {
  need(28);
  y += 6;
  writeLines([text], { font: "bold", size: 11, color: [40, 55, 48], lineHeight: 14 });
  y += 3;
}

function bullets(items) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  for (const item of items) {
    writeLines(doc.splitTextToSize(`•  ${item}`, maxW), {
      font: "normal",
      size: 10.5,
      lineHeight: lineH,
    });
    y += 2;
  }
  y += 5;
}

function steps(items) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  items.forEach((item, i) => {
    writeLines(doc.splitTextToSize(`${i + 1}.  ${item}`, maxW), {
      font: "normal",
      size: 10.5,
      lineHeight: lineH,
    });
    y += 2;
  });
  y += 5;
}

function moneyTable(rows) {
  need(24 + rows.length * 16);
  const col1 = margin;
  const col2 = margin + maxW * 0.62;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(90, 90, 90);
  if (y + 14 > bottom) newPage();
  doc.text("Item", col1, y);
  doc.text("Estimate", col2, y);
  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.6);
  doc.line(margin, y, margin + maxW, y);
  y += 12;
  for (const [left, right] of rows) {
    need(18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(32, 36, 34);
    const leftLines = doc.splitTextToSize(left, maxW * 0.58);
    const startY = y;
    for (const line of leftLines) {
      doc.text(line, col1, y);
      y += 12;
    }
    doc.setFont("helvetica", "bold");
    doc.text(right, col2, startY);
    y = Math.max(y, startY + 12) + 4;
  }
  y += 6;
}

function callout(title, body) {
  const pad = 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const titleLines = doc.splitTextToSize(title, maxW - 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const bodyLines = doc.splitTextToSize(body, maxW - 20);
  const boxH = pad + titleLines.length * 12 + 4 + bodyLines.length * 12 + pad;
  need(boxH + 8);
  const startY = y;
  doc.setFillColor(245, 240, 232);
  doc.roundedRect(margin - 4, startY, maxW + 8, boxH, 4, 4, "F");
  y = startY + pad + 8;
  writeLines(titleLines, { font: "bold", size: 10, color: [90, 70, 40], lineHeight: 12 });
  y += 2;
  writeLines(bodyLines, { font: "normal", size: 10, color: [45, 45, 42], lineHeight: 12 });
  y = startY + boxH + 10;
}

function stampFooters() {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `Hamilton's Odds N Ends Furniture — Owner Master Report — Page ${i} of ${pages}`,
      margin,
      pageH - 28,
    );
  }
}

const updated = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

// Cover
doc.setFillColor(26, 35, 30);
doc.rect(0, 0, pageW, 220, "F");
doc.setTextColor(247, 242, 234);
doc.setFont("helvetica", "bold");
doc.setFontSize(22);
doc.text("Hamilton's Odds N Ends Furniture", margin, 64);
doc.setFontSize(15);
doc.setFont("helvetica", "normal");
doc.text("Owner Master Report", margin, 92);
doc.setFontSize(11);
doc.setTextColor(196, 165, 116);
doc.text("Everything you need: system, operations, and cost estimates", margin, 122);
doc.setFontSize(10);
doc.setTextColor(200, 205, 200);
doc.text("One document for running and presenting the store platform", margin, 148);
doc.text(`Updated ${updated}`, margin, 172);
doc.text("Pricing figures are public list rates as of mid-2026 — always re-check vendor pages.", margin, 192);

y = 250;
p(
  "This report is the single reference for the furniture store platform: what it is, how the parts connect, what runs automatically, how to operate day to day, what it costs to keep online, and sample Square fee math for different sales volumes.",
);
p("Live site: https://hamiltonsoddsandends.com");
p("Customer email from: orders@hamiltonsoddsandends.com · Owner alerts: hamiltonsbikes216@gmail.com");

// ── SYSTEM ─────────────────────────────────────────────────────────
h1("1. What the system is");
p(
  "One Cloudflare-hosted application with three doors into the same store. The public website is where customers shop and pay. Admin is your back office. The driver portal is a separate login for delivery routes only. Behind all three is one API, one database, product image storage, Square for cards, and Resend for email.",
);

h2("How the pieces connect");
bullets([
  "Browser (React site) talks only to your Worker API.",
  "Worker is the brain: rules, stock, orders, routes, auctions, refunds.",
  "Database (Cloudflare D1) stores products, orders, drivers, sessions, settings.",
  "Images (Cloudflare R2) hold product and hero photos.",
  "Square charges and refunds cards (and can keep a card on file for fee adjustments).",
  "Resend sends customer confirmations and separate owner alerts.",
  "Google Maps is used as links / map embeds for addresses and GPS pins — not a paid Maps API in this build.",
]);

h2("Three logins on purpose");
bullets([
  "Admin — inventory, prices, refunds, routes, settings. Full control.",
  "Driver — assigned routes, stop status, issues, live GPS. Cannot change prices or refund.",
  "Customer — shop, account, bid, track orders, open claims.",
]);

h1("2. What runs by itself");
h2("Customer pays online");
steps([
  "Card charged through Square.",
  "Order created as paid / confirmed.",
  "Stock drops (out of stock if it hits zero).",
  "Customer confirmation email + your owner alert.",
  "Customer can track with order number + email.",
]);

h2("You assign delivery → driver finishes");
steps([
  "Admin puts paid delivery orders on a named route for a driver and date.",
  "Driver marks en route → order can move to out for delivery + email.",
  "Driver marks delivered → GPS proof saved, order delivered, customer emailed.",
  "Phone location heartbeats feed Admin → Live drivers map.",
]);

h2("You refund or cancel");
steps([
  "Money returns through Square when there was a card charge.",
  "Order / payment status update; customer can be emailed.",
  "Full refund or cancel removes the order from active driver routes automatically.",
  "Optional: restore inventory on a full refund.",
]);

h2("Auction ends with a winner");
steps([
  "Auction closes; stock locks on the linked product.",
  "Unpaid settlement order + secure pay link emailed to winner.",
  "Winner pays (pickup or delivery) → treated like a normal paid order.",
  "Admin can resend the pay email if needed.",
]);

callout(
  "Demo one-liner",
  "One store, three doors, one brain. Pay creates the order, drops stock, and emails both sides. A route hands it to a driver. Delivered updates the customer. Refund pulls money and pulls the stop.",
);

// ── OPS ────────────────────────────────────────────────────────────
h1("3. Day-to-day operations");
h2("Inventory");
p(
  "Add products with photos, price, sale price, colors, and search tags (so “couch” finds a sectional). Use Discount selected / Tag selected for bulk edits. Print hang tags with QR codes. Statuses: active, draft, out of stock, archived. Run the SKU report weekly for low stock, missing photos, and sales by SKU — download PDF or CSV.",
);

h2("Orders and packing");
p(
  "Orders lists every sale. Changing order status emails the customer. Email customer re-sends confirmation. Issue full or partial refunds from the order. Print packing slips for one or many orders.",
);

h2("Delivery setup");
p(
  "Delivery settings: ZIP fees, free-delivery rules, weekday windows. Drivers: create logins; share only the /driver link. Assign drivers: build routes. Live drivers: see GPS freshness and current stop. Reports: resolve driver-reported issues and rebook if needed.",
);

h2("Other admin");
p(
  "Auctions, Offers/promo codes, Revenue statements, Claims, Settings (homepage, contact, tax, notify email, from name, feature toggles). In-store sale can stay hidden until you enable it in Settings.",
);

h2("Simple rhythm");
bullets([
  "Morning: Dashboard + Orders; set today’s routes; clear delivery issues.",
  "Day: add inventory; assign new deliveries; watch Live drivers; refund carefully (stop auto-removes).",
  "Weekly: SKU report; Revenue glance; confirm emails and Square still look healthy.",
]);

h2("If something breaks");
bullets([
  "No customer email → Email customer on the order; confirm from address is orders@hamiltonsoddsandends.com.",
  "Driver missing from map → allow Location; keep driver page open.",
  "Refunded but still on route → refresh route; stop should show removed/skipped.",
  "Stock wrong after refund → restore inventory on full refund.",
  "Search can’t find sofa/couch → add search tags.",
]);

// ── COSTS ──────────────────────────────────────────────────────────
h1("4. Cost of running the entire platform");
p(
  "Split costs into two buckets: (A) fixed platform bills you pay whether or not you sell, and (B) variable fees that scale with sales and email volume. Figures below are approximate public list prices for planning — confirm on each vendor’s site before budgeting.",
);

h2("A. Fixed / platform (typical production month)");
moneyTable([
  ["Cloudflare Workers Paid (recommended for production)", "$5 / month base"],
  ["Cloudflare D1 database (usually inside free allowance at this scale)", "$0 typical"],
  ["Cloudflare R2 images (usually inside free 10 GB + ops)", "$0 typical"],
  ["Resend email — Free plan (3,000/mo, 100/day)", "$0"],
  ["Resend Pro if you outgrow free (50,000 emails/mo)", "$20 / month"],
  ["Domain (hamiltonsoddsandends.com) — renew yearly, ~spread monthly", "~$1–2 / month"],
  ["Custom store domain on Cloudflare (optional, when you attach it)", "Usually $0 extra"],
  ["Google Maps links/embeds in this build", "$0"],
  ["Square software (Free plan — pay only when you process cards)", "$0 / month"],
]);

callout(
  "Realistic platform total today",
  "Most months at current furniture volume: about $5–25 total for hosting + email + domain share. The $5 Cloudflare Paid plan is the main fixed line. Stay on Resend Free until you hit ~100 emails/day or 3,000/month; then budget $20 for Pro. Square has no monthly fee on Free — you only pay per card sale.",
);

h2("B. Variable — Square card fees (the big ops cost)");
p(
  "This app charges cards through Square’s online payments API. On Square’s Free plan, online API card sales are typically 2.9% + $0.30 per successful charge. Card-on-file / manual entry adjustments are higher (commonly 3.5% + $0.15). In-person terminal rates are separate if you use Square hardware in the shop. Failed payments are not charged. Refunds return the processing fee in Square’s usual way for that payment.",
);

moneyTable([
  ["Online API card sale (Free plan, typical)", "2.9% + $0.30"],
  ["Card on file / keyed adjustment (typical)", "3.5% + $0.15"],
  ["In-person tap/dip/swipe (Free plan, if used)", "About 2.6% + $0.15"],
  ["Square Plus subscription (optional, lower some rates)", "About $49 / location / mo"],
]);

h2("Sample Square math (online API @ 2.9% + $0.30)");
p("Fee ≈ (sale × 0.029) + $0.30. You keep the rest (before tax/refunds).");
moneyTable([
  ["One $400 furniture sale", "Fee ≈ $11.90 · You keep ≈ $388.10"],
  ["One $800 sale", "Fee ≈ $23.50 · You keep ≈ $776.50"],
  ["10 sales × $500 average = $5,000 / month", "Fees ≈ $148 · Keep ≈ $4,852"],
  ["20 sales × $500 = $10,000 / month", "Fees ≈ $296 · Keep ≈ $9,704"],
  ["40 sales × $500 = $20,000 / month", "Fees ≈ $592 · Keep ≈ $19,408"],
  ["$50,000 / month card volume", "Fees ≈ $1,465 · Keep ≈ $48,535"],
]);

callout(
  "Rule of thumb",
  "Plan on roughly 3% of online card volume going to Square (a bit less on large tickets, a bit more on small ones because of the flat $0.30). Platform hosting is tiny next to processing fees once you are selling regularly.",
);

h2("C. Monthly totals — three planning scenarios");
moneyTable([
  ["Quiet month — few online sales, Free email, Workers Paid", "~$5–10 platform + Square on actual sales"],
  ["Steady month — ~$10k online card volume", "~$5–25 platform + ~$300 Square"],
  ["Busy month — ~$20k online + Resend Pro", "~$25–30 platform + ~$600 Square"],
]);

h2("D. What is NOT in these software numbers");
bullets([
  "Delivery truck, fuel, driver pay, warehouse rent, insurance, utilities.",
  "Furniture cost of goods (what you paid for each piece).",
  "Phone / internet for the store and drivers’ phones.",
  "Printed hang tags, packing materials, marketing ads.",
  "Accountant, bookkeeping tools, or Square hardware readers if you buy them.",
]);
p(
  "Those operating costs dwarf the website bill. The platform’s job is to take orders, track stock, email people, and run routes — cheaply. Labor and inventory are the real P&L.",
);

h1("5. Cost checklist (what to watch each month)");
bullets([
  "Cloudflare dashboard → Workers / D1 / R2 usage (should stay near $5).",
  "Resend usage → emails sent vs 3,000 free / 100 per day.",
  "Square dashboard → processing fees vs sales (target ~3% online).",
  "Domain renewal date once a year.",
  "If online volume is high, compare Square Free vs Plus — only worth it when the lower rate saves more than the subscription.",
]);

h1("6. Access & safety (need to know)");
bullets([
  "Never share admin password with drivers — give /driver only.",
  "Do not paste Square or Resend secret keys into chat or screenshots.",
  "Log out of admin on shared computers.",
  "Sandbox vs production Square: production keys required for real customer charges.",
  "Owner notify email and from address live under Admin → Settings.",
]);

h1("7. Quick screen map");
bullets([
  "Customers: Home, Shop, Product, Cart, Checkout, Track order, Account, Auctions, Auction pay, Claims.",
  "Admin: Dashboard, Inventory, SKU report, Orders, Auctions, Assign drivers, Live drivers, Drivers, Delivery, Reports, Revenue, Offers, Claims, Settings.",
  "Drivers: Login, routes, stops (en route / delivered / issue), location sharing on.",
]);

h1("8. One-page summary");
p(
  "The store is a connected system: website + admin + drivers share one database. Paying online automatically creates the order, lowers stock, and emails customer and owner. Delivery is assigned in admin, executed in the driver app with GPS, and status emails fire on the way. Refunds reverse money and remove route stops. Auctions settle into a pay link, then become normal orders.",
);
p(
  "Expect about $5–25/month to keep the software online at normal volume, plus roughly 2.9% + $0.30 per online card sale through Square. Everything else you need to know for demo and daily ops is in the sections above.",
);

stampFooters();
const buf = Buffer.from(doc.output("arraybuffer"));
writeFileSync(outPath, buf);
try {
  copyFileSync(outPath, desktopPath);
  console.log("Wrote", outPath);
  console.log("Copied", desktopPath);
} catch (e) {
  console.log("Wrote", outPath, "(desktop copy skipped)", e.message);
}
