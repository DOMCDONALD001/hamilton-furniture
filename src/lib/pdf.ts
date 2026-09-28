import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const STORE = "Hamilton's Odds N Ends Furniture";
const INK: [number, number, number] = [30, 45, 38];
const MUTED: [number, number, number] = [90, 100, 94];
const LINE: [number, number, number] = [200, 208, 202];
const ACCENT: [number, number, number] = [45, 90, 62];
const ALT_ROW: [number, number, number] = [245, 247, 245];

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function stampFooter(doc: jsPDF, page = 1, total = 1) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(STORE, 40, h - 24);
  doc.text(`Page ${page} of ${total}`, w - 40, h - 24, { align: "right" });
}

function addPageNumbers(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    stampFooter(doc, i, total);
  }
}

export type StatementPdfInput = {
  from: string;
  to: string;
  storePhone?: string;
  storeEmail?: string;
  storeAddress?: string;
  summary: {
    order_count: number;
    gross_cents: number;
    discount_cents: number;
    delivery_cents: number;
    tax_cents: number;
    total_cents: number;
    paid_cents: number;
    unpaid_cents: number;
    cancelled_cents: number;
    refunded_cents: number;
    delivery_orders: number;
    pickup_orders: number;
    cost_of_goods_cents?: number;
    profit_cents?: number;
    merchandise_after_discount_cents?: number;
    units_sold?: number;
    units_missing_cost?: number;
  };
  top_products: Array<{
    product_name: string;
    product_sku: string;
    qty: number;
    revenue_cents: number;
    cost_cents?: number;
    profit_cents?: number;
  }>;
  orders: Array<{
    order_number: string;
    customer_name: string;
    status: string;
    payment_status: string;
    delivery_method: string;
    total_cents: number;
    created_at: string;
  }>;
};

export function downloadRevenueStatementPdf(input: StatementPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 48;

  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageW, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(STORE, 40, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Revenue statement", 40, 54);

  y = 96;
  doc.setTextColor(...INK);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(`Period: ${input.from}  →  ${input.to}`, 40, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const contact = [input.storeAddress, input.storePhone, input.storeEmail]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) {
    doc.text(contact, 40, y);
    y += 14;
  }
  doc.text(`Generated ${new Date().toLocaleString()}`, 40, y);
  y += 22;

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Summary", 40, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 10, textColor: INK, cellPadding: 5 },
    columnStyles: {
      0: { cellWidth: 260 },
      1: { halign: "right", cellWidth: 120, fontStyle: "bold" },
    },
    body: [
      ["Gross merchandise", dollars(input.summary.gross_cents)],
      ["Less discounts", `−${dollars(input.summary.discount_cents)}`],
      ["Your cost (items sold)", `−${dollars(input.summary.cost_of_goods_cents || 0)}`],
      ["Profit on merchandise", dollars(input.summary.profit_cents || 0)],
      ["Delivery income", dollars(input.summary.delivery_cents)],
      ["Tax collected", dollars(input.summary.tax_cents)],
      ["Order totals", dollars(input.summary.total_cents)],
      ["Paid / collected", dollars(input.summary.paid_cents)],
      ["Accounts receivable (unpaid)", dollars(input.summary.unpaid_cents)],
      ["Orders in period", String(input.summary.order_count)],
      ["Delivery / pickup orders", `${input.summary.delivery_orders} / ${input.summary.pickup_orders}`],
      ["Cancelled / refunded", `${dollars(input.summary.cancelled_cents)} / ${dollars(input.summary.refunded_cents)}`],
      ...(input.summary.units_missing_cost
        ? [[
            "Units sold with no cost set",
            String(input.summary.units_missing_cost),
          ]]
        : []),
    ],
    didDrawCell: (data) => {
      if (data.section === "body" && data.row.index === 3) {
        doc.setDrawColor(...LINE);
        const { x, y: cy, width, height } = data.cell;
        doc.line(x, cy, x + width, cy);
        doc.line(x, cy + height, x + width, cy + height);
      }
    },
  });

  // @ts-expect-error lastAutoTable injected by plugin
  y = (doc.lastAutoTable?.finalY as number) + 22;

  if (input.top_products.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text("Top products", 40, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [["Product", "SKU", "Qty", "Revenue", "Your cost", "Profit"]],
      body: input.top_products.map((p) => [
        p.product_name,
        p.product_sku,
        String(p.qty),
        dollars(p.revenue_cents),
        dollars(p.cost_cents || 0),
        dollars(p.profit_cents || 0),
      ]),
      styles: { fontSize: 9, textColor: INK, cellPadding: 4 },
      headStyles: {
        fillColor: ACCENT,
        textColor: 255,
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: ALT_ROW },
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
    });
    // @ts-expect-error lastAutoTable injected by plugin
    y = (doc.lastAutoTable?.finalY as number) + 22;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  if (y > 680) {
    doc.addPage();
    y = 48;
  }
  doc.text("Orders", 40, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [["Date", "Order", "Customer", "Method", "Payment", "Total"]],
    body: input.orders.map((o) => [
      o.created_at.slice(0, 10),
      o.order_number,
      o.customer_name,
      o.delivery_method,
      o.payment_status,
      dollars(o.total_cents),
    ]),
    styles: { fontSize: 8, textColor: INK, cellPadding: 3 },
    headStyles: {
      fillColor: ACCENT,
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: ALT_ROW },
    columnStyles: {
      5: { halign: "right" },
    },
  });

  addPageNumbers(doc);
  doc.save(`hamilton-statement-${input.from}-to-${input.to}.pdf`);
}

