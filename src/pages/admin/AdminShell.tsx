import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, money } from "../../lib/api";
import { Modal, ToastProvider, useToast } from "../../components/AdminUI";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      navigate("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand-mark" style={{ marginBottom: "0.35rem" }}>
          Hamilton Odds N Ends
        </div>
        <p className="muted" style={{ color: "#9aa49d" }}>
          Owner admin — inventory, orders, revenue, delivery
        </p>
        <div className="field">
          <label>Admin password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Default local: hamilton-admin"
          />
        </div>
        {error && <p style={{ color: "#e0b8b6" }}>{error}</p>}
        <button className="btn btn-primary" style={{ width: "100%" }}>
          Sign in
        </button>
        <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#8f9a93" }}>
          <Link to="/">← Back to store</Link>
        </p>
      </form>
    </div>
  );
}

function AdminChrome() {
  const navigate = useNavigate();
  const toast = useToast();

  async function logout() {
    await api("/api/admin/logout", { method: "POST" });
    toast.push("Signed out", "info");
    navigate("/admin/login");
  }

  return (
    <div className="admin-shell">
      <aside className="admin-nav">
        <div className="brand-mark">Owner Admin</div>
        <NavLink to="/admin" end>
          Dashboard
        </NavLink>
        <NavLink to="/admin/products">Inventory</NavLink>
        <NavLink to="/admin/auctions">Auctions</NavLink>
        <NavLink to="/admin/orders">Orders</NavLink>
        <NavLink to="/admin/revenue">Revenue</NavLink>
        <NavLink to="/admin/discounts">Offers</NavLink>
        <NavLink to="/admin/delivery">Delivery</NavLink>
        <NavLink to="/admin/settings">Settings</NavLink>
        <button
          className="btn btn-outline btn-sm"
          style={{ marginTop: "auto", color: "#fff", borderColor: "#3a4540" }}
          onClick={logout}
          type="button"
        >
          Log out
        </button>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

export function AdminLayout() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ authenticated: boolean }>("/api/admin/me")
      .then((d) => setOk(d.authenticated))
      .catch(() => setOk(false));
  }, []);

  if (ok === null) return <div className="login-page">Checking session…</div>;
  if (!ok) return <Navigate to="/admin/login" replace />;

  return (
    <ToastProvider>
      <AdminChrome />
    </ToastProvider>
  );
}

