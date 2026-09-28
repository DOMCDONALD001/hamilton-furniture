import { id } from "./types";

export async function addOrderEvent(
  db: D1Database,
  orderId: string,
  eventType: string,
  message?: string,
) {
  await db
    .prepare(
      `INSERT INTO order_events (id, order_id, event_type, message) VALUES (?, ?, ?, ?)`,
    )
    .bind(id("evt"), orderId, eventType, message || null)
    .run();
}

export async function listOrderEvents(db: D1Database, orderId: string) {
  const { results } = await db
    .prepare(
      `SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC`,
    )
    .bind(orderId)
    .all();
  return results || [];
}

export function parseWindowsJson(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
  } catch {
    /* ignore */
  }
  return ["9am–12pm", "12pm–3pm", "3pm–6pm"];
}

export function availableDeliveryDates(leadDays: number, maxDays: number) {
  const out: string[] = [];
  const start = Math.max(0, leadDays);
  const end = Math.max(start, maxDays);
  const now = new Date();
  for (let i = start; i <= end; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    // Skip Sundays (0)
    if (d.getDay() === 0) continue;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}
