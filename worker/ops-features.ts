import { Hono } from "hono";
import type { Env } from "./types";
import { id } from "./types";
import { requireAdmin } from "./auth";
import { getCustomerFromRequest } from "./customer-auth";
import { getSetting, getPublicOrigin, orderNumber as makeOrderNumber } from "./helpers";
import { addOrderEvent, availableDeliveryDates, parseWindowsJson } from "./order-events";
import { emailOrderIfNeeded } from "./email";

type App = { Bindings: Env; Variables: Record<string, unknown> };

export const opsFeatures = new Hono<App>();

// ─── Delivery windows (public) ─────────────────────────────────────

opsFeatures.get("/api/delivery/windows", async (c) => {
  const windows = parseWindowsJson(
    await getSetting(c.env.DB, "delivery_windows_json", '["9am–12pm","12pm–3pm","3pm–6pm"]'),
  );
  const lead = Number(await getSetting(c.env.DB, "delivery_lead_days", "1")) || 1;
  const max = Number(await getSetting(c.env.DB, "delivery_max_days", "14")) || 14;
  return c.json({
    windows,
    dates: availableDeliveryDates(lead, max),
    lead_days: lead,
    max_days: max,
  });
});

// ─── Customer addresses ────────────────────────────────────────────

opsFeatures.get("/api/account/addresses", async (c) => {
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  if (!customer) return c.json({ error: "Sign in required" }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, updated_at DESC`,
  )
    .bind(customer.id)
    .all();
  return c.json({ addresses: results || [] });
});

opsFeatures.post("/api/account/addresses", async (c) => {
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  if (!customer) return c.json({ error: "Sign in required" }, 401);
  const body = await c.req.json<{
    label?: string;
    name?: string;
    phone?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    is_default?: boolean;
  }>();
  if (!body.address1?.trim() || !body.city?.trim() || !body.zip?.trim()) {
    return c.json({ error: "Address, city, and ZIP are required" }, 400);
  }
  const addrId = id("addr");
  if (body.is_default) {
    await c.env.DB.prepare(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`)
      .bind(customer.id)
      .run();
  }
  await c.env.DB.prepare(
    `INSERT INTO customer_addresses
      (id, customer_id, label, name, phone, address1, address2, city, state, zip, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      addrId,
      customer.id,
      body.label?.trim() || "Home",
      body.name?.trim() || customer.name,
      body.phone?.trim() || customer.phone || null,
      body.address1.trim(),
      body.address2?.trim() || null,
      body.city.trim(),
      body.state?.trim() || "MS",
      body.zip.trim(),
      body.is_default ? 1 : 0,
    )
    .run();
  const address = await c.env.DB.prepare(`SELECT * FROM customer_addresses WHERE id = ?`)
    .bind(addrId)
    .first();
  return c.json({ address }, 201);
});

opsFeatures.delete("/api/account/addresses/:id", async (c) => {
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  if (!customer) return c.json({ error: "Sign in required" }, 401);
  await c.env.DB.prepare(
    `DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?`,
  )
    .bind(c.req.param("id"), customer.id)
    .run();
  return c.json({ ok: true });
});

// ─── Return / damage claims ────────────────────────────────────────

opsFeatures.post("/api/orders/claims", async (c) => {
  const body = await c.req.json<{
    order_number?: string;
    email?: string;
    claim_type?: string;
    reason?: string;
  }>();
  const orderNum = (body.order_number || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const reason = (body.reason || "").trim();
  const claimType = body.claim_type || "return";
  if (!orderNum || !email || reason.length < 5) {
    return c.json({ error: "Order number, email, and a detailed reason are required" }, 400);
  }
  const allowed = ["return", "damage", "wrong_item", "missing", "other"];
  if (!allowed.includes(claimType)) return c.json({ error: "Invalid claim type" }, 400);

  const order = await c.env.DB.prepare(
    `SELECT id, order_number, customer_email, status FROM orders
     WHERE order_number = ? AND lower(customer_email) = ?`,
  )
    .bind(orderNum, email)
    .first<{ id: string; order_number: string; customer_email: string; status: string }>();
  if (!order) return c.json({ error: "Order not found for that number and email" }, 404);

  const claimId = id("claim");
  await c.env.DB.prepare(
    `INSERT INTO return_claims (id, order_id, customer_email, claim_type, reason, status)
     VALUES (?, ?, ?, ?, ?, 'open')`,
  )
    .bind(claimId, order.id, order.customer_email, claimType, reason)
    .run();

  await addOrderEvent(c.env.DB, order.id, "claim_opened", `${claimType}: ${reason.slice(0, 120)}`);

  const claim = await c.env.DB.prepare(`SELECT * FROM return_claims WHERE id = ?`)
    .bind(claimId)
    .first();
  return c.json({ claim }, 201);
});

opsFeatures.get("/api/admin/claims", requireAdmin, async (c) => {
  const status = c.req.query("status") || "open";
  let sql = `
    SELECT c.*, o.order_number, o.customer_name, o.total_cents
    FROM return_claims c
    JOIN orders o ON o.id = c.order_id
  `;
  const binds: string[] = [];
  if (status !== "all") {
    sql += ` WHERE c.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY c.created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ claims: results || [] });
});

