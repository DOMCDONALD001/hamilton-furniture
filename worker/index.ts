import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Product, Discount } from "./types";
import { id, slugify } from "./types";
import {
  requireAdmin,
  getSessionToken,
  createSession,
  destroySession,
  verifyAdminLogin,
  setupAdminPassword,
  changeAdminPassword,
  adminNeedsSetup,
  validateSession,
  sessionCookie,
  clearSessionCookie,
  OWNER_EMAIL,
} from "./auth";
import {
  attachImages,
  getSetting,
  setSetting,
  getPublicOrigin,
  calcDiscountCents,
  getDeliveryConfig,
  resolveDelivery,
  isDiscountValid,
  orderNumber,
  normalizeZip,
  parseColors,
  serializeColors,
} from "./helpers";
import {
  createSquarePayment,
  createSquareRefund,
  getSquareConfig,
  findOrCreateSquareCustomer,
  saveSquareCardFromPayment,
  chargeSquareCardOnFile,
} from "./square";
import {
  settleAuctions,
  closeAuction,
  minNextBid,
  publicAuction,
  auctionSlug,
  type Auction,
  type Bid,
} from "./auction-helpers";
import {
  loadSettlementByToken,
  previewSettlementDelivery,
  payAuctionSettlement,
  sendAuctionWonEmail,
  moneyLabel,
  createAuctionSettlement,
} from "./auction-settle";
import {
  hashPassword,
  verifyCustomerPassword,
  createCustomerSession,
  getCustomerFromRequest,
  destroyCustomerSession,
  customerSessionCookie,
  clearCustomerSessionCookie,
  newCustomerId,
} from "./customer-auth";
import { deliveryPortal } from "./delivery-portal";
import { opsFeatures } from "./ops-features";
import { addOrderEvent, listOrderEvents, parseWindowsJson } from "./order-events";
import { emailOrderIfNeeded, notifyOrderEvent } from "./email";
import { removeOrderFromActiveRoutes } from "./routes-helpers";

type App = { Bindings: Env };

const app = new Hono<App>();

app.route("/", deliveryPortal);
app.route("/", opsFeatures);

app.use("/api/*", cors({ origin: "*", credentials: true }));

app.get("/api/health", (c) =>
  c.json({ ok: true, store: c.env.STORE_NAME || "Hamilton's Odds N Ends Furniture" }),
);

// ─── Public: catalog ───────────────────────────────────────────────

app.get("/api/categories", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM categories ORDER BY sort_order ASC, name ASC`,
  ).all();
  return c.json({ categories: results });
});

app.get("/api/products", async (c) => {
  const q = c.req.query("q")?.trim();
  const category = c.req.query("category");
  const featured = c.req.query("featured");
  const condition = c.req.query("condition");
  const sort = c.req.query("sort") || "newest";
  const minPrice = Number(c.req.query("min") || 0);
  const maxPrice = Number(c.req.query("max") || 0);
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(48, Math.max(1, Number(c.req.query("limit") || 24)));
  const offset = (page - 1) * limit;

  const where: string[] = [`status = 'active'`, `stock > 0`];
  const binds: (string | number)[] = [];

  if (q) {
    where.push(`(name LIKE ? OR description LIKE ? OR brand LIKE ? OR sku LIKE ? OR tags LIKE ?)`);
    const like = `%${q}%`;
    binds.push(like, like, like, like, like);
  }
  if (category) {
    where.push(`(category_id = ? OR category_id IN (SELECT id FROM categories WHERE slug = ?))`);
    binds.push(category, category);
  }
  if (featured === "1") where.push(`featured = 1`);
  if (condition) {
    where.push(`condition = ?`);
    binds.push(condition);
  }
  if (minPrice > 0) {
    where.push(`price_cents >= ?`);
    binds.push(Math.round(minPrice * 100));
  }
  if (maxPrice > 0) {
    where.push(`price_cents <= ?`);
    binds.push(Math.round(maxPrice * 100));
  }

  const orderBy =
    sort === "price_asc"
      ? "price_cents ASC"
      : sort === "price_desc"
        ? "price_cents DESC"
        : sort === "name"
          ? "name ASC"
          : "created_at DESC";

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM products ${whereSql}`,
  )
    .bind(...binds)
    .first<{ n: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM products ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Product>();

  const products = await attachImages(c, results || []);
  return c.json({
    products,
    page,
    limit,
    total: countRow?.n ?? 0,
    pages: Math.ceil((countRow?.n ?? 0) / limit),
  });
});

app.get("/api/products/:idOrSlug", async (c) => {
  const key = c.req.param("idOrSlug");
  const product = await c.env.DB.prepare(
    `SELECT * FROM products WHERE id = ? OR slug = ?`,
  )
    .bind(key, key)
    .first<Product>();
  if (!product || (product.status !== "active" && !(await isAdminRequest(c)))) {
    return c.json({ error: "Product not found" }, 404);
  }
  const [enriched] = await attachImages(c, [product]);
  let category = null;
  if (product.category_id) {
    category = await c.env.DB.prepare(`SELECT * FROM categories WHERE id = ?`)
      .bind(product.category_id)
      .first();
  }
  const { results: related } = await c.env.DB.prepare(
    `SELECT * FROM products WHERE status = 'active' AND stock > 0 AND id != ? AND category_id = ? LIMIT 4`,
  )
    .bind(product.id, product.category_id)
    .all<Product>();
  const relatedProducts = await attachImages(c, related || []);
  return c.json({ product: enriched, category, related: relatedProducts });
});

app.get("/api/images/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const obj = await c.env.IMAGES.get(key);
  if (!obj) {
    return new Response(placeholderSvg(), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
    });
  }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { headers });
});

app.get("/api/offers", async (c) => {
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  const { results } = await c.env.DB.prepare(
    `SELECT id, code, name, description, type, value, min_order_cents, product_id, category_id, ends_at, members_only
     FROM discounts WHERE active = 1
     AND COALESCE(show_on_home, 1) = 1
     AND (starts_at IS NULL OR starts_at <= datetime('now'))
     AND (ends_at IS NULL OR ends_at >= datetime('now'))
     AND (max_uses IS NULL OR used_count < max_uses)
     ORDER BY created_at DESC`,
  ).all<{
    id: string;
    code: string | null;
    name: string;
    description: string | null;
    type: string;
    value: number;
    min_order_cents: number;
    product_id: string | null;
    category_id: string | null;
    ends_at: string | null;
    members_only: number;
  }>();

  const offers = (results || []).map((o) => ({
    ...o,
    members_only: !!o.members_only,
    locked: !!o.members_only && !customer,
  }));

  return c.json({ offers, signed_in: !!customer });
});

// ─── Customer accounts (optional) ──────────────────────────────────

app.get("/api/account/me", async (c) => {
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  return c.json({ customer });
});

