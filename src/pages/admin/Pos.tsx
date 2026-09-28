import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../../lib/api";
import { useToast } from "../../components/AdminUI";

type Product = {
  id: string;
  name: string;
  sku: string;
  price_cents: number;
  stock: number;
  status: string;
};

type Line = { product_id: string; name: string; sku: string; price_cents: number; quantity: number };

export function AdminPos() {
  const toast = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [customer, setCustomer] = useState({
    customer_name: "In-store customer",
    customer_email: "",
    customer_phone: "",
    payment_method: "cash" as "cash" | "card_terminal" | "other",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: Record<string, string> }>("/api/admin/settings")
      .then((d) => setAllowed(d.settings.show_pos_tab === "1"))
      .catch(() => setAllowed(false));
    api<{ products: Product[] }>("/api/admin/products")
      .then((d) => setProducts(d.products.filter((p) => p.status !== "archived")))
      .catch(() => toast.push("Could not load products", "err"));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products.slice(0, 40);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.sku.toLowerCase().includes(needle),
      )
      .slice(0, 40);
  }, [products, q]);

  const total = cart.reduce((s, l) => s + l.price_cents * l.quantity, 0);

  if (allowed === null) return <p className="muted">Loading…</p>;
  if (!allowed) {
    return (
      <div>
        <h1>In-store sale</h1>
        <p className="muted">
          This tab is turned off. Enable it under{" "}
          <Link to="/admin/settings">Settings → Admin features</Link>.
        </p>
      </div>
    );
  }

  function add(p: Product) {
    setCart((prev) => {
      const existing = prev.find((x) => x.product_id === p.id);
      if (existing) {
        return prev.map((x) =>
          x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x,
        );
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          sku: p.sku,
          price_cents: p.price_cents,
          quantity: 1,
        },
      ];
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cart.length) {
      toast.push("Add at least one item", "err");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ order: { order_number: string; total_cents: number } }>(
        "/api/admin/pos-sale",
        {
          method: "POST",
          body: JSON.stringify({
            ...customer,
            customer_email: customer.customer_email || undefined,
            items: cart.map((l) => ({
              product_id: l.product_id,
              quantity: l.quantity,
            })),
          }),
        },
      );
      toast.push(`Sale recorded · ${res.order.order_number} · ${money(res.order.total_cents)}`);
      setCart([]);
      setCustomer((c) => ({ ...c, notes: "", customer_phone: "" }));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Sale failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>In-store sale</h1>
      <p className="muted">Cash / terminal sales — no Square online charge.</p>
      <div className="split-layout">
        <div className="admin-panel">
          <div className="toolbar">
            <input
              placeholder="Search inventory"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 220 }}
            />
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Price</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{money(p.price_cents)}</td>
                  <td>{p.stock}</td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      disabled={p.stock < 1}
                      onClick={() => add(p)}
                    >
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="admin-panel" onSubmit={onSubmit}>
          <h3 style={{ marginTop: 0 }}>Cart</h3>
          {!cart.length && <p className="muted">No items yet.</p>}
          {cart.map((l) => (
            <div className="summary-row" key={l.product_id}>
              <span>
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    setCart((prev) => prev.filter((x) => x.product_id !== l.product_id))
                  }
                >
                  ×
                </button>{" "}
                {l.quantity}× {l.name}
              </span>
              <span>
                <input
                  type="number"
                  min={1}
                  value={l.quantity}
                  style={{ width: 56 }}
                  onChange={(e) =>
                    setCart((prev) =>
                      prev.map((x) =>
                        x.product_id === l.product_id
                          ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) }
                          : x,
                      ),
                    )
                  }
                />{" "}
                {money(l.price_cents * l.quantity)}
              </span>
            </div>
          ))}
          <div className="summary-row total">
            <span>Subtotal (tax applied on save)</span>
            <span>{money(total)}</span>
          </div>
          <div className="field">
            <label>Customer name</label>
            <input
              value={customer.customer_name}
              onChange={(e) => setCustomer({ ...customer, customer_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email (optional)</label>
            <input
              type="email"
              value={customer.customer_email}
              onChange={(e) => setCustomer({ ...customer, customer_email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              value={customer.customer_phone}
              onChange={(e) => setCustomer({ ...customer, customer_phone: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Payment</label>
            <select
              value={customer.payment_method}
              onChange={(e) =>
                setCustomer({
                  ...customer,
                  payment_method: e.target.value as typeof customer.payment_method,
                })
              }
            >
              <option value="cash">Cash</option>
              <option value="card_terminal">Card terminal</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea
              rows={2}
              value={customer.notes}
              onChange={(e) => setCustomer({ ...customer, notes: e.target.value })}
            />
          </div>
          <button className="btn btn-primary" disabled={busy || !cart.length}>
            {busy ? "Saving…" : "Complete sale"}
          </button>
          <p style={{ marginTop: "1rem" }}>
            <Link to="/admin/orders">View orders →</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