export function AdminDashboard() {
  const toast = useToast();
  const navigate = useNavigate();
  const [quickOpen, setQuickOpen] = useState(false);
  const [orderModal, setOrderModal] = useState<{
    order: {
      id: string;
      order_number: string;
      customer_name: string;
      customer_email: string;
      customer_phone: string | null;
      shipping_address1: string;
      shipping_city: string;
      shipping_state: string;
      shipping_zip: string;
      delivery_method: string;
      status: string;
      total_cents: number;
      shipping_notes?: string | null;
    };
    items: Array<{
      product_name: string;
      product_sku: string;
      quantity: number;
      line_total_cents: number;
      image?: string | null;
      ship_label?: {
        dimensions: string | null;
        condition: string | null;
        color: string | null;
        material: string | null;
        weight_lbs: number | null;
      };
      product?: { description?: string; brand?: string | null } | null;
    }>;
  } | null>(null);
  const [data, setData] = useState<{
    stats: {
      products: number;
      low_stock: number;
      open_orders: number;
      revenue_cents: number;
    };
    recent_orders: Array<{
      id: string;
      order_number: string;
      customer_name: string;
      status: string;
      payment_status?: string;
      total_cents: number;
      created_at: string;
    }>;
    low_stock_items: Array<{
      id: string;
      name: string;
      sku: string;
      stock: number;
    }>;
  } | null>(null);

  useEffect(() => {
    api<NonNullable<typeof data>>("/api/admin/dashboard")
      .then(setData)
      .catch(() => toast.push("Dashboard failed to load", "err"));
  }, []);

  async function openOrder(id: string) {
    try {
      const detail = await api<NonNullable<typeof orderModal>>(`/api/admin/orders/${id}`);
      setOrderModal(detail);
    } catch {
      toast.push("Could not load order details", "err");
    }
  }

  if (!data) return <p>Loading dashboard…</p>;

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setQuickOpen(true)}>
          Quick actions
        </button>
      </div>

      <div className="stats">
        <div className="stat clickable" onClick={() => navigate("/admin/products")} role="button" tabIndex={0}>
          <div className="label">Products</div>
          <div className="value">{data.stats.products}</div>
        </div>
        <div className="stat clickable" onClick={() => navigate("/admin/products")} role="button" tabIndex={0}>
          <div className="label">Low stock</div>
          <div className="value">{data.stats.low_stock}</div>
        </div>
        <div className="stat clickable" onClick={() => navigate("/admin/orders")} role="button" tabIndex={0}>
          <div className="label">Open orders</div>
          <div className="value">{data.stats.open_orders}</div>
        </div>
        <div className="stat clickable" onClick={() => navigate("/admin/revenue")} role="button" tabIndex={0}>
          <div className="label">Paid revenue</div>
          <div className="value">{money(data.stats.revenue_cents)}</div>
        </div>
      </div>

      <div className="admin-panel">
        <h3 style={{ marginTop: 0 }}>Recent orders</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Click an order to see product photos, sizes, and what to ship.
        </p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_orders.map((o) => (
              <tr
                key={o.id}
                style={{ cursor: "pointer" }}
                onClick={() => openOrder(o.id)}
              >
                <td>
                  <strong>{o.order_number}</strong>
                </td>
                <td>{o.customer_name}</td>
                <td>
                  <span className={`status ${o.status}`}>{o.status}</span>
                </td>
                <td>{money(o.total_cents)}</td>
              </tr>
            ))}
            {!data.recent_orders.length && (
              <tr>
                <td colSpan={4} className="muted">
                  No orders yet — place a test order from the storefront.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-panel">
        <h3 style={{ marginTop: 0 }}>Low stock alerts</h3>
        {data.low_stock_items.length === 0 ? (
          <p className="muted">All good.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.low_stock_items.map((p) => (
                <tr key={p.id}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.stock}</td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => navigate("/admin/products")}
                    >
                      Restock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={quickOpen} title="Quick actions" onClose={() => setQuickOpen(false)}>
        <div className="quick-actions">
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/products");
            }}
          >
            Add / edit inventory
          </button>
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/auctions");
            }}
          >
            Create / manage auctions
          </button>
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/orders");
            }}
          >
            Manage orders & deliveries
          </button>
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/revenue");
            }}
          >
            Revenue & statements
          </button>
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/delivery");
            }}
          >
            Restrict delivery ZIPs
          </button>
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/discounts");
            }}
          >
            Create an offer
          </button>
        </div>
      </Modal>

      <Modal
        open={!!orderModal}
        title={orderModal ? `Order ${orderModal.order.order_number}` : "Order"}
        onClose={() => setOrderModal(null)}
        wide
        footer={
          orderModal ? (
            <>
              <button className="btn btn-outline" type="button" onClick={() => setOrderModal(null)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  const id = orderModal.order.id;
                  setOrderModal(null);
                  navigate(`/admin/orders?focus=${id}`);
                }}
              >
                Open full order manager
              </button>
            </>
          ) : undefined
        }
      >
        {orderModal && (
          <div>
            <p>
              <strong>{orderModal.order.customer_name}</strong>
              <br />
              {orderModal.order.customer_email}
              {orderModal.order.customer_phone ? ` · ${orderModal.order.customer_phone}` : ""}
            </p>
            <p>
              <strong>
                {orderModal.order.delivery_method === "pickup" ? "Pickup" : "Ship to"}:
              </strong>{" "}
              {orderModal.order.shipping_address1}, {orderModal.order.shipping_city},{" "}
              {orderModal.order.shipping_state} {orderModal.order.shipping_zip}
            </p>
            <h4>What to ship</h4>
            <div className="ship-items">
              {orderModal.items.map((i) => (
                <div className="ship-item" key={i.product_sku + i.product_name}>
                  <img
                    src={i.image || "/api/images/placeholder"}
                    alt=""
                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }}
                  />
                  <div style={{ flex: 1 }}>
                    <strong>
                      {i.quantity}× {i.product_name}
                    </strong>
                    <div className="muted">SKU {i.product_sku}</div>
                    <div className="muted">
                      {[
                        i.ship_label?.dimensions && `Size ${i.ship_label.dimensions}`,
                        i.ship_label?.weight_lbs != null && `${i.ship_label.weight_lbs} lbs`,
                        i.ship_label?.condition,
                        i.ship_label?.color,
                        i.ship_label?.material,
                        i.product?.brand,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <strong>{money(i.line_total_cents)}</strong>
                </div>
              ))}
            </div>
            <div className="summary-row total">
              <span>Order total</span>
              <span>{money(orderModal.order.total_cents)}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