app.post("/api/account/register", async (c) => {
  const body = await c.req.json<{
    name: string;
    email: string;
    password: string;
    phone?: string;
  }>();
  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim();
  const password = body.password || "";
  if (!name || !email || password.length < 6) {
    return c.json({ error: "Name, email, and password (6+ chars) required" }, 400);
  }
  const existing = await c.env.DB.prepare(`SELECT id FROM customers WHERE email = ?`)
    .bind(email)
    .first();
  if (existing) return c.json({ error: "An account with that email already exists" }, 409);

  const { hash, salt } = await hashPassword(password);
  const customerId = newCustomerId();
  await c.env.DB.prepare(
    `INSERT INTO customers (id, email, password_hash, password_salt, name, phone)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(customerId, email, hash, salt, name, body.phone?.trim() || null)
    .run();

  const token = await createCustomerSession(c.env.DB, customerId);
  c.header("Set-Cookie", customerSessionCookie(token));
  return c.json({
    customer: { id: customerId, email, name, phone: body.phone?.trim() || null },
  }, 201);
});

app.post("/api/account/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  const email = (body.email || "").trim().toLowerCase();
  const row = await c.env.DB.prepare(
    `SELECT id, email, name, phone, password_hash, password_salt FROM customers WHERE email = ?`,
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      name: string;
      phone: string | null;
      password_hash: string;
      password_salt: string;
    }>();
  if (!row || !(await verifyCustomerPassword(body.password || "", row.password_hash, row.password_salt))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const token = await createCustomerSession(c.env.DB, row.id);
  c.header("Set-Cookie", customerSessionCookie(token));
  return c.json({
    customer: { id: row.id, email: row.email, name: row.name, phone: row.phone },
  });
});

app.post("/api/account/logout", async (c) => {
  await destroyCustomerSession(c.env.DB, c.req.header("Cookie"));
  c.header("Set-Cookie", clearCustomerSessionCookie());
  return c.json({ ok: true });
});

app.put("/api/account/me", async (c) => {
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  if (!customer) return c.json({ error: "Sign in required" }, 401);
  const body = await c.req.json<{ name?: string; phone?: string }>();
  await c.env.DB.prepare(
    `UPDATE customers SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(body.name?.trim() || null, body.phone?.trim() || null, customer.id)
    .run();
  const updated = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  return c.json({ customer: updated });
});

app.get("/api/account/orders", async (c) => {
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  if (!customer) return c.json({ error: "Sign in required" }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT id, order_number, status, payment_status, total_cents, created_at, delivery_method
     FROM orders WHERE customer_id = ? OR lower(customer_email) = lower(?)
     ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(customer.id, customer.email)
    .all();
  return c.json({ orders: results });
});

app.get("/api/delivery/config", async (c) => {
  const config = await getDeliveryConfig(c.env.DB);
  return c.json({
    delivery_enabled: config.enabled,
    pickup_enabled: config.pickup_enabled,
    flat_fee_cents: config.local_fee_cents,
    local_fee_cents: config.local_fee_cents,
    extended_fee_cents: config.extended_fee_cents,
    per_item_cents: config.per_item_cents,
    free_above_cents: config.free_above_cents,
    eta_text: config.eta_text,
    eta_local: config.eta_local,
    eta_extended: config.eta_extended,
    local_zip_count: config.local_zips.length,
    extended_zip_count: config.extended_zips.length,
    allowed_zip_count: config.allowed_zips.length,
  });
});

app.post("/api/delivery/check", async (c) => {
  const body = await c.req.json<{
    zip?: string;
    method?: string;
    subtotal_cents?: number;
    discount_code?: string;
    item_count?: number;
  }>();
  const config = await getDeliveryConfig(c.env.DB);
  let freeShipping = false;
  if (body.discount_code) {
    const disc = await c.env.DB.prepare(
      `SELECT * FROM discounts WHERE upper(code) = upper(?)`,
    )
      .bind(body.discount_code)
      .first<Discount>();
    if (disc && isDiscountValid(disc) && disc.type === "free_shipping") {
      freeShipping = true;
    }
  }
  const result = resolveDelivery({
    config,
    method: body.method || "delivery",
    zip: body.zip || "",
    subtotalAfterDiscount: body.subtotal_cents || 0,
    freeShippingPromo: freeShipping,
    item_count: body.item_count || 1,
  });
  return c.json({
    ...result,
    zip: normalizeZip(body.zip || ""),
    eta_text: result.eta_text || config.eta_text,
    flat_fee_cents: config.local_fee_cents,
    local_fee_cents: config.local_fee_cents,
    extended_fee_cents: config.extended_fee_cents,
    free_above_cents: config.free_above_cents,
    free_shipping: result.ok && (freeShipping || result.delivery_cents === 0),
  });
});

app.get("/api/payments/config", async (c) => {
  const config = await getSquareConfig(c.env);
  return c.json({
    enabled: config.configured,
    applicationId: config.configured ? config.applicationId : null,
    locationId: config.configured ? config.locationId : null,
    environment: config.environment,
  });
});

app.post("/api/checkout/preview", async (c) => {
  const body = await c.req.json<{
    items: { product_id: string; quantity: number; color?: string | null }[];
    discount_code?: string;
    zip?: string;
    method?: string;
  }>();
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  const quote = await buildQuote(c, { ...body, is_member: !!customer });
  if ("error" in quote) return c.json(quote, 400);
  return c.json(quote);
});

app.post("/api/orders", async (c) => {
  const body = await c.req.json<{
    items: { product_id: string; quantity: number; color?: string | null }[];
    discount_code?: string;
    zip: string;
    method?: string;
    customer_name: string;
    customer_email: string;
    customer_phone?: string;
    shipping_address1: string;
    shipping_address2?: string;
    shipping_city: string;
    shipping_state: string;
    shipping_zip: string;
    shipping_notes?: string;
    delivery_date?: string;
    delivery_window?: string;
    source_id?: string;
    idempotency_key?: string;
    pay_later?: boolean;
  }>();

  if (!body.customer_name || !body.customer_email) {
    return c.json({ error: "Missing required customer fields" }, 400);
  }

  const method = body.method || "delivery";
  if (method === "delivery" && !body.shipping_address1) {
    return c.json({ error: "Delivery address is required" }, 400);
  }
  let deliveryDate: string | null = null;
  let deliveryWindow: string | null = null;
  if (method === "delivery") {
    const windows = parseWindowsJson(
      await getSetting(c.env.DB, "delivery_windows_json", '["9am–12pm","12pm–3pm","3pm–6pm"]'),
    );
    deliveryDate = (body.delivery_date || "").trim() || null;
    deliveryWindow = (body.delivery_window || "").trim() || null;
    if (!deliveryDate || !deliveryWindow) {
      return c.json({ error: "Choose a delivery date and time window" }, 400);
    }
    if (!windows.includes(deliveryWindow)) {
      return c.json({ error: "Invalid delivery window" }, 400);
    }
  }

  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  const square = await getSquareConfig(c.env);

  // No unpaid storefront orders — card payment is required
  if (!square.configured) {
    return c.json(
      { error: "Online payments are not available. Please try again later or call the store." },
      503,
    );
  }
  if (body.pay_later) {
    return c.json({ error: "Pay later is not available. Card payment is required." }, 400);
  }
  if (!body.source_id?.trim()) {
    return c.json({ error: "Card payment required before placing an order" }, 400);
  }

  const quote = await buildQuote(c, {
    items: body.items,
    discount_code: body.discount_code,
    zip: body.shipping_zip || body.zip,
    method,
    is_member: !!customer,
  });
  if ("error" in quote) return c.json(quote, 400);

  const orderId = id("ord");
  const num = orderNumber();

  const paid = await createSquarePayment(c.env, {
    sourceId: body.source_id,
    amountCents: quote.total_cents,
    idempotencyKey: body.idempotency_key || crypto.randomUUID(),
    orderNumber: num,
    customerEmail: body.customer_email,
    customerName: body.customer_name,
    note: `${c.env.STORE_NAME || "Hamilton's Odds N Ends"} order ${num}`,
  });
  if (!paid.ok) {
    return c.json({ error: paid.error }, 402);
  }

  const squarePaymentId = paid.paymentId;
  const paymentStatus = "paid" as const;
  const paymentMethod = "square";

  // Save card on file so delivery adjustments can re-charge / auto-refund
  let squareCustomerId: string | null = null;
  let squareCardId: string | null = null;
  let cardBrand: string | null = null;
  let cardLast4: string | null = null;
  try {
    const sqCustomer = await findOrCreateSquareCustomer(c.env, {
      email: body.customer_email,
      name: body.customer_name,
      phone: body.customer_phone,
      referenceId: customer?.id || num,
    });
    if (sqCustomer.ok) {
      squareCustomerId = sqCustomer.customerId;
      const saved = await saveSquareCardFromPayment(c.env, {
        paymentId: squarePaymentId,
        customerId: sqCustomer.customerId,
        idempotencyKey: `card-${body.idempotency_key || squarePaymentId}`,
      });
      if (saved.ok) {
        squareCardId = saved.cardId;
        cardBrand = saved.brand || null;
        cardLast4 = saved.last4 || null;
      }
    }
  } catch {
    /* card-on-file is best-effort — order still succeeds */
  }

  // Stock check & decrement
  for (const line of quote.lines) {
    const updated = await c.env.DB.prepare(
      `UPDATE products SET stock = stock - ?, updated_at = datetime('now'),
       status = CASE WHEN stock - ? <= 0 THEN 'out_of_stock' ELSE status END
       WHERE id = ? AND stock >= ?`,
    )
      .bind(line.quantity, line.quantity, line.product_id, line.quantity)
      .run();
    if (!updated.meta.changes) {
      return c.json(
        {
          error: `Insufficient stock for ${line.product_name}. Your card was charged — contact the store with payment ${squarePaymentId}.`,
          square_payment_id: squarePaymentId,
          order_number: num,
        },
        409,
      );
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO orders (
      id, order_number, status, payment_status, customer_name, customer_email, customer_phone,
      shipping_address1, shipping_address2, shipping_city, shipping_state, shipping_zip, shipping_notes,
      delivery_zone_id, delivery_method, subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents,
      discount_id, discount_code, customer_id, square_payment_id, payment_method,
      delivery_date, delivery_window, sale_channel,
      square_customer_id, square_card_id, card_brand, card_last4
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?, ?)`,
  )
    .bind(
      orderId,
      num,
      "confirmed",
      paymentStatus,
      body.customer_name,
      body.customer_email,
      body.customer_phone || null,
      body.shipping_address1 || (method === "pickup" ? "Store pickup" : ""),
      body.shipping_address2 || null,
      body.shipping_city || (method === "pickup" ? "Tupelo" : ""),
      body.shipping_state || "MS",
      body.shipping_zip || body.zip || "",
      body.shipping_notes || null,
      null,
      method,
      quote.subtotal_cents,
      quote.discount_cents,
      quote.delivery_cents,
      quote.tax_cents,
      quote.total_cents,
      quote.discount?.id || null,
      quote.discount?.code || null,
      customer?.id || null,
      squarePaymentId,
      paymentMethod,
      deliveryDate,
      deliveryWindow,
      squareCustomerId,
      squareCardId,
      cardBrand,
      cardLast4,
    )
    .run();

  for (const line of quote.lines) {
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

  if (quote.discount?.id) {
    await c.env.DB.prepare(
      `UPDATE discounts SET used_count = used_count + 1 WHERE id = ?`,
    )
      .bind(quote.discount.id)
      .run();
  }

  await addOrderEvent(c.env.DB, orderId, "paid", "Card payment received");
  await addOrderEvent(c.env.DB, orderId, "confirmed", "Order confirmed");
  const windowNote =
    method === "delivery" && deliveryDate
      ? `Scheduled ${deliveryDate}${deliveryWindow ? ` · ${deliveryWindow}` : ""}`
      : undefined;
  await emailOrderIfNeeded(
    c.env,
    await getPublicOrigin(c.env, c.req.url),
    {
      customer_email: body.customer_email,
      order_number: num,
      status: "confirmed",
      total_cents: quote.total_cents,
    },
    "paid",
    windowNote,
  );

  return c.json(
    {
      order_id: orderId,
      order_number: num,
      total_cents: quote.total_cents,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      square_payment_id: squarePaymentId,
    },
    201,
  );
});

app.get("/api/orders/lookup", async (c) => {
  const number = c.req.query("number");
  const email = c.req.query("email");
  if (!number || !email) return c.json({ error: "number and email required" }, 400);
  const order = await c.env.DB.prepare(
    `SELECT id, order_number, status, payment_status, customer_name, delivery_method,
            delivery_date, delivery_window, sale_channel,
            subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents, created_at
     FROM orders WHERE order_number = ? AND lower(customer_email) = lower(?)`,
  )
    .bind(number, email)
    .first();
  if (!order) return c.json({ error: "Order not found" }, 404);
  const orderId = (order as { id: string }).id;
  const { results: items } = await c.env.DB.prepare(
    `SELECT product_name, product_sku, unit_price_cents, quantity, line_total_cents FROM order_items WHERE order_id = ?`,
  )
    .bind(orderId)
    .all();
  const events = await listOrderEvents(c.env.DB, orderId);
  return c.json({ order, items, events });
});

app.get("/api/store", async (c) => {
  const keys = [
    "store_phone",
    "store_email",
    "store_address",
    "site_url",
    "tax_rate_bps",
    "brand_name",
    "brand_sub",
    "topbar_text",
    "hero_kicker",
    "hero_headline",
    "hero_subtext",
    "hero_cta_primary",
    "hero_cta_secondary",
    "hero_image_key",
    "hero_image_position",
    "featured_title",
    "featured_subtitle",
    "auctions_title",
    "auctions_subtitle",
    "offers_title",
    "offers_subtitle",
    "footer_blurb",
  ];
  const settings: Record<string, string> = {};
  for (const key of keys) {
    settings[key] = await getSetting(c.env.DB, key);
  }
  const siteUrl =
    settings.site_url?.trim() ||
    (c.env.PUBLIC_SITE_URL || "").trim() ||
    "https://hamiltonsoddsandends.com";
  return c.json({
    name: settings.brand_name || c.env.STORE_NAME || "Hamilton's Odds N Ends Furniture",
    ...settings,
    site_url: siteUrl.replace(/\/$/, ""),
    hero_image: settings.hero_image_key
      ? `/api/images/${settings.hero_image_key}`
      : null,
  });
});

// ─── Auth ──────────────────────────────────────────────────────────

app.get("/api/admin/setup-status", async (c) => {
  const needs_setup = await adminNeedsSetup(c.env.DB);
  return c.json({ needs_setup, email: OWNER_EMAIL });
});

app.post("/api/admin/setup", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const result = await setupAdminPassword(
    c.env.DB,
    body.email || OWNER_EMAIL,
    body.password || "",
  );
  if ("error" in result) return c.json({ error: result.error }, 400);
  const token = await createSession(c.env.DB, result.admin.id);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({ ok: true, email: result.admin.email });
});

app.post("/api/admin/login", async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  const admin = await verifyAdminLogin(c.env.DB, email || "", password || "");
  if (!admin) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const token = await createSession(c.env.DB, admin.id);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({ ok: true, email: admin.email });
});

app.post("/api/admin/logout", async (c) => {
  const token = getSessionToken(c.req.header("Cookie"));
  await destroySession(c.env.DB, token);
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

app.get("/api/admin/me", async (c) => {
  const token = getSessionToken(c.req.header("Cookie"));
  const session = await validateSession(c.env.DB, token);
  return c.json({
    authenticated: !!session,
    email: session?.email ?? null,
    name: session?.name ?? null,
  });
});

app.post("/api/admin/change-password", requireAdmin, async (c) => {
  const token = getSessionToken(c.req.header("Cookie"));
  const session = await validateSession(c.env.DB, token);
  if (!session?.adminId) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ current_password?: string; new_password?: string }>();
  const result = await changeAdminPassword(
    c.env.DB,
    session.adminId,
    body.current_password || "",
    body.new_password || "",
  );
  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

// ─── Admin: dashboard ──────────────────────────────────────────────

app.get("/api/admin/dashboard", requireAdmin, async (c) => {
  const products = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM products WHERE status != 'archived'`,
  ).first<{ n: number }>();
  const lowStock = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM products WHERE stock <= low_stock_threshold AND status = 'active'`,
  ).first<{ n: number }>();
  const ordersOpen = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM orders WHERE status NOT IN ('delivered','cancelled','refunded')`,
  ).first<{ n: number }>();
  const openIssues = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM delivery_issues WHERE status = 'open'`,
  ).first<{ n: number }>();
  const revenue = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total_cents),0) as n FROM orders WHERE payment_status = 'paid'`,
  ).first<{ n: number }>();
  const recent = await c.env.DB.prepare(
    `SELECT id, order_number, customer_name, status, payment_status, total_cents, created_at
     FROM orders ORDER BY created_at DESC LIMIT 8`,
  ).all();
  const low = await c.env.DB.prepare(
    `SELECT id, name, sku, stock, low_stock_threshold FROM products
     WHERE stock <= low_stock_threshold AND status != 'archived' ORDER BY stock ASC LIMIT 10`,
  ).all();
  return c.json({
    stats: {
      products: products?.n ?? 0,
      low_stock: lowStock?.n ?? 0,
      open_orders: ordersOpen?.n ?? 0,
      open_issues: openIssues?.n ?? 0,
      revenue_cents: revenue?.n ?? 0,
    },
    recent_orders: recent.results,
    low_stock_items: low.results,
  });
});

// ─── Admin: products ───────────────────────────────────────────────

app.get("/api/admin/products", requireAdmin, async (c) => {
  const q = c.req.query("q")?.trim();
  const status = c.req.query("status");
  let sql = `SELECT * FROM products`;
  const where: string[] = [];
  const binds: string[] = [];
  if (q) {
    where.push(`(name LIKE ? OR sku LIKE ? OR brand LIKE ? OR tags LIKE ?)`);
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push(`status = ?`);
    binds.push(status);
  }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY updated_at DESC`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<Product>();
  const products = await attachImages(c, results || []);
  return c.json({ products });
});

app.post("/api/admin/products", requireAdmin, async (c) => {
  const body = await c.req.json<
    Partial<Product> & {
      name: string;
      price_cents: number;
      colors?: string[] | string | null;
    }
  >();
  if (!body.name || body.price_cents == null) {
    return c.json({ error: "name and price_cents required" }, 400);
  }
  const productId = id("prod");
  const sku = body.sku || `HOE-${productId.slice(-8).toUpperCase()}`;
  const slug = body.slug || slugify(body.name) + "-" + productId.slice(-4);
  const colorValue = serializeColors(body.colors ?? body.color ?? null);
  await c.env.DB.prepare(
    `INSERT INTO products (
      id, sku, name, slug, description, category_id, price_cents, compare_at_cents, cost_cents,
      stock, low_stock_threshold, condition, brand, dimensions, weight_lbs, material, color,
      featured, status, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      productId,
      sku,
      body.name,
      slug,
      body.description || "",
      body.category_id || null,
      body.price_cents,
      body.compare_at_cents ?? null,
      body.cost_cents ?? null,
      body.stock ?? 0,
      body.low_stock_threshold ?? 2,
      body.condition || "new",
      body.brand || null,
      body.dimensions || null,
      body.weight_lbs ?? null,
      body.material || null,
      colorValue,
      body.featured ? 1 : 0,
      body.status || "active",
      typeof body.tags === "string" ? body.tags : JSON.stringify(body.tags || []),
    )
    .run();
  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`)
    .bind(productId)
    .first<Product>();
  const [enriched] = await attachImages(c, product ? [product] : []);
  return c.json({ product: enriched }, 201);
});

app.put("/api/admin/products/:id", requireAdmin, async (c) => {
  const productId = c.req.param("id");
  const body = await c.req.json<Partial<Product> & { colors?: string[] | string | null }>();
  const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`)
    .bind(productId)
    .first<Product>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const colorValue =
    body.colors !== undefined || body.color !== undefined
      ? serializeColors(body.colors ?? body.color ?? null)
      : existing.color;

  await c.env.DB.prepare(
    `UPDATE products SET
      sku = COALESCE(?, sku),
      name = COALESCE(?, name),
      slug = COALESCE(?, slug),
      description = COALESCE(?, description),
      category_id = COALESCE(?, category_id),
      price_cents = COALESCE(?, price_cents),
      compare_at_cents = ?,
      cost_cents = ?,
      stock = COALESCE(?, stock),
      low_stock_threshold = COALESCE(?, low_stock_threshold),
      condition = COALESCE(?, condition),
      brand = ?,
      dimensions = ?,
      weight_lbs = ?,
      material = ?,
      color = ?,
      featured = COALESCE(?, featured),
      status = COALESCE(?, status),
      tags = COALESCE(?, tags),
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.sku ?? null,
      body.name ?? null,
      body.slug ?? null,
      body.description ?? null,
      body.category_id ?? null,
      body.price_cents ?? null,
      body.compare_at_cents ?? null,
      body.cost_cents ?? null,
      body.stock ?? null,
      body.low_stock_threshold ?? null,
      body.condition ?? null,
      body.brand ?? null,
      body.dimensions ?? null,
      body.weight_lbs ?? null,
      body.material ?? null,
      colorValue,
      body.featured != null ? (body.featured ? 1 : 0) : null,
      body.status ?? null,
      body.tags != null
        ? typeof body.tags === "string"
          ? body.tags
          : JSON.stringify(body.tags)
        : null,
      productId,
    )
    .run();

  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`)
    .bind(productId)
    .first<Product>();
  const [enriched] = await attachImages(c, product ? [product] : []);
  return c.json({ product: enriched });
});

