import type { FormEvent } from "react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";

export function ClaimsPage() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    order_number: params.get("number") || "",
    email: params.get("email") || "",
    claim_type: "return",
    reason: "",
  });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api("/api/orders/claims", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit claim");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shell" style={{ maxWidth: 560, marginBottom: "3rem" }}>
      <div className="section-head">
        <div>
          <h2>Return or damage claim</h2>
          <p>Tell us what went wrong — we’ll follow up by email.</p>
        </div>
      </div>
      {done ? (
        <div className="panel">
          <p style={{ marginTop: 0 }}>Claim submitted. We’ll review it shortly.</p>
          <Link to="/orders" className="btn btn-dark">
            Track order
          </Link>
        </div>
      ) : (
        <form className="panel" onSubmit={onSubmit}>
          <div className="field">
            <label>Order number</label>
            <input
              required
              value={form.order_number}
              onChange={(e) => setForm({ ...form, order_number: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email on the order</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Type</label>
            <select
              value={form.claim_type}
              onChange={(e) => setForm({ ...form, claim_type: e.target.value })}
            >
              <option value="return">Return</option>
              <option value="damage">Damage</option>
              <option value="wrong_item">Wrong item</option>
              <option value="missing">Missing item</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <label>Details</label>
            <textarea
              required
              rows={5}
              minLength={5}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="What happened? Include item names if you can."
            />
          </div>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <button className="btn btn-dark" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit claim"}
          </button>
        </form>
      )}
    </div>
  );
}