export type PackingSlipPdfInput = {
  order: {
    order_number: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string | null;
    shipping_address1: string;
    shipping_address2?: string | null;
    shipping_city: string;
    shipping_state: string;
    shipping_zip: string;
    shipping_notes?: string | null;
    delivery_method: string;
    status: string;
    payment_status: string;
    subtotal_cents: number;
    discount_cents: number;
    delivery_cents: number;
    tax_cents: number;
    total_cents: number;
    created_at: string;
  };
  items: Array<{
    product_name: string;
    product_sku: string;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    ship_label?: {
      dimensions: string | null;
      weight_lbs: number | null;
      condition: string | null;
      color: string | null;
      material: string | null;
    };
    product?: {
      brand?: string | null;
      description?: string;
    } | null;
  }>;
  storePhone?: string;
  storeEmail?: string;
  storeAddress?: string;
};

/** Draw one packing slip onto `doc` (starts a new page if not the first slip). */
function drawPackingSlip(doc: jsPDF, input: PackingSlipPdfInput, isFirst: boolean) {
  if (!isFirst) doc.addPage();

  const pageW = doc.internal.pageSize.getWidth();
  const o = input.order;
  let y = 48;

  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageW, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(STORE, 40, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Packing slip / order ticket", 40, 54);

  y = 96;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(o.order_number, 40, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(`Placed ${o.created_at.slice(0, 16).replace("T", " ")}`, pageW - 40, y, {
    align: "right",
  });
  y += 18;

  doc.setTextColor(...INK);
  doc.setFontSize(10);
  doc.text(`Status: ${o.status.replaceAll("_", " ")}  ·  Payment: ${o.payment_status}`, 40, y);
  y += 14;
  doc.text(`Method: ${o.delivery_method === "pickup" ? "Pickup" : "Delivery"}`, 40, y);
  y += 22;

  const leftX = 40;
  const rightX = pageW / 2 + 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Customer", leftX, y);
  doc.text(o.delivery_method === "pickup" ? "Pickup location / notes" : "Deliver to", rightX, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const custLines = [o.customer_name, o.customer_email, o.customer_phone || ""].filter(Boolean);
  const shipLines = [
    o.shipping_address1,
    o.shipping_address2 || "",
    `${o.shipping_city}, ${o.shipping_state} ${o.shipping_zip}`,
    o.shipping_notes ? `Notes: ${o.shipping_notes}` : "",
  ].filter(Boolean);

  const blockStart = y;
  custLines.forEach((line, i) => doc.text(line, leftX, blockStart + i * 13));
  shipLines.forEach((line, i) => {
    const wrapped = doc.splitTextToSize(line, pageW / 2 - 50);
    doc.text(wrapped, rightX, blockStart + i * 13);
  });
  y = blockStart + Math.max(custLines.length, shipLines.length) * 13 + 20;

  if (input.storeAddress || input.storePhone) {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      ["Store:", input.storeAddress, input.storePhone, input.storeEmail].filter(Boolean).join("  "),
      40,
      y,
    );
    y += 18;
    doc.setTextColor(...INK);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Pack these items", 40, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [["Qty", "Item", "SKU", "Details", "Line"]],
    body: input.items.map((i) => {
      const details = [
        i.ship_label?.dimensions && `Dims ${i.ship_label.dimensions}`,
        i.ship_label?.weight_lbs != null && `${i.ship_label.weight_lbs} lbs`,
        i.ship_label?.condition,
        i.ship_label?.color,
        i.ship_label?.material,
        i.product?.brand,
      ]
        .filter(Boolean)
        .join(" · ");
      return [
        String(i.quantity),
        i.product_name,
        i.product_sku,
        details || "—",
        dollars(i.line_total_cents),
      ];
    }),
    styles: { fontSize: 9, textColor: INK, cellPadding: 5, valign: "top" },
    headStyles: {
      fillColor: ACCENT,
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: ALT_ROW },
    columnStyles: {
      0: { cellWidth: 36, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 170 },
      2: { cellWidth: 70 },
      3: { cellWidth: 180 },
      4: { cellWidth: 55, halign: "right" },
    },
  });

  // @ts-expect-error lastAutoTable injected by plugin
  y = (doc.lastAutoTable?.finalY as number) + 18;

  if (y > 680) {
    doc.addPage();
    y = 48;
  }

  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 10, textColor: INK, cellPadding: 4 },
    margin: { left: pageW - 220 },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 70, halign: "right", fontStyle: "bold" },
    },
    body: [
      ["Subtotal", dollars(o.subtotal_cents)],
      ...(o.discount_cents ? [["Discount", `−${dollars(o.discount_cents)}`]] : []),
      ["Delivery", dollars(o.delivery_cents)],
      ["Tax", dollars(o.tax_cents)],
      ["Total", dollars(o.total_cents)],
    ],
  });

  // @ts-expect-error lastAutoTable injected by plugin
  y = (doc.lastAutoTable?.finalY as number) + 28;
  doc.setDrawColor(...LINE);
  doc.line(40, y, pageW - 40, y);
  y += 28;
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("Received by: ____________________________    Date: ______________", 40, y);
  y += 22;
  doc.text("Driver / packer: _________________________    Time: ______________", 40, y);
}

