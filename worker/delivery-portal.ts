import { Hono } from "hono";
import type { Env } from "./types";
import { id } from "./types";
import { requireAdmin } from "./auth";
import {
  requireDriver,
  createDriver,
  verifyDriverLogin,
  createDriverSession,
  destroyDriverSession,
  getDriverSessionToken,
  validateDriverSession,
  driverSessionCookie,
  clearDriverSessionCookie,
  setDriverPassword,
  DRIVER_STOP_STATUSES,
  DRIVER_ISSUE_TYPES,
} from "./driver-auth";
import {
  listAssignableOrders,
  getRouteWithStops,
  createRoute,
  autoAssignRoutes,
  orderStatusForStop,
  markOrdersOutForDelivery,
  refreshRouteProgress,
  stripDeliveryGeoForDriver,
} from "./routes-helpers";
import { addOrderEvent } from "./order-events";
import { emailOrderIfNeeded } from "./email";
import { getPublicOrigin } from "./helpers";

type App = { Bindings: Env; Variables: Record<string, unknown> };

export const deliveryPortal = new Hono<App>();

// ─── Driver auth ───────────────────────────────────────────────────

deliveryPortal.post("/api/driver/login", async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  const driver = await verifyDriverLogin(c.env.DB, email || "", password || "");
  if (!driver) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const token = await createDriverSession(c.env.DB, driver.id);
  c.header("Set-Cookie", driverSessionCookie(token));
  return c.json({ ok: true, email: driver.email, name: driver.name });
});

deliveryPortal.post("/api/driver/logout", async (c) => {
  const token = getDriverSessionToken(c.req.header("Cookie"));
  const session = await validateDriverSession(c.env.DB, token);
  if (session?.driverId) {
    await c.env.DB.prepare(`DELETE FROM driver_presence WHERE driver_id = ?`)
      .bind(session.driverId)
      .run();
  }
  await destroyDriverSession(c.env.DB, token);
  c.header("Set-Cookie", clearDriverSessionCookie());
  return c.json({ ok: true });
});

deliveryPortal.get("/api/driver/me", async (c) => {
  const token = getDriverSessionToken(c.req.header("Cookie"));
  const session = await validateDriverSession(c.env.DB, token);
  return c.json({
    authenticated: !!session,
    email: session?.email ?? null,
    name: session?.name ?? null,
    driver_id: session?.driverId ?? null,
  });
});

// ─── Driver portal (status + issues only) ──────────────────────────

deliveryPortal.get("/api/driver/routes", requireDriver, async (c) => {
  const driverId = c.get("driverId") as string;
  const date = c.req.query("date");
  let sql = `
    SELECT r.*,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id) as stop_count,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'delivered') as delivered_count,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'failed') as failed_count,
      (SELECT COUNT(*) FROM delivery_issues i WHERE i.route_id = r.id AND i.status = 'open') as open_issue_count
    FROM delivery_routes r
    WHERE r.driver_id = ? AND r.status IN ('assigned', 'in_progress', 'completed')
  `;
  const binds: string[] = [driverId];
  if (date) {
    sql += ` AND r.route_date = ?`;
    binds.push(date);
  }
  sql += ` ORDER BY r.route_date DESC, r.created_at DESC LIMIT 50`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ routes: results || [] });
});

deliveryPortal.get("/api/driver/routes/:id", requireDriver, async (c) => {
  const driverId = c.get("driverId") as string;
  const detail = await getRouteWithStops(c.env.DB, c.req.param("id"));
  if (!detail) return c.json({ error: "Route not found" }, 404);
  if ((detail.route as { driver_id?: string }).driver_id !== driverId) {
    return c.json({ error: "Not your route" }, 403);
  }
  return c.json(stripDeliveryGeoForDriver(detail));
});

