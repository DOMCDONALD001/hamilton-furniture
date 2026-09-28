import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, money } from "../lib/api";
import { useCustomer } from "../lib/customer";

export function AccountPage() {
  const { customer, loading, login, register, logout, refresh } = useCustomer();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">(
    params.get("mode") === "register" ? "register" : "login",
  );
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
  });
  const [orders, setOrders] = useState<
    Array<{
      order_number: string;
      status: string;
      total_cents: number;
      created_at: string;
      delivery_method: string;
    }>
  >([]);
  const [addresses, setAddresses] = useState<
    Array<{
      id: string;
      label: string | null;
      address1: string;
      address2: string | null;
      city: string;
      state: string;
      zip: string;
      is_default: number;
    }>
  >([]);
  const [addrForm, setAddrForm] = useState({
    label: "Home",
    address1: "",
    address2: "",
    city: "Tupelo",
    state: "MS",
    zip: "",
    is_default: true,
  });

  useEffect(() => {
    if (!customer) return;
    api<{ orders: typeof orders }>("/api/account/orders")
      .then((d) => setOrders(d.orders))
      .catch(() => setOrders([]));
    api<{ addresses: typeof addresses }>("/api/account/addresses")
      .then((d) => setAddresses(d.addresses || []))
      .catch(() => setAddresses([]));
  }, [customer]);

  async function saveAddress(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/account/addresses", {
        method: "POST",
        body: JSON.stringify({
          ...addrForm,
          name: customer?.name,
          phone: customer?.phone,
        }),
      });
      const refreshed = await api<{ addresses: typeof addresses }>("/api/account/addresses");
      setAddresses(refreshed.addresses || []);
      setAddrForm({
        label: "Home",
        address1: "",
        address2: "",
        city: "Tupelo",
        state: "MS",
        zip: "",
        is_default: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save address");
    }
  }

  async function removeAddress(id: string) {
    await api(`/api/account/addresses/${id}`, { method: "DELETE" });
    setAddresses((a) => a.filter((x) => x.id !== id));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "login") {
        await login(form.email, form.password);
      } else {
        await register({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone || undefined,
        });
      }
      await refresh();
      const next = params.get("next");
      if (next) navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (loading) return <div className="shell empty">Loading account…</div>;

  if (!customer) {
    return (
      <div className="shell" style={{ maxWidth: 480, marginBottom: "3rem" }}>
        <div className="section-head">
          <div>
            <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
            <p>
              {params.get("next")?.includes("/auctions")
                ? "Sign in required to bid on auctions."
                : "Optional — guests can still shop. Accounts unlock member-only offers and auctions."}
            </p>
          </div>
        </div>
        <form className="panel" onSubmit={onSubmit}>
          {mode === "register" && (
            <div className="field">
              <label>Full name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          {mode === "register" && (
            <div className="field">
              <label>Phone (optional)</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          )}
          <div className="field">
            <label>Password</label>
            <input
              required
              type="password"
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button className="btn btn-dark" style={{ width: "100%" }}>
            {mode === "login" ? "Sign in" : "Create free account"}
          </button>
          <p style={{ marginTop: "1rem", textAlign: "center" }}>
            {mode === "login" ? (
              <>
                No account?{" "}
                <button type="button" className="linkish" onClick={() => setMode("register")}>
                  Register
                </button>
              </>
            ) : (
              <>
                Already have one?{" "}
                <button type="button" className="linkish" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </p>
          <p className="muted" style={{ textAlign: "center", fontSize: "0.85rem" }}>
            Prefer not to? <Link to="/shop">Continue as guest</Link>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="shell" style={{ maxWidth: 720, marginBottom: "3rem" }}>
      <div className="section-head">
        <div>
          <h2>Hi, {customer.name.split(" ")[0]}</h2>
          <p>Member account · {customer.email}</p>
        </div>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => logout()}>
          Log out
        </button>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Member perks</h3>
        <p className="muted" style={{ margin: 0 }}>
          You’re signed in — member-only promo codes (like <strong>MEMBER15</strong>) work at
          checkout. Guests cannot use those offers.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Saved addresses</h3>
        {addresses.length ? (
          <ul style={{ paddingLeft: "1.1rem", marginTop: 0 }}>
            {addresses.map((a) => (
              <li key={a.id} style={{ marginBottom: "0.5rem" }}>
                <strong>{a.label || "Address"}</strong>
                {a.is_default ? " · default" : ""} — {a.address1}
                {a.address2 ? `, ${a.address2}` : ""}, {a.city}, {a.state} {a.zip}{" "}
                <button type="button" className="linkish" onClick={() => removeAddress(a.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No saved addresses yet.</p>
        )}
        <form onSubmit={saveAddress}>
          <div className="grid-2">
            <div className="field">
              <label>Label</label>
              <input
                value={addrForm.label}
                onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })}
              />
            </div>
            <div className="field">
              <label>ZIP</label>
              <input
                required
                value={addrForm.zip}
                onChange={(e) => setAddrForm({ ...addrForm, zip: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>Street</label>
            <input
              required
              value={addrForm.address1}
              onChange={(e) => setAddrForm({ ...addrForm, address1: e.target.value })}
            />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>City</label>
              <input
                required
                value={addrForm.city}
                onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })}
              />
            </div>
            <div className="field">
              <label>State</label>
              <input
                required
                value={addrForm.state}
                onChange={(e) => setAddrForm({ ...addrForm, state: e.target.value })}
              />
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={addrForm.is_default}
              onChange={(e) => setAddrForm({ ...addrForm, is_default: e.target.checked })}
            />
            Default address
          </label>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button className="btn btn-outline btn-sm" type="submit">
            Save address
          </button>
        </form>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Your orders</h3>
        {orders.length ? (
          <table className="bid-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_number}>
                  <td>{o.order_number}</td>
                  <td>{o.status.replaceAll("_", " ")}</td>
                  <td>{money(o.total_cents)}</td>
                  <td>
                    <Link
                      to={`/orders?number=${encodeURIComponent(o.order_number)}&email=${encodeURIComponent(customer.email)}`}
                    >
                      Track
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No orders linked yet.</p>
        )}
      </div>
    </div>
  );
}