app.delete("/api/admin/products/:id", requireAdmin, async (c) => {
  const productId = c.req.param("id");
  const { results: imgs } = await c.env.DB.prepare(
    `SELECT r2_key FROM product_images WHERE product_id = ?`,
  )
    .bind(productId)
    .all<{ r2_key: string }>();
  for (const img of imgs || []) {
    await c.env.IMAGES.delete(img.r2_key);
  }
  await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(productId).run();
  return c.json({ ok: true });
});

app.post("/api/admin/products/:id/images", requireAdmin, async (c) => {
  const productId = c.req.param("id");
  const product = await c.env.DB.prepare(`SELECT id FROM products WHERE id = ?`)
    .bind(productId)
    .first();
  if (!product) return c.json({ error: "Product not found" }, 404);

  const form = await c.req.formData();
  const file = form.get("file");
  const isFile =
    !!file &&
    typeof file === "object" &&
    typeof (file as File).arrayBuffer === "function" &&
    typeof (file as File).size === "number";
  if (!isFile) return c.json({ error: "file required" }, 400);
  const upload = file as File;
  if (upload.size > 12 * 1024 * 1024) {
    return c.json(
      { error: "Image too large (max 12MB). Try a smaller photo or use Wi‑Fi." },
      400,
    );
  }
  if (upload.size === 0) {
    return c.json({ error: "Empty file — pick the photo again from Files/Downloads." }, 400);
  }

  const ext = (upload.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `products/${productId}/${crypto.randomUUID()}.${ext || "jpg"}`;
  await c.env.IMAGES.put(key, upload.stream(), {
    httpMetadata: { contentType: upload.type || "image/jpeg" },
  });

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM product_images WHERE product_id = ?`,
  )
    .bind(productId)
    .first<{ n: number }>();
  const imageId = id("img");
  const isPrimary = (count?.n ?? 0) === 0 ? 1 : 0;
  await c.env.DB.prepare(
    `INSERT INTO product_images (id, product_id, r2_key, alt_text, sort_order, is_primary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(imageId, productId, key, form.get("alt")?.toString() || null, count?.n ?? 0, isPrimary)
    .run();

  return c.json({
    image: { id: imageId, r2_key: key, url: `/api/images/${key}`, is_primary: isPrimary },
  }, 201);
});

app.delete("/api/admin/images/:id", requireAdmin, async (c) => {
  const imageId = c.req.param("id");
  const img = await c.env.DB.prepare(`SELECT * FROM product_images WHERE id = ?`)
    .bind(imageId)
    .first<{ id: string; r2_key: string; product_id: string; is_primary: number }>();
  if (!img) return c.json({ error: "Not found" }, 404);
  await c.env.IMAGES.delete(img.r2_key);
  await c.env.DB.prepare(`DELETE FROM product_images WHERE id = ?`).bind(imageId).run();
  if (img.is_primary) {
    await c.env.DB.prepare(
      `UPDATE product_images SET is_primary = 1 WHERE product_id = ? AND id = (
        SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1
      )`,
    )
      .bind(img.product_id, img.product_id)
      .run();
  }
  return c.json({ ok: true });
});

app.post("/api/admin/images/:id/primary", requireAdmin, async (c) => {
  const imageId = c.req.param("id");
  const img = await c.env.DB.prepare(`SELECT * FROM product_images WHERE id = ?`)
    .bind(imageId)
    .first<{ product_id: string }>();
  if (!img) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare(`UPDATE product_images SET is_primary = 0 WHERE product_id = ?`)
    .bind(img.product_id)
    .run();
  await c.env.DB.prepare(`UPDATE product_images SET is_primary = 1 WHERE id = ?`)
    .bind(imageId)
    .run();
  return c.json({ ok: true });
});

// ─── Admin: photo dropspace (phone staging before inventory) ───────

app.get("/api/admin/photo-drop", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, r2_key, note, created_at FROM photo_drop ORDER BY datetime(created_at) DESC LIMIT 200`,
  ).all<{ id: string; r2_key: string; note: string | null; created_at: string }>();
  const photos = (results || []).map((row) => ({
    id: row.id,
    r2_key: row.r2_key,
    note: row.note,
    created_at: row.created_at,
    url: `/api/images/${row.r2_key}`,
  }));
  return c.json({ photos });
});

app.post("/api/admin/photo-drop", requireAdmin, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const note = (form.get("note")?.toString() || "").trim().slice(0, 200) || null;
  const isFile =
    !!file &&
    typeof file === "object" &&
    typeof (file as File).arrayBuffer === "function" &&
    typeof (file as File).size === "number";
  if (!isFile) return c.json({ error: "file required" }, 400);
  const upload = file as File;
  if (upload.size > 12 * 1024 * 1024) {
    return c.json(
      { error: "Image too large (max 12MB). Try a smaller photo or use Wi‑Fi." },
      400,
    );
  }
  if (upload.size === 0) {
    return c.json({ error: "Empty file — take or pick the photo again." }, 400);
  }
  if (upload.type && !upload.type.startsWith("image/")) {
    return c.json({ error: "Please upload an image file" }, 400);
  }

  const ext = (upload.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const photoId = id("drop");
  const key = `drop/${photoId}.${ext || "jpg"}`;
  await c.env.IMAGES.put(key, upload.stream(), {
    httpMetadata: { contentType: upload.type || "image/jpeg" },
  });
  await c.env.DB.prepare(
    `INSERT INTO photo_drop (id, r2_key, note, created_at) VALUES (?, ?, ?, datetime('now'))`,
  )
    .bind(photoId, key, note)
    .run();

  return c.json(
    {
      photo: {
        id: photoId,
        r2_key: key,
        note,
        url: `/api/images/${key}`,
        created_at: new Date().toISOString(),
      },
    },
    201,
  );
});

app.delete("/api/admin/photo-drop/:id", requireAdmin, async (c) => {
  const photoId = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT id, r2_key FROM photo_drop WHERE id = ?`)
    .bind(photoId)
    .first<{ id: string; r2_key: string }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  await c.env.IMAGES.delete(row.r2_key);
  await c.env.DB.prepare(`DELETE FROM photo_drop WHERE id = ?`).bind(photoId).run();
  return c.json({ ok: true });
});

/** Attach a staged dropspace photo onto a product (moves it out of the drop). */
app.post("/api/admin/photo-drop/:id/attach", requireAdmin, async (c) => {
  const photoId = c.req.param("id");
  const body = await c.req.json<{ product_id?: string }>();
  const productId = (body.product_id || "").trim();
  if (!productId) return c.json({ error: "product_id required" }, 400);

  const product = await c.env.DB.prepare(`SELECT id FROM products WHERE id = ?`)
    .bind(productId)
    .first();
  if (!product) return c.json({ error: "Product not found" }, 404);

  const drop = await c.env.DB.prepare(`SELECT id, r2_key, note FROM photo_drop WHERE id = ?`)
    .bind(photoId)
    .first<{ id: string; r2_key: string; note: string | null }>();
  if (!drop) return c.json({ error: "Photo not found in dropspace" }, 404);

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM product_images WHERE product_id = ?`,
  )
    .bind(productId)
    .first<{ n: number }>();
  const imageId = id("img");
  const isPrimary = (count?.n ?? 0) === 0 ? 1 : 0;
  await c.env.DB.prepare(
    `INSERT INTO product_images (id, product_id, r2_key, alt_text, sort_order, is_primary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(imageId, productId, drop.r2_key, drop.note, count?.n ?? 0, isPrimary)
    .run();
  await c.env.DB.prepare(`DELETE FROM photo_drop WHERE id = ?`).bind(photoId).run();

  return c.json({
    ok: true,
    image: {
      id: imageId,
      r2_key: drop.r2_key,
      url: `/api/images/${drop.r2_key}`,
      is_primary: isPrimary,
    },
  });
});

// ─── Admin: categories ─────────────────────────────────────────────

app.post("/api/admin/categories", requireAdmin, async (c) => {
  const body = await c.req.json<{ name: string; description?: string }>();
  const catId = id("cat");
  const slug = slugify(body.name);
  await c.env.DB.prepare(
    `INSERT INTO categories (id, name, slug, description) VALUES (?, ?, ?, ?)`,
  )
    .bind(catId, body.name, slug, body.description || null)
    .run();
  return c.json({ id: catId, slug }, 201);
});

// ─── Admin: discounts ──────────────────────────────────────────────

app.get("/api/admin/discounts", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM discounts ORDER BY created_at DESC`,
  ).all();
  return c.json({ discounts: results });
});

app.post("/api/admin/discounts", requireAdmin, async (c) => {
  const body = await c.req.json<
    Partial<Discount> & {
      name: string;
      type: Discount["type"];
      value: number;
      members_only?: boolean | number;
      show_on_home?: boolean | number;
    }
  >();
  const discId = id("disc");
  await c.env.DB.prepare(
    `INSERT INTO discounts (
      id, code, name, description, type, value, min_order_cents, max_uses,
      product_id, category_id, starts_at, ends_at, active, members_only, show_on_home
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      discId,
      body.code || null,
      body.name,
      body.description || null,
      body.type,
      body.value,
      body.min_order_cents ?? 0,
      body.max_uses ?? null,
      body.product_id || null,
      body.category_id || null,
      body.starts_at || null,
      body.ends_at || null,
      body.active == null ? 1 : body.active ? 1 : 0,
      body.members_only ? 1 : 0,
      body.show_on_home == null || body.show_on_home ? 1 : 0,
    )
    .run();
  return c.json({ id: discId }, 201);
});

