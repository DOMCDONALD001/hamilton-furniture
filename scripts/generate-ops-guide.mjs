/**
 * Hamilton's Odds N Ends Furniture — plain-language operations guide PDF.
 * Run: node scripts/generate-ops-guide.mjs
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
const outPath = join(outDir, "Hamilton-Odds-N-Ends-Operations-Guide.pdf");
const desktopPath = join(homedir(), "Desktop", "Hamilton-Odds-N-Ends-Operations-Guide.pdf");

mkdirSync(outDir, { recursive: true });

const doc = new jsPDF({ unit: "pt", format: "letter" });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const margin = 54;
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
  need(42);
  y += 12;
  writeLines([text], { font: "bold", size: 14, color: [26, 35, 30], lineHeight: 18 });
  y += 6;
}

function h2(text) {
  need(28);
  y += 6;
  writeLines([text], { font: "bold", size: 11, color: [40, 55, 48], lineHeight: 15 });
  y += 3;
}

function stampFooters() {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`Hamilton's Odds N Ends Furniture — Operations Guide — Page ${i} of ${pages}`, margin, pageH - 28);
  }
}

// Cover
doc.setFillColor(26, 35, 30);
doc.rect(0, 0, pageW, 160, "F");
doc.setTextColor(247, 242, 234);
doc.setFont("helvetica", "bold");
doc.setFontSize(22);
doc.text("Hamilton's Odds N Ends Furniture", margin, 70);
doc.setFont("helvetica", "normal");
doc.setFontSize(13);
doc.text("How the store works", margin, 98);
doc.setFontSize(10);
doc.setTextColor(196, 165, 116);
doc.text(
  `Updated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
  margin,
  124,
);

y = 190;

p(
  "This guide explains how the furniture store website and admin tools work in everyday language. It is meant for owners and staff — not for developers.",
);

h1("The big picture");
p(
  "There are three parts that all share the same store information. The public website is where customers shop, check out, and track orders. The admin area is where you manage products, orders, drivers, and settings. The driver portal is a separate login drivers use only for their delivery routes.",
);
p(
  "When a customer pays online, the item comes out of stock, an order is created, the customer gets a confirmation email, and you get a store alert. If they chose delivery, you later put that order on a driver route. When the driver marks it delivered, the customer gets another email. If you refund or cancel an order that is still on a route, it is taken off the driver’s list automatically so they do not deliver it.",
);

h1("What customers do on the website");
p(
  "Customers browse the shop, open product pages with photos and prices, and add items to a cart. They can search by name, brand, SKU, or search tags you add (for example tagging a sectional with “couch” and “sofa” so it shows up when people search those words).",
);
p(
  "At checkout they enter their contact info and choose pickup or delivery. For delivery they pick a weekday on a calendar and a time window. The delivery fee depends on their ZIP code. They pay by card. After payment they can track the order with their order number and email. If something goes wrong with a delivery, they can open a claim on the site, and you handle it under Claims in admin.",
);

h1("Inventory");
p(
  "In admin under Inventory you add products, set prices, mark items on sale, add search tags, and upload photos. You can discount or tag several products at once. Product statuses control whether something is for sale, a draft, out of stock, or archived.",
);
p(
  "The SKU report is your stock tracker. It shows how many of each item you have, which are low or out, value on hand, what has sold, and which products are missing photos. You can filter the list and download a PDF or spreadsheet for counts and bookkeeping. Running this once a week is a good habit.",
);

h1("Orders, refunds, and packing");
p(
  "The Orders page lists every sale. Open an order to see items, address, payment, and notes. When you change the order status (for example processing, out for delivery, or delivered), the customer is emailed. You can also email the customer a confirmation again without changing anything.",
);
p(
  "You can issue a full or partial refund through Square from the order screen. On a full refund you can put stock back. If you fully refund or mark an order cancelled or refunded, that order is removed from any active driver route so the driver cannot deliver it by mistake. Packing slips can be printed for one order or several at once.",
);

h1("Deliveries and drivers");
p(
  "Under Delivery settings you set ZIP fees, free-delivery rules, and which days and time windows customers can choose. Under Drivers you create driver logins. Give drivers only the driver website link — not the admin login. Drivers cannot change prices, inventory, or payments.",
);
p(
  "On Assign drivers you build a route for a date, add delivery orders, and assign a driver. The driver opens their portal, works each stop, and marks en route, delivered, or reports a problem. Delivered stops save a location pin you can open in Maps.",
);
p(
  "Live drivers shows who is out on the road, how far along their route they are, and a map of their last shared location. Drivers need to keep the driver page open and allow location on their phone. If someone reports a delivery problem, it shows under Reports so you can resolve it and rebook if needed.",
);

h1("Auctions");
p(
  "Auctions run alongside regular buy-now products. Bidding needs a customer account. When an auction ends, the winner gets an email with a pay link and can choose free pickup or paid delivery. After they pay, treat the order like any other sale. You can resend the pay email from the auction page if they need it again.",
);

h1("Payments and email");
p(
  "Online payments run through Square. Customers enter their card at checkout or when paying for an auction win. Refunds you start in admin go back through Square when the order was paid by card.",
);
p(
  "Customer emails come from orders@hamiltonsoddsandends.com. Customers get order confirmations and status updates. You get a separate alert when a new paid order comes in or when an order changes, so you are not relying only on the customer copy. You can set your notify email and the from name under Settings.",
);

h1("Other admin tools");
p(
  "In-store sale can stay hidden until you turn it on in Settings. Offers lets you create promo codes. Revenue shows sales for a date range and can download a statement. Claims is where customer issue tickets live. Settings also covers homepage text and photos, contact info, tax rate, and your password.",
);

h1("A simple daily routine");
h2("Morning");
p(
  "Check the dashboard and Orders for anything that came in overnight. Set up today’s delivery routes and check Live drivers. Clear any open delivery issues in Reports.",
);
h2("During the day");
p(
  "Add new inventory with photos and search tags. Put new delivery orders onto routes as they come in. Keep an eye on Live drivers. If you refund or cancel, remember the stop comes off the route automatically.",
);
h2("Weekly");
p(
  "Run the SKU report and fix low stock or missing photos. Glance at Revenue for paid versus refunded. Make sure order emails and payments still look normal.",
);

h1("If something goes wrong");
p(
  "If a customer did not get email, use Email customer on their order and confirm your from address is set to orders@hamiltonsoddsandends.com in Settings. If a driver is missing from the live map, have them allow location and keep the driver page open. If an order was refunded but still shows on a route, refresh the route — it should show as removed. If stock did not come back after a refund, use restore inventory on the full refund. If search cannot find a couch or sofa, add those words as search tags on the product.",
);

h1("Access");
p(
  "Keep the owner admin login separate from driver logins. Do not share the admin password with drivers. Log out on shared computers. Drivers can only update delivery progress — they cannot change prices or take refunds.",
);

p("Website: https://hamiltonsoddsandends.com");

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
