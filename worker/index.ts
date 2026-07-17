import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Product, Discount } from "./types";
import { id, slugify } from "./types";
import {
  requireAdmin,
  getSessionToken,
  createSession,
  destroySession,
  verifyPassword,
  sessionCookie,
  clearSessionCookie,
  validateSession,
} from "./auth";
import {
  attachImages,
  getSetting,
  setSetting,
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
  settleAuctions,
  closeAuction,
  minNextBid,
  publicAuction,
  auctionSlug,
  type Auction,
  type Bid,
} from "./auction-helpers";
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

type App = { Bindings: Env };

const app = new Hono<App>();

app.use("/api/*", cors({ origin: "*", credentials: true }));

app.get("/api/health", (c) =>
  c.json({ ok: true, store: c.env.STORE_NAME || "Hamilton Odds N Ends Furniture" }),
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
  }>();

  if (!body.customer_name || !body.customer_email || !body.shipping_address1) {
    return c.json({ error: "Missing required customer fields" }, 400);
  }

  const customer = await getCustomerFromRequest(c.env.DB, c.req.header("Cookie"));

  const quote = await buildQuote(c, {
    items: body.items,
    discount_code: body.discount_code,
    zip: body.shipping_zip || body.zip,
    method: body.method,
    is_member: !!customer,
  });
  if ("error" in quote) return c.json(quote, 400);

  const orderId = id("ord");
  const num = orderNumber();

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
      return c.json({ error: `Insufficient stock for ${line.product_name}` }, 409);
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO orders (
      id, order_number, status, payment_status, customer_name, customer_email, customer_phone,
      shipping_address1, shipping_address2, shipping_city, shipping_state, shipping_zip, shipping_notes,
      delivery_zone_id, delivery_method, subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents,
      discount_id, discount_code, customer_id
    ) VALUES (?, ?, 'pending', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      orderId,
      num,
      body.customer_name,
      body.customer_email,
      body.customer_phone || null,
      body.shipping_address1,
      body.shipping_address2 || null,
      body.shipping_city,
      body.shipping_state,
      body.shipping_zip,
      body.shipping_notes || null,
      null,
      body.method || "delivery",
      quote.subtotal_cents,
      quote.discount_cents,
      quote.delivery_cents,
      quote.tax_cents,
      quote.total_cents,
      quote.discount?.id || null,
      quote.discount?.code || null,
      customer?.id || null,
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

  return c.json({ order_id: orderId, order_number: num, total_cents: quote.total_cents }, 201);
});

app.get("/api/orders/lookup", async (c) => {
  const number = c.req.query("number");
  const email = c.req.query("email");
  if (!number || !email) return c.json({ error: "number and email required" }, 400);
  const order = await c.env.DB.prepare(
    `SELECT id, order_number, status, payment_status, customer_name, delivery_method,
            subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents, created_at
     FROM orders WHERE order_number = ? AND lower(customer_email) = lower(?)`,
  )
    .bind(number, email)
    .first();
  if (!order) return c.json({ error: "Order not found" }, 404);
  const { results: items } = await c.env.DB.prepare(
    `SELECT product_name, product_sku, unit_price_cents, quantity, line_total_cents FROM order_items WHERE order_id = ?`,
  )
    .bind((order as { id: string }).id)
    .all();
  return c.json({ order, items });
});

app.get("/api/store", async (c) => {
  const keys = ["store_phone", "store_email", "store_address", "tax_rate_bps"];
  const settings: Record<string, string> = {};
  for (const key of keys) {
    settings[key] = await getSetting(c.env.DB, key);
  }
  return c.json({
    name: c.env.STORE_NAME || "Hamilton Odds N Ends Furniture",
    ...settings,
  });
});

// ─── Auth ──────────────────────────────────────────────────────────

app.post("/api/admin/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (!(await verifyPassword(c.env, password || ""))) {
    return c.json({ error: "Invalid password" }, 401);
  }
  const token = await createSession(c.env.DB);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({ ok: true });
});

app.post("/api/admin/logout", async (c) => {
  const token = getSessionToken(c.req.header("Cookie"));
  await destroySession(c.env.DB, token);
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

app.get("/api/admin/me", async (c) => {
  const token = getSessionToken(c.req.header("Cookie"));
  const ok = await validateSession(c.env.DB, token);
  return c.json({ authenticated: ok });
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
    where.push(`(name LIKE ? OR sku LIKE ?)`);
    binds.push(`%${q}%`, `%${q}%`);
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
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  if (file.size > 8 * 1024 * 1024) return c.json({ error: "Max 8MB" }, 400);

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `products/${productId}/${crypto.randomUUID()}.${ext || "jpg"}`;
  await c.env.IMAGES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "image/jpeg" },
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
    Partial<Discount> & { name: string; type: Discount["type"]; value: number; members_only?: boolean | number }
  >();
  const discId = id("disc");
  await c.env.DB.prepare(
    `INSERT INTO discounts (
      id, code, name, description, type, value, min_order_cents, max_uses,
      product_id, category_id, starts_at, ends_at, active, members_only
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    )
    .run();
  return c.json({ id: discId }, 201);
});

app.put("/api/admin/discounts/:id", requireAdmin, async (c) => {
  const discId = c.req.param("id");
  const body = await c.req.json<Partial<Discount> & { members_only?: boolean | number }>();
  await c.env.DB.prepare(
    `UPDATE discounts SET
      code = ?, name = COALESCE(?, name), description = ?, type = COALESCE(?, type),
      value = COALESCE(?, value), min_order_cents = COALESCE(?, min_order_cents),
      max_uses = ?, product_id = ?, category_id = ?, starts_at = ?, ends_at = ?,
      active = COALESCE(?, active),
      members_only = COALESCE(?, members_only)
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
            SUM(oi.line_total_cents) as revenue_cents
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
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
    summary,
    daily: daily || [],
    by_status: byStatus || [],
    top_products: topProducts || [],
    orders: orders || [],
  });
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

  return c.json({ order, items: enriched });
});

