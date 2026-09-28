import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../../lib/api";
import { useToast } from "../../components/AdminUI";

type Claim = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  claim_type: string;
  reason: string;
  status: string;
  admin_note: string | null;
  total_cents: number;
  created_at: string;
};

export function AdminClaims() {
  const toast = useToast();
  const [status, setStatus] = useState("open");
  const [claims, setClaims] = useState<Claim[]>([]);

  async function load(s = status) {
    try {
      const data = await api<{ claims: Claim[] }>(`/api/admin/claims?status=${encodeURIComponent(s)}`);
      setClaims(data.claims);
    } catch {
      toast.push("Could not load claims", "err");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function update(id: string, next: string) {
    try {
      await api(`/api/admin/claims/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      toast.push(`Claim marked ${next}`);
      load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Update failed", "err");
    }
  }

  return (
    <div>
      <h1>Returns & claims</h1>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => load()}>
          Refresh
        </button>
      </div>
      <div className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Order</th>
              <th>Type</th>
              <th>Customer</th>
              <th>Reason</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.created_at).toLocaleString()}</td>
                <td>
                  <Link to="/admin/orders">{c.order_number}</Link>
                  <div className="muted">{money(c.total_cents)}</div>
                </td>
                <td>{c.claim_type.replaceAll("_", " ")}</td>
                <td>
                  {c.customer_name}
                  <div className="muted">{c.customer_email}</div>
                </td>
                <td style={{ maxWidth: 280 }}>{c.reason}</td>
                <td>
                  <span className={`status ${c.status}`}>{c.status}</span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {c.status === "open" && (
                    <>
                      <button className="btn btn-outline btn-sm" type="button" onClick={() => update(c.id, "approved")}>
                        Approve
                      </button>{" "}
                      <button className="btn btn-outline btn-sm" type="button" onClick={() => update(c.id, "denied")}>
                        Deny
                      </button>
                    </>
                  )}
                  {c.status !== "resolved" && (
                    <button className="btn btn-outline btn-sm" type="button" onClick={() => update(c.id, "resolved")}>
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!claims.length && (
              <tr>
                <td colSpan={7} className="muted">
                  No claims in this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