deliveryPortal.patch("/api/driver/stops/:id", requireDriver, async (c) => {
  const driverId = c.get("driverId") as string;
  const stopId = c.req.param("id");
  const body = await c.req.json<{
    status?: string;
    driver_note?: string;
    lat?: number;
    lng?: number;
    accuracy_m?: number;
  }>();
  const status = body.status || "";
  if (!DRIVER_STOP_STATUSES.includes(status as (typeof DRIVER_STOP_STATUSES)[number])) {
    return c.json({ error: "Invalid stop status" }, 400);
  }

  const stop = await c.env.DB.prepare(
    `SELECT s.*, r.driver_id, r.id as route_id, r.status as route_status
     FROM delivery_route_stops s
     JOIN delivery_routes r ON r.id = s.route_id
     WHERE s.id = ?`,
  )
    .bind(stopId)
    .first<{
      id: string;
      order_id: string;
      route_id: string;
      driver_id: string | null;
      route_status: string;
      status: string;
    }>();

  if (!stop) return c.json({ error: "Stop not found" }, 404);
  if (stop.driver_id !== driverId) {
    return c.json({ error: "Not your stop" }, 403);
  }
  if (stop.route_status === "cancelled") {
    return c.json({ error: "Route is cancelled" }, 400);
  }

  const deliveredAt = status === "delivered" ? new Date().toISOString() : null;
  const hasGeo =
    status === "delivered" &&
    typeof body.lat === "number" &&
    typeof body.lng === "number" &&
    Number.isFinite(body.lat) &&
    Number.isFinite(body.lng) &&
    body.lat >= -90 &&
    body.lat <= 90 &&
    body.lng >= -180 &&
    body.lng <= 180;

  const lat = hasGeo ? body.lat! : null;
  const lng = hasGeo ? body.lng! : null;
  const accuracy =
    hasGeo && typeof body.accuracy_m === "number" && Number.isFinite(body.accuracy_m)
      ? body.accuracy_m
      : null;
  const geoAt = hasGeo ? new Date().toISOString() : null;

  await c.env.DB.prepare(
    `UPDATE delivery_route_stops
     SET status = ?,
         driver_note = COALESCE(?, driver_note),
         delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
         delivered_lat = CASE WHEN ? IS NOT NULL THEN ? ELSE delivered_lat END,
         delivered_lng = CASE WHEN ? IS NOT NULL THEN ? ELSE delivered_lng END,
         delivered_accuracy_m = CASE WHEN ? IS NOT NULL THEN ? ELSE delivered_accuracy_m END,
         delivered_geo_at = CASE WHEN ? IS NOT NULL THEN ? ELSE delivered_geo_at END,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      status,
      body.driver_note ?? null,
      status,
      deliveredAt,
      lat,
      lat,
      lng,
      lng,
      accuracy,
      accuracy,
      geoAt,
      geoAt,
      stopId,
    )
    .run();

  // Drivers may only update order delivery progress — never payment, prices, etc.
  const orderStatus = orderStatusForStop(status);
  if (orderStatus) {
    const before = await c.env.DB.prepare(
      `SELECT customer_email, order_number, total_cents, status FROM orders WHERE id = ?`,
    )
      .bind(stop.order_id)
      .first<{
        customer_email: string;
        order_number: string;
        total_cents: number;
        status: string;
      }>();
    await c.env.DB.prepare(
      `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(orderStatus, stop.order_id)
      .run();
    if (before && before.status !== orderStatus) {
      await addOrderEvent(c.env.DB, stop.order_id, orderStatus, `Driver marked stop ${status}`);
      if (orderStatus === "delivered" || orderStatus === "out_for_delivery") {
        await emailOrderIfNeeded(
          c.env,
          await getPublicOrigin(c.env, c.req.url),
          { ...before, status: orderStatus },
          orderStatus,
        );
      }
    }
  }

  // Promote / complete route based on remaining stops
  await refreshRouteProgress(c.env.DB, stop.route_id);

  const detail = await getRouteWithStops(c.env.DB, stop.route_id);
  return c.json(detail ? stripDeliveryGeoForDriver(detail) : detail);
});

