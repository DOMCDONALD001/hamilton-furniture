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

  useEffect(() => {
    if (!customer) return;
    api<{ orders: typeof orders }>("/api/account/orders")
      .then((d) => setOrders(d.orders))
      .catch(() => setOrders([]));
  }, [customer]);

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
            <p>Optional — guests can still shop. Accounts unlock member-only offers.</p>
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
          Sign out
        </button>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Member perks</h3>
        <p className="muted" style={{ margin: 0 }}>
          You’re signed in — member-only promo codes (like <strong>MEMBER15</strong>) work at
          checkout. Guests cannot use those offers.
        </p>
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
