import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, money } from "../lib/api";
import {
  fulfillmentLabel,
  isPickupMethod,
  orderStatusLabel,
} from "../lib/orderStatus";

type Order = {
  order_number: string;
  status: string;
  payment_status: string;
  customer_name: string;
  delivery_method: string;
  delivery_date?: string | null;
  delivery_window?: string | null;
  subtotal_cents: number;
  discount_cents: number;
  delivery_cents: number;
  tax_cents: number;
  total_cents: number;
  created_at: string;
};

type Item = {
  product_name: string;
  product_sku: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

type EventRow = {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
};

const DELIVERY_STEPS = [
  { key: "paid", label: "Payment received", hint: "Your card was charged" },
  { key: "confirmed", label: "Order confirmed", hint: "We’re preparing your items" },
  { key: "processing", label: "Getting ready", hint: "Staging for delivery" },
  { key: "out_for_delivery", label: "Out for delivery", hint: "On the way to you" },
  { key: "delivered", label: "Delivered", hint: "Dropped off — thank you" },
] as const;

const PICKUP_STEPS = [
  { key: "paid", label: "Payment received", hint: "Your card was charged" },
  { key: "confirmed", label: "Pickup order confirmed", hint: "We’ll stage your items at the store" },
  { key: "processing", label: "Preparing for pickup", hint: "Getting your order ready" },
  { key: "out_for_delivery", label: "Ready for pickup", hint: "Come pick up at the store" },
  { key: "delivered", label: "Picked up", hint: "Thanks for shopping with us" },
] as const;

function stepIndex(status: string, steps: readonly { key: string }[]) {
  if (status === "refunded" || status === "cancelled") return -1;
  const i = steps.findIndex((s) => s.key === status);
  if (i >= 0) return i;
  if (status === "pending") return 0;
  return 1;
}

function statusHeadline(status: string, method: string) {
  if (status === "cancelled") return "This order was cancelled";
  if (status === "refunded") return "This order was refunded";
  return orderStatusLabel(status, method);
}

function eventLabel(eventType: string, method: string) {
  if (eventType === "out_for_delivery" && isPickupMethod(method)) return "Ready for pickup";
  if (eventType === "delivered" && isPickupMethod(method)) return "Picked up";
  return orderStatusLabel(eventType, method);
}

export function OrdersPage() {
  const [params] = useSearchParams();
  const [number, setNumber] = useState(params.get("number") || "");
  const [email, setEmail] = useState(params.get("email") || "");
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState("");
  const [looking, setLooking] = useState(false);

  async function lookup(n = number, e = email) {
    setError("");
    setOrder(null);
    setEvents([]);
    setLooking(true);
    try {
      const data = await api<{ order: Order; items: Item[]; events?: EventRow[] }>(
        `/api/orders/lookup?number=${encodeURIComponent(n)}&email=${encodeURIComponent(e)}`,
      );
      setOrder(data.order);
      setItems(data.items);
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not found");
    } finally {
      setLooking(false);
    }
  }

  useEffect(() => {
    if (params.get("number") && params.get("email")) {
      lookup(params.get("number")!, params.get("email")!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    lookup();
  }

  const isPickup = order ? isPickupMethod(order.delivery_method) : false;
  const steps = isPickup ? PICKUP_STEPS : DELIVERY_STEPS;
  const active = order ? stepIndex(order.status, steps) : -1;

  return (
    <div className="shell track-page">
      <div className="track-intro">
        <p className="track-eyebrow">Order status</p>
        <h1>Track your order</h1>
        <p className="track-lead">
          Enter the order number from your confirmation email and the email used at checkout.
        </p>
      </div>

      <form className="track-lookup" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="track-number">Order number</label>
          <input
            id="track-number"
            required
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="HOE-…"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="track-email">Email</label>
          <input
            id="track-email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <button className="btn btn-dark" disabled={looking}>
          {looking ? "Looking up…" : "Find order"}
        </button>
        {error && <p className="track-error">{error}</p>}
      </form>

      {order && (
        <div className="track-result">
          <header className="track-result-head">
            <div>
              <p className="track-eyebrow">{order.order_number}</p>
              <h2>{statusHeadline(order.status, order.delivery_method)}</h2>
              <p className="muted">
                Placed {new Date(order.created_at).toLocaleString()} · for {order.customer_name}
              </p>
            </div>
            <div className="track-badges">
              <span className={`status method-${isPickup ? "pickup" : "delivery"}`}>
                {fulfillmentLabel(order.delivery_method)}
              </span>
              <span className={`status ${order.status}`}>
                {orderStatusLabel(order.status, order.delivery_method)}
              </span>
              <span className={`status ${order.payment_status}`}>{order.payment_status}</span>
            </div>
          </header>

          <div className="track-meta">
            <div>
              <span className="track-meta-label">Fulfillment</span>
              <strong>{fulfillmentLabel(order.delivery_method)}</strong>
              {isPickup && (
                <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  Pick up at the store when status says Ready for pickup.
                </div>
              )}
            </div>
            {order.delivery_date && !isPickup && (
              <div>
                <span className="track-meta-label">Scheduled delivery</span>
                <strong>
                  {order.delivery_date}
                  {order.delivery_window ? ` · ${order.delivery_window}` : ""}
                </strong>
              </div>
            )}
            <div>
              <span className="track-meta-label">Total</span>
              <strong>{money(order.total_cents)}</strong>
            </div>
          </div>

          {order.status !== "refunded" && order.status !== "cancelled" && (
            <ol className="track-steps" aria-label="Order progress">
              {steps.map((s, idx) => {
                const done = active > idx;
                const current = active === idx;
                return (
                  <li
                    key={s.key}
                    className={`track-step${done ? " is-done" : ""}${current ? " is-current" : ""}`}
                  >
                    <span className="track-step-marker" aria-hidden>
                      {done ? "✓" : idx + 1}
                    </span>
                    <div>
                      <strong>{s.label}</strong>
                      <span>{s.hint}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="track-grid">
            <section className="track-panel">
              <h3>Items</h3>
              <ul className="track-items">
                {items.map((i) => (
                  <li key={i.product_sku + i.product_name}>
                    <div>
                      <strong>
                        {i.quantity}× {i.product_name}
                      </strong>
                      <span className="muted">SKU {i.product_sku}</span>
                    </div>
                    <span>{money(i.line_total_cents)}</span>
                  </li>
                ))}
              </ul>
              <div className="track-totals">
                {order.discount_cents > 0 && (
                  <div className="summary-row">
                    <span>Discount</span>
                    <span>−{money(order.discount_cents)}</span>
                  </div>
                )}
                <div className="summary-row">
                  <span>{isPickup ? "Pickup" : "Delivery"}</span>
                  <span>{isPickup ? "Free" : money(order.delivery_cents)}</span>
                </div>
                <div className="summary-row">
                  <span>Tax</span>
                  <span>{money(order.tax_cents)}</span>
                </div>
                <div className="summary-row total">
                  <span>Total</span>
                  <span>{money(order.total_cents)}</span>
                </div>
              </div>
            </section>

            <section className="track-panel">
              <h3>Activity</h3>
              {events.length > 0 ? (
                <ul className="track-activity">
                  {events.map((ev) => (
                    <li key={ev.id}>
                      <time dateTime={ev.created_at}>
                        {new Date(ev.created_at).toLocaleString()}
                      </time>
                      <strong>{eventLabel(ev.event_type, order.delivery_method)}</strong>
                      {ev.message && <span>{ev.message}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Updates will appear here as your order moves along.
                </p>
              )}
              <p className="track-help">
                <Link
                  to={`/claims?number=${encodeURIComponent(order.order_number)}&email=${encodeURIComponent(email)}`}
                >
                  Report a return or damage
                </Link>
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