app.put("/api/admin/discounts/:id", requireAdmin, async (c) => {
  const discId = c.req.param("id");
  const body = await c.req.json<
    Partial<Discount> & { members_only?: boolean | number; show_on_home?: boolean | number }
  >();
  await c.env.DB.prepare(
    `UPDATE discounts SET
      code = ?, name = COALESCE(?, name), description = ?, type = COALESCE(?, type),
      value = COALESCE(?, value), min_order_cents = COALESCE(?, min_order_cents),
      max_uses = ?, product_id = ?, category_id = ?, starts_at = ?, ends_at = ?,
      active = COALESCE(?, active),
      members_only = COALESCE(?, members_only),
      show_on_home = COALESCE(?, show_on_home)
     WHERE id = ?`,
  )
    .bind(
      body.code ?? null,
      body.name ?? null,
      body.description ?? null,
      body.type ?? null,
      body.value ?? null,
      body.min_order_cents ?? null,
      body.max_uses ?? null,
      body.product_id ?? null,
      body.category_id ?? null,
      body.starts_at ?? null,
      body.ends_at ?? null,
      body.active != null ? (body.active ? 1 : 0) : null,
      body.members_only != null ? (body.members_only ? 1 : 0) : null,
      body.show_on_home != null ? (body.show_on_home ? 1 : 0) : null,
      discId,
    )
    .run();
  return c.json({ ok: true });
});

app.delete("/api/admin/discounts/:id", requireAdmin, async (c) => {
  await c.env.DB.prepare(`DELETE FROM discounts WHERE id = ?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ─── Admin: simple delivery setup ──────────────────────────────────

app.get("/api/admin/delivery", requireAdmin, async (c) => {
  const config = await getDeliveryConfig(c.env.DB);
  return c.json({ config });
});

app.put("/api/admin/delivery", requireAdmin, async (c) => {
  const body = await c.req.json<{
    enabled?: boolean;
    pickup_enabled?: boolean;
    local_zips?: string[] | string;
    extended_zips?: string[] | string;
    local_fee_cents?: number;
    extended_fee_cents?: number;
    per_item_cents?: number;
    free_above_cents?: number | null;
    eta_local?: string;
    eta_extended?: string;
    eta_text?: string;
    outside_message?: string;
    // legacy
    allowed_zips?: string[] | string;
    flat_fee_cents?: number;
  }>();

  const toZips = (raw: string[] | string | undefined) => {
    if (raw == null) return null;
    const list = Array.isArray(raw)
      ? raw
      : String(raw)
          .split(/[\s,]+/)
          .map((z) => z.trim());
    return [...new Set(list.map((z) => normalizeZip(z)).filter((z) => z.length === 5))];
  };

  if (body.enabled != null) await setSetting(c.env.DB, "delivery_enabled", body.enabled ? "1" : "0");
  if (body.pickup_enabled != null) {
    await setSetting(c.env.DB, "delivery_pickup_enabled", body.pickup_enabled ? "1" : "0");
  }

  const local = toZips(body.local_zips ?? body.allowed_zips);
  const extended = toZips(body.extended_zips);
  if (local) {
    await setSetting(c.env.DB, "delivery_local_zips", JSON.stringify(local));
    await setSetting(c.env.DB, "delivery_allowed_zips", JSON.stringify([...local, ...(extended || [])]));
  }
  if (extended) {
    await setSetting(c.env.DB, "delivery_extended_zips", JSON.stringify(extended));
  }

  const localFee = body.local_fee_cents ?? body.flat_fee_cents;
  if (localFee != null) {
    await setSetting(c.env.DB, "delivery_local_fee_cents", String(Math.round(localFee)));
    await setSetting(c.env.DB, "delivery_flat_fee_cents", String(Math.round(localFee)));
  }
  if (body.extended_fee_cents != null) {
    await setSetting(c.env.DB, "delivery_extended_fee_cents", String(Math.round(body.extended_fee_cents)));
  }
  if (body.per_item_cents != null) {
    await setSetting(c.env.DB, "delivery_per_item_cents", String(Math.round(body.per_item_cents)));
  }
  if (body.free_above_cents !== undefined) {
    await setSetting(
      c.env.DB,
      "delivery_free_above_cents",
      body.free_above_cents == null ? "" : String(Math.round(body.free_above_cents)),
    );
  }
  if (body.eta_local != null) await setSetting(c.env.DB, "delivery_eta_local", body.eta_local);
  if (body.eta_extended != null) await setSetting(c.env.DB, "delivery_eta_extended", body.eta_extended);
  if (body.eta_text != null) await setSetting(c.env.DB, "delivery_eta_text", body.eta_text);
  if (body.outside_message != null) {
    await setSetting(c.env.DB, "delivery_outside_message", body.outside_message);
  }

  const config = await getDeliveryConfig(c.env.DB);
  return c.json({ ok: true, config });
});

// ─── Admin: revenue & statements ───────────────────────────────────

app.get("/api/admin/revenue", requireAdmin, async (c) => {
  const from = c.req.query("from") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = c.req.query("to") || new Date().toISOString().slice(0, 10);
  const toEnd = `${to}T23:59:59`;

  const summary = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as order_count,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN subtotal_cents ELSE 0 END), 0) as gross_cents,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN discount_cents ELSE 0 END), 0) as discount_cents,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN delivery_cents ELSE 0 END), 0) as delivery_cents,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN tax_cents ELSE 0 END), 0) as tax_cents,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents ELSE 0 END), 0) as total_cents,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' AND status != 'cancelled' THEN total_cents ELSE 0 END), 0) as paid_cents,
      COALESCE(SUM(CASE WHEN payment_status = 'unpaid' AND status NOT IN ('cancelled','refunded') THEN total_cents ELSE 0 END), 0) as unpaid_cents,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total_cents ELSE 0 END), 0) as cancelled_cents,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_cents ELSE 0 END), 0) as refunded_cents,
      COALESCE(SUM(CASE WHEN delivery_method = 'delivery' AND status != 'cancelled' THEN 1 ELSE 0 END), 0) as delivery_orders,
      COALESCE(SUM(CASE WHEN delivery_method = 'pickup' AND status != 'cancelled' THEN 1 ELSE 0 END), 0) as pickup_orders
     FROM orders
     WHERE date(created_at) >= date(?) AND datetime(created_at) <= datetime(?)`,
  )
    .bind(from, toEnd)
    .first();

  // Your cost (COGS) from product cost × qty sold; profit = merchandise after discounts − cost
  const costRow = await c.env.DB.prepare(
    `SELECT
      COALESCE(SUM(oi.quantity * COALESCE(p.cost_cents, 0)), 0) as cost_of_goods_cents,
      COALESCE(SUM(oi.line_total_cents), 0) as item_revenue_cents,
      COALESCE(SUM(oi.quantity), 0) as units_sold,
      COALESCE(SUM(
        CASE WHEN p.cost_cents IS NULL OR p.cost_cents <= 0 THEN oi.quantity ELSE 0 END
      ), 0) as units_missing_cost
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE date(o.created_at) >= date(?) AND datetime(o.created_at) <= datetime(?)
       AND o.status != 'cancelled'`,
  )
    .bind(from, toEnd)
    .first<{
      cost_of_goods_cents: number;
      item_revenue_cents: number;
      units_sold: number;
      units_missing_cost: number;
    }>();

  const costOfGoods = Number(costRow?.cost_of_goods_cents || 0);
  const grossCents = Number(summary?.gross_cents || 0);
  const discountCents = Number(summary?.discount_cents || 0);
  const merchandiseAfterDiscount = Math.max(0, grossCents - discountCents);
  const profitCents = merchandiseAfterDiscount - costOfGoods;

  const { results: daily } = await c.env.DB.prepare(
    `SELECT
      date(created_at) as day,
      COUNT(*) as orders,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents ELSE 0 END), 0) as total_cents,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' AND status != 'cancelled' THEN total_cents ELSE 0 END), 0) as paid_cents,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN delivery_cents ELSE 0 END), 0) as delivery_cents
     FROM orders
     WHERE date(created_at) >= date(?) AND datetime(created_at) <= datetime(?)
     GROUP BY date(created_at)
     ORDER BY day ASC`,
  )
    .bind(from, toEnd)
    .all();

  const { results: byStatus } = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as n, COALESCE(SUM(total_cents),0) as total_cents
     FROM orders
     WHERE date(created_at) >= date(?) AND datetime(created_at) <= datetime(?)
     GROUP BY status`,
  )
    .bind(from, toEnd)
    .all();

  const { results: topProducts } = await c.env.DB.prepare(
    `SELECT oi.product_name, oi.product_sku,
            SUM(oi.quantity) as qty,
            SUM(oi.line_total_cents) as revenue_cents,
            SUM(oi.quantity * COALESCE(p.cost_cents, 0)) as cost_cents,
            SUM(oi.line_total_cents) - SUM(oi.quantity * COALESCE(p.cost_cents, 0)) as profit_cents
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE date(o.created_at) >= date(?) AND datetime(o.created_at) <= datetime(?)
       AND o.status != 'cancelled'
     GROUP BY oi.product_sku, oi.product_name
     ORDER BY revenue_cents DESC
     LIMIT 10`,
  )
    .bind(from, toEnd)
    .all();

  const { results: orders } = await c.env.DB.prepare(
    `SELECT id, order_number, customer_name, status, payment_status, delivery_method,
            subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents, created_at
     FROM orders
     WHERE date(created_at) >= date(?) AND datetime(created_at) <= datetime(?)
     ORDER BY created_at DESC
     LIMIT 500`,
  )
    .bind(from, toEnd)
    .all();

  return c.json({
    from,
    to,
    summary: {
      ...summary,
      cost_of_goods_cents: costOfGoods,
      profit_cents: profitCents,
      merchandise_after_discount_cents: merchandiseAfterDiscount,
      units_sold: Number(costRow?.units_sold || 0),
      units_missing_cost: Number(costRow?.units_missing_cost || 0),
    },
    daily: daily || [],
    by_status: byStatus || [],
    top_products: topProducts || [],
    orders: orders || [],
  });
});

/** Full inventory / SKU tracker report */
app.get("/api/admin/inventory-report", requireAdmin, async (c) => {
  const status = c.req.query("status")?.trim();
  const q = c.req.query("q")?.trim();
  const stock = c.req.query("stock")?.trim(); // low | out | in | all

  let sql = `
    SELECT
      p.id, p.sku, p.name, p.slug, p.status, p.condition, p.brand,
      p.category_id, c.name as category_name,
      p.price_cents, p.compare_at_cents, p.cost_cents, p.stock, p.low_stock_threshold,
      p.featured, p.updated_at, p.created_at, p.tags,
      COALESCE((
        SELECT SUM(oi.quantity)
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id
          AND o.status NOT IN ('cancelled', 'refunded')
      ), 0) as units_sold,
      COALESCE((
        SELECT SUM(oi.line_total_cents)
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id
          AND o.status NOT IN ('cancelled', 'refunded')
      ), 0) as revenue_cents,
      COALESCE((
        SELECT COUNT(*) FROM product_images img WHERE img.product_id = p.id
      ), 0) as image_count
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE 1=1
  `;
  const binds: string[] = [];
  if (status) {
    sql += ` AND p.status = ?`;
    binds.push(status);
  }
  if (q) {
    sql += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ? OR p.tags LIKE ?)`;
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  if (stock === "out") {
    sql += ` AND p.stock <= 0`;
  } else if (stock === "low") {
    sql += ` AND p.stock > 0 AND p.stock <= p.low_stock_threshold`;
  } else if (stock === "in") {
    sql += ` AND p.stock > 0`;
  }
  sql += ` ORDER BY
    CASE WHEN p.stock <= 0 THEN 0 WHEN p.stock <= p.low_stock_threshold THEN 1 ELSE 2 END,
    p.name ASC`;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<{
      id: string;
      sku: string;
      name: string;
      slug: string;
      status: string;
      condition: string;
      brand: string | null;
      category_id: string | null;
      category_name: string | null;
      price_cents: number;
      compare_at_cents: number | null;
      cost_cents: number | null;
      stock: number;
      low_stock_threshold: number;
      featured: number;
      updated_at: string;
      created_at: string;
      tags: string;
      units_sold: number;
      revenue_cents: number;
      image_count: number;
    }>();

  const items = (results || []).map((row) => {
    const retail = row.price_cents * Math.max(0, row.stock);
    const costVal = (row.cost_cents || 0) * Math.max(0, row.stock);
    const marginUnit =
      row.cost_cents != null && row.cost_cents > 0 ? row.price_cents - row.cost_cents : null;
    let stock_flag: "out" | "low" | "ok" = "ok";
    if (row.stock <= 0) stock_flag = "out";
    else if (row.stock <= (row.low_stock_threshold ?? 2)) stock_flag = "low";
    return {
      ...row,
      retail_value_cents: retail,
      cost_value_cents: costVal,
      margin_unit_cents: marginUnit,
      stock_flag,
    };
  });

  const summary = {
    sku_count: items.length,
    active_count: items.filter((i) => i.status === "active").length,
    draft_count: items.filter((i) => i.status === "draft").length,
    archived_count: items.filter((i) => i.status === "archived").length,
    out_of_stock_count: items.filter((i) => i.stock_flag === "out").length,
    low_stock_count: items.filter((i) => i.stock_flag === "low").length,
    units_on_hand: items.reduce((s, i) => s + Math.max(0, i.stock), 0),
    retail_value_cents: items.reduce((s, i) => s + i.retail_value_cents, 0),
    cost_value_cents: items.reduce((s, i) => s + i.cost_value_cents, 0),
    units_sold_all_time: items.reduce((s, i) => s + Number(i.units_sold || 0), 0),
    revenue_all_time_cents: items.reduce((s, i) => s + Number(i.revenue_cents || 0), 0),
    missing_photos: items.filter((i) => Number(i.image_count) === 0).length,
  };

  return c.json({ summary, items, generated_at: new Date().toISOString() });
});

