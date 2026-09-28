/**
 * Teaching / demo PDF: how the whole Hamilton's Odds N Ends system connects and runs itself.
 * Run: node scripts/generate-system-demo.mjs
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
const outPath = join(outDir, "Hamilton-Odds-N-Ends-System-Demo.pdf");
const desktopPath = join(homedir(), "Desktop", "Hamilton-Odds-N-Ends-System-Demo.pdf");

mkdirSync(outDir, { recursive: true });

const doc = new jsPDF({ unit: "pt", format: "letter" });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const margin = 52;
const maxW = pageW - margin * 2;
const bottom = pageH - 56;
const lineH = 14;
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
  const lines = doc.splitTextToSize(text, maxW);
  writeLines(lines, { font: "normal", size: 10.5, lineHeight: lineH });
  y += 8;
}

function h1(text) {
  need(44);
  y += 14;
  writeLines([text], { font: "bold", size: 14, color: [26, 35, 30], lineHeight: 18 });
  y += 6;
}

function h2(text) {
  need(30);
  y += 8;
  writeLines([text], { font: "bold", size: 11.5, color: [40, 55, 48], lineHeight: 15 });
  y += 4;
}

function steps(items) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  items.forEach((item, i) => {
    const lines = doc.splitTextToSize(`${i + 1}.  ${item}`, maxW);
    writeLines(lines, { font: "normal", size: 10.5, lineHeight: lineH });
    y += 3;
  });
  y += 6;
}

function callout(title, body) {
  need(70);
  y += 4;
  doc.setFillColor(245, 240, 232);
  const startY = y - 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const titleLines = doc.splitTextToSize(title, maxW - 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const bodyLines = doc.splitTextToSize(body, maxW - 20);
  const boxH = 18 + titleLines.length * 13 + bodyLines.length * 13 + 14;
  if (startY + boxH > bottom) {
    newPage();
    return callout(title, body);
  }
  doc.setFillColor(245, 240, 232);
  doc.roundedRect(margin - 4, startY, maxW + 8, boxH, 4, 4, "F");
  y = startY + 18;
  writeLines(titleLines, { font: "bold", size: 10, color: [90, 70, 40], lineHeight: 13 });
  y += 2;
  writeLines(bodyLines, { font: "normal", size: 10, color: [45, 45, 42], lineHeight: 13 });
  y = startY + boxH + 10;
}

function flowBox(lines) {
  need(20 + lines.length * 13);
  y += 2;
  doc.setFillColor(236, 242, 238);
  const boxH = 16 + lines.length * 13 + 10;
  if (y - 10 + boxH > bottom) {
    newPage();
  }
  const startY = y - 10;
  doc.setFillColor(236, 242, 238);
  doc.roundedRect(margin - 4, startY, maxW + 8, boxH, 4, 4, "F");
  y = startY + 16;
  for (const line of lines) {
    writeLines([line], { font: "normal", size: 9.5, color: [30, 50, 40], lineHeight: 13 });
  }
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
      `Hamilton's Odds N Ends Furniture — System Demo Guide — Page ${i} of ${pages}`,
      margin,
      pageH - 28,
    );
  }
}

// ── Cover ──────────────────────────────────────────────────────────
doc.setFillColor(26, 35, 30);
doc.rect(0, 0, pageW, 210, "F");
doc.setTextColor(247, 242, 234);
doc.setFont("helvetica", "bold");
doc.setFontSize(22);
doc.text("Hamilton's Odds N Ends Furniture", margin, 68);
doc.setFontSize(16);
doc.setFont("helvetica", "normal");
doc.text("System Demo Guide", margin, 96);
doc.setFontSize(11);
doc.setTextColor(196, 165, 116);
doc.text("How every part connects — and what runs by itself", margin, 126);
doc.setFontSize(10);
doc.setTextColor(200, 205, 200);
doc.text("A teaching walkthrough for presenting the full platform", margin, 150);
doc.text(
  `Updated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
  margin,
  172,
);

y = 240;
p(
  "Use this document when you demonstrate the store. It explains the whole platform as one connected system: the public website, the owner admin, the driver app, payments, email, inventory, auctions, and live delivery tracking — and which steps happen automatically once someone clicks.",
);
p(
  "Live site: https://hamiltonsoddsandends.com",
);

h1("1. What you are looking at");
p(
  "This is one application hosted on Cloudflare. Customers, owners, and drivers each see a different door into the same store. Behind those doors is one API, one database, one image store, Square for cards, and Resend for email. Changing inventory in admin changes what the shop shows. Paying on the website creates the order your drivers later deliver. Nothing is glued together by hand each time — the pieces talk through the same backend.",
);

h2("The three doors");
steps([
  "Storefront — the public shop. Browse, cart, checkout, auctions, track an order, customer account, claims.",
  "Admin — your back office. Inventory, orders, refunds, routes, live drivers, auctions, revenue, settings.",
  "Driver portal — a separate login. Drivers only see assigned routes, mark stops, report issues, and share GPS.",
]);

callout(
  "Demo tip",
  "Open all three in separate browser windows (or one normal + one private window for driver). Walk a single order from website → admin → driver → delivered. That one story shows the whole system.",
);

h1("2. How the pieces are wired together");
p(
  "Think of it as a hub. The browser never talks to Square or the database directly for business rules. It talks to your Worker API. The Worker is the brain.",
);

flowBox([
  "Customer / Admin / Driver  (React website)",
  "            |",
  "            v",
  "     Cloudflare Worker API",
  "       |        |        |        |",
  "       v        v        v        v",
  "   Database   Images   Square   Email",
  "     (D1)      (R2)   (cards)  (Resend)",
]);

p(
  "Database holds products, orders, routes, drivers, auctions, sessions. Images live in cloud storage and show on product pages. Square takes and refunds card payments. Resend sends customer confirmations and your owner alerts. Maps links open Google Maps for addresses and live GPS pins — the system stores the coordinates; Maps just displays them.",
);

h1("3. What runs by itself");
p(
  "This is the heart of the demo. Once a person does one action, the system chains the rest.",
);

h2("When a customer pays on the website");
steps([
  "Card is charged through Square.",
  "Order is created as paid and confirmed.",
  "Stock for each item drops (and marks out of stock if it hits zero).",
  "Customer gets a confirmation email.",
  "You get a separate “new paid order” alert.",
  "Customer lands on the track-order page.",
]);
callout(
  "You do not manually create the order or lower stock",
  "Checkout does that in one request. Your job after that is fulfillment — pack, assign to a route if it is delivery, or hand off for pickup.",
);

h2("When you put that order on a driver route");
steps([
  "Admin builds a route for a date and assigns a driver.",
  "Driver opens the driver portal and works each stop.",
  "Marking “en route” can move the order to out for delivery and email the customer.",
  "Marking “delivered” saves a GPS proof pin, sets the order delivered, and emails the customer again.",
  "Meanwhile the driver’s phone quietly sends location heartbeats so Live Drivers can show them on the map.",
]);

h2("When you refund or cancel");
steps([
  "Money goes back through Square when there was a card charge.",
  "Order and payment status update; customer can be emailed.",
  "On a full refund or cancel, the order is pulled off any active driver route automatically (stop marked skipped).",
  "Optional: put inventory back on a full refund.",
]);
callout(
  "Teaching point",
  "Refund is not just “money back.” The logistics side updates too, so a driver does not deliver something you already cancelled.",
);

h2("When an auction ends");
steps([
  "System closes the auction and checks the high bid against any reserve.",
  "If there is a winner: product stock locks out, an unpaid settlement order is created, and the winner gets a secure pay link by email.",
  "Winner pays (pickup or delivery). After payment it behaves like a normal paid order — you can route it if needed.",
  "Admin can resend the pay email if they lost it.",
]);

h1("4. Walkthrough A — Online sale (best demo story)");
p("Say this out loud while you click:");
steps([
  "Shop: pick a product with stock, add to cart, go to checkout.",
  "Choose delivery, pick a weekday and time window, enter a ZIP in your delivery area.",
  "Pay with a test or real card (depending on Square mode).",
  "Show the confirmation email idea: customer gets theirs; you get the owner alert.",
  "Admin → Orders: open the new order. Stock on Inventory already dropped.",
  "Admin → Assign drivers: add the order to today’s route for a driver.",
  "Driver portal (other window): open the route, mark en route, then delivered (with location allowed).",
  "Admin → Live drivers: show the heartbeat / map pin while they are out.",
  "Track order on the public site with order number + email — status shows delivered.",
]);

h1("5. Walkthrough B — Auction to paid order");
steps([
  "Admin: create or open a live auction tied to a product.",
  "Storefront: bid (needs a customer account) or Buy It Now.",
  "When it ends (or buys now), show that the winner gets a pay link — order starts unpaid.",
  "Open the pay link, choose pickup or delivery, pay with card.",
  "Back in admin: order is now paid like any other sale.",
]);

h1("6. Walkthrough C — Refund removes the stop");
steps([
  "Take a delivery order that is already on an active route.",
  "In admin, issue a full refund (or mark cancelled / refunded).",
  "Refresh the driver’s route — that stop is skipped / removed.",
  "Explain: one action updates money, order status, email, and the driver’s list.",
]);

h1("7. Inventory and search (how the catalog feeds the shop)");
p(
  "Products live in the database with stock, price, sale price, tags, and photos. The shop only sells what you mark active with stock. Search looks at name, description, brand, SKU, and search tags — so tagging a sectional with “couch” and “sofa” makes it findable even if the title never says those words.",
);
p(
  "The SKU report is the inventory brain for counts: on-hand, low/out, value, units sold, missing photos. Photos themselves are stored in cloud image storage and served through the API — upload once in admin, they appear on the site.",
);

h1("8. Who can do what (security that matters in a demo)");
p(
  "There are three separate logins on purpose. Admin can change prices, refund, and assign routes. Drivers can only update delivery progress and report issues — they cannot refund or edit inventory. Customers can shop, bid, and track their own orders. Sessions are cookie-based and independent, so sharing a driver login never opens the back office.",
);

h1("9. Money and messages");
p(
  "Square handles card charges at checkout and auction pay, refunds from admin, and can keep a card on file so you can adjust a delivery fee later without asking for the number again. Resend sends mail from orders@hamiltonsoddsandends.com. Customers get their confirmations and status updates; you get a separate notify copy so you always know a sale happened even if you never open admin.",
);

h1("10. Map of the main screens (so you can navigate live)");
h2("Customers see");
p(
  "Home, Shop, Product pages, Cart, Checkout, Track order, Account, Auctions, Auction pay link, Claims.",
);
h2("You see in admin");
p(
  "Dashboard, Inventory, SKU report, Orders, Auctions, Assign drivers, Live drivers, Drivers, Delivery settings, Reports, Revenue, Offers, Claims, Settings. In-store sale can be shown or hidden from Settings.",
);
h2("Drivers see");
p(
  "Login, today’s routes, each route’s stops (navigate, en route, delivered, report issue), and their own issue list. Location sharing stays on while the portal is open.",
);

h1("11. One sentence per layer (memorize for Q&A)");
steps([
  "Website: what people touch.",
  "Worker API: the rules and automation.",
  "Database: the single source of truth for stock, orders, routes, auctions.",
  "Image storage: product photos.",
  "Square: money in and money back.",
  "Email: automatic receipts and status updates.",
  "Driver GPS: live proof of where the truck is and where delivery happened.",
]);

callout(
  "Closing line for your demo",
  "“One store, three doors, one brain. A customer pay click creates the order, drops stock, and emails both sides. Assigning a route hands that order to a driver. Delivered updates the order and the customer. Refund pulls money and pulls the stop. The system is the glue — we just run the warehouse and the truck.”",
);

p(
  "That is the full system story. Practice Walkthrough A once before presenting — it alone proves the platform is connected and self-running.",
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
