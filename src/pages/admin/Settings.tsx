import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export function AdminSettings() {
  const [settings, setSettings] = useState({
    store_phone: "",
    store_email: "",
    store_address: "",
    tax_rate_bps: "725",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ settings: Record<string, string> }>("/api/admin/settings").then((d) => {
      setSettings({
        store_phone: d.settings.store_phone || "",
        store_email: d.settings.store_email || "",
        store_address: d.settings.store_address || "",
        tax_rate_bps: d.settings.tax_rate_bps || "725",
      });
    });
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h1>Store settings</h1>
      <form className="admin-panel" style={{ maxWidth: 560 }} onSubmit={save}>
        <div className="field">
          <label>Phone</label>
          <input
            value={settings.store_phone}
            onChange={(e) => setSettings({ ...settings, store_phone: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            value={settings.store_email}
            onChange={(e) => setSettings({ ...settings, store_email: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Address</label>
          <input
            value={settings.store_address}
            onChange={(e) => setSettings({ ...settings, store_address: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Tax rate (basis points, 725 = 7.25%)</label>
          <input
            value={settings.tax_rate_bps}
            onChange={(e) => setSettings({ ...settings, tax_rate_bps: e.target.value })}
          />
        </div>
        <button className="btn btn-primary">Save settings</button>
        {saved && <span style={{ marginLeft: 12 }}>Saved</span>}
      </form>
      <div className="admin-panel" style={{ maxWidth: 560, marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Admin password</h3>
        <p className="muted">
          Set production password with:{" "}
          <code>npx wrangler secret put ADMIN_PASSWORD</code>
        </p>
        <p className="muted">Local default password: <code>hamilton-admin</code></p>
      </div>
    </div>
  );
}
