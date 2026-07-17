import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, money } from "../lib/api";

type Order = {
  order_number: string;
  status: string;
  payment_status: string;
  customer_name: string;
  delivery_method: string;
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

export function OrdersPage() {
  const [params] = useSearchParams();
  const [number, setNumber] = useState(params.get("number") || "");
  const [email, setEmail] = useState(params.get("email") || "");
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");

  async function lookup(n = number, e = email) {
    setError("");
    setOrder(null);
    try {
      const data = await api<{ order: Order; items: Item[] }>(
        `/api/orders/lookup?number=${encodeURIComponent(n)}&email=${encodeURIComponent(e)}`,
      );
      setOrder(data.order);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not found");
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

  return (
    <div className="shell" style={{ maxWidth: 720, marginBottom: "3rem" }}>
      <div className="section-head">
        <div>
          <h2>Track order</h2>
          <p>Enter your order number and email</p>
        </div>
      </div>
      <form className="panel" onSubmit={onSubmit}>
        <div className="field">
          <label>Order number</label>
          <input required value={number} onChange={(e) => setNumber(e.target.value)} placeholder="HOE-…" />
        </div>
        <div className="field">
          <label>Email</label>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn btn-dark">Look up</button>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </form>

      {order && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <h3 style={{ margin: 0 }}>{order.order_number}</h3>
              <div className="muted">{new Date(order.created_at).toLocaleString()}</div>
            </div>
            <span className={`status ${order.status}`}>{order.status.replaceAll("_", " ")}</span>
          </div>
          <p>
            Hi {order.customer_name} — payment: <strong>{order.payment_status}</strong> ·{" "}
            {order.delivery_method}
          </p>
          {items.map((i) => (
            <div className="summary-row" key={i.product_sku + i.product_name}>
              <span>
                {i.quantity}× {i.product_name}
              </span>
              <span>{money(i.line_total_cents)}</span>
            </div>
          ))}
          <div className="summary-row">
            <span>Discount</span>
            <span>−{money(order.discount_cents)}</span>
          </div>
          <div className="summary-row">
            <span>Delivery</span>
            <span>{money(order.delivery_cents)}</span>
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
      )}
    </div>
  );
}