opsFeatures.patch("/api/admin/claims/:id", requireAdmin, async (c) => {
  const body = await c.req.json<{ status?: string; admin_note?: string }>();
  const allowed = ["open", "approved", "denied", "resolved"];
  if (body.status && !allowed.includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE return_claims SET
       status = COALESCE(?, status),
       admin_note = COALESCE(?, admin_note),
       resolved_at = CASE WHEN ? IN ('resolved','denied','approved') THEN datetime('now') ELSE resolved_at END
     WHERE id = ?`,
  )
    .bind(body.status ?? null, body.admin_note ?? null, body.status ?? null, c.req.param("id"))
    .run();
  const claim = await c.env.DB.prepare(
    `SELECT c.*, o.order_number FROM return_claims c JOIN orders o ON o.id = c.order_id WHERE c.id = ?`,
  )
    .bind(c.req.param("id"))
    .first();
  return c.json({ claim });
});

// ─── Admin in-store / cash sale ────────────────────────────────────

opsFeatures.post("/api/admin/pos-sale", requireAdmin, async (c) => {
  const body = await c.req.json<{
    items?: { product_id: string; quantity: number; color?: string | null }[];
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    payment_method?: "cash" | "card_terminal" | "other";
    notes?: string;
  }>();

  const items = body.items || [];
  if (!items.length) return c.json({ error: "Add at least one item" }, 400);
  const name = (body.customer_name || "In-store customer").trim();
  const email = (body.customer_email || "instore@hamiltonsoddsandends.local").trim().toLowerCase();
  const payMethod = body.payment_method || "cash";

  let subtotal = 0;
  const lines: Array<{
    product_id: string;
    product_name: string;
    product_sku: string;
    unit_price_cents: number;
    quantity: number;
    line_total_cents: number;
  }> = [];

  for (const item of items) {
    const product = await c.env.DB.prepare(
      `SELECT id, name, sku, price_cents, stock, status FROM products WHERE id = ?`,
    )
      .bind(item.product_id)
      .first<{
        id: string;
        name: string;
        sku: string;
        price_cents: number;
        stock: number;
        status: string;
      }>();
    if (!product || product.status === "archived") {
      return c.json({ error: "Product not found" }, 404);
    }
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    if (product.stock < qty) {
      return c.json({ error: `Insufficient stock for ${product.name}` }, 409);
    }
    const lineTotal = product.price_cents * qty;
    subtotal += lineTotal;
    lines.push({
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      unit_price_cents: product.price_cents,
      quantity: qty,
      line_total_cents: lineTotal,
    });
  }

  const orderId = id("ord");
  const num = makeOrderNumber();
  const taxRate = Number(await getSetting(c.env.DB, "tax_rate", "0")) || 0;
  const taxRateBps = Number(await getSetting(c.env.DB, "tax_rate_bps", "725")) || 0;
  const taxCents =
    taxRate > 0 ? Math.round(subtotal * taxRate) : Math.round((subtotal * taxRateBps) / 10000);
  const total = subtotal + taxCents;

  for (const line of lines) {
    const updated = await c.env.DB.prepare(
      `UPDATE products SET stock = stock - ?, updated_at = datetime('now'),
       status = CASE WHEN stock - ? <= 0 THEN 'out_of_stock' ELSE status END
       WHERE id = ? AND stock >= ?`,
    )
      .bind(line.quantity, line.quantity, line.product_id, line.quantity)
      .run();
    if (!updated.meta.changes) {
      return c.json({ error: `Stock changed for ${line.product_name}` }, 409);
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO orders (
      id, order_number, status, payment_status, customer_name, customer_email, customer_phone,
      shipping_address1, shipping_city, shipping_state, shipping_zip, shipping_notes,
      delivery_method, subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents,
      payment_method, sale_channel, admin_notes
    ) VALUES (?, ?, 'delivered', 'paid', ?, ?, ?, 'In-store pickup', 'Tupelo', 'MS', '38804', ?, 'pickup', ?, 0, 0, ?, ?, ?, 'in_store', ?)`,
  )
    .bind(
      orderId,
      num,
      name,
      email,
      body.customer_phone || null,
      body.notes || null,
      subtotal,
      taxCents,
      total,
      payMethod,
      body.notes || `In-store ${payMethod} sale`,
    )
    .run();

  for (const line of lines) {
    await c.env.DB.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, product_sku, unit_price_cents, quantity, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id("oi"),
        orderId,
        line.product_id,
        line.product_name,
        line.product_sku,
        line.unit_price_cents,
        line.quantity,
        line.line_total_cents,
      )
      .run();
  }

  await addOrderEvent(c.env.DB, orderId, "pos_sale", `In-store sale via ${payMethod}`);
  await addOrderEvent(c.env.DB, orderId, "paid", "Paid in store");
  await addOrderEvent(c.env.DB, orderId, "delivered", "Picked up / completed in store");

  await emailOrderIfNeeded(
    c.env,
    await getPublicOrigin(c.env, c.req.url),
    {
      customer_email: email,
      customer_name: name,
      order_number: num,
      status: "delivered",
      total_cents: total,
    },
    "paid",
    `In-store ${payMethod} sale`,
  );

  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
  return c.json({ order }, 201);
});