// ─── Admin: orders ─────────────────────────────────────────────────

app.get("/api/admin/orders", requireAdmin, async (c) => {
  const status = c.req.query("status");
  const q = c.req.query("q")?.trim();
  let sql = `SELECT * FROM orders`;
  const where: string[] = [];
  const binds: string[] = [];
  if (status) {
    where.push(`status = ?`);
    binds.push(status);
  }
  if (q) {
    where.push(`(order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)`);
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY created_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ orders: results });
});

app.get("/api/admin/orders/:id", requireAdmin, async (c) => {
  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(c.req.param("id"))
    .first();
  if (!order) return c.json({ error: "Not found" }, 404);
  const { results: items } = await c.env.DB.prepare(
    `SELECT * FROM order_items WHERE order_id = ?`,
  )
    .bind(c.req.param("id"))
    .all<{
      id: string;
      order_id: string;
      product_id: string | null;
      product_name: string;
      product_sku: string;
      unit_price_cents: number;
      quantity: number;
      line_total_cents: number;
    }>();

  const enriched = [];
  for (const item of items || []) {
    let product: Record<string, unknown> | null = null;
    let image: string | null = null;
    if (item.product_id) {
      product = await c.env.DB.prepare(
        `SELECT id, name, sku, slug, description, condition, brand, dimensions, weight_lbs, material, color, stock
         FROM products WHERE id = ?`,
      )
        .bind(item.product_id)
        .first();
      const img = await c.env.DB.prepare(
        `SELECT r2_key FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC LIMIT 1`,
      )
        .bind(item.product_id)
        .first<{ r2_key: string }>();
      if (img) image = `/api/images/${img.r2_key}`;
    }
    enriched.push({
      ...item,
      image,
      product,
      ship_label: {
        name: item.product_name,
        sku: item.product_sku,
        qty: item.quantity,
        dimensions: (product?.dimensions as string) || null,
        weight_lbs: (product?.weight_lbs as number) || null,
        condition: (product?.condition as string) || null,
        color: product?.color
          ? parseColors(product.color as string).join(", ") || null
          : null,
        material: (product?.material as string) || null,
      },
    });
  }

  return c.json({ order, items: enriched, refunds: await listOrderRefunds(c.env.DB, c.req.param("id")) });
});

async function listOrderRefunds(db: D1Database, orderId: string) {
  const { results } = await db
    .prepare(`SELECT * FROM order_refunds WHERE order_id = ? ORDER BY created_at DESC`)
    .bind(orderId)
    .all();
  return results || [];
}

