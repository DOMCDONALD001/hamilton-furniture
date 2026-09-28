import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, money } from "../../lib/api";
import { Modal, ToastProvider, useToast } from "../../components/AdminUI";

export function AdminLogin() {
  const [email, setEmail] = useState("hamiltonsbikes216@gmail.com");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api<{ needs_setup: boolean; email: string }>("/api/admin/setup-status")
      .then((d) => {
        setNeedsSetup(d.needs_setup);
        if (d.email) setEmail(d.email);
      })
      .catch(() => setNeedsSetup(false));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (needsSetup) {
        if (password !== confirm) {
          setError("Passwords do not match");
          return;
        }
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          return;
        }
        await api("/api/admin/setup", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      } else {
        await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }
      navigate("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  if (needsSetup === null) {
    return <div className="login-page">Loading…</div>;
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand-mark" style={{ marginBottom: "0.35rem" }}>
          Hamilton's Odds N Ends
        </div>
        <p className="muted" style={{ color: "#9aa49d" }}>
          {needsSetup
            ? "Create your owner account password to finish setup"
            : "Sign in with your owner account"}
        </p>
        <div className="field">
          <label>Admin email</label>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={needsSetup}
          />
        </div>
        <div className="field">
          <label>{needsSetup ? "Create password" : "Password"}</label>
          <input
            type="password"
            required
            autoComplete={needsSetup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={needsSetup ? "At least 8 characters" : ""}
          />
        </div>
        {needsSetup && (
          <div className="field">
            <label>Confirm password</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}
        {error && <p style={{ color: "#e0b8b6" }}>{error}</p>}
        <button className="btn btn-primary" style={{ width: "100%" }}>
          {needsSetup ? "Create account & sign in" : "Sign in"}
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
  const location = useLocation();
  const toast = useToast();
  const [adminEmail, setAdminEmail] = useState("");
  const [showPos, setShowPos] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    api<{ authenticated: boolean; email: string | null }>("/api/admin/me")
      .then((d) => {
        if (d.email) setAdminEmail(d.email);
      })
      .catch(() => {});
    api<{ settings: Record<string, string> }>("/api/admin/settings")
      .then((d) => setShowPos(d.settings.show_pos_tab === "1"))
      .catch(() => setShowPos(false));
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  async function logout() {
    await api("/api/admin/logout", { method: "POST" });
    toast.push("Signed out", "info");
    navigate("/admin/login");
  }

  function closeNav() {
    setNavOpen(false);
  }

  const nav = (
    <>
      <div className="brand-mark">Owner Admin</div>
      {adminEmail && (
        <p className="admin-nav-email">
          {adminEmail}
        </p>
      )}
      <NavLink to="/admin" end onClick={closeNav}>
        Dashboard
      </NavLink>
      <NavLink to="/admin/products" onClick={closeNav}>
        Inventory
      </NavLink>
      <NavLink to="/admin/photos" onClick={closeNav}>
        Photo dropspace
      </NavLink>
      <NavLink to="/admin/inventory-report" onClick={closeNav}>
        SKU report
      </NavLink>
      {showPos && (
        <NavLink to="/admin/pos" onClick={closeNav}>
          In-store sale
        </NavLink>
      )}
      <NavLink to="/admin/auctions" onClick={closeNav}>
        Auctions
      </NavLink>
      <NavLink to="/admin/orders" onClick={closeNav}>
        Orders
      </NavLink>
      <NavLink to="/admin/claims" onClick={closeNav}>
        Claims
      </NavLink>
      <NavLink to="/admin/routes" onClick={closeNav}>
        Assign drivers
      </NavLink>
      <NavLink to="/admin/live" onClick={closeNav}>
        Live drivers
      </NavLink>
      <NavLink to="/admin/drivers" onClick={closeNav}>
        Drivers
      </NavLink>
      <NavLink to="/admin/reports" onClick={closeNav}>
        Reports
      </NavLink>
      <NavLink to="/admin/revenue" onClick={closeNav}>
        Revenue
      </NavLink>
      <NavLink to="/admin/discounts" onClick={closeNav}>
        Offers
      </NavLink>
      <NavLink to="/admin/delivery" onClick={closeNav}>
        Delivery
      </NavLink>
      <NavLink to="/admin/settings" onClick={closeNav}>
        Settings
      </NavLink>
      <div className="admin-nav-footer">
        <NavLink to="/admin/settings" className="admin-settings-link" onClick={closeNav}>
          Store page settings
        </NavLink>
        <button className="admin-logout-btn" type="button" onClick={logout}>
          Log out
        </button>
      </div>
    </>
  );

  return (
    <div className={`admin-shell${navOpen ? " nav-open" : ""}`}>
      <header className="admin-mobile-bar">
        <button
          className="admin-menu-btn"
          type="button"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}
        >
          <span className="admin-menu-bars" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          Menu
        </button>
        <div className="admin-mobile-title">Owner Admin</div>
        <Link className="admin-mobile-photos" to="/admin/photos" onClick={closeNav}>
          Photos
        </Link>
      </header>

      {navOpen && (
        <button
          className="admin-nav-backdrop"
          type="button"
          aria-label="Close menu"
          onClick={closeNav}
        />
      )}

      <aside className="admin-nav" id="admin-nav">
        {nav}
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
  const [showPos, setShowPos] = useState(false);
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
      open_issues?: number;
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
  const [today, setToday] = useState<{
    date: string;
    stats: {
      open_issues: number;
      open_claims: number;
      routes_today: number;
      routes_incomplete: number;
      deliveries_today: number;
      low_stock: number;
    };
    orders: Array<{
      id: string;
      order_number: string;
      customer_name: string;
      status: string;
      total_cents: number;
      delivery_date: string | null;
      delivery_window: string | null;
      delivery_method: string;
    }>;
    incomplete_routes: Array<{
      id: string;
      name: string;
      status: string;
      driver_name: string | null;
      stop_count: number;
      delivered_count: number;
    }>;
  } | null>(null);

  useEffect(() => {
    api<NonNullable<typeof data>>("/api/admin/dashboard")
      .then(setData)
      .catch(() => toast.push("Dashboard failed to load", "err"));
    api<NonNullable<typeof today>>("/api/admin/today")
      .then(setToday)
      .catch(() => {});
    api<{ settings: Record<string, string> }>("/api/admin/settings")
      .then((d) => setShowPos(d.settings.show_pos_tab === "1"))
      .catch(() => setShowPos(false));
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

      {today && (
        <div className="admin-panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Today · {today.date}</h3>
          <div className="stats" style={{ marginBottom: "1rem" }}>
            <div className="stat clickable" onClick={() => navigate("/admin/routes")} role="button" tabIndex={0}>
              <div className="label">Routes today</div>
              <div className="value">{today.stats.routes_today}</div>
            </div>
            <div className="stat clickable" onClick={() => navigate("/admin/routes")} role="button" tabIndex={0}>
              <div className="label">Incomplete routes</div>
              <div className="value">{today.stats.routes_incomplete}</div>
            </div>
            <div className="stat">
              <div className="label">Scheduled deliveries</div>
              <div className="value">{today.stats.deliveries_today}</div>
            </div>
            <div className="stat clickable" onClick={() => navigate("/admin/claims")} role="button" tabIndex={0}>
              <div className="label">Open claims</div>
              <div className="value">{today.stats.open_claims}</div>
            </div>
            <div className="stat clickable" onClick={() => navigate("/admin/reports")} role="button" tabIndex={0}>
              <div className="label">Open issues</div>
              <div className="value">{today.stats.open_issues}</div>
            </div>
          </div>
          {today.incomplete_routes.length > 0 && (
            <>
              <h4 style={{ marginBottom: "0.35rem" }}>Routes in progress</h4>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Driver</th>
                    <th>Progress</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {today.incomplete_routes.map((r) => (
                    <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => navigate("/admin/routes")}>
                      <td>{r.name}</td>
                      <td>{r.driver_name || "—"}</td>
                      <td>
                        {r.delivered_count}/{r.stop_count}
                      </td>
                      <td>
                        <span className={`status ${r.status}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {today.orders.length > 0 && (
            <>
              <h4 style={{ margin: "1rem 0 0.35rem" }}>Orders touching today</h4>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Window</th>
                    <th>Status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {today.orders.map((o) => (
                    <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => openOrder(o.id)}>
                      <td>
                        <strong>{o.order_number}</strong>
                      </td>
                      <td>{o.customer_name}</td>
                      <td>
                        {o.delivery_date || "—"}
                        {o.delivery_window ? ` · ${o.delivery_window}` : ""}
                      </td>
                      <td>
                        <span className={`status ${o.status}`}>{o.status}</span>
                      </td>
                      <td>{money(o.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

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
        <div className="stat clickable" onClick={() => navigate("/admin/reports")} role="button" tabIndex={0}>
          <div className="label">Open reports</div>
          <div className="value">{data.stats.open_issues ?? 0}</div>
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
              navigate("/admin/photos");
            }}
          >
            Photo dropspace (phone pics)
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
          {showPos && (
            <button
              className="btn btn-dark"
              type="button"
              onClick={() => {
                setQuickOpen(false);
                navigate("/admin/pos");
              }}
            >
              In-store / cash sale
            </button>
          )}
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/claims");
            }}
          >
            Returns & claims
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
              navigate("/admin/routes");
            }}
          >
            Assign delivery routes
          </button>
          <button
            className="btn btn-dark"
            type="button"
            onClick={() => {
              setQuickOpen(false);
              navigate("/admin/drivers");
            }}
          >
            Manage drivers
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
