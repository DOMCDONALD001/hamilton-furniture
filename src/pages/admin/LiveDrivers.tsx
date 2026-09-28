import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useToast } from "../../components/AdminUI";

type CurrentStop = {
  id: string;
  stop_order: number;
  status: string;
  order_number: string;
  customer_name: string;
  address: string;
};

type LiveDriver = {
  id: string | null;
  name: string | null;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_email: string | null;
  driver_phone: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  presence_at: string | null;
  presence_age_sec: number | null;
  live_status: "online" | "stale" | "offline";
  stop_count: number;
  delivered_count: number;
  en_route_count: number;
  failed_count: number;
  open_issue_count: number;
  current_stop: CurrentStop | null;
};

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ageLabel(sec: number | null) {
  if (sec == null) return "No GPS yet";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Classic Google Maps embed — no WebGL / no third-party static host. */
function mapsEmbedUrl(lat: number, lng: number) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`;
}

function DriverMap({
  lat,
  lng,
  label,
  accuracyM,
}: {
  lat: number;
  lng: number;
  label?: string | null;
  accuracyM?: number | null;
}) {
  const embed = mapsEmbedUrl(lat, lng);
  return (
    <>
      <div className="live-map-frame">
        <iframe
          title={label ? `Map · ${label}` : "Driver map"}
          src={embed}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>
        {lat.toFixed(5)}, {lng.toFixed(5)}
        {accuracyM != null ? ` · ±${Math.round(accuracyM)}m` : ""}
      </p>
      <p style={{ marginBottom: 0 }}>
        <a href={mapsUrl(lat, lng)} target="_blank" rel="noreferrer">
          Open exact pin in Google Maps
        </a>
      </p>
    </>
  );
}

export function AdminLiveDrivers() {
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await api<{ drivers: LiveDriver[]; refreshed_at: string }>(
        `/api/admin/drivers/live?date=${encodeURIComponent(date)}`,
      );
      setDrivers(data.drivers);
      setRefreshedAt(data.refreshed_at);
    } catch (err) {
      if (!silent) toast.push(err instanceof Error ? err.message : "Could not load live board", "err");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    timer.current = window.setInterval(() => load(true), 10000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [date]);

  const selected = useMemo(() => {
    if (!drivers.length) return null;
    if (selectedId) {
      return drivers.find((d) => (d.id || d.driver_id) === selectedId) || drivers[0];
    }
    return drivers.find((d) => d.live_status === "online") || drivers[0];
  }, [drivers, selectedId]);

  const mapLat = selected?.lat ?? null;
  const mapLng = selected?.lng ?? null;

  const onlineCount = drivers.filter((d) => d.live_status === "online").length;
  const inProgress = drivers.filter((d) => d.status === "in_progress").length;

  return (
    <div>
      <div className="section-head" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Live drivers</h1>
          <p className="muted" style={{ margin: 0 }}>
            Watch routes and GPS while drivers have the app open. Refreshes every 10 seconds.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              Date
            </span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => load()}>
            Refresh
          </button>
          <Link className="btn btn-outline btn-sm" to="/admin/routes">
            Assign routes
          </Link>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: "1rem" }}>
        <div className="stat">
          <span className="muted">On the board</span>
          <strong>{drivers.length}</strong>
        </div>
        <div className="stat">
          <span className="muted">GPS online</span>
          <strong>{onlineCount}</strong>
        </div>
        <div className="stat">
          <span className="muted">In progress</span>
          <strong>{inProgress}</strong>
        </div>
        <div className="stat">
          <span className="muted">Last refresh</span>
          <strong style={{ fontSize: "0.95rem" }}>
            {refreshedAt
              ? new Date(refreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
              : "—"}
          </strong>
        </div>
      </div>

      <div className="live-drivers-layout">
        <div className="admin-panel" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>Status board</h3>
          {loading && !drivers.length ? (
            <p className="muted">Loading…</p>
          ) : !drivers.length ? (
            <p className="muted">
              No assigned routes for this date. Create a route under{" "}
              <Link to="/admin/routes">Assign drivers</Link>, then have the driver open the portal
              on their phone with location allowed.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>GPS</th>
                    <th>Route</th>
                    <th>Progress</th>
                    <th>Doing now</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => {
                    const key = d.id || d.driver_id || `${d.driver_name}`;
                    const active = (selected?.id || selected?.driver_id) === (d.id || d.driver_id);
                    return (
                      <tr
                        key={key}
                        className={active ? "row-selected" : undefined}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedId(d.id || d.driver_id)}
                      >
                        <td>
                          <strong>{d.driver_name || "Unassigned"}</strong>
                          {d.driver_phone && (
                            <div className="muted" style={{ fontSize: "0.8rem" }}>
                              {d.driver_phone}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`live-pill live-${d.live_status}`}>
                            {d.live_status}
                          </span>
                          <div className="muted" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                            {ageLabel(d.presence_age_sec)}
                          </div>
                        </td>
                        <td>
                          {d.name ? (
                            <>
                              <div>{d.name}</div>
                              <span className={`status ${d.status}`}>
                                {d.status.replaceAll("_", " ")}
                              </span>
                            </>
                          ) : (
                            <span className="muted">Idle / no route</span>
                          )}
                        </td>
                        <td>
                          {d.stop_count
                            ? `${d.delivered_count}/${d.stop_count} delivered`
                            : "—"}
                          {(d.failed_count || 0) > 0 && (
                            <div style={{ color: "#e0b8b6", fontSize: "0.8rem" }}>
                              {d.failed_count} failed
                            </div>
                          )}
                          {(d.open_issue_count || 0) > 0 && (
                            <div style={{ color: "#e0b8b6", fontSize: "0.8rem" }}>
                              {d.open_issue_count} open issue
                            </div>
                          )}
                        </td>
                        <td>
                          {d.current_stop ? (
                            <>
                              <div>
                                Stop #{d.current_stop.stop_order} ·{" "}
                                <span className={`status ${d.current_stop.status}`}>
                                  {d.current_stop.status.replaceAll("_", " ")}
                                </span>
                              </div>
                              <div className="muted" style={{ fontSize: "0.8rem" }}>
                                {d.current_stop.customer_name} · {d.current_stop.order_number}
                              </div>
                              <div className="muted" style={{ fontSize: "0.78rem" }}>
                                {d.current_stop.address}
                              </div>
                            </>
                          ) : d.status === "completed" ? (
                            <span className="muted">Route finished</span>
                          ) : (
                            <span className="muted">Waiting to start</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {d.lat != null && d.lng != null && (
                            <a
                              className="btn btn-outline btn-sm"
                              href={mapsUrl(d.lat, d.lng)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Map
                            </a>
                          )}{" "}
                          {d.id && (
                            <Link
                              className="btn btn-outline btn-sm"
                              to="/admin/routes"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Route
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="admin-panel" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>
            {selected?.driver_name ? `Map · ${selected.driver_name}` : "Map"}
          </h3>
          {mapLat != null && mapLng != null ? (
            <DriverMap
              lat={mapLat}
              lng={mapLng}
              label={selected?.driver_name}
              accuracyM={selected?.accuracy_m}
            />
          ) : (
            <p className="muted">
              No live GPS yet. Drivers must keep the driver portal open on their phone and allow
              location access while on a route.
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.75rem" }}>
            Green = GPS ping in last 2 min · Amber = 2–15 min · Gray = offline / no signal
          </p>
        </div>
      </div>
    </div>
  );
}
