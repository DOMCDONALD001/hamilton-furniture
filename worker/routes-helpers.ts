import type { Env } from "./types";
import { id } from "./types";
import { addOrderEvent } from "./order-events";
import { emailOrderIfNeeded } from "./email";

export type RouteOrderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string | null;
  shipping_address1: string;
  shipping_address2: string | null;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  shipping_notes: string | null;
  status: string;
  delivery_method: string;
  total_cents: number;
};

/** Orders eligible to hand to a driver (processing / confirmed, not already assigned). */
export async function listAssignableOrders(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT o.*
       FROM orders o
       WHERE o.delivery_method = 'delivery'
         AND o.status IN ('confirmed', 'processing')
         AND o.id NOT IN (
           SELECT s.order_id
           FROM delivery_route_stops s
           JOIN delivery_routes r ON r.id = s.route_id
           WHERE r.status IN ('draft', 'assigned', 'in_progress')
             AND s.status NOT IN ('delivered', 'skipped', 'failed')
         )
       ORDER BY
         CASE WHEN o.delivery_date IS NOT NULL THEN 0 ELSE 1 END,
         o.delivery_date ASC,
         CASE o.status WHEN 'processing' THEN 0 ELSE 1 END,
         o.shipping_zip ASC, o.shipping_city ASC, o.created_at ASC`,
    )
    .all<RouteOrderRow>();
  return results || [];
}

/** Mark assigned delivery orders as out for delivery. */
export async function markOrdersOutForDelivery(
  db: D1Database,
  orderIds: string[],
  opts?: { env?: Env; origin?: string },
) {
  if (!orderIds.length) return;
  for (const orderId of orderIds) {
    const before = await db
      .prepare(`SELECT id, status, customer_email, order_number, total_cents FROM orders WHERE id = ?`)
      .bind(orderId)
      .first<{
        id: string;
        status: string;
        customer_email: string;
        order_number: string;
        total_cents: number;
      }>();
    const updated = await db
      .prepare(
        `UPDATE orders
         SET status = 'out_for_delivery', updated_at = datetime('now')
         WHERE id = ?
           AND delivery_method = 'delivery'
           AND status IN ('confirmed', 'processing', 'pending')`,
      )
      .bind(orderId)
      .run();
    if (!updated.meta.changes || !before || before.status === "out_for_delivery") continue;
    await addOrderEvent(db, orderId, "out_for_delivery", "Assigned to delivery route");
    if (opts?.env && opts.origin) {
      await emailOrderIfNeeded(
        opts.env,
        opts.origin,
        { ...before, status: "out_for_delivery" },
        "out_for_delivery",
      );
    }
  }
}

export async function getRouteWithStops(db: D1Database, routeId: string) {
  const route = await db
    .prepare(
      `SELECT r.*, d.name as driver_name, d.email as driver_email, d.phone as driver_phone,
        (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id) as stop_count,
        (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'delivered') as delivered_count,
        (SELECT COUNT(*) FROM delivery_route_stops s WHERE s.route_id = r.id AND s.status = 'failed') as failed_count,
        (SELECT COUNT(*) FROM delivery_issues i WHERE i.route_id = r.id AND i.status = 'open') as open_issue_count
       FROM delivery_routes r
       LEFT JOIN drivers d ON d.id = r.driver_id
       WHERE r.id = ?`,
    )
    .bind(routeId)
    .first();
  if (!route) return null;

  const { results: stops } = await db
    .prepare(
      `SELECT s.*,
              o.order_number, o.customer_name, o.customer_email, o.customer_phone,
              o.shipping_address1, o.shipping_address2, o.shipping_city,
              o.shipping_state, o.shipping_zip, o.shipping_notes,
              o.status as order_status, o.total_cents, o.delivery_method,
              (SELECT COUNT(*) FROM delivery_issues i WHERE i.stop_id = s.id AND i.status = 'open') as open_issue_count
       FROM delivery_route_stops s
       JOIN orders o ON o.id = s.order_id
       WHERE s.route_id = ?
       ORDER BY s.stop_order ASC, s.created_at ASC`,
    )
    .bind(routeId)
    .all();

  return { route, stops: stops || [] };
}

/** Hide delivery GPS from driver clients — admin still sees pins. */
export function stripDeliveryGeoForDriver<T extends { route: unknown; stops: Array<Record<string, unknown>> }>(
  detail: T,
): T {
  return {
    ...detail,
    stops: detail.stops.map((s) => {
      const {
        delivered_lat: _lat,
        delivered_lng: _lng,
        delivered_accuracy_m: _acc,
        delivered_geo_at: _geoAt,
        ...rest
      } = s;
      return rest;
    }),
  };
}

export async function createRoute(
  db: D1Database,
  input: {
    name: string;
    route_date: string;
    driver_id?: string | null;
    notes?: string | null;
    order_ids: string[];
    status?: string;
  },
  opts?: { env?: Env; origin?: string },
) {
  const routeId = id("route");
  const status = input.driver_id ? input.status || "assigned" : "draft";
  await db
    .prepare(
      `INSERT INTO delivery_routes (id, name, route_date, driver_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      routeId,
      input.name.trim() || `Route ${input.route_date}`,
      input.route_date,
      input.driver_id || null,
      status,
      input.notes || null,
    )
    .run();

  let order = 0;
  for (const orderId of input.order_ids) {
    await db
      .prepare(
        `INSERT INTO delivery_route_stops (id, route_id, order_id, stop_order, status)
         VALUES (?, ?, ?, ?, 'pending')`,
      )
      .bind(id("stop"), routeId, orderId, order++)
      .run();
  }

  if (input.driver_id) {
    await markOrdersOutForDelivery(db, input.order_ids, opts);
  }

  return getRouteWithStops(db, routeId);
}

