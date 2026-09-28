import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { api, money } from "../../lib/api";
import { ToastProvider, useToast } from "../../components/AdminUI";

const ISSUE_TYPES = [
  { value: "customer_not_home", label: "Customer not home" },
  { value: "wrong_address", label: "Wrong address" },
  { value: "access_issue", label: "Access / parking" },
  { value: "damaged", label: "Item damaged" },
  { value: "refused", label: "Customer refused" },
  { value: "other", label: "Other" },
];

export function DriverLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/driver/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      navigate("/driver");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login-page driver-login">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand-mark" style={{ marginBottom: "0.35rem" }}>
          Driver portal
        </div>
        <p className="muted" style={{ color: "#9aa49d" }}>
          Delivery routes only — mark delivered or report an issue.
        </p>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

function DriverChrome() {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<"off" | "on" | "denied">("off");
  const watchRef = useRef<number | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    api<{ name: string | null }>("/api/driver/me").then((d) => {
      if (d.name) setName(d.name);
    });
  }, []);

  // Share live GPS while the driver portal is open (admin Live board)
  useEffect(() => {
    if (!navigator.geolocation) {
      setSharing("denied");
      return;
    }

    const send = (pos: GeolocationPosition) => {
      const now = Date.now();
      if (now - lastSent.current < 20000) return; // throttle ~20s
      lastSent.current = now;
      const routeMatch = window.location.pathname.match(/\/driver\/routes\/([^/]+)/);
      void api("/api/driver/location", {
        method: "POST",
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed_mps: pos.coords.speed,
          route_id: routeMatch?.[1] || null,
        }),
      })
        .then(() => setSharing("on"))
        .catch(() => {
          /* keep trying */
        });
    };

    watchRef.current = navigator.geolocation.watchPosition(
      send,
      () => setSharing("denied"),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );

    const onVis = () => {
      if (document.visibilityState === "visible" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(send, () => setSharing("denied"), {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 5000,
        });
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  async function logout() {
    try {
      await api("/api/driver/location", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    await api("/api/driver/logout", { method: "POST" });
    toast.push("Signed out", "info");
    navigate("/driver/login");
  }

  return (
    <div className="admin-shell driver-shell">
      <aside className="admin-nav">
        <div className="brand-mark">Driver</div>
        {name && (
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#9aa49d" }}>{name}</p>
        )}
        <p
          className="muted"
          style={{
            margin: "0 0 0.85rem",
            fontSize: "0.75rem",
            color:
              sharing === "on" ? "#9dcea8" : sharing === "denied" ? "#e0b8b6" : "#9aa49d",
          }}
        >
          {sharing === "on"
            ? "Live location sharing on"
            : sharing === "denied"
              ? "Location blocked — enable for live tracking"
              : "Starting location…"}
        </p>
        <NavLink to="/driver" end>
          My routes
        </NavLink>
        <NavLink to="/driver/issues">My issues</NavLink>
        <div className="admin-nav-footer">
          <button className="admin-logout-btn" type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

export function DriverLayout() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ authenticated: boolean }>("/api/driver/me")
      .then((d) => setOk(d.authenticated))
      .catch(() => setOk(false));
  }, []);

  if (ok === null) return <div className="login-page">Checking session…</div>;
  if (!ok) return <Navigate to="/driver/login" replace />;

  return (
    <ToastProvider>
      <DriverChrome />
    </ToastProvider>
  );
}

type RouteSummary = {
  id: string;
  name: string;
  route_date: string;
  status: string;
  stop_count: number;
  delivered_count: number;
  failed_count?: number;
  open_issue_count?: number;
};

export function DriverHome() {
  const toast = useToast();
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    api<{ routes: RouteSummary[] }>("/api/driver/routes")
      .then((d) => setRoutes(d.routes))
      .catch(() => toast.push("Could not load routes", "err"));
  }, []);

  const todayRoutes = routes.filter((r) => r.route_date === today);
  const other = routes.filter((r) => r.route_date !== today);

  return (
    <div>
      <h1>My routes</h1>
      <p className="muted">Open a route to navigate stops, mark delivered, or report a problem.</p>

      <div className="admin-panel">
        <h3 style={{ marginTop: 0 }}>Today · {today}</h3>
        {!todayRoutes.length ? (
          <p className="muted">No routes assigned for today.</p>
        ) : (
          <div className="driver-route-list">
            {todayRoutes.map((r) => {
              const hasIssue = (r.open_issue_count || 0) > 0 || (r.failed_count || 0) > 0;
              return (
                <Link
                  key={r.id}
                  to={`/driver/routes/${r.id}`}
                  className={`driver-route-card ${hasIssue ? "has-issue" : ""}`}
                >
                  <strong>
                    {r.name}
                    {hasIssue && (
                      <span className="route-issue-icon" title="Issue reported on this route">
                        !
                      </span>
                    )}
                  </strong>
                  <span className={`status ${r.status}`}>{r.status.replaceAll("_", " ")}</span>
                  <div className="muted">
                    {r.delivered_count}/{r.stop_count} delivered
                    {(r.failed_count || 0) > 0 ? ` · ${r.failed_count} issue` : ""}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {other.length > 0 && (
        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Other routes</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Route</th>
                <th>Progress</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {other.map((r) => {
                const hasIssue = (r.open_issue_count || 0) > 0 || (r.failed_count || 0) > 0;
                return (
                  <tr key={r.id}>
                    <td>{r.route_date}</td>
                    <td>
                      {r.name}
                      {hasIssue && <span className="route-issue-icon">!</span>}
                    </td>
                    <td>
                      {r.delivered_count}/{r.stop_count}
                    </td>
                    <td>
                      <span className={`status ${r.status}`}>{r.status.replaceAll("_", " ")}</span>
                    </td>
                    <td>
                      <Link className="btn btn-outline btn-sm" to={`/driver/routes/${r.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Stop = {
  id: string;
  order_id: string;
  stop_order: number;
  status: string;
  driver_note: string | null;
  order_number: string;
  customer_name: string;
  customer_phone: string | null;
  shipping_address1: string;
  shipping_address2: string | null;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  shipping_notes: string | null;
  order_status: string;
  total_cents: number;
  delivered_at?: string | null;
  delivered_lat?: number | null;
  delivered_lng?: number | null;
  delivered_accuracy_m?: number | null;
  delivered_geo_at?: string | null;
  open_issue_count?: number;
};

function readDeviceGeo(): Promise<{
  lat: number;
  lng: number;
  accuracy_m: number | null;
} | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m:
            typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

export function DriverRouteDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [route, setRoute] = useState<{
    name: string;
    route_date: string;
    status: string;
    open_issue_count?: number;
    failed_count?: number;
  } | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [issueStop, setIssueStop] = useState<Stop | null>(null);
  const [issueType, setIssueType] = useState("customer_not_home");
  const [issueMsg, setIssueMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    const data = await api<{ route: typeof route & object; stops: Stop[] }>(
      `/api/driver/routes/${id}`,
    );
    setRoute(data.route as typeof route);
    setStops(data.stops);
  }

  useEffect(() => {
    load().catch(() => toast.push("Route not found", "err"));
  }, [id]);

  async function setStopStatus(stopId: string, status: string) {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { status };
      if (status === "delivered") {
        const geo = await readDeviceGeo();
        if (geo) {
          payload.lat = geo.lat;
          payload.lng = geo.lng;
          if (geo.accuracy_m != null) payload.accuracy_m = geo.accuracy_m;
        }
      }
      const data = await api<{ route: typeof route & object; stops: Stop[] }>(
        `/api/driver/stops/${stopId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      setRoute(data.route as typeof route);
      setStops(data.stops);
      toast.push(
        status === "delivered"
          ? "Marked delivered"
          : status === "en_route"
            ? "En route"
            : "Stop updated",
      );
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Update failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitIssue(e: FormEvent) {
    e.preventDefault();
    if (!issueStop) return;
    setBusy(true);
    try {
      await api("/api/driver/issues", {
        method: "POST",
        body: JSON.stringify({
          stop_id: issueStop.id,
          issue_type: issueType,
          message: issueMsg,
        }),
      });
      toast.push("Issue reported to the store");
      setIssueStop(null);
      setIssueMsg("");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not report", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!route) return <p>Loading route…</p>;

  return (
    <div>
      <p style={{ marginBottom: 8 }}>
        <Link to="/driver">← All routes</Link>
      </p>
      <h1>
        {route.name}
        {((route.open_issue_count || 0) > 0 || (route.failed_count || 0) > 0) && (
          <span className="route-issue-icon" title="This route has an issue report">
            !
          </span>
        )}
      </h1>
      <p className="muted">
        {route.route_date} ·{" "}
        <span className={`status ${route.status}`}>{route.status.replaceAll("_", " ")}</span>
        {route.status === "completed" ? " · all stops finished" : ""}
      </p>

      <div className="driver-stops">
        {stops.map((s, idx) => {
          const maps = `https://maps.google.com/?q=${encodeURIComponent(
            `${s.shipping_address1}, ${s.shipping_city}, ${s.shipping_state} ${s.shipping_zip}`,
          )}`;
          const stopIssue = s.status === "failed" || (s.open_issue_count || 0) > 0;
          return (
            <article
              key={s.id}
              className={`driver-stop status-${s.status}${stopIssue ? " has-issue" : ""}`}
            >
              <div className="driver-stop-head">
                <span className="driver-stop-num">{idx + 1}</span>
                <div>
                  <strong>
                    {s.order_number}
                    {stopIssue && <span className="route-issue-icon">!</span>}
                  </strong>
                  <div>{s.customer_name}</div>
                  <div className="muted">{money(s.total_cents)}</div>
                </div>
                <span className={`status ${s.status}`}>{s.status.replaceAll("_", " ")}</span>
              </div>
              <p style={{ margin: "0.5rem 0" }}>
                {s.shipping_address1}
                {s.shipping_address2 ? `, ${s.shipping_address2}` : ""}
                <br />
                {s.shipping_city}, {s.shipping_state} {s.shipping_zip}
              </p>
              {s.customer_phone && (
                <p className="muted" style={{ margin: "0 0 0.5rem" }}>
                  <a href={`tel:${s.customer_phone}`}>{s.customer_phone}</a>
                </p>
              )}
              {s.shipping_notes && (
                <p className="muted" style={{ margin: "0 0 0.5rem" }}>
                  Notes: {s.shipping_notes}
                </p>
              )}
              {s.status === "skipped" && (
                <p style={{ margin: "0 0 0.5rem", color: "#e0b8b6" }}>
                  Removed from route
                  {s.driver_note ? ` — ${s.driver_note}` : " (cancelled / refunded)"}
                </p>
              )}
              <div className="driver-stop-actions">
                <a className="btn btn-outline btn-sm" href={maps} target="_blank" rel="noreferrer">
                  Maps
                </a>
                {s.status !== "delivered" && s.status !== "skipped" && (
                  <>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      disabled={busy || s.status === "en_route"}
                      onClick={() => setStopStatus(s.id, "en_route")}
                    >
                      En route
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => setStopStatus(s.id, "delivered")}
                    >
                      Delivered
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => setIssueStop(s)}
                    >
                      Report issue
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {issueStop && (
        <div className="driver-issue-modal">
          <form className="admin-panel" onSubmit={submitIssue}>
            <h3 style={{ marginTop: 0 }}>Report issue · {issueStop.order_number}</h3>
            <div className="field">
              <label>Type</label>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
                {ISSUE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>What happened?</label>
              <textarea
                required
                rows={3}
                value={issueMsg}
                onChange={(e) => setIssueMsg(e.target.value)}
                placeholder="Short note for the store…"
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-outline" type="button" onClick={() => setIssueStop(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                Send to store
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function DriverIssues() {
  const toast = useToast();
  const [issues, setIssues] = useState<
    Array<{
      id: string;
      order_number: string;
      customer_name: string;
      issue_type: string;
      message: string;
      status: string;
      created_at: string;
    }>
  >([]);

  useEffect(() => {
    api<{ issues: typeof issues }>("/api/driver/issues")
      .then((d) => setIssues(d.issues))
      .catch(() => toast.push("Could not load issues", "err"));
  }, []);

  return (
    <div>
      <h1>My issues</h1>
      <div className="admin-panel">
        {!issues.length ? (
          <p className="muted">You have not reported any issues yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Order</th>
                <th>Type</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td>{i.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    <strong>{i.order_number}</strong>
                    <div className="muted">{i.customer_name}</div>
                  </td>
                  <td>{i.issue_type.replaceAll("_", " ")}</td>
                  <td>{i.message}</td>
                  <td>
                    <span className={`status ${i.status}`}>{i.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
