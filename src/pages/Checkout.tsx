import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, money } from "../lib/api";
import { useCart } from "../lib/cart";
import { useCustomer } from "../lib/customer";
import { Modal } from "../components/AdminUI";

type Quote = {
  subtotal_cents: number;
  discount_cents: number;
  delivery_cents: number;
  tax_cents: number;
  total_cents: number;
  free_shipping?: boolean;
  needs_zip?: boolean;
  in_area?: boolean | null;
  delivery_config?: {
    eta_text: string;
    flat_fee_cents: number;
    free_above_cents: number | null;
  };
};

type DeliveryOpts = {
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  flat_fee_cents: number;
  free_above_cents: number | null;
  eta_text: string;
};

export function CheckoutPage() {
  const { items, clear, subtotal } = useCart();
  const { customer } = useCustomer();
  const navigate = useNavigate();
  const [opts, setOpts] = useState<DeliveryOpts | null>(null);
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [memberGate, setMemberGate] = useState(false);
  const [areaPopup, setAreaPopup] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    shipping_address1: "",
    shipping_address2: "",
    shipping_city: "Hamilton",
    shipping_state: "OH",
    shipping_zip: "",
    shipping_notes: "",
  });

  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({
      ...f,
      customer_name: f.customer_name || customer.name,
      customer_email: f.customer_email || customer.email,
      customer_phone: f.customer_phone || customer.phone || "",
    }));
  }, [customer]);

  useEffect(() => {
    api<DeliveryOpts>("/api/delivery/config").then((d) => {
      setOpts(d);
      if (!d.delivery_enabled && d.pickup_enabled) setMethod("pickup");
      if (d.delivery_enabled && !d.pickup_enabled) setMethod("delivery");
    });
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => {
      setError("");
      setMemberGate(false);
      fetch("/api/checkout/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            color: i.color || null,
          })),
          discount_code: code || undefined,
          zip: form.shipping_zip,
          method,
        }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            if (data.members_only) setMemberGate(true);
            if (data.delivery_blocked) {
              setAreaPopup(data.outside_message || data.error || "Outside delivery area");
              setQuote(null);
            }
            setError(data.error || "Could not calculate total");
            return;
          }
          setAreaPopup("");
          setQuote(data as Quote);
        })
        .catch(() => setError("Could not calculate total"));
    }, 300);
    return () => clearTimeout(t);
  }, [items, code, form.shipping_zip, method, customer]);

  if (!items.length) {
    return (
      <div className="shell empty">
        <p>Nothing to check out.</p>
        <Link to="/shop" className="btn btn-dark">
          Shop
        </Link>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await api<{ order_number: string }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          method,
          discount_code: code || undefined,
          zip: form.shipping_zip,
          items: items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            color: i.color || null,
          })),
        }),
      });
      clear();
      navigate(
        `/orders?number=${encodeURIComponent(res.order_number)}&email=${encodeURIComponent(form.customer_email)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setError(msg);
      if (/ZIP|deliver|area|pickup/i.test(msg)) setAreaPopup(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const blocked = !!areaPopup && method === "delivery";

  return (
    <div className="shell">
      <div className="section-head">
        <div>
          <h2>Checkout</h2>
          <p>
            {opts
              ? `Flat delivery ${money(opts.flat_fee_cents)} · ${opts.eta_text}`
              : "Delivery, pickup, and promo codes"}
          </p>
        </div>
      </div>
      <form className="checkout-layout" onSubmit={onSubmit}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Customer & shipping</h3>
          <div className="grid-2">
            <div className="field">
              <label>Full name</label>
              <input
                required
                value={form.customer_name}
                onChange={(e) => set("customer_name", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                required
                type="email"
                value={form.customer_email}
                onChange={(e) => set("customer_email", e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              value={form.customer_phone}
              onChange={(e) => set("customer_phone", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Fulfillment</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "delivery" | "pickup")}
            >
              {opts?.delivery_enabled !== false && <option value="delivery">Delivery</option>}
              {opts?.pickup_enabled !== false && <option value="pickup">Store pickup</option>}
            </select>
          </div>
          {method === "delivery" && (
            <>
              <div className="field">
                <label>Address</label>
                <input
                  required
                  value={form.shipping_address1}
                  onChange={(e) => set("shipping_address1", e.target.value)}
                />
              </div>
              <div className="field">
                <label>Apt / suite</label>
                <input
                  value={form.shipping_address2}
                  onChange={(e) => set("shipping_address2", e.target.value)}
                />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>City</label>
                  <input
                    required
                    value={form.shipping_city}
                    onChange={(e) => set("shipping_city", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>State</label>
                  <input
                    required
                    value={form.shipping_state}
                    onChange={(e) => set("shipping_state", e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>ZIP (must be in our delivery area)</label>
                <input
                  required
                  value={form.shipping_zip}
                  onChange={(e) => set("shipping_zip", e.target.value)}
                  placeholder="45011"
                />
                {quote?.needs_zip && (
                  <small className="muted">Enter your ZIP to confirm we deliver there.</small>
                )}
                {blocked && (
                  <small style={{ color: "var(--danger)", display: "block", marginTop: 6 }}>
                    This ZIP is outside our delivery area.
                  </small>
                )}
              </div>
            </>
          )}
          {method === "pickup" && (
            <div className="field">
              <label>Contact city / ZIP (for records)</label>
              <input
                required
                value={form.shipping_address1}
                onChange={(e) => set("shipping_address1", e.target.value)}
                placeholder="Hamilton"
              />
              <input
                style={{ marginTop: 8 }}
                required
                value={form.shipping_zip}
                onChange={(e) => set("shipping_zip", e.target.value)}
                placeholder="ZIP"
              />
            </div>
          )}
          <div className="field">
            <label>Delivery notes</label>
            <textarea
              rows={3}
              value={form.shipping_notes}
              onChange={(e) => set("shipping_notes", e.target.value)}
              placeholder="Stairs, gate codes, preferred times…"
            />
          </div>
        </div>

        <aside className="panel">
          <h3 style={{ marginTop: 0 }}>Pay & place order</h3>
          <div className="field">
            <label>Promo code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={customer ? "MEMBER15 or WELCOME10" : "WELCOME10"}
            />
            {!customer && (
              <small className="muted">
                Member-only codes need an account.{" "}
                <Link to="/account?mode=register&next=/checkout">Create free account</Link>
              </small>
            )}
            {customer && (
              <small className="muted">Signed in as {customer.email} — member offers unlocked.</small>
            )}
          </div>
          {memberGate && (
            <p style={{ color: "var(--accent-deep)" }}>
              That code is for account holders.{" "}
              <Link to="/account?mode=login&next=/checkout">Sign in</Link> or{" "}
              <Link to="/account?mode=register&next=/checkout">register</Link> (optional — guests can
              still checkout without it).
            </p>
          )}
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{money(quote?.subtotal_cents ?? subtotal)}</span>
          </div>
          <div className="summary-row">
            <span>Discount</span>
            <span>−{money(quote?.discount_cents ?? 0)}</span>
          </div>
          <div className="summary-row">
            <span>Delivery</span>
            <span>{money(quote?.delivery_cents ?? 0)}</span>
          </div>
          <div className="summary-row">
            <span>Tax</span>
            <span>{money(quote?.tax_cents ?? 0)}</span>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <span>{money(quote?.total_cents ?? subtotal)}</span>
          </div>
          {quote?.delivery_config && method === "delivery" && !blocked && (
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              ETA: {quote.delivery_config.eta_text}
              {quote.delivery_config.free_above_cents != null
                ? ` · Free over ${money(quote.delivery_config.free_above_cents)}`
                : ""}
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Payment is arranged with the store. You’ll get an order number to track status.
          </p>
          {error && !areaPopup && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={submitting || blocked}
          >
            {submitting ? "Placing order…" : blocked ? "Delivery not available" : "Place order"}
          </button>
        </aside>
      </form>

      <Modal
        open={!!areaPopup}
        title="Outside our delivery area"
        onClose={() => setAreaPopup("")}
        footer={
          <>
            {opts?.pickup_enabled !== false && (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  setMethod("pickup");
                  setAreaPopup("");
                  setError("");
                }}
              >
                Switch to store pickup
              </button>
            )}
            <button className="btn btn-outline" type="button" onClick={() => setAreaPopup("")}>
              Change ZIP
            </button>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.55 }}>{areaPopup}</p>
      </Modal>
    </div>
  );
}
