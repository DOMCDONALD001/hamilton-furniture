import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api, money } from "../../lib/api";
import { useToast } from "../../components/AdminUI";

type Driver = { id: string; name: string; email: string; active: number };

type OrderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  shipping_address1: string;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  status: string;
  total_cents: number;
};

type RouteRow = {
  id: string;
  name: string;
  route_date: string;
  driver_id: string | null;
  driver_name?: string | null;
  status: string;
  stop_count: number;
  delivered_count: number;
  failed_count?: number;
  open_issue_count?: number;
  notes?: string | null;
};

type RouteDetail = {
  route: RouteRow & { notes?: string | null };
  stops: Array<{
    id: string;
    order_id: string;
    stop_order: number;
    status: string;
    order_number: string;
    customer_name: string;
    shipping_address1: string;
    shipping_city: string;
    shipping_zip: string;
    customer_phone: string | null;
    order_status?: string;
    delivered_at?: string | null;
    delivered_lat?: number | null;
    delivered_lng?: number | null;
    delivered_accuracy_m?: number | null;
  }>;
};

export function AdminRoutes() {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [assignable, setAssignable] = useState<OrderRow[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [routeDate, setRouteDate] = useState(today);
  const [driverId, setDriverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<RouteDetail | null>(null);

  async function load() {
    const [d, r, a] = await Promise.all([
      api<{ drivers: Driver[] }>("/api/admin/drivers"),
      api<{ routes: RouteRow[] }>(`/api/admin/routes?date=${routeDate}`),
      api<{ orders: OrderRow[] }>("/api/admin/routes/assignable-orders"),
    ]);
    setDrivers(d.drivers.filter((x) => x.active));
    setRoutes(r.routes);
    setAssignable(a.orders);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load assignments", "err"));
  }, [routeDate]);

  function toggleOrder(id: string) {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllProcessing() {
    const ids = assignable.filter((o) => o.status === "processing").map((o) => o.id);
    setSelectedOrders(new Set(ids));
  }

  async function assignToDriver(e: FormEvent) {
    e.preventDefault();
    if (!driverId) {
      toast.push("Pick a driver first", "info");
      return;
    }
    if (!selectedOrders.size) {
      toast.push("Select processing orders to assign", "info");
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/routes", {
        method: "POST",
        body: JSON.stringify({
          route_date: routeDate,
          driver_id: driverId,
          order_ids: [...selectedOrders],
        }),
      });
      toast.push(
        `Assigned ${selectedOrders.size} order${selectedOrders.size === 1 ? "" : "s"} · status set to out for delivery`,
      );
      setSelectedOrders(new Set());
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Assign failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function autoAssign() {
    setBusy(true);
    try {
      const res = await api<{
        routes: unknown[];
        assigned_orders?: number;
      }>("/api/admin/routes/auto-assign", {
        method: "POST",
        body: JSON.stringify({ route_date: routeDate }),
      });
      toast.push(
        `Auto-assigned ${res.assigned_orders ?? 0} orders · set to out for delivery`,
      );
      setSelectedOrders(new Set());
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Auto-assign failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function openRoute(id: string) {
    const data = await api<RouteDetail>(`/api/admin/routes/${id}`);
    setDetail(data);
  }

  async function reassignDriver(routeId: string, newDriverId: string) {
    if (!newDriverId) return;
    await api(`/api/admin/routes/${routeId}`, {
      method: "PATCH",
      body: JSON.stringify({ driver_id: newDriverId }),
    });
    toast.push("Driver updated · orders set out for delivery");
    await load();
    if (detail?.route.id === routeId) await openRoute(routeId);
  }

  async function cancelRoute(routeId: string) {
    await api(`/api/admin/routes/${routeId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    });
    toast.push("Assignment cancelled", "info");
    setDetail(null);
    await load();
  }

  const processingCount = assignable.filter((o) => o.status === "processing").length;

  return (
    <div>
      <h1>Assign orders to drivers</h1>
      <p className="muted">
        Pick processing (or confirmed) delivery orders, assign a driver, and those orders move to{" "}
        <strong>out for delivery</strong> for the driver portal.
      </p>

      <div className="toolbar">
        <label className="qr-copies-field">
          <span>Date</span>
          <input
            type="date"
            value={routeDate}
            onChange={(e) => setRouteDate(e.target.value)}
            style={{ width: "auto", minWidth: 140 }}
          />
        </label>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={busy || !drivers.length || !assignable.length}
          onClick={autoAssign}
        >
          Auto-assign all
        </button>
      </div>

      <div className="split-layout">
        <form className="admin-panel" onSubmit={assignToDriver}>
          <h3 style={{ marginTop: 0 }}>Manual assign</h3>
          <div className="field">
            <label>Driver</label>
            <select
              required
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">Select driver…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <h4 style={{ margin: 0 }}>
              Ready to assign ({assignable.length})
              {processingCount > 0 ? ` · ${processingCount} processing` : ""}
            </h4>
            {processingCount > 0 && (
              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={selectAllProcessing}
              >
                Select all processing
              </button>
            )}
          </div>

          {!assignable.length ? (
            <p className="muted">
              No processing/confirmed delivery orders waiting. Set an order to{" "}
              <strong>processing</strong> on the Orders page first.
            </p>
          ) : (
            <div style={{ maxHeight: 420, overflow: "auto", marginTop: 8 }}>
              {assignable.map((o) => (
                <label
                  key={o.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "0.55rem 0",
                    borderBottom: "1px solid #2a322e",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedOrders.has(o.id)}
                    onChange={() => toggleOrder(o.id)}
                  />
                  <span>
                    <strong>{o.order_number}</strong> · {o.customer_name}{" "}
                    <span className={`status ${o.status}`}>{o.status}</span>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {o.shipping_address1}, {o.shipping_city} {o.shipping_zip} ·{" "}
                      {money(o.total_cents)}
                    </div>
                  </span>
                </label>
              ))}
            </div>
          )}

          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !selectedOrders.size || !driverId}
            style={{ marginTop: 12 }}
          >
            Assign to driver ({selectedOrders.size}) → out for delivery
          </button>
        </form>

        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Assigned today · {routeDate}</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Driver / batch</th>
                <th>Orders</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const hasIssue = (r.open_issue_count || 0) > 0 || (r.failed_count || 0) > 0;
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.driver_name || r.name}</strong>
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {r.name}
                      </div>
                    </td>
                    <td>
                      {r.delivered_count}/{r.stop_count}
                      {(r.failed_count || 0) > 0 ? (
                        <span className="muted"> · {r.failed_count} failed</span>
                      ) : null}
                    </td>
                    <td>
                      <span className={`status ${r.status}`}>{r.status.replaceAll("_", " ")}</span>
                      {hasIssue && (
                        <span
                          className="route-issue-icon"
                          title={`${r.open_issue_count || 0} open report(s)`}
                          aria-label="Has delivery issues"
                        >
                          !
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-outline btn-sm"
                        type="button"
                        onClick={() => openRoute(r.id)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!routes.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No driver assignments for this date yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {detail && (
            <div style={{ marginTop: "1.25rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <h3 style={{ margin: 0 }}>{detail.route.name}</h3>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() => cancelRoute(detail.route.id)}
                >
                  Cancel assignment
                </button>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Change driver</label>
                <select
                  value={detail.route.driver_id || ""}
                  onChange={(e) => reassignDriver(detail.route.id, e.target.value)}
                >
                  <option value="" disabled>
                    Select driver…
                  </option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Order</th>
                    <th>Address</th>
                    <th>Order status</th>
                    <th>GPS</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.stops.map((s, idx) => (
                    <tr key={s.id}>
                      <td>{idx + 1}</td>
                      <td>
                        <strong>{s.order_number}</strong>
                        <div className="muted">{s.customer_name}</div>
                      </td>
                      <td>
                        {s.shipping_address1}
                        <div className="muted">
                          {s.shipping_city} {s.shipping_zip}
                        </div>
                      </td>
                      <td>
                        <span className={`status ${s.order_status || s.status}`}>
                          {(s.order_status || s.status).replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        {s.delivered_lat != null && s.delivered_lng != null ? (
                          <a
                            href={`https://maps.google.com/?q=${s.delivered_lat},${s.delivered_lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {s.delivered_lat.toFixed(5)}, {s.delivered_lng.toFixed(5)}
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