app.post("/api/admin/orders/:id/refund", requireAdmin, async (c) => {
  const orderId = c.req.param("id");
  const body = await c.req.json<{
    reason?: string;
    amount_cents?: number;
    restore_stock?: boolean;
  }>();

  const reason = (body.reason || "").trim();
  if (reason.length < 3) {
    return c.json({ error: "Refund reason is required (at least 3 characters)" }, 400);
  }

  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      total_cents: number;
      square_payment_id: string | null;
      refunded_cents: number | null;
      admin_notes: string | null;
    }>();
  if (!order) return c.json({ error: "Order not found" }, 404);

  if (order.payment_status === "refunded" || order.status === "refunded") {
    return c.json({ error: "Order is already fully refunded" }, 400);
  }

  const alreadyRefunded = order.refunded_cents || 0;
  const maxRefundable = Math.max(0, order.total_cents - alreadyRefunded);
  if (maxRefundable < 1) {
    return c.json({ error: "Nothing left to refund on this order" }, 400);
  }

  const amountCents =
    body.amount_cents != null ? Math.round(Number(body.amount_cents)) : maxRefundable;
  if (!Number.isFinite(amountCents) || amountCents < 1) {
    return c.json({ error: "Invalid refund amount" }, 400);
  }
  if (amountCents > maxRefundable) {
    return c.json(
      { error: `Refund cannot exceed ${maxRefundable} cents remaining` },
      400,
    );
  }

  let squareRefundId: string | null = null;
  let refundStatus = "completed";

  if (order.square_payment_id && order.payment_status !== "unpaid") {
    const square = await getSquareConfig(c.env);
    if (!square.configured) {
      return c.json({ error: "Square is not configured — cannot refund card payment" }, 503);
    }
    const refunded = await createSquareRefund(c.env, {
      paymentId: order.square_payment_id,
      amountCents,
      reason: `${order.order_number}: ${reason}`,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!refunded.ok) {
      return c.json({ error: refunded.error }, 402);
    }
    squareRefundId = refunded.refundId;
    refundStatus = refunded.status === "PENDING" ? "pending" : "completed";
  }

  const refundId = id("ref");
  const adminEmail = c.get("adminEmail") as string | undefined;
  await c.env.DB.prepare(
    `INSERT INTO order_refunds
      (id, order_id, amount_cents, reason, square_refund_id, square_payment_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      refundId,
      orderId,
      amountCents,
      reason,
      squareRefundId,
      order.square_payment_id || null,
      refundStatus,
      adminEmail || null,
    )
    .run();

  const newRefundedTotal = alreadyRefunded + amountCents;
  const fullyRefunded = newRefundedTotal >= order.total_cents;
  const paymentStatus = fullyRefunded ? "refunded" : "partial";
  const orderStatus = fullyRefunded ? "refunded" : order.status;

  const noteLine = `[Refund ${new Date().toISOString().slice(0, 16)}] $${(amountCents / 100).toFixed(2)} — ${reason}${
    squareRefundId ? ` (Square ${squareRefundId})` : " (manual / no card charge)"
  }`;

  await c.env.DB.prepare(
    `UPDATE orders SET
       refunded_cents = ?,
       refund_reason = ?,
       payment_status = ?,
       status = ?,
       admin_notes = CASE
         WHEN admin_notes IS NULL OR admin_notes = '' THEN ?
         ELSE admin_notes || char(10) || ?
       END,
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      newRefundedTotal,
      reason,
      paymentStatus,
      orderStatus,
      noteLine,
      noteLine,
      orderId,
    )
    .run();

  if (body.restore_stock && fullyRefunded) {
    const { results: items } = await c.env.DB.prepare(
      `SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL`,
    )
      .bind(orderId)
      .all<{ product_id: string; quantity: number }>();
    for (const item of items || []) {
      await c.env.DB.prepare(
        `UPDATE products SET
           stock = stock + ?,
           status = CASE WHEN status = 'out_of_stock' THEN 'active' ELSE status END,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(item.quantity, item.product_id)
        .run();
    }
  }

  const updated = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{
      customer_email: string;
      order_number: string;
      status: string;
      total_cents: number;
    }>();
  const refund = await c.env.DB.prepare(`SELECT * FROM order_refunds WHERE id = ?`)
    .bind(refundId)
    .first();

  if (updated) {
    await addOrderEvent(
      c.env.DB,
      orderId,
      fullyRefunded ? "refunded" : "partial_refund",
      `$${(amountCents / 100).toFixed(2)} — ${reason}`,
    );
    await emailOrderIfNeeded(
      c.env,
      await getPublicOrigin(c.env, c.req.url),
      updated,
      "refunded",
      `Refund amount: $${(amountCents / 100).toFixed(2)}. ${reason}`,
    );
    if (fullyRefunded) {
      await removeOrderFromActiveRoutes(
        c.env.DB,
        orderId,
        `Removed from route — order refunded ($${((amountCents) / 100).toFixed(2)})`,
      );
    }
  }

  return c.json({ order: updated, refund });
});

app.patch("/api/admin/orders/:id", requireAdmin, async (c) => {
  const orderId = c.req.param("id");
  const body = await c.req.json<{
    status?: string;
    payment_status?: string;
    admin_notes?: string;
    delivery_cents?: number;
    delivery_date?: string | null;
    delivery_window?: string | null;
    /** Update totals without charging/refunding (rare override) */
    skip_payment?: boolean;
  }>();
  const before = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{
      status: string;
      customer_email: string;
      customer_name: string;
      order_number: string;
      total_cents: number;
      subtotal_cents: number;
      discount_cents: number;
      delivery_cents: number;
      tax_cents: number;
      payment_status: string;
      square_payment_id: string | null;
      square_customer_id: string | null;
      square_card_id: string | null;
      card_brand: string | null;
      card_last4: string | null;
      refunded_cents: number | null;
    }>();

  if (!before) return c.json({ error: "Order not found" }, 404);

  let paymentAction: {
    type: "charge" | "refund";
    amount_cents: number;
    payment_id?: string;
    refund_id?: string;
  } | null = null;

  if (
    body.delivery_cents != null &&
    Number.isFinite(body.delivery_cents) &&
    Math.round(body.delivery_cents) !== before.delivery_cents &&
    !body.skip_payment
  ) {
    const newDelivery = Math.max(0, Math.round(body.delivery_cents));
    const newTotal =
      before.subtotal_cents - before.discount_cents + newDelivery + before.tax_cents;
    const delta = newTotal - before.total_cents;

    if (delta > 0) {
      if (!before.square_card_id || !before.square_customer_id) {
        return c.json(
          {
            error:
              "No card on file for this order. Newer online orders save the card so extras can be charged. Update with skip_payment, or collect payment another way.",
            needs_card: true,
            delta_cents: delta,
          },
          402,
        );
      }
      const charged = await chargeSquareCardOnFile(c.env, {
        cardId: before.square_card_id,
        customerId: before.square_customer_id,
        amountCents: delta,
        idempotencyKey: crypto.randomUUID(),
        orderNumber: before.order_number,
        customerEmail: before.customer_email,
        note: `Delivery adjustment for ${before.order_number}`,
      });
      if (!charged.ok) {
        return c.json({ error: charged.error, delta_cents: delta }, 402);
      }
      paymentAction = {
        type: "charge",
        amount_cents: delta,
        payment_id: charged.paymentId,
      };
      await addOrderEvent(
        c.env.DB,
        orderId,
        "charge_adjustment",
        `Charged $${(delta / 100).toFixed(2)} for delivery update (Square ${charged.paymentId})`,
      );
    } else if (delta < 0) {
      const refundAmount = Math.abs(delta);
      if (!before.square_payment_id) {
        return c.json(
          {
            error:
              "No Square payment to refund. Use skip_payment to update totals only, or process a manual refund.",
            delta_cents: delta,
          },
          402,
        );
      }
      const refunded = await createSquareRefund(c.env, {
        paymentId: before.square_payment_id,
        amountCents: refundAmount,
        reason: `Delivery charge reduced on ${before.order_number}`,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!refunded.ok) {
        return c.json({ error: refunded.error, delta_cents: delta }, 402);
      }
      paymentAction = {
        type: "refund",
        amount_cents: refundAmount,
        refund_id: refunded.refundId,
      };
      await c.env.DB.prepare(
        `INSERT INTO order_refunds
          (id, order_id, amount_cents, reason, square_refund_id, square_payment_id, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id("ref"),
          orderId,
          refundAmount,
          `Delivery charge reduced`,
          refunded.refundId,
          before.square_payment_id,
          refunded.status,
          "admin",
        )
        .run();
      await c.env.DB.prepare(
        `UPDATE orders SET refunded_cents = COALESCE(refunded_cents, 0) + ? WHERE id = ?`,
      )
        .bind(refundAmount, orderId)
        .run();
      await addOrderEvent(
        c.env.DB,
        orderId,
        "refund_adjustment",
        `Refunded $${(refundAmount / 100).toFixed(2)} for delivery update (Square ${refunded.refundId})`,
      );
    }
  }

  await c.env.DB.prepare(
    `UPDATE orders SET
      status = COALESCE(?, status),
      payment_status = COALESCE(?, payment_status),
      admin_notes = COALESCE(?, admin_notes),
      delivery_cents = COALESCE(?, delivery_cents),
      delivery_date = CASE WHEN ? = 1 THEN ? ELSE delivery_date END,
      delivery_window = CASE WHEN ? = 1 THEN ? ELSE delivery_window END,
      total_cents = CASE WHEN ? IS NOT NULL
        THEN subtotal_cents - discount_cents + COALESCE(?, delivery_cents) + tax_cents
        ELSE total_cents END,
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.status ?? null,
      body.payment_status ?? null,
      body.admin_notes ?? null,
      body.delivery_cents ?? null,
      body.delivery_date !== undefined ? 1 : 0,
      body.delivery_date ?? null,
      body.delivery_window !== undefined ? 1 : 0,
      body.delivery_window ?? null,
      body.delivery_cents ?? null,
      body.delivery_cents ?? null,
      orderId,
    )
    .run();
  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{
      status: string;
      customer_email: string;
      order_number: string;
      total_cents: number;
    }>();

  if (order && body.status && before && before.status !== body.status) {
    await addOrderEvent(c.env.DB, orderId, body.status, "Updated by admin");
    await emailOrderIfNeeded(c.env, await getPublicOrigin(c.env, c.req.url), order, body.status);
    if (body.status === "cancelled" || body.status === "refunded") {
      await removeOrderFromActiveRoutes(
        c.env.DB,
        orderId,
        `Removed from route — order ${body.status}`,
      );
    }
  } else if (
    order &&
    body.payment_status &&
    before &&
    before.payment_status !== body.payment_status
  ) {
    await addOrderEvent(
      c.env.DB,
      orderId,
      `payment_${body.payment_status}`,
      `Payment marked ${body.payment_status} by admin`,
    );
    const kind =
      body.payment_status === "paid"
        ? "paid"
        : body.payment_status === "refunded"
          ? "refunded"
          : "update";
    await emailOrderIfNeeded(
      c.env,
      await getPublicOrigin(c.env, c.req.url),
      order,
      kind,
      `Payment status: ${body.payment_status}`,
    );
    if (body.payment_status === "refunded") {
      await removeOrderFromActiveRoutes(
        c.env.DB,
        orderId,
        "Removed from route — payment marked refunded",
      );
    }
  }

  return c.json({ order, payment_action: paymentAction });
});

app.post("/api/admin/orders/:id/email", requireAdmin, async (c) => {
  const orderId = c.req.param("id");
  const body = await c.req.json<{ kind?: string; message?: string }>().catch(() => ({} as { kind?: string; message?: string }));
  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{
      customer_email: string;
      customer_name: string;
      order_number: string;
      status: string;
      total_cents: number;
    }>();
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (!order.customer_email) return c.json({ error: "Order has no customer email" }, 400);

  const kind = body.kind || (order.status === "delivered" ? "delivered" : "paid");
  const result = await notifyOrderEvent(c.env, {
    customerEmail: order.customer_email,
    customerName: order.customer_name,
    orderNumber: order.order_number,
    status: order.status,
    totalCents: order.total_cents,
    kind,
    origin: await getPublicOrigin(c.env, c.req.url),
    extra: body.message,
    notifyOwner: false,
  });

  if (!result.ok) {
    return c.json(
      {
        error:
          ("error" in result && result.error) ||
          "Customer email failed. Verify your domain in Resend and set From address (e.g. orders@yourdomain.com).",
        result,
      },
      502,
    );
  }
  await addOrderEvent(c.env.DB, orderId, "email_sent", `Customer emailed (${kind})`);
  return c.json({ ok: true, result });
});

// ─── Admin: settings ───────────────────────────────────────────────

app.get("/api/admin/settings", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();
  const settings: Record<string, string> = {};
  for (const row of results || []) settings[row.key] = row.value;

  // Prefill sandbox fields from Worker env when not saved yet (so Settings shows them).
  if (!settings.square_sandbox_application_id?.trim()) {
    settings.square_sandbox_application_id = (c.env.SQUARE_APPLICATION_ID || "").trim();
  }
  if (!settings.square_sandbox_location_id?.trim()) {
    settings.square_sandbox_location_id = (c.env.SQUARE_LOCATION_ID || "").trim();
  }

  // Never send raw access tokens — only whether each is set.
  const liveToken = (settings.square_access_token || "").trim();
  const sandboxTokenSaved = (settings.square_sandbox_access_token || "").trim();
  const sandboxTokenFromEnv = (c.env.SQUARE_ACCESS_TOKEN || "").trim();
  settings.square_access_token_set = liveToken ? "1" : "0";
  settings.square_sandbox_access_token_set =
    sandboxTokenSaved || sandboxTokenFromEnv ? "1" : "0";
  delete settings.square_access_token;
  delete settings.square_sandbox_access_token;

  const square = await getSquareConfig(c.env);
  settings.square_active_environment = square.environment;
  settings.square_active_configured = square.configured ? "1" : "0";
  return c.json({ settings });
});

app.put("/api/admin/settings", requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, string>>();
  // Read-only / derived keys — never persist from the client.
  delete body.square_access_token_set;
  delete body.square_sandbox_access_token_set;
  delete body.square_active_environment;
  delete body.square_active_configured;

  for (const [key, value] of Object.entries(body)) {
    // Keep existing access token if the field was left blank (masked / unchanged).
    if (key === "square_access_token" || key === "square_sandbox_access_token") {
      const next = String(value ?? "").trim();
      if (!next || next.includes("•")) continue;
    }
    await c.env.DB.prepare(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(key, String(value))
      .run();
  }
  return c.json({ ok: true });
});

app.post("/api/admin/hero-image", requireAdmin, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const isFile =
    !!file &&
    typeof file === "object" &&
    typeof (file as File).arrayBuffer === "function" &&
    typeof (file as File).size === "number";
  if (!isFile) return c.json({ error: "file required" }, 400);
  const upload = file as File;
  if (upload.size > 12 * 1024 * 1024) {
    return c.json(
      { error: "Image too large (max 12MB). Try a smaller photo or use Wi‑Fi." },
      400,
    );
  }
  if (upload.size === 0) {
    return c.json({ error: "Empty file — pick the photo again from Files/Downloads." }, 400);
  }
  if (upload.type && !upload.type.startsWith("image/")) {
    return c.json({ error: "Image file required" }, 400);
  }

  const oldKey = await getSetting(c.env.DB, "hero_image_key", "");
  const ext = (upload.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `store/hero-${crypto.randomUUID()}.${ext || "jpg"}`;
  await c.env.IMAGES.put(key, upload.stream(), {
    httpMetadata: { contentType: upload.type || "image/jpeg" },
  });
  await setSetting(c.env.DB, "hero_image_key", key);
  if (oldKey && oldKey !== key) {
    try {
      await c.env.IMAGES.delete(oldKey);
    } catch {
      /* ignore */
    }
  }
  return c.json({
    ok: true,
    hero_image_key: key,
    hero_image: `/api/images/${key}`,
  });
});

app.delete("/api/admin/hero-image", requireAdmin, async (c) => {
  const oldKey = await getSetting(c.env.DB, "hero_image_key", "");
  if (oldKey) {
    try {
      await c.env.IMAGES.delete(oldKey);
    } catch {
      /* ignore */
    }
  }
  await setSetting(c.env.DB, "hero_image_key", "");
  return c.json({ ok: true });
});

// ─── Public: auctions ──────────────────────────────────────────────

async function enrichAuction(c: { env: Env }, auction: Auction) {
  let image: string | null = null;
  let product: { id: string; name: string; slug: string; sku: string } | null = null;
  if (auction.product_id) {
    const p = await c.env.DB.prepare(
      `SELECT id, name, slug, sku FROM products WHERE id = ?`,
    )
      .bind(auction.product_id)
      .first<{ id: string; name: string; slug: string; sku: string }>();
    if (p) product = p;
    const img = await c.env.DB.prepare(
      `SELECT r2_key FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC LIMIT 1`,
    )
      .bind(auction.product_id)
      .first<{ r2_key: string }>();
    if (img) image = `/api/images/${img.r2_key}`;
  }
  const pub = publicAuction(auction);
  const safe = { ...pub } as Record<string, unknown>;
  delete safe.reserve_cents;
  delete safe.winner_email;
  delete safe.winner_phone;
  return {
    ...safe,
    image,
    product,
    has_reserve: auction.reserve_cents != null,
  };
}

app.get("/api/auctions", async (c) => {
  await settleAuctions(c.env, await getPublicOrigin(c.env, c.req.url));
  const status = c.req.query("status"); // live | scheduled | ended | all
  let sql = `SELECT * FROM auctions WHERE status != 'cancelled'`;
  const binds: string[] = [];
  if (status === "live") {
    sql += ` AND status = 'live'`;
  } else if (status === "scheduled") {
    sql += ` AND status = 'scheduled'`;
  } else if (status === "closed") {
    sql += ` AND status IN ('ended','sold')`;
  } else if (status === "all") {
    // no filter beyond cancelled
  } else {
    sql += ` AND status IN ('live','scheduled')`;
  }
  sql += ` ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, ends_at ASC`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<Auction>();
  const auctions = [];
  for (const a of results || []) {
    auctions.push(await enrichAuction(c, a));
  }
  return c.json({ auctions });
});

app.get("/api/auctions/:idOrSlug", async (c) => {
  await settleAuctions(c.env, await getPublicOrigin(c.env, c.req.url));
  const key = c.req.param("idOrSlug");
  const auction = await c.env.DB.prepare(
    `SELECT * FROM auctions WHERE id = ? OR slug = ?`,
  )
    .bind(key, key)
    .first<Auction>();
  if (!auction || auction.status === "cancelled") {
    return c.json({ error: "Auction not found" }, 404);
  }
  const enriched = await enrichAuction(c, auction);
  const { results: bids } = await c.env.DB.prepare(
    `SELECT id, bidder_name, amount_cents, created_at FROM bids
     WHERE auction_id = ? ORDER BY amount_cents DESC, created_at ASC LIMIT 50`,
  )
    .bind(auction.id)
    .all();

  // Mask bidder names slightly for privacy (show first name + last initial)
  const masked = (bids || []).map((b) => {
    const name = String((b as { bidder_name: string }).bidder_name || "Bidder");
    const parts = name.trim().split(/\s+/);
    const maskedName =
      parts.length > 1
        ? `${parts[0]} ${parts[parts.length - 1][0]}.`
        : parts[0];
    return { ...b, bidder_name: maskedName };
  });

  return c.json({
    auction: {
      ...enriched,
      // expose whether reserve met, not the number
      has_reserve: auction.reserve_cents != null,
    },
    bids: masked,
  });
});

app.post("/api/auctions/:id/bid", async (c) => {
  await settleAuctions(c.env, await getPublicOrigin(c.env, c.req.url));
  const auctionId = c.req.param("id");
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  if (!customer) {
    return c.json(
      { error: "Sign in to place a bid", requires_login: true },
      401,
    );
  }

  const body = await c.req.json<{
    amount_cents: number;
    bidder_phone?: string;
  }>();

  const amount = Math.round(Number(body.amount_cents));
  if (!Number.isFinite(amount) || amount < 1) {
    return c.json({ error: "Invalid bid amount" }, 400);
  }

  const auction = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(auctionId)
    .first<Auction>();
  if (!auction) return c.json({ error: "Auction not found" }, 404);
  if (auction.status !== "live") {
    return c.json({ error: "This auction is not open for bidding" }, 409);
  }

  const min = minNextBid(auction);
  if (amount < min) {
    return c.json({ error: `Minimum bid is $${(min / 100).toFixed(2)}`, min_next_bid_cents: min }, 400);
  }

  const bidId = id("bid");
  await c.env.DB.prepare(
    `INSERT INTO bids (id, auction_id, bidder_name, bidder_email, bidder_phone, amount_cents, customer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bidId,
      auction.id,
      customer.name,
      customer.email.toLowerCase(),
      body.bidder_phone?.trim() || customer.phone || null,
      amount,
      customer.id,
    )
    .run();

  // Soft close / anti-snipe: extend 2 minutes if bid in final 2 minutes
  const endsMs = Date.parse(
    auction.ends_at.includes("T") ? auction.ends_at : auction.ends_at.replace(" ", "T") + "Z",
  );
  let newEnds = auction.ends_at;
  if (endsMs - Date.now() < 2 * 60 * 1000) {
    const extended = new Date(Math.max(endsMs, Date.now()) + 2 * 60 * 1000);
    newEnds = extended.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  }

  const reserveMet =
    auction.reserve_cents == null ? 1 : amount >= auction.reserve_cents ? 1 : 0;

  await c.env.DB.prepare(
    `UPDATE auctions SET
      current_bid_cents = ?,
      bid_count = bid_count + 1,
      reserve_met = ?,
      ends_at = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(amount, reserveMet, newEnds, auction.id)
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(auction.id)
    .first<Auction>();

  return c.json(
    {
      ok: true,
      bid_id: bidId,
      auction: updated ? publicAuction(updated) : null,
      message: "You're the high bidder!",
    },
    201,
  );
});

app.post("/api/auctions/:id/buy-now", async (c) => {
  await settleAuctions(c.env, await getPublicOrigin(c.env, c.req.url));
  const auctionId = c.req.param("id");
  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));
  if (!customer) {
    return c.json(
      { error: "Sign in to buy now", requires_login: true },
      401,
    );
  }

  const body = await c.req.json<{
    bidder_phone?: string;
  }>();

  const auction = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(auctionId)
    .first<Auction>();
  if (!auction) return c.json({ error: "Auction not found" }, 404);
  if (auction.status !== "live") {
    return c.json({ error: "Auction is not live" }, 409);
  }
  if (!auction.buy_now_cents) {
    return c.json({ error: "Buy It Now is not available on this auction" }, 400);
  }

  const amount = auction.buy_now_cents;
  const bidId = id("bid");
  await c.env.DB.prepare(
    `INSERT INTO bids (id, auction_id, bidder_name, bidder_email, bidder_phone, amount_cents, customer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bidId,
      auction.id,
      customer.name,
      customer.email.toLowerCase(),
      body.bidder_phone?.trim() || customer.phone || null,
      amount,
      customer.id,
    )
    .run();

  await c.env.DB.prepare(
    `UPDATE auctions SET
      current_bid_cents = ?,
      bid_count = bid_count + 1,
      reserve_met = 1,
      ends_at = datetime('now'),
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(amount, auction.id)
    .run();

  const refreshed = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(auction.id)
    .first<Auction>();
  if (refreshed) await closeAuction(c.env, { ...refreshed, status: "live" }, await getPublicOrigin(c.env, c.req.url));

  const final = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(auction.id)
    .first<Auction>();

  return c.json({ ok: true, auction: final ? publicAuction(final) : null, message: "You won with Buy It Now!" });
});

// ─── Auction winner settlement (pay + pickup/delivery) ─────────────

app.get("/api/auctions/settle/:token", async (c) => {
  const loaded = await loadSettlementByToken(c.env, c.req.param("token"));
  if (!loaded) return c.json({ error: "Settlement not found" }, 404);
  const { auction, order, items } = loaded;
  const deliveryConfig = await getDeliveryConfig(c.env.DB);
  const windows = parseWindowsJson(
    await getSetting(c.env.DB, "delivery_windows_json", '["9am–12pm","12pm–3pm","3pm–6pm"]'),
  );
  const leadDays = Number(await getSetting(c.env.DB, "delivery_lead_days", "1")) || 1;
  const maxDays = Number(await getSetting(c.env.DB, "delivery_max_days", "14")) || 14;
  return c.json({
    auction: {
      id: auction.id,
      title: auction.title,
      slug: auction.slug,
      status: auction.status,
      winner_bid_cents: auction.winner_bid_cents,
      winner_name: auction.winner_name,
    },
    order: {
      order_number: order.order_number,
      payment_status: order.payment_status,
      status: order.status,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      subtotal_cents: order.subtotal_cents,
      delivery_cents: order.delivery_cents,
      tax_cents: order.tax_cents,
      total_cents: order.total_cents,
      delivery_method: order.delivery_method,
    },
    items,
    delivery: {
      enabled: deliveryConfig.enabled,
      pickup_enabled: deliveryConfig.pickup_enabled,
      windows,
      lead_days: leadDays,
      max_days: maxDays,
    },
    paid: order.payment_status === "paid",
  });
});

app.post("/api/auctions/settle/:token/preview", async (c) => {
  const loaded = await loadSettlementByToken(c.env, c.req.param("token"));
  if (!loaded) return c.json({ error: "Settlement not found" }, 404);
  if (loaded.order.payment_status === "paid") {
    return c.json({ error: "Already paid", already_paid: true }, 409);
  }
  const body = await c.req.json<{ method?: string; zip?: string }>();
  const method = body.method === "pickup" ? "pickup" : "delivery";
  const zip = (body.zip || "").trim() || "38801";
  const preview = await previewSettlementDelivery(c.env, {
    bidCents: loaded.order.subtotal_cents,
    method,
    zip,
  });
  if (!preview.ok) return c.json({ error: preview.error }, 400);
  return c.json(preview);
});

app.post("/api/auctions/settle/:token/pay", async (c) => {
  const body = await c.req.json<{
    source_id?: string;
    idempotency_key?: string;
    method?: string;
    zip?: string;
    shipping_address1?: string;
    shipping_address2?: string;
    shipping_city?: string;
    shipping_state?: string;
    shipping_notes?: string;
    delivery_date?: string;
    delivery_window?: string;
    customer_phone?: string;
  }>();

  const method = body.method === "pickup" ? "pickup" : "delivery";
  if (method === "delivery") {
    const windows = parseWindowsJson(
      await getSetting(c.env.DB, "delivery_windows_json", '["9am–12pm","12pm–3pm","3pm–6pm"]'),
    );
    if (body.delivery_window && !windows.includes(body.delivery_window)) {
      return c.json({ error: "Invalid delivery window" }, 400);
    }
  }

  const result = await payAuctionSettlement(c.env, {
    token: c.req.param("token"),
    sourceId: body.source_id || "",
    idempotencyKey: body.idempotency_key || crypto.randomUUID(),
    method,
    zip: body.zip || "38801",
    shipping_address1: body.shipping_address1,
    shipping_address2: body.shipping_address2,
    shipping_city: body.shipping_city,
    shipping_state: body.shipping_state,
    shipping_notes: body.shipping_notes,
    delivery_date: body.delivery_date,
    delivery_window: body.delivery_window,
    customer_phone: body.customer_phone,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  if (!result.already_paid) {
    const order = await c.env.DB.prepare(
      `SELECT customer_email, order_number, status, total_cents FROM orders WHERE id = ?`,
    )
      .bind(result.order_id)
      .first<{
        customer_email: string;
        order_number: string;
        status: string;
        total_cents: number;
      }>();
    if (order) {
      await emailOrderIfNeeded(c.env, await getPublicOrigin(c.env, c.req.url), order, "paid", "Thanks for paying your auction win.");
    }
  }

  return c.json({
    ok: true,
    already_paid: result.already_paid,
    order_number: result.order_number,
    order_id: result.order_id,
    total_cents: "total_cents" in result ? result.total_cents : undefined,
  });
});

// ─── Admin: auctions ───────────────────────────────────────────────

app.get("/api/admin/auctions", requireAdmin, async (c) => {
  await settleAuctions(c.env, await getPublicOrigin(c.env, c.req.url));
  const { results } = await c.env.DB.prepare(
    `SELECT a.*,
            o.order_number as settlement_order_number,
            o.payment_status as settlement_payment_status,
            o.delivery_method as settlement_delivery_method,
            o.total_cents as settlement_total_cents
     FROM auctions a
     LEFT JOIN orders o ON o.id = a.settlement_order_id
     ORDER BY a.created_at DESC`,
  ).all();
  return c.json({ auctions: results || [] });
});

app.get("/api/admin/auctions/:id", requireAdmin, async (c) => {
  await settleAuctions(c.env, await getPublicOrigin(c.env, c.req.url));
  const auction = await c.env.DB.prepare(
    `SELECT a.*,
            o.order_number as settlement_order_number,
            o.payment_status as settlement_payment_status,
            o.status as settlement_order_status,
            o.delivery_method as settlement_delivery_method,
            o.total_cents as settlement_total_cents,
            o.shipping_address1 as settlement_address,
            o.shipping_city as settlement_city,
            o.shipping_state as settlement_state,
            o.shipping_zip as settlement_zip,
            o.delivery_date as settlement_delivery_date,
            o.delivery_window as settlement_delivery_window
     FROM auctions a
     LEFT JOIN orders o ON o.id = a.settlement_order_id
     WHERE a.id = ?`,
  )
    .bind(c.req.param("id"))
    .first();
  if (!auction) return c.json({ error: "Not found" }, 404);
  const { results: bids } = await c.env.DB.prepare(
    `SELECT * FROM bids WHERE auction_id = ? ORDER BY amount_cents DESC, created_at ASC`,
  )
    .bind(c.req.param("id"))
    .all<Bid>();
  const payUrl = (auction as { settlement_token?: string | null }).settlement_token
    ? `${await getPublicOrigin(c.env, c.req.url)}/auctions/pay/${(auction as { settlement_token: string }).settlement_token}`
    : null;
  return c.json({ auction, bids: bids || [], pay_url: payUrl });
});

app.post("/api/admin/auctions/:id/resend-settlement", requireAdmin, async (c) => {
  const auction = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<
      Auction & {
        settlement_order_id: string | null;
        settlement_token: string | null;
      }
    >();
  if (!auction) return c.json({ error: "Not found" }, 404);
  if (auction.status !== "sold" || !auction.winner_email || !auction.winner_bid_cents) {
    return c.json({ error: "No winner to email" }, 400);
  }

  const origin = await getPublicOrigin(c.env, c.req.url);

  // Backfill settlement for auctions sold before this feature
  if (!auction.settlement_token || !auction.settlement_order_id) {
    const high = await c.env.DB.prepare(
      `SELECT * FROM bids WHERE auction_id = ? ORDER BY amount_cents DESC, created_at ASC LIMIT 1`,
    )
      .bind(auction.id)
      .first<{
        bidder_name: string;
        bidder_email: string;
        bidder_phone: string | null;
        amount_cents: number;
        customer_id: string | null;
      }>();
    if (!high) return c.json({ error: "No winning bid found" }, 400);
    await createAuctionSettlement(
      c.env,
      auction,
      {
        id: "backfill",
        auction_id: auction.id,
        bidder_name: high.bidder_name,
        bidder_email: high.bidder_email,
        bidder_phone: high.bidder_phone,
        amount_cents: high.amount_cents,
        created_at: "",
        customer_id: high.customer_id,
      },
      origin,
    );
    const refreshed = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
      .bind(auction.id)
      .first<
        Auction & {
          settlement_order_id: string | null;
          settlement_token: string | null;
        }
      >();
    if (!refreshed?.settlement_token || !refreshed.settlement_order_id) {
      return c.json({ error: "Could not create settlement" }, 500);
    }
    return c.json({ ok: true, created: true, emailed: true });
  }

  const order = await c.env.DB.prepare(
    `SELECT order_number, subtotal_cents, tax_cents, total_cents, payment_status FROM orders WHERE id = ?`,
  )
    .bind(auction.settlement_order_id)
    .first<{
      order_number: string;
      subtotal_cents: number;
      tax_cents: number;
      total_cents: number;
      payment_status: string;
    }>();
  if (!order) return c.json({ error: "Settlement order missing" }, 404);
  if (order.payment_status === "paid") {
    return c.json({ error: "Winner already paid" }, 409);
  }

  const emailed = await sendAuctionWonEmail(c.env, {
    origin,
    token: auction.settlement_token,
    orderNumber: order.order_number,
    winnerName: auction.winner_name || "Winner",
    winnerEmail: auction.winner_email,
    auctionTitle: auction.title,
    bidCents: order.subtotal_cents,
    taxCents: order.tax_cents,
    totalCents: order.total_cents,
  });
  await c.env.DB.prepare(
    `UPDATE auctions SET settlement_email_sent_at = datetime('now') WHERE id = ?`,
  )
    .bind(auction.id)
    .run();

  return c.json({
    ok: true,
    emailed: emailed.ok,
    skipped: "skipped" in emailed ? emailed.skipped : false,
    amount_label: moneyLabel(order.total_cents),
  });
});

app.post("/api/admin/auctions", requireAdmin, async (c) => {
  const body = await c.req.json<{
    title: string;
    description?: string;
    product_id?: string | null;
    starting_bid_cents: number;
    reserve_cents?: number | null;
    bid_increment_cents?: number;
    buy_now_cents?: number | null;
    starts_at: string;
    ends_at: string;
    go_live?: boolean;
  }>();

  if (!body.title || !body.starting_bid_cents || !body.starts_at || !body.ends_at) {
    return c.json({ error: "title, starting bid, start and end times required" }, 400);
  }

  let title = body.title;
  let description = body.description || "";
  if (body.product_id) {
    const p = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`)
      .bind(body.product_id)
      .first<Product>();
    if (p) {
      if (!description) description = p.description;
      if (!title) title = p.name;
    }
  }

  const auctionId = id("auc");
  const slug = auctionSlug(title);
  const starts = body.starts_at.replace("T", " ").slice(0, 19);
  const ends = body.ends_at.replace("T", " ").slice(0, 19);
  const startLive =
    body.go_live || Date.parse(starts.includes("T") ? starts : starts.replace(" ", "T") + "Z") <= Date.now();

  await c.env.DB.prepare(
    `INSERT INTO auctions (
      id, slug, product_id, title, description,
      starting_bid_cents, current_bid_cents, reserve_cents, bid_increment_cents, buy_now_cents,
      starts_at, ends_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      auctionId,
      slug,
      body.product_id || null,
      title,
      description,
      body.starting_bid_cents,
      body.starting_bid_cents,
      body.reserve_cents ?? null,
      body.bid_increment_cents ?? 500,
      body.buy_now_cents ?? null,
      starts,
      ends,
      startLive ? "live" : "scheduled",
    )
    .run();

  return c.json({ id: auctionId, slug }, 201);
});

app.patch("/api/admin/auctions/:id", requireAdmin, async (c) => {
  const auctionId = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    description?: string;
    ends_at?: string;
    reserve_cents?: number | null;
    buy_now_cents?: number | null;
    bid_increment_cents?: number;
    status?: string;
  }>();

  const auction = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(auctionId)
    .first<Auction>();
  if (!auction) return c.json({ error: "Not found" }, 404);

  if (body.status === "cancelled" && ["live", "scheduled"].includes(auction.status)) {
    await c.env.DB.prepare(
      `UPDATE auctions SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(auctionId)
      .run();
    return c.json({ ok: true });
  }

  if (body.status === "ended" && auction.status === "live") {
    await closeAuction(c.env, auction, await getPublicOrigin(c.env, c.req.url));
    return c.json({ ok: true });
  }

  await c.env.DB.prepare(
    `UPDATE auctions SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      ends_at = COALESCE(?, ends_at),
      reserve_cents = ?,
      buy_now_cents = ?,
      bid_increment_cents = COALESCE(?, bid_increment_cents),
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.title ?? null,
      body.description ?? null,
      body.ends_at ? body.ends_at.replace("T", " ").slice(0, 19) : null,
      body.reserve_cents !== undefined ? body.reserve_cents : auction.reserve_cents,
      body.buy_now_cents !== undefined ? body.buy_now_cents : auction.buy_now_cents,
      body.bid_increment_cents ?? null,
      auctionId,
    )
    .run();

  return c.json({ ok: true });
});

app.delete("/api/admin/auctions/:id", requireAdmin, async (c) => {
  await c.env.DB.prepare(`DELETE FROM auctions WHERE id = ?`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ─── Helpers ───────────────────────────────────────────────────────

async function isAdminRequest(c: { req: { header: (n: string) => string | undefined }; env: Env }) {
  const token = getSessionToken(c.req.header("Cookie"));
  return validateSession(c.env.DB, token);
}

async function buildQuote(
  c: { env: Env },
  body: {
    items: { product_id: string; quantity: number; color?: string | null }[];
    discount_code?: string;
    zip?: string;
    method?: string;
    is_member?: boolean;
  },
) {
  if (!body.items?.length) return { error: "Cart is empty" };

  const lines: {
    product_id: string;
    product_name: string;
    product_sku: string;
    unit_price_cents: number;
    quantity: number;
    line_total_cents: number;
    category_id: string | null;
    color: string | null;
  }[] = [];

  const needed = new Map<string, number>();
  for (const item of body.items) {
    const qty = Math.max(1, Math.floor(item.quantity || 1));
    needed.set(item.product_id, (needed.get(item.product_id) || 0) + qty);
  }

  for (const item of body.items) {
    const qty = Math.max(1, Math.floor(item.quantity || 1));
    const product = await c.env.DB.prepare(
      `SELECT * FROM products WHERE id = ? AND status = 'active'`,
    )
      .bind(item.product_id)
      .first<Product>();
    if (!product) return { error: `Product not found: ${item.product_id}` };
    const totalNeeded = needed.get(item.product_id) || qty;
    if (product.stock < totalNeeded) {
      return { error: `Only ${product.stock} left of ${product.name}` };
    }

    const available = parseColors(product.color);
    let color: string | null = item.color?.trim() || null;
    if (color && available.length && !available.some((c) => c.toLowerCase() === color!.toLowerCase())) {
      return { error: `Color "${color}" is not available for ${product.name}` };
    }
    if (!color && available.length === 1) color = available[0];
    if (!color && available.length > 1) {
      return { error: `Please choose a color for ${product.name}` };
    }

    lines.push({
      product_id: product.id,
      product_name: color ? `${product.name} · ${color}` : product.name,
      product_sku: product.sku,
      unit_price_cents: product.price_cents,
      quantity: qty,
      line_total_cents: product.price_cents * qty,
      category_id: product.category_id,
      color,
    });
  }

  const subtotal = lines.reduce((s, l) => s + l.line_total_cents, 0);
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const productIds = lines.map((l) => l.product_id);
  const categoryIds = lines.map((l) => l.category_id).filter(Boolean) as string[];
  const isMember = !!body.is_member;

  let discount: Discount | null = null;
  let discountCents = 0;
  let freeShipping = false;

  // Auto product-specific discounts (skip member-only for guests)
  const { results: autoDiscs } = await c.env.DB.prepare(
    `SELECT * FROM discounts WHERE active = 1 AND code IS NULL AND product_id IS NOT NULL`,
  ).all<Discount>();
  for (const d of autoDiscs || []) {
    if (!isDiscountValid(d)) continue;
    if (d.members_only && !isMember) continue;
    const extra = calcDiscountCents(d, subtotal, itemCount, productIds, categoryIds);
    if (extra > discountCents) {
      discountCents = extra;
      discount = d;
    }
  }

  if (body.discount_code) {
    const coded = await c.env.DB.prepare(
      `SELECT * FROM discounts WHERE upper(code) = upper(?)`,
    )
      .bind(body.discount_code)
      .first<Discount>();
    if (!coded || !isDiscountValid(coded)) return { error: "Invalid or expired promo code" };
    if (coded.members_only && !isMember) {
      return {
        error: "This offer is for account holders only. Create a free account or sign in to use it.",
        members_only: true,
      };
    }
    if (coded.type === "free_shipping") {
      freeShipping = true;
      discount = coded;
    } else {
      const extra = calcDiscountCents(coded, subtotal, itemCount, productIds, categoryIds);
      if (extra <= 0 && coded.min_order_cents > subtotal) {
        return { error: `Minimum order $${(coded.min_order_cents / 100).toFixed(2)} for this code` };
      }
      discountCents = Math.max(discountCents, extra);
      discount = coded;
    }
  }

  const afterDiscount = subtotal - discountCents;
  const config = await getDeliveryConfig(c.env.DB);
  const method = body.method || "delivery";
  const zipNorm = normalizeZip(body.zip || "");

  // Soft preview until a full ZIP is entered
  if (method === "delivery" && zipNorm.length < 5) {
    const taxBps = Number(await getSetting(c.env.DB, "tax_rate_bps", "725"));
    const taxCents = Math.round((afterDiscount * taxBps) / 10000);
    const estimated = freeShipping ? 0 : config.flat_fee_cents;
    return {
      lines,
      subtotal_cents: subtotal,
      discount_cents: discountCents,
      delivery_cents: estimated,
      tax_cents: taxCents,
      total_cents: afterDiscount + estimated + taxCents,
      discount,
      zone: null,
      needs_zip: true,
      in_area: null,
      delivery_config: {
        eta_text: config.eta_text,
        flat_fee_cents: config.flat_fee_cents,
        free_above_cents: config.free_above_cents,
      },
      free_shipping: freeShipping,
    };
  }

  const delivery = resolveDelivery({
    config,
    method,
    zip: zipNorm,
    subtotalAfterDiscount: afterDiscount,
    freeShippingPromo: freeShipping,
    item_count: itemCount,
  });

  if (!delivery.ok) {
    return {
      error: delivery.error || "Delivery not available for this address",
      delivery_blocked: true,
      in_area: delivery.in_area === true,
      outside_message: config.outside_message,
      allowed_hint: `${config.allowed_zips.length} ZIP codes in service area`,
    };
  }

  const deliveryCents = delivery.delivery_cents;
  const taxBps = Number(await getSetting(c.env.DB, "tax_rate_bps", "725"));
  const taxCents = Math.round((afterDiscount * taxBps) / 10000);
  const total = afterDiscount + deliveryCents + taxCents;

  return {
    lines,
    subtotal_cents: subtotal,
    discount_cents: discountCents,
    delivery_cents: deliveryCents,
    tax_cents: taxCents,
    total_cents: total,
    discount,
    zone: null,
    delivery_config: {
      eta_text: config.eta_text,
      flat_fee_cents: config.flat_fee_cents,
      free_above_cents: config.free_above_cents,
    },
    in_area: true,
    free_shipping: freeShipping || deliveryCents === 0,
  };
}

function placeholderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2c3530"/>
      <stop offset="100%" stop-color="#1a1f1c"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <text x="400" y="290" text-anchor="middle" fill="#c4a574" font-family="Georgia, serif" font-size="28">Hamilton's Odds N Ends</text>
  <text x="400" y="330" text-anchor="middle" fill="#8a938c" font-family="system-ui,sans-serif" font-size="16">Photo coming soon</text>
</svg>`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    // Browsers flag plain http:// as "Not secure" — always upgrade.
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