// ─── Dashboard today ───────────────────────────────────────────────

opsFeatures.get("/api/admin/today", requireAdmin, async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const openIssues = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM delivery_issues WHERE status = 'open'`,
  ).first<{ n: number }>();
  const openClaims = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM return_claims WHERE status = 'open'`,
  ).first<{ n: number }>();
  const routesToday = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM delivery_routes WHERE route_date = ? AND status != 'cancelled'`,
  )
    .bind(today)
    .first<{ n: number }>();
  const routesIncomplete = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM delivery_routes
     WHERE route_date = ? AND status IN ('assigned','in_progress')`,
  )
    .bind(today)
    .first<{ n: number }>();
  const deliveriesToday = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM orders
     WHERE delivery_date = ? AND delivery_method = 'delivery'
       AND status NOT IN ('cancelled','refunded')`,
  )
    .bind(today)
    .first<{ n: number }>();
  const lowStock = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM products WHERE stock <= low_stock_threshold AND status = 'active'`,
  ).first<{ n: number }>();
  const { results: todayOrders } = await c.env.DB.prepare(
    `SELECT id, order_number, customer_name, status, payment_status, total_cents,
            delivery_date, delivery_window, delivery_method
     FROM orders
     WHERE date(created_at) = ? OR delivery_date = ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(today, today)
    .all();
  const { results: incompleteRoutes } = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.status, d.name as driver_name,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id) as stop_count,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'delivered') as delivered_count
     FROM delivery_routes r
     LEFT JOIN drivers d ON d.id = r.driver_id
     WHERE r.route_date = ? AND r.status IN ('assigned','in_progress')
     ORDER BY r.created_at ASC`,
  )
    .bind(today)
    .all();

  return c.json({
    date: today,
    stats: {
      open_issues: openIssues?.n ?? 0,
      open_claims: openClaims?.n ?? 0,
      routes_today: routesToday?.n ?? 0,
      routes_incomplete: routesIncomplete?.n ?? 0,
      deliveries_today: deliveriesToday?.n ?? 0,
      low_stock: lowStock?.n ?? 0,
    },
    orders: todayOrders || [],
    incomplete_routes: incompleteRoutes || [],
  });
});
