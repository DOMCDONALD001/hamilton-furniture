import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, money } from "../lib/api";
import { useCart } from "../lib/cart";
import { useCustomer } from "../lib/customer";
import { Modal } from "../components/AdminUI";
import { DeliveryDatePicker } from "../components/DeliveryDatePicker";
import {
  SquareCardPay,
  type PaymentsConfig,
  type SquareCardInstance,
} from "../components/SquareCardPay";

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
  const [payConfig, setPayConfig] = useState<PaymentsConfig | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<SquareCardInstance | null>(null);
  const [form, setForm] = useState({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    shipping_address1: "",
    shipping_address2: "",
    shipping_city: "Tupelo",
    shipping_state: "MS",
    shipping_zip: "",
    shipping_notes: "",
    delivery_date: "",
    delivery_window: "",
  });
  const [windows, setWindows] = useState<{ dates: string[]; windows: string[] } | null>(null);
  const [addresses, setAddresses] = useState<
    Array<{
      id: string;
      label: string | null;
      name: string | null;
      phone: string | null;
      address1: string;
      address2: string | null;
      city: string;
      state: string;
      zip: string;
      is_default: number;
    }>
  >([]);

  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({
      ...f,
      customer_name: f.customer_name || customer.name,
      customer_email: f.customer_email || customer.email,
      customer_phone: f.customer_phone || customer.phone || "",
    }));
    api<{ addresses: typeof addresses }>("/api/account/addresses")
      .then((d) => setAddresses(d.addresses || []))
      .catch(() => setAddresses([]));
  }, [customer]);

  useEffect(() => {
    api<DeliveryOpts>("/api/delivery/config").then((d) => {
      setOpts(d);
      if (!d.delivery_enabled && d.pickup_enabled) setMethod("pickup");
      if (d.delivery_enabled && !d.pickup_enabled) setMethod("delivery");
    });
    api<{ dates: string[]; windows: string[] }>("/api/delivery/windows")
      .then((d) => {
        setWindows(d);
        setForm((f) => ({
          ...f,
          delivery_date: f.delivery_date || d.dates[0] || "",
          delivery_window: f.delivery_window || d.windows[0] || "",
        }));
      })
      .catch(() => setWindows(null));
    api<PaymentsConfig>("/api/payments/config")
      .then(setPayConfig)
      .catch(() => setPayConfig({ enabled: false, applicationId: null, locationId: null, environment: "sandbox" }));
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
      if (!payConfig?.enabled) {
        throw new Error("Online card payment is required. Payments are unavailable right now — try again shortly.");
      }
      const card = cardRef.current;
      if (!card || !cardReady) {
        throw new Error("Card form is still loading — wait a moment and try again");
      }
      const result = await card.tokenize();
      if (result.status !== "OK" || !result.token) {
        throw new Error(
          result.errors?.map((x) => x.message).filter(Boolean).join("; ") ||
            "Card payment was declined or incomplete",
        );
      }

      const res = await api<{ order_number: string; payment_status?: string }>("/api/orders", {
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
          source_id: result.token,
          idempotency_key: crypto.randomUUID(),
          delivery_date: method === "delivery" ? form.delivery_date || undefined : undefined,
          delivery_window: method === "delivery" ? form.delivery_window || undefined : undefined,
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
  const paymentsOn = !!payConfig?.enabled;

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
              {addresses.length > 0 && (
                <div className="field">
                  <label>Saved address</label>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const a = addresses.find((x) => x.id === e.target.value);
                      if (!a) return;
                      setForm((f) => ({
                        ...f,
                        customer_name: a.name || f.customer_name,
                        customer_phone: a.phone || f.customer_phone,
                        shipping_address1: a.address1,
                        shipping_address2: a.address2 || "",
                        shipping_city: a.city,
                        shipping_state: a.state,
                        shipping_zip: a.zip,
                      }));
                    }}
                  >
                    <option value="">Choose a saved address…</option>
                    {addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {(a.label || "Address") + ` — ${a.address1}, ${a.city}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>Delivery date</label>
                <DeliveryDatePicker
                  dates={windows?.dates || []}
                  value={form.delivery_date}
                  onChange={(d) => set("delivery_date", d)}
                  required
                />
              </div>
              <div className="field">
                <label>Time window</label>
                <select
                  required
                  value={form.delivery_window}
                  onChange={(e) => set("delivery_window", e.target.value)}
                >
                  {(windows?.windows || []).map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
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
                <label>ZIP</label>
                <input
                  required
                  value={form.shipping_zip}
                  onChange={(e) => set("shipping_zip", e.target.value)}
                  placeholder="ZIP"
                />
                <small className="muted">Enter your ZIP to confirm we deliver there.</small>
                {areaPopup && method === "delivery" && (
                  <small style={{ color: "var(--danger)", display: "block", marginTop: 6 }}>
                    {areaPopup}
                  </small>
                )}
              </div>
            </>
          )}
          {method === "pickup" && (
            <div className="field">
              <label>Pickup contact ZIP (optional)</label>
              <input
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

          {paymentsOn && payConfig && (
            <SquareCardPay
              config={payConfig}
              cardRef={cardRef}
              onReadyChange={setCardReady}
            />
          )}

          {!paymentsOn && (
            <p style={{ color: "var(--danger)", fontSize: "0.9rem" }}>
              Card payment is required and is temporarily unavailable. Orders cannot be placed until
              payments are back online.
            </p>
          )}

          {error && !areaPopup && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={submitting || blocked || !paymentsOn || !cardReady}
          >
            {submitting
              ? "Processing payment…"
              : `Pay ${money(quote?.total_cents ?? subtotal)} & place order`}
          </button>
        </aside>
      </form>

      <Modal
        open={!!areaPopup && method === "delivery"}
        title="Outside delivery area"
        onClose={() => setAreaPopup("")}
      >
        <p style={{ margin: 0, lineHeight: 1.55 }}>{areaPopup}</p>
      </Modal>
    </div>
  );
}