export function buildPackingSlipsPdf(inputs: PackingSlipPdfInput[]) {
  if (!inputs.length) throw new Error("No packing slips to build");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  inputs.forEach((input, idx) => drawPackingSlip(doc, input, idx === 0));
  addPageNumbers(doc);
  return doc;
}

function openPdfBlob(doc: jsPDF, opts?: { autoPrint?: boolean }) {
  if (opts?.autoPrint) doc.autoPrint();
  const url = String(doc.output("bloburl"));
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  }
  return url;
}

export function downloadPackingSlipPdf(input: PackingSlipPdfInput) {
  const doc = buildPackingSlipsPdf([input]);
  doc.save(`hamilton-packing-slip-${input.order.order_number}.pdf`);
}

/** Open packing slip PDF in a new tab for on-screen viewing. */
export function viewPackingSlipPdf(input: PackingSlipPdfInput) {
  openPdfBlob(buildPackingSlipsPdf([input]));
}

export function downloadPackingSlipsPdf(inputs: PackingSlipPdfInput[], filename?: string) {
  const doc = buildPackingSlipsPdf(inputs);
  const name =
    filename ||
    (inputs.length === 1
      ? `hamilton-packing-slip-${inputs[0].order.order_number}.pdf`
      : `hamilton-packing-slips-${inputs.length}-orders.pdf`);
  doc.save(name);
}