/**
 * Auto-build routes for today:
 * cluster assignable orders by ZIP prefix (first 3 digits),
 * then round-robin clusters across active drivers.
 */
export async function autoAssignRoutes(
  db: D1Database,
  opts?: { route_date?: string; driver_ids?: string[]; env?: Env; origin?: string },
) {
  const routeDate = opts?.route_date || new Date().toISOString().slice(0, 10);

  let drivers: Array<{ id: string; name: string }> = [];
  if (opts?.driver_ids?.length) {
    const placeholders = opts.driver_ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT id, name FROM drivers WHERE active = 1 AND id IN (${placeholders}) ORDER BY name ASC`,
      )
      .bind(...opts.driver_ids)
      .all<{ id: string; name: string }>();
    drivers = results || [];
  } else {
    const { results } = await db
      .prepare(`SELECT id, name FROM drivers WHERE active = 1 ORDER BY name ASC`)
      .all<{ id: string; name: string }>();
    drivers = results || [];
  }

  if (!drivers.length) {
    return { error: "No active drivers to assign" as const, routes: [] as Awaited<ReturnType<typeof createRoute>>[] };
  }

  const orders = await listAssignableOrders(db);
  if (!orders.length) {
    return { error: "No unassigned delivery orders" as const, routes: [] as Awaited<ReturnType<typeof createRoute>>[] };
  }

  // Group by ZIP prefix (3 digits) for geographic clustering
  const clusters = new Map<string, RouteOrderRow[]>();
  for (const order of orders) {
    const key = (order.shipping_zip || "000").replace(/\D/g, "").slice(0, 3) || "000";
    const list = clusters.get(key) || [];
    list.push(order);
    clusters.set(key, list);
  }

  const bucketed: RouteOrderRow[][] = drivers.map(() => []);
  let i = 0;
  for (const [, cluster] of [...clusters.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    bucketed[i % drivers.length].push(...cluster);
    i++;
  }

  const created = [];
  for (let d = 0; d < drivers.length; d++) {
    const bucket = bucketed[d];
    if (!bucket.length) continue;
    // Stable sort within driver: ZIP then city
    bucket.sort((a, b) => {
      const z = (a.shipping_zip || "").localeCompare(b.shipping_zip || "");
      if (z) return z;
      return (a.shipping_city || "").localeCompare(b.shipping_city || "");
    });
    const route = await createRoute(
      db,
      {
        name: `${drivers[d].name} · ${routeDate}`,
        route_date: routeDate,
        driver_id: drivers[d].id,
        order_ids: bucket.map((o) => o.id),
        status: "assigned",
        notes: "Auto-assigned by ZIP clusters",
      },
      { env: opts?.env, origin: opts?.origin },
    );
    if (route) created.push(route);
  }

  return { routes: created, assigned_orders: orders.length };
}

/** Map stop status → order status (drivers can only affect delivery progress). */
export function orderStatusForStop(stopStatus: string): string | null {
  if (stopStatus === "en_route") return "out_for_delivery";
  if (stopStatus === "delivered") return "delivered";
  return null;
}

/**
 * Sync route status from stops:
 * - any pending/en_route → in_progress (if work started)
 * - all stops terminal (delivered/skipped/failed) → completed
 */
export async function refreshRouteProgress(db: D1Database, routeId: string) {
  const counts = await db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status IN ('pending', 'en_route') THEN 1 ELSE 0 END) as open_stops,
         SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN status IN ('en_route', 'delivered', 'failed', 'skipped') THEN 1 ELSE 0 END) as started
       FROM delivery_route_stops WHERE route_id = ?`,
    )
    .bind(routeId)
    .first<{
      total: number;
      open_stops: number;
      delivered: number;
      failed: number;
      started: number;
    }>();

  if (!counts || !counts.total) return;

  const route = await db
    .prepare(`SELECT status FROM delivery_routes WHERE id = ?`)
    .bind(routeId)
    .first<{ status: string }>();
  if (!route || route.status === "cancelled") return;

  if (counts.open_stops === 0) {
    await db
      .prepare(
        `UPDATE delivery_routes SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(routeId)
      .run();
    return;
  }

  if (counts.started > 0 && (route.status === "assigned" || route.status === "draft")) {
    await db
      .prepare(
        `UPDATE delivery_routes SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(routeId)
      .run();
  }
}

/**
 * Pull an order off active driver routes (refunded / cancelled while out for delivery).
 * Marks open stops as skipped so the driver no longer delivers them.
 */
export async function removeOrderFromActiveRoutes(
  db: D1Database,
  orderId: string,
  reason: string,
) {
  const { results: stops } = await db
    .prepare(
      `SELECT s.id, s.route_id, s.status
       FROM delivery_route_stops s
       JOIN delivery_routes r ON r.id = s.route_id
       WHERE s.order_id = ?
         AND r.status IN ('draft', 'assigned', 'in_progress')
         AND s.status NOT IN ('delivered', 'skipped')`,
    )
    .bind(orderId)
    .all<{ id: string; route_id: string; status: string }>();

  if (!stops?.length) return 0;

  const note = reason.slice(0, 280);
  const routeIds = new Set<string>();
  for (const stop of stops) {
    await db
      .prepare(
        `UPDATE delivery_route_stops
         SET status = 'skipped',
             driver_note = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(note, stop.id)
      .run();
    routeIds.add(stop.route_id);
  }

  for (const routeId of routeIds) {
    await refreshRouteProgress(db, routeId);
  }

  await addOrderEvent(db, orderId, "removed_from_route", note);
  return stops.length;
}
