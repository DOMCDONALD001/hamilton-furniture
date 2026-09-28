import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api, money } from "../../lib/api";
import { useToast } from "../../components/AdminUI";

type Discount = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  min_order_cents: number;
  max_uses: number | null;
  used_count: number;
  active: number;
  ends_at: string | null;
  members_only?: number;
  show_on_home?: number;
};

export function AdminDiscounts() {
  const toast = useToast();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    type: "percent" as Discount["type"],
    value: "10",
    min_order: "0",
    max_uses: "",
    ends_at: "",
    members_only: false,
    show_on_home: true,
  });

  async function load() {
    const data = await api<{ discounts: Discount[] }>("/api/admin/discounts");
    setDiscounts(data.discounts);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load offers", "err"));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    await api("/api/admin/discounts", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        code: form.code || null,
        description: form.description,
        type: form.type,
        value:
          form.type === "percent"
            ? Number(form.value)
            : form.type === "fixed"
              ? Math.round(Number(form.value) * 100)
              : 0,
        min_order_cents: Math.round(Number(form.min_order || 0) * 100),
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        ends_at: form.ends_at || null,
        active: 1,
        members_only: form.members_only,
        show_on_home: form.show_on_home,
      }),
    });
    setForm({
      name: "",
      code: "",
      description: "",
      type: "percent",
      value: "10",
      min_order: "0",
      max_uses: "",
      ends_at: "",
      members_only: false,
      show_on_home: true,
    });
    toast.push(form.members_only ? "Member-only offer created" : "Offer created");
    await load();
  }

  async function toggle(d: Discount) {
    await api(`/api/admin/discounts/${d.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...d, active: d.active ? 0 : 1 }),
    });
    await load();
  }

  async function toggleMembers(d: Discount) {
    await api(`/api/admin/discounts/${d.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...d, members_only: d.members_only ? 0 : 1 }),
    });
    toast.push(d.members_only ? "Now available to guests" : "Now members only");
    await load();
  }

  async function toggleHome(d: Discount) {
    const onHome = d.show_on_home == null ? 1 : d.show_on_home;
    await api(`/api/admin/discounts/${d.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...d, show_on_home: onHome ? 0 : 1 }),
    });
    toast.push(onHome ? "Hidden from home page" : "Shown on home page");
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this offer?")) return;
    await api(`/api/admin/discounts/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <h1>Offers & discounts</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Check <strong>Account holders only</strong> so guests cannot use the code — customers must
        create a free account / sign in. Use <strong>Hide from home</strong> to keep a code working
        at checkout without advertising it on the homepage.
      </p>
      <div className="split-layout equal">
        <div className="admin-panel">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Offer</th>
                <th>Code</th>
                <th>Value</th>
                <th>Who</th>
                <th>Home</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => {
                const onHome = d.show_on_home == null ? 1 : d.show_on_home;
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.name}</strong>
                      <div className="muted">{d.active ? "Active" : "Off"}</div>
                    </td>
                    <td>{d.code || "—"}</td>
                    <td>
                      {d.type === "percent"
                        ? `${d.value}%`
                        : d.type === "fixed"
                          ? money(d.value)
                          : "Free ship"}
                    </td>
                    <td>
                      <span className={`status ${d.members_only ? "live" : "scheduled"}`}>
                        {d.members_only ? "Members" : "Everyone"}
                      </span>
                    </td>
                    <td>
                      <span className={`status ${onHome ? "scheduled" : "draft"}`}>
                        {onHome ? "Shown" : "Hidden"}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-outline btn-sm" type="button" onClick={() => toggle(d)}>
                        {d.active ? "Disable" : "Enable"}
                      </button>{" "}
                      <button
                        className="btn btn-outline btn-sm"
                        type="button"
                        onClick={() => toggleHome(d)}
                      >
                        {onHome ? "Hide from home" : "Show on home"}
                      </button>{" "}
                      <button
                        className="btn btn-outline btn-sm"
                        type="button"
                        onClick={() => toggleMembers(d)}
                      >
                        {d.members_only ? "Allow guests" : "Members only"}
                      </button>{" "}
                      <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(d.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <form className="admin-panel" onSubmit={create}>
          <h3 style={{ marginTop: 0 }}>Create offer</h3>
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Promo code (optional)</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </div>
          <div className="field">
            <label>Description</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as Discount["type"] })}
              >
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed $ off</option>
                <option value="free_shipping">Free shipping</option>
              </select>
            </div>
            <div className="field">
              <label>
                {form.type === "percent" ? "Percent" : form.type === "fixed" ? "Dollars off" : "N/A"}
              </label>
              <input
                type="number"
                step="0.01"
                disabled={form.type === "free_shipping"}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Min order ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.min_order}
                onChange={(e) => setForm({ ...form, min_order: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Max uses</label>
              <input
                type="number"
                value={form.max_uses}
                onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>Ends at</label>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
            />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={form.members_only}
              onChange={(e) => setForm({ ...form, members_only: e.target.checked })}
            />
            Account holders only (not guests)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={form.show_on_home}
              onChange={(e) => setForm({ ...form, show_on_home: e.target.checked })}
            />
            Show on home page
          </label>
          <button className="btn btn-primary">Create offer</button>
        </form>
      </div>
    </div>
  );
}
