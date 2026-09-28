import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useToast } from "../../components/AdminUI";

type Issue = {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  order_status: string;
  shipping_address1?: string;
  shipping_city?: string;
  shipping_zip?: string;
  driver_name: string;
  issue_type: string;
  message: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

const ORDER_STATUSES = [
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "confirmed",
];

export function AdminReports() {
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [resolveStatus, setResolveStatus] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const data = await api<{ issues: Issue[] }>(
      `/api/admin/delivery-issues?status=${filter}`,
    );
    setIssues(data.issues);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load reports", "err"));
  }, [filter]);

  async function resolve(issue: Issue) {
    setBusy(issue.id);
    try {
      const orderStatus = resolveStatus[issue.id] || "processing";
      await api(`/api/admin/delivery-issues/${issue.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "resolved",
          order_status: orderStatus,
          admin_note: noteDraft[issue.id]?.trim() || undefined,
        }),
      });
      toast.push(`Resolved · order set to ${orderStatus.replaceAll("_", " ")}`);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Resolve failed", "err");
    } finally {
      setBusy(null);
    }
  }

  async function setOrderOnly(issue: Issue, orderStatus: string) {
    setBusy(issue.id);
    try {
      await api(`/api/admin/delivery-issues/${issue.id}`, {
        method: "PATCH",
        body: JSON.stringify({ order_status: orderStatus }),
      });
      toast.push(`Order ${issue.order_number} → ${orderStatus.replaceAll("_", " ")}`);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Update failed", "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Delivery reports</h1>
      <p className="muted">
        When a driver reports a problem, the order moves to <strong>processing</strong> so you can
        reassign it. Resolve the report here and set the next status.
      </p>

      <div className="toolbar">
        {(["open", "resolved", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-outline"}`}
            onClick={() => setFilter(f)}
          >
            {f === "open" ? "Open" : f === "resolved" ? "Resolved" : "All"}
          </button>
        ))}
      </div>

      <div className="admin-panel">
        {!issues.length ? (
          <p className="muted">No {filter === "all" ? "" : filter + " "}reports.</p>
        ) : (
          <div className="report-list">
            {issues.map((i) => (
              <article key={i.id} className="report-card">
                <div className="report-card-head">
                  <div>
                    <strong>{i.order_number}</strong>
                    <div className="muted">{i.customer_name}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className={`status ${i.status}`}>{i.status}</span>
                    <span className={`status ${i.order_status}`}>
                      {i.order_status.replaceAll("_", " ")}
                    </span>
                  </div>
                </div>

                <p style={{ margin: "0.5rem 0" }}>
                  <strong>{i.issue_type.replaceAll("_", " ")}</strong> · {i.driver_name}
                  <br />
                  {i.message}
                </p>
                {(i.shipping_address1 || i.shipping_city) && (
                  <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    {i.shipping_address1}
                    {i.shipping_city ? `, ${i.shipping_city}` : ""} {i.shipping_zip || ""}
                  </p>
                )}
                <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.8rem" }}>
                  Reported {i.created_at.slice(0, 16).replace("T", " ")}
                  {i.resolved_at
                    ? ` · Resolved ${i.resolved_at.slice(0, 16).replace("T", " ")}`
                    : ""}
                </p>
                {i.admin_note && (
                  <p className="muted" style={{ fontSize: "0.85rem" }}>
                    Admin note: {i.admin_note}
                  </p>
                )}

                <div className="report-card-actions">
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => navigate(`/admin/orders?focus=${i.order_id}`)}
                  >
                    Open order
                  </button>

                  {i.status === "open" ? (
                    <>
                      <label className="qr-copies-field">
                        <span>Set order to</span>
                        <select
                          value={resolveStatus[i.id] || "processing"}
                          onChange={(e) =>
                            setResolveStatus((p) => ({ ...p, [i.id]: e.target.value }))
                          }
                          style={{ width: "auto", minWidth: 150 }}
                        >
                          {ORDER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <input
                        placeholder="Admin note (optional)"
                        value={noteDraft[i.id] || ""}
                        onChange={(e) =>
                          setNoteDraft((p) => ({ ...p, [i.id]: e.target.value }))
                        }
                        style={{ flex: 1, minWidth: 140 }}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={busy === i.id}
                        onClick={() => resolve(i)}
                      >
                        Resolve & update status
                      </button>
                    </>
                  ) : (
                    <label className="qr-copies-field">
                      <span>Change order status</span>
                      <select
                        value={i.order_status}
                        disabled={busy === i.id}
                        onChange={(e) => setOrderOnly(i, e.target.value)}
                        style={{ width: "auto", minWidth: 150 }}
                      >
                        {ORDER_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