/** Open multi-order packing slip PDF and trigger the browser print dialog. */
export function printPackingSlipsPdf(inputs: PackingSlipPdfInput[]) {
  openPdfBlob(buildPackingSlipsPdf(inputs), { autoPrint: true });
}

/** View multi-order packing slip PDF without auto-print. */
export function viewPackingSlipsPdf(inputs: PackingSlipPdfInput[]) {
  openPdfBlob(buildPackingSlipsPdf(inputs));
}

export type InventoryReportPdfInput = {
  generatedAt: string;
  storePhone?: string;
  storeEmail?: string;
  storeAddress?: string;
  filters?: string;
  summary: {
    sku_count: number;
    active_count: number;
    out_of_stock_count: number;
    low_stock_count: number;
    units_on_hand: number;
    retail_value_cents: number;
    cost_value_cents: number;
    units_sold_all_time: number;
    revenue_all_time_cents: number;
    missing_photos: number;
  };
  items: Array<{
    sku: string;
    name: string;
    category_name: string | null;
    status: string;
    stock: number;
    stock_flag: string;
    price_cents: number;
    cost_cents: number | null;
    retail_value_cents: number;
    units_sold: number;
    revenue_cents: number;
  }>;
};

export function downloadInventoryReportPdf(input: InventoryReportPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 48;

  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, pageW, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(STORE, 40, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Inventory & SKU Tracker Report", 40, 54);

  y = 92;
  doc.setTextColor(...INK);
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Generated ${new Date(input.generatedAt).toLocaleString()}`, 40, y);
  if (input.filters) {
    y += 14;
    doc.text(`Filters: ${input.filters}`, 40, y);
  }
  y += 22;

  const s = input.summary;
  autoTable(doc, {
    startY: y,
    margin: { left: 40, right: 40 },
    head: [["Metric", "Value"]],
    body: [
      ["SKUs in report", String(s.sku_count)],
      ["Active listings", String(s.active_count)],
      ["Out of stock", String(s.out_of_stock_count)],
      ["Low stock", String(s.low_stock_count)],
      ["Units on hand", String(s.units_on_hand)],
      ["Retail value (on hand)", dollars(s.retail_value_cents)],
      ["Cost value (on hand)", dollars(s.cost_value_cents)],
      ["Units sold (all time)", String(s.units_sold_all_time)],
      ["Revenue (all time)", dollars(s.revenue_all_time_cents)],
      ["Missing photos", String(s.missing_photos)],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: ACCENT },
    alternateRowStyles: { fillColor: ALT_ROW },
  });

  y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || y) + 18;

  autoTable(doc, {
    startY: y,
    margin: { left: 40, right: 40 },
    head: [["SKU", "Product", "Cat", "Stock", "Price", "Value", "Sold", "Rev"]],
    body: input.items.map((i) => [
      i.sku,
      i.name.length > 28 ? `${i.name.slice(0, 27)}…` : i.name,
      i.category_name || "—",
      i.stock_flag === "low"
        ? `${i.stock} (low)`
        : i.stock_flag === "out"
          ? `${i.stock} (out)`
          : String(i.stock),
      dollars(i.price_cents),
      dollars(i.retail_value_cents),
      String(i.units_sold),
      dollars(i.revenue_cents),
    ]),
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: ACCENT, fontSize: 8 },
    alternateRowStyles: { fillColor: ALT_ROW },
    columnStyles: {
      0: { cellWidth: 62 },
      1: { cellWidth: 120 },
      3: { cellWidth: 42 },
    },
  });

  addPageNumbers(doc);
  doc.save(`hamilton-inventory-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
