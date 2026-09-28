import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, money } from "../lib/api";
import { DeliveryDatePicker } from "../components/DeliveryDatePicker";
import {
  SquareCardPay,
  type PaymentsConfig,
  type SquareCardInstance,
} from "../components/SquareCardPay";

type SettleData = {
  auction: {
    id: string;
    title: string;
    slug: string;
    status: string;
    winner_bid_cents: number | null;
    winner_name: string | null;
  };
  order: {
    order_number: string;
    payment_status: string;
    status: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string | null;
    subtotal_cents: number;
    delivery_cents: number;
    tax_cents: number;
    total_cents: number;
    delivery_method: string;
  };
  items: Array<{
    product_name: string;
    product_sku: string;
    unit_price_cents: number;
    quantity: number;
    line_total_cents: number;
  }>;
  delivery: {
    enabled: boolean;
    pickup_enabled: boolean;
    windows: string[];
    lead_days: number;
    max_days: number;
  };
  paid: boolean;
};

type Preview = {
  subtotal_cents: number;
  delivery_cents: number;
  tax_cents: number;
  total_cents: number;
  eta_text?: string;
};

function deliveryDates(leadDays: number, maxDays: number) {
  const out: string[] = [];
  const start = Math.max(0, leadDays);
  const end = Math.max(start, maxDays);
  const now = new Date();
  for (let i = start; i <= end; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (d.getDay() === 0) continue;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

export function AuctionPayPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<SettleData | null>(null);
  const [error, setError] = useState("");
  const [method, setMethod] = useState<"pickup" | "delivery">("pickup");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payConfig, setPayConfig] = useState<PaymentsConfig | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<SquareCardInstance | null>(null);
  const [form, setForm] = useState({
    customer_phone: "",
    shipping_address1: "",
    shipping_address2: "",
    shipping_city: "Tupelo",
    shipping_state: "MS",
    shipping_zip: "38801",
    shipping_notes: "",
    delivery_date: "",
    delivery_window: "",
  });

  useEffect(() => {
    if (!token) return;
    api<SettleData>(`/api/auctions/settle/${token}`)
      .then((d) => {
        setData(d);
        if (!d.delivery.pickup_enabled && d.delivery.enabled) setMethod("delivery");
        if (d.delivery.pickup_enabled && !d.delivery.enabled) setMethod("pickup");
        const firstDate = deliveryDates(d.delivery.lead_days, d.delivery.max_days)[0] || "";
        setForm((f) => ({
          ...f,
          customer_phone: d.order.customer_phone || "",
          delivery_date: f.delivery_date || firstDate,
          delivery_window: f.delivery_window || d.delivery.windows[0] || "",
        }));
      })
      .catch((e) => setError(e.message));
    api<PaymentsConfig>("/api/payments/config")
      .then(setPayConfig)
      .catch(() => setPayConfig(null));
  }, [token]);

  useEffect(() => {
    if (!token || !data || data.paid) return;
    const zip = method === "pickup" ? "38801" : form.shipping_zip;
    api<Preview>(`/api/auctions/settle/${token}/preview`, {
      method: "POST",
      body: JSON.stringify({ method, zip }),
    })
      .then(setPreview)
      .catch((e) => setError(e.message));
  }, [token, data, method, form.shipping_zip]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !data || !cardRef.current) return;
    setSubmitting(true);
    setError("");
    try {
      const tok = await cardRef.current.tokenize();
      if (tok.status !== "OK" || !tok.token) {
        throw new Error(tok.errors?.[0]?.message || "Card tokenization failed");
      }
      const result = await api<{
        order_number: string;
        already_paid?: boolean;
      }>(`/api/auctions/settle/${token}/pay`, {
        method: "POST",
        body: JSON.stringify({
          source_id: tok.token,
          idempotency_key: crypto.randomUUID(),
          method,
          zip: form.shipping_zip,
          shipping_address1: form.shipping_address1,
          shipping_address2: form.shipping_address2,
          shipping_city: form.shipping_city,
          shipping_state: form.shipping_state,
          shipping_notes: form.shipping_notes,
          delivery_date: form.delivery_date,
          delivery_window: form.delivery_window,
          customer_phone: form.customer_phone,
        }),
      });
      navigate(
        `/orders?number=${encodeURIComponent(result.order_number)}&email=${encodeURIComponent(data.order.customer_email)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !data) return <div className="shell empty">{error}</div>;
  if (!data) return <div className="shell empty">Loading your auction win…</div>;

  if (data.paid) {
    return (
      <div className="shell" style={{ maxWidth: 640, marginBottom: "3rem" }}>
        <div className="panel">
          <h1 style={{ marginTop: 0 }}>Already paid</h1>
          <p>
            Thanks — payment for <strong>{data.auction.title}</strong> is complete (
            {data.order.order_number}).
          </p>
          <Link
            className="btn btn-primary"
            to={`/orders?number=${encodeURIComponent(data.order.order_number)}&email=${encodeURIComponent(data.order.customer_email)}`}
          >
            Track order
          </Link>
        </div>
      </div>
    );
  }

  const dates = deliveryDates(data.delivery.lead_days, data.delivery.max_days);
  const totals = preview || {
    subtotal_cents: data.order.subtotal_cents,
    delivery_cents: 0,
    tax_cents: data.order.tax_cents,
    total_cents: data.order.total_cents,
  };

  return (
    <div className="shell" style={{ maxWidth: 720, marginBottom: "3rem" }}>
      <div className="section-head">
        <div>
          <p className="track-eyebrow">Auction win</p>
          <h1 style={{ margin: "0.2rem 0" }}>Pay & arrange fulfillment</h1>
          <p className="muted" style={{ margin: 0 }}>
            Hi {data.order.customer_name} — you won <strong>{data.auction.title}</strong>. Pay
            online, then choose free pickup or paid delivery.
          </p>
        </div>
      </div>

      <form className="panel" onSubmit={onSubmit}>
        <div className="summary-row">
          <span>Winning bid</span>
          <strong>{money(totals.subtotal_cents)}</strong>
        </div>
        {data.items.map((i) => (
          <div className="summary-row" key={i.product_sku}>
            <span className="muted">
              {i.quantity}× {i.product_name}
            </span>
            <span className="muted">{money(i.line_total_cents)}</span>
          </div>
        ))}

        <div className="field" style={{ marginTop: "1.25rem" }}>
          <label>How do you want the item?</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as "pickup" | "delivery")}
          >
            {data.delivery.pickup_enabled && (
              <option value="pickup">Store pickup — free (Tupelo, MS)</option>
            )}
            {data.delivery.enabled && (
              <option value="delivery">Delivery — fee based on ZIP</option>
            )}
          </select>
        </div>

        <div className="field">
          <label>Phone</label>
          <input
            value={form.customer_phone}
            onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
            placeholder="Best number to reach you"
          />
        </div>

        {method === "delivery" && (
          <>
            <div className="field">
              <label>Delivery address</label>
              <input
                required
                value={form.shipping_address1}
                onChange={(e) => setForm({ ...form, shipping_address1: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Apt / suite (optional)</label>
              <input
                value={form.shipping_address2}
                onChange={(e) => setForm({ ...form, shipping_address2: e.target.value })}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.5fr 0.8fr", gap: 10 }}>
              <div className="field">
                <label>City</label>
                <input
                  required
                  value={form.shipping_city}
                  onChange={(e) => setForm({ ...form, shipping_city: e.target.value })}
                />
              </div>
              <div className="field">
                <label>State</label>
                <input
                  required
                  value={form.shipping_state}
                  onChange={(e) => setForm({ ...form, shipping_state: e.target.value })}
                />
              </div>
              <div className="field">
                <label>ZIP</label>
                <input
                  required
                  value={form.shipping_zip}
                  onChange={(e) => setForm({ ...form, shipping_zip: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Delivery date</label>
              <DeliveryDatePicker
                dates={dates}
                value={form.delivery_date}
                onChange={(d) => setForm({ ...form, delivery_date: d })}
                required
              />
            </div>
            <div className="field">
              <label>Time window</label>
              <select
                required
                value={form.delivery_window}
                onChange={(e) => setForm({ ...form, delivery_window: e.target.value })}
              >
                <option value="">Choose…</option>
                {data.delivery.windows.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            {preview?.eta_text && (
              <p className="muted" style={{ marginTop: 0 }}>
                {preview.eta_text}
              </p>
            )}
          </>
        )}

        <div className="field">
          <label>Notes (optional)</label>
          <textarea
            rows={2}
            value={form.shipping_notes}
            onChange={(e) => setForm({ ...form, shipping_notes: e.target.value })}
          />
        </div>

        <div className="summary-row">
          <span>Delivery</span>
          <span>{method === "pickup" ? "Free" : money(totals.delivery_cents)}</span>
        </div>
        <div className="summary-row">
          <span>Tax</span>
          <span>{money(totals.tax_cents)}</span>
        </div>
        <div className="summary-row total">
          <span>Total due</span>
          <span>{money(totals.total_cents)}</span>
        </div>

        <div style={{ marginTop: "1.25rem" }}>
          <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Card payment</h3>
          {payConfig?.enabled ? (
            <SquareCardPay config={payConfig} cardRef={cardRef} onReadyChange={setCardReady} />
          ) : (
            <p style={{ color: "var(--danger)" }}>Online card payment is temporarily unavailable.</p>
          )}
        </div>

        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "0.75rem" }}
          disabled={submitting || !cardReady || !payConfig?.enabled}
        >
          {submitting ? "Processing…" : `Pay ${money(totals.total_cents)}`}
        </button>
        <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
          Reference {data.order.order_number} · after payment you’ll get an order confirmation email.
        </p>
      </form>
    </div>
  );
}