/** Live GPS heartbeat while driver is working a route */
deliveryPortal.post("/api/driver/location", requireDriver, async (c) => {
  const driverId = c.get("driverId") as string;
  const body = await c.req.json<{
    lat?: number;
    lng?: number;
    accuracy_m?: number | null;
    heading?: number | null;
    speed_mps?: number | null;
    route_id?: string | null;
    stop_id?: string | null;
  }>();

  const lat = body.lat;
  const lng = body.lng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return c.json({ error: "Valid lat/lng required" }, 400);
  }

  let routeId = body.route_id || null;
  let stopId = body.stop_id || null;

  if (routeId) {
    const route = await c.env.DB.prepare(
      `SELECT id, driver_id, status FROM delivery_routes WHERE id = ?`,
    )
      .bind(routeId)
      .first<{ id: string; driver_id: string | null; status: string }>();
    if (!route || route.driver_id !== driverId) {
      return c.json({ error: "Not your route" }, 403);
    }
  } else {
    // Prefer today's active route
    const today = new Date().toISOString().slice(0, 10);
    const active = await c.env.DB.prepare(
      `SELECT id FROM delivery_routes
       WHERE driver_id = ? AND route_date = ? AND status IN ('assigned','in_progress')
       ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
    )
      .bind(driverId, today)
      .first<{ id: string }>();
    routeId = active?.id || null;
  }

  if (stopId && routeId) {
    const stop = await c.env.DB.prepare(
      `SELECT id FROM delivery_route_stops WHERE id = ? AND route_id = ?`,
    )
      .bind(stopId, routeId)
      .first();
    if (!stop) stopId = null;
  }

  const accuracy =
    typeof body.accuracy_m === "number" && Number.isFinite(body.accuracy_m)
      ? body.accuracy_m
      : null;
  const heading =
    typeof body.heading === "number" && Number.isFinite(body.heading) ? body.heading : null;
  const speed =
    typeof body.speed_mps === "number" && Number.isFinite(body.speed_mps) ? body.speed_mps : null;

  await c.env.DB.prepare(
    `INSERT INTO driver_presence (
       driver_id, lat, lng, accuracy_m, heading, speed_mps, route_id, stop_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(driver_id) DO UPDATE SET
       lat = excluded.lat,
       lng = excluded.lng,
       accuracy_m = excluded.accuracy_m,
       heading = excluded.heading,
       speed_mps = excluded.speed_mps,
       route_id = excluded.route_id,
       stop_id = excluded.stop_id,
       updated_at = datetime('now')`,
  )
    .bind(driverId, lat, lng, accuracy, heading, speed, routeId, stopId)
    .run();

  return c.json({ ok: true });
});

deliveryPortal.delete("/api/driver/location", requireDriver, async (c) => {
  const driverId = c.get("driverId") as string;
  await c.env.DB.prepare(`DELETE FROM driver_presence WHERE driver_id = ?`).bind(driverId).run();
  return c.json({ ok: true });
});

deliveryPortal.post("/api/driver/issues", requireDriver, async (c) => {
  const driverId = c.get("driverId") as string;
  const body = await c.req.json<{
    order_id?: string;
    stop_id?: string;
    route_id?: string;
    issue_type?: string;
    message?: string;
  }>();

  const issueType = body.issue_type || "other";
  if (!DRIVER_ISSUE_TYPES.includes(issueType as (typeof DRIVER_ISSUE_TYPES)[number])) {
    return c.json({ error: "Invalid issue type" }, 400);
  }
  const message = (body.message || "").trim();
  if (!message) return c.json({ error: "Describe the issue" }, 400);

  let orderId = body.order_id || "";
  let routeId = body.route_id || null;
  let stopId = body.stop_id || null;

  if (stopId) {
    const stop = await c.env.DB.prepare(
      `SELECT s.order_id, s.route_id, r.driver_id
       FROM delivery_route_stops s
       JOIN delivery_routes r ON r.id = s.route_id
       WHERE s.id = ?`,
    )
      .bind(stopId)
      .first<{ order_id: string; route_id: string; driver_id: string | null }>();
    if (!stop || stop.driver_id !== driverId) {
      return c.json({ error: "Stop not found" }, 404);
    }
    orderId = stop.order_id;
    routeId = stop.route_id;
  } else if (orderId) {
    // Ensure this order is on one of the driver's routes
    const owned = await c.env.DB.prepare(
      `SELECT s.id, s.route_id FROM delivery_route_stops s
       JOIN delivery_routes r ON r.id = s.route_id
       WHERE s.order_id = ? AND r.driver_id = ?
       ORDER BY s.created_at DESC LIMIT 1`,
    )
      .bind(orderId, driverId)
      .first<{ id: string; route_id: string }>();
    if (!owned) return c.json({ error: "Order is not on your route" }, 403);
    stopId = owned.id;
    routeId = owned.route_id;
  } else {
    return c.json({ error: "order_id or stop_id required" }, 400);
  }

  const issueId = id("issue");
  await c.env.DB.prepare(
    `INSERT INTO delivery_issues
      (id, order_id, route_id, stop_id, driver_id, issue_type, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
  )
    .bind(issueId, orderId, routeId, stopId, driverId, issueType, message)
    .run();

  // Mark stop failed when reporting a delivery problem
  if (stopId) {
    await c.env.DB.prepare(
      `UPDATE delivery_route_stops
       SET status = CASE WHEN status = 'delivered' THEN status ELSE 'failed' END,
           driver_note = COALESCE(driver_note || ' · ', '') || ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(`Issue: ${issueType}`, stopId)
      .run();
  }

  // Flip order back to processing so admin can reassign; note keeps the report trail
  const noteLine = `[Driver report ${new Date().toISOString().slice(0, 16)}] ${issueType.replaceAll("_", " ")}: ${message}`;
  await c.env.DB.prepare(
    `UPDATE orders
     SET status = 'processing',
         admin_notes = CASE
           WHEN admin_notes IS NULL OR admin_notes = '' THEN ?
           ELSE admin_notes || char(10) || ?
         END,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(noteLine, noteLine, orderId)
    .run();

  if (routeId) {
    await refreshRouteProgress(c.env.DB, routeId);
  }

  const issue = await c.env.DB.prepare(`SELECT * FROM delivery_issues WHERE id = ?`)
    .bind(issueId)
    .first();
  return c.json({ issue });
});

deliveryPortal.get("/api/driver/issues", requireDriver, async (c) => {
  const driverId = c.get("driverId") as string;
  const { results } = await c.env.DB.prepare(
    `SELECT i.*, o.order_number, o.customer_name
     FROM delivery_issues i
     JOIN orders o ON o.id = i.order_id
     WHERE i.driver_id = ?
     ORDER BY i.created_at DESC LIMIT 50`,
  )
    .bind(driverId)
    .all();
  return c.json({ issues: results || [] });
});

// ─── Admin: drivers ────────────────────────────────────────────────

deliveryPortal.get("/api/admin/drivers", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, name, phone, active, created_at, updated_at
     FROM drivers ORDER BY name ASC`,
  ).all();
  return c.json({ drivers: results || [] });
});

deliveryPortal.post("/api/admin/drivers", requireAdmin, async (c) => {
  const body = await c.req.json<{
    email?: string;
    name?: string;
    phone?: string;
    password?: string;
  }>();
  const result = await createDriver(c.env.DB, {
    email: body.email || "",
    name: body.name || "",
    phone: body.phone,
    password: body.password || "",
  });
  if ("error" in result) return c.json({ error: result.error }, 400);
  return c.json(result);
});

deliveryPortal.patch("/api/admin/drivers/:id", requireAdmin, async (c) => {
  const driverId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    phone?: string | null;
    active?: boolean;
    password?: string;
  }>();

  const existing = await c.env.DB.prepare(`SELECT id FROM drivers WHERE id = ?`)
    .bind(driverId)
    .first();
  if (!existing) return c.json({ error: "Driver not found" }, 404);

  if (body.password) {
    const pw = await setDriverPassword(c.env.DB, driverId, body.password);
    if ("error" in pw) return c.json({ error: pw.error }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE drivers SET
       name = COALESCE(?, name),
       phone = CASE WHEN ? THEN ? ELSE phone END,
       active = COALESCE(?, active),
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.name?.trim() || null,
      body.phone !== undefined ? 1 : 0,
      body.phone ?? null,
      body.active === undefined ? null : body.active ? 1 : 0,
      driverId,
    )
    .run();

  const driver = await c.env.DB.prepare(
    `SELECT id, email, name, phone, active, created_at, updated_at FROM drivers WHERE id = ?`,
  )
    .bind(driverId)
    .first();
  return c.json({ driver });
});

/** Live fleet board — routes + last GPS ping */
deliveryPortal.get("/api/admin/drivers/live", requireAdmin, async (c) => {
  const date = (c.req.query("date") || new Date().toISOString().slice(0, 10)).trim();

  const { results: routes } = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.route_date, r.status, r.driver_id, r.updated_at,
            d.name as driver_name, d.email as driver_email, d.phone as driver_phone, d.active as driver_active,
            p.lat, p.lng, p.accuracy_m, p.heading, p.speed_mps, p.updated_at as presence_at,
            p.stop_id as presence_stop_id,
            CASE WHEN p.updated_at IS NULL THEN NULL
                 ELSE CAST((julianday('now') - julianday(p.updated_at)) * 86400 AS INTEGER)
            END as presence_age_sec,
            (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id) as stop_count,
            (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'delivered') as delivered_count,
            (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'en_route') as en_route_count,
            (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'failed') as failed_count,
            (SELECT COUNT(*) FROM delivery_issues i WHERE i.route_id = r.id AND i.status = 'open') as open_issue_count
     FROM delivery_routes r
     LEFT JOIN drivers d ON d.id = r.driver_id
     LEFT JOIN driver_presence p ON p.driver_id = r.driver_id
     WHERE r.route_date = ?
       AND r.status IN ('assigned', 'in_progress', 'completed')
     ORDER BY
       CASE r.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END,
       d.name ASC,
       r.name ASC`,
  )
    .bind(date)
    .all<{
      id: string;
      name: string;
      route_date: string;
      status: string;
      driver_id: string | null;
      updated_at: string;
      driver_name: string | null;
      driver_email: string | null;
      driver_phone: string | null;
      driver_active: number | null;
      lat: number | null;
      lng: number | null;
      accuracy_m: number | null;
      heading: number | null;
      speed_mps: number | null;
      presence_at: string | null;
      presence_stop_id: string | null;
      presence_age_sec: number | null;
      stop_count: number;
      delivered_count: number;
      en_route_count: number;
      failed_count: number;
      open_issue_count: number;
    }>();

  const drivers: Array<Record<string, unknown>> = [];
  for (const r of routes || []) {
    let current_stop: {
      id: string;
      stop_order: number;
      status: string;
      order_number: string;
      customer_name: string;
      address: string;
    } | null = null;

    const current = await c.env.DB.prepare(
      `SELECT s.id, s.stop_order, s.status, o.order_number, o.customer_name,
              o.shipping_address1, o.shipping_city, o.shipping_state, o.shipping_zip
       FROM delivery_route_stops s
       JOIN orders o ON o.id = s.order_id
       WHERE s.route_id = ?
         AND s.status IN ('en_route', 'pending')
       ORDER BY CASE s.status WHEN 'en_route' THEN 0 ELSE 1 END, s.stop_order ASC
       LIMIT 1`,
    )
      .bind(r.id)
      .first<{
        id: string;
        stop_order: number;
        status: string;
        order_number: string;
        customer_name: string;
        shipping_address1: string;
        shipping_city: string;
        shipping_state: string;
        shipping_zip: string;
      }>();

    if (current) {
      current_stop = {
        id: current.id,
        stop_order: current.stop_order,
        status: current.status,
        order_number: current.order_number,
        customer_name: current.customer_name,
        address: [
          current.shipping_address1,
          current.shipping_city,
          current.shipping_state,
          current.shipping_zip,
        ]
          .filter(Boolean)
          .join(", "),
      };
    }

    const ageSec = r.presence_age_sec;
    const live_status =
      ageSec != null && ageSec <= 120
        ? "online"
        : ageSec != null && ageSec <= 900
          ? "stale"
          : "offline";

    drivers.push({
      ...r,
      current_stop,
      live_status,
    });
  }

  // Also include active drivers with presence but no route today (idle ping)
  const { results: idle } = await c.env.DB.prepare(
    `SELECT d.id as driver_id, d.name as driver_name, d.email as driver_email, d.phone as driver_phone,
            p.lat, p.lng, p.accuracy_m, p.heading, p.speed_mps, p.updated_at as presence_at,
            CAST((julianday('now') - julianday(p.updated_at)) * 86400 AS INTEGER) as presence_age_sec
     FROM driver_presence p
     JOIN drivers d ON d.id = p.driver_id
     WHERE d.active = 1
       AND NOT EXISTS (
         SELECT 1 FROM delivery_routes r
         WHERE r.driver_id = d.id AND r.route_date = ? AND r.status IN ('assigned','in_progress','completed')
       )
       AND CAST((julianday('now') - julianday(p.updated_at)) * 86400 AS INTEGER) <= 900`,
  )
    .bind(date)
    .all<{
      driver_id: string;
      driver_name: string;
      driver_email: string;
      driver_phone: string | null;
      lat: number;
      lng: number;
      accuracy_m: number | null;
      heading: number | null;
      speed_mps: number | null;
      presence_at: string;
      presence_age_sec: number;
    }>();

  for (const d of idle || []) {
    const ageSec = d.presence_age_sec;
    drivers.push({
      id: null,
      name: null,
      route_date: date,
      status: "idle",
      driver_id: d.driver_id,
      driver_name: d.driver_name,
      driver_email: d.driver_email,
      driver_phone: d.driver_phone,
      lat: d.lat,
      lng: d.lng,
      accuracy_m: d.accuracy_m,
      heading: d.heading,
      speed_mps: d.speed_mps,
      presence_at: d.presence_at,
      stop_count: 0,
      delivered_count: 0,
      en_route_count: 0,
      failed_count: 0,
      open_issue_count: 0,
      current_stop: null,
      presence_age_sec: ageSec,
      live_status: ageSec <= 120 ? "online" : "stale",
    });
  }

  return c.json({ date, drivers, refreshed_at: new Date().toISOString() });
});

// ─── Admin: routes ─────────────────────────────────────────────────

deliveryPortal.get("/api/admin/routes", requireAdmin, async (c) => {
  const date = c.req.query("date");
  const status = c.req.query("status");
  let sql = `
    SELECT r.*, d.name as driver_name, d.email as driver_email,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id) as stop_count,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'delivered') as delivered_count,
      (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'failed') as failed_count,
      (SELECT COUNT(*) FROM delivery_issues i WHERE i.route_id = r.id AND i.status = 'open') as open_issue_count
    FROM delivery_routes r
    LEFT JOIN drivers d ON d.id = r.driver_id
    WHERE 1=1
  `;
  const binds: string[] = [];
  if (date) {
    sql += ` AND r.route_date = ?`;
    binds.push(date);
  }
  if (status) {
    sql += ` AND r.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY r.route_date DESC, r.created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ routes: results || [] });
});

deliveryPortal.get("/api/admin/routes/assignable-orders", requireAdmin, async (c) => {
  const orders = await listAssignableOrders(c.env.DB);
  return c.json({ orders });
});

deliveryPortal.get("/api/admin/routes/:id", requireAdmin, async (c) => {
  const detail = await getRouteWithStops(c.env.DB, c.req.param("id"));
  if (!detail) return c.json({ error: "Not found" }, 404);
  return c.json(detail);
});

deliveryPortal.post("/api/admin/routes", requireAdmin, async (c) => {
  const body = await c.req.json<{
    name?: string;
    route_date?: string;
    driver_id?: string | null;
    notes?: string;
    order_ids?: string[];
  }>();
  const orderIds = body.order_ids || [];
  if (!orderIds.length) return c.json({ error: "Select at least one order" }, 400);
  if (!body.driver_id) {
    return c.json({ error: "Pick a driver to assign these orders" }, 400);
  }
  const routeDate = body.route_date || new Date().toISOString().slice(0, 10);
  const driver = await c.env.DB.prepare(
    `SELECT name FROM drivers WHERE id = ? AND active = 1`,
  )
    .bind(body.driver_id)
    .first<{ name: string }>();
  if (!driver) return c.json({ error: "Driver not found or inactive" }, 400);

  const detail = await createRoute(
    c.env.DB,
    {
      name: body.name || `${driver.name} · ${orderIds.length} order${orderIds.length === 1 ? "" : "s"}`,
      route_date: routeDate,
      driver_id: body.driver_id,
      notes: body.notes,
      order_ids: orderIds,
    },
    { env: c.env, origin: await getPublicOrigin(c.env, c.req.url) },
  );
  return c.json(detail);
});

deliveryPortal.post("/api/admin/routes/auto-assign", requireAdmin, async (c) => {
  const body = await c.req.json<{ route_date?: string; driver_ids?: string[] }>().catch(() => ({}));
  const result = await autoAssignRoutes(c.env.DB, {
    ...(body as { route_date?: string; driver_ids?: string[] }),
    env: c.env,
    origin: await getPublicOrigin(c.env, c.req.url),
  });
  if ("error" in result && result.error && !result.routes.length) {
    return c.json({ error: result.error, routes: [] }, 400);
  }
  return c.json(result);
});

deliveryPortal.patch("/api/admin/routes/:id", requireAdmin, async (c) => {
  const routeId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    driver_id?: string | null;
    status?: string;
    notes?: string | null;
    order_ids?: string[];
  }>();

  const existing = await c.env.DB.prepare(`SELECT id FROM delivery_routes WHERE id = ?`)
    .bind(routeId)
    .first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const allowed = ["draft", "assigned", "in_progress", "completed", "cancelled"];
  if (body.status && !allowed.includes(body.status)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE delivery_routes SET
       name = COALESCE(?, name),
       driver_id = CASE WHEN ? THEN ? ELSE driver_id END,
       status = COALESCE(?, status),
       notes = CASE WHEN ? THEN ? ELSE notes END,
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.name?.trim() || null,
      body.driver_id !== undefined ? 1 : 0,
      body.driver_id ?? null,
      body.status ?? null,
      body.notes !== undefined ? 1 : 0,
      body.notes ?? null,
      routeId,
    )
    .run();

  // If assigning a driver and still draft, bump to assigned
  if (body.driver_id) {
    await c.env.DB.prepare(
      `UPDATE delivery_routes SET status = 'assigned', updated_at = datetime('now')
       WHERE id = ? AND status = 'draft'`,
    )
      .bind(routeId)
      .run();

    const { results: stopOrders } = await c.env.DB.prepare(
      `SELECT order_id FROM delivery_route_stops WHERE route_id = ?`,
    )
      .bind(routeId)
      .all<{ order_id: string }>();
    await markOrdersOutForDelivery(
      c.env.DB,
      (stopOrders || []).map((s) => s.order_id),
      { env: c.env, origin: await getPublicOrigin(c.env, c.req.url) },
    );
  }

  if (body.order_ids) {
    await c.env.DB.prepare(`DELETE FROM delivery_route_stops WHERE route_id = ?`)
      .bind(routeId)
      .run();
    let order = 0;
    for (const orderId of body.order_ids) {
      await c.env.DB.prepare(
        `INSERT INTO delivery_route_stops (id, route_id, order_id, stop_order, status)
         VALUES (?, ?, ?, ?, 'pending')`,
      )
        .bind(id("stop"), routeId, orderId, order++)
        .run();
    }
    const route = await c.env.DB.prepare(`SELECT driver_id FROM delivery_routes WHERE id = ?`)
      .bind(routeId)
      .first<{ driver_id: string | null }>();
    if (route?.driver_id) {
      await markOrdersOutForDelivery(c.env.DB, body.order_ids, {
        env: c.env,
        origin: await getPublicOrigin(c.env, c.req.url),
      });
    }
  }

  const detail = await getRouteWithStops(c.env.DB, routeId);
  return c.json(detail);
});

deliveryPortal.delete("/api/admin/routes/:id", requireAdmin, async (c) => {
  await c.env.DB.prepare(`DELETE FROM delivery_routes WHERE id = ?`)
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

// ─── Admin: delivery issues ────────────────────────────────────────

deliveryPortal.get("/api/admin/delivery-issues", requireAdmin, async (c) => {
  const status = c.req.query("status") || "open";
  let sql = `
    SELECT i.*, o.order_number, o.customer_name, o.status as order_status,
           o.shipping_address1, o.shipping_city, o.shipping_zip,
           d.name as driver_name
    FROM delivery_issues i
    JOIN orders o ON o.id = i.order_id
    JOIN drivers d ON d.id = i.driver_id
  `;
  const binds: string[] = [];
  if (status !== "all") {
    sql += ` WHERE i.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY i.created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ issues: results || [] });
});

deliveryPortal.patch("/api/admin/delivery-issues/:id", requireAdmin, async (c) => {
  const body = await c.req.json<{
    status?: string;
    admin_note?: string;
    order_status?: string;
  }>();
  const issueId = c.req.param("id");
  const status = body.status;
  if (status && !["open", "resolved"].includes(status)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  const issueRow = await c.env.DB.prepare(`SELECT * FROM delivery_issues WHERE id = ?`)
    .bind(issueId)
    .first<{ id: string; order_id: string }>();
  if (!issueRow) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE delivery_issues SET
       status = COALESCE(?, status),
       admin_note = COALESCE(?, admin_note),
       resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END
     WHERE id = ?`,
  )
    .bind(status ?? null, body.admin_note ?? null, status ?? null, issueId)
    .run();

  const allowedOrder = [
    "pending",
    "confirmed",
    "processing",
    "out_for_delivery",
    "delivered",
    "cancelled",
    "refunded",
  ];
  if (body.order_status && allowedOrder.includes(body.order_status)) {
    await c.env.DB.prepare(
      `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(body.order_status, issueRow.order_id)
      .run();
  }

  const issue = await c.env.DB.prepare(
    `SELECT i.*, o.order_number, o.customer_name, o.status as order_status, d.name as driver_name
     FROM delivery_issues i
     JOIN orders o ON o.id = i.order_id
     JOIN drivers d ON d.id = i.driver_id
     WHERE i.id = ?`,
  )
    .bind(issueId)
    .first();
  return c.json({ issue });
});