app.patch("/api/admin/orders/:id", requireAdmin, async (c) => {
  const orderId = c.req.param("id");
  const body = await c.req.json<{
    status?: string;
    payment_status?: string;
    admin_notes?: string;
    delivery_cents?: number;
  }>();
  await c.env.DB.prepare(
    `UPDATE orders SET
      status = COALESCE(?, status),
      payment_status = COALESCE(?, payment_status),
      admin_notes = COALESCE(?, admin_notes),
      delivery_cents = COALESCE(?, delivery_cents),
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
      body.delivery_cents ?? null,
      body.delivery_cents ?? null,
      orderId,
    )
    .run();
  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(orderId)
    .first();
  return c.json({ order });
});

// ─── Admin: settings ───────────────────────────────────────────────

app.get("/api/admin/settings", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT key, value FROM store_settings`).all<{
    key: string;
    value: string;
  }>();
  const settings: Record<string, string> = {};
  for (const row of results || []) settings[row.key] = row.value;
  return c.json({ settings });
});

app.put("/api/admin/settings", requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, string>>();
  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
      .bind(key, String(value))
      .run();
  }
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
  await settleAuctions(c.env.DB);
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
  await settleAuctions(c.env.DB);
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
  await settleAuctions(c.env.DB);
  const auctionId = c.req.param("id");
  const body = await c.req.json<{
    amount_cents: number;
    bidder_name: string;
    bidder_email: string;
    bidder_phone?: string;
  }>();

  if (!body.bidder_name?.trim() || !body.bidder_email?.trim()) {
    return c.json({ error: "Name and email are required to bid" }, 400);
  }
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
    `INSERT INTO bids (id, auction_id, bidder_name, bidder_email, bidder_phone, amount_cents)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bidId,
      auction.id,
      body.bidder_name.trim(),
      body.bidder_email.trim().toLowerCase(),
      body.bidder_phone?.trim() || null,
      amount,
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
  await settleAuctions(c.env.DB);
  const auctionId = c.req.param("id");
  const body = await c.req.json<{
    bidder_name: string;
    bidder_email: string;
    bidder_phone?: string;
  }>();

  if (!body.bidder_name?.trim() || !body.bidder_email?.trim()) {
    return c.json({ error: "Name and email are required" }, 400);
  }

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
    `INSERT INTO bids (id, auction_id, bidder_name, bidder_email, bidder_phone, amount_cents)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      bidId,
      auction.id,
      body.bidder_name.trim(),
      body.bidder_email.trim().toLowerCase(),
      body.bidder_phone?.trim() || null,
      amount,
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
  if (refreshed) await closeAuction(c.env.DB, { ...refreshed, status: "live" });

  const final = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(auction.id)
    .first<Auction>();

  return c.json({ ok: true, auction: final ? publicAuction(final) : null, message: "You won with Buy It Now!" });
});

// ─── Admin: auctions ───────────────────────────────────────────────

app.get("/api/admin/auctions", requireAdmin, async (c) => {
  await settleAuctions(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM auctions ORDER BY created_at DESC`,
  ).all<Auction>();
  return c.json({ auctions: results || [] });
});

app.get("/api/admin/auctions/:id", requireAdmin, async (c) => {
  await settleAuctions(c.env.DB);
  const auction = await c.env.DB.prepare(`SELECT * FROM auctions WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<Auction>();
  if (!auction) return c.json({ error: "Not found" }, 404);
  const { results: bids } = await c.env.DB.prepare(
    `SELECT * FROM bids WHERE auction_id = ? ORDER BY amount_cents DESC, created_at ASC`,
  )
    .bind(auction.id)
    .all<Bid>();
  return c.json({ auction, bids: bids || [] });
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
    await closeAuction(c.env.DB, auction);
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
  <text x="400" y="290" text-anchor="middle" fill="#c4a574" font-family="Georgia, serif" font-size="28">Hamilton Odds N Ends</text>
  <text x="400" y="330" text-anchor="middle" fill="#8a938c" font-family="system-ui,sans-serif" font-size="16">Photo coming soon</text>
</svg>`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
