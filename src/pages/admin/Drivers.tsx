import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/AdminUI";

type Driver = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  active: number;
  created_at: string;
};

type Issue = {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  driver_name: string;
  issue_type: string;
  message: string;
  status: string;
  admin_note: string | null;
  created_at: string;
};

const emptyForm = { name: "", email: "", phone: "", password: "" };

export function AdminDrivers() {
  const toast = useToast();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [resetPw, setResetPw] = useState<Record<string, string>>({});

  async function load() {
    const [d, i] = await Promise.all([
      api<{ drivers: Driver[] }>("/api/admin/drivers"),
      api<{ issues: Issue[] }>("/api/admin/delivery-issues?status=open"),
    ]);
    setDrivers(d.drivers);
    setIssues(i.issues);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load drivers", "err"));
  }, []);

  async function createDriver(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/admin/drivers", {
        method: "POST",
        body: JSON.stringify(form),
      });
      toast.push("Driver account created");
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Create failed", "err");
    }
  }

  async function toggleActive(d: Driver) {
    await api(`/api/admin/drivers/${d.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !d.active }),
    });
    toast.push(d.active ? "Driver deactivated" : "Driver activated", "info");
    await load();
  }

  async function savePassword(driverId: string) {
    const password = resetPw[driverId]?.trim();
    if (!password || password.length < 8) {
      toast.push("Password must be at least 8 characters", "err");
      return;
    }
    await api(`/api/admin/drivers/${driverId}`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    });
    toast.push("Password updated");
    setResetPw((p) => ({ ...p, [driverId]: "" }));
  }

  async function resolveIssue(issueId: string) {
    await api(`/api/admin/delivery-issues/${issueId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "resolved" }),
    });
    toast.push("Issue marked resolved");
    await load();
  }

  return (
    <div>
      <h1>Drivers</h1>
      <p className="muted">
        Drivers sign in at <code>/driver</code>. They can only update delivery status and report
        issues — not inventory, pricing, or payments.
      </p>

      <div className="split-layout">
        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Driver accounts</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.name}</strong>
                  </td>
                  <td>{d.email}</td>
                  <td>{d.phone || "—"}</td>
                  <td>
                    <span className={`status ${d.active ? "live" : "ended"}`}>
                      {d.active ? "active" : "off"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => toggleActive(d)}
                    >
                      {d.active ? "Deactivate" : "Activate"}
                    </button>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input
                        type="password"
                        placeholder="New password"
                        value={resetPw[d.id] || ""}
                        onChange={(e) =>
                          setResetPw((p) => ({ ...p, [d.id]: e.target.value }))
                        }
                        style={{ maxWidth: 140 }}
                      />
                      <button
                        className="btn btn-outline btn-sm"
                        type="button"
                        onClick={() => savePassword(d.id)}
                      >
                        Reset pw
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!drivers.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No drivers yet — create one on the right.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form className="admin-panel" onSubmit={createDriver}>
          <h3 style={{ marginTop: 0 }}>Create driver</h3>
          <div className="field">
            <label>Name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Temporary password</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 8 characters"
            />
          </div>
          <button className="btn btn-primary" type="submit">
            Create driver account
          </button>
        </form>
      </div>

      <div className="admin-panel" style={{ marginTop: "1.25rem" }}>
        <h3 style={{ marginTop: 0 }}>Open delivery issues</h3>
        {!issues.length ? (
          <p className="muted">No open issues from drivers.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Order</th>
                <th>Driver</th>
                <th>Type</th>
                <th>Message</th>
                <th></th>
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
                  <td>{i.driver_name}</td>
                  <td>{i.issue_type.replaceAll("_", " ")}</td>
                  <td>{i.message}</td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => resolveIssue(i.id)}
                    >
                      Resolve
                    </button>
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
