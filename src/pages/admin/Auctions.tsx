import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money, type Product } from "../../lib/api";
import { ConfirmModal, Modal, useToast } from "../../components/AdminUI";

type Auction = {
  id: string;
  slug: string;
  product_id: string | null;
  title: string;
  description: string;
  starting_bid_cents: number;
  current_bid_cents: number;
  reserve_cents: number | null;
  bid_increment_cents: number;
  buy_now_cents: number | null;
  bid_count: number;
  starts_at: string;
  ends_at: string;
  status: string;
  winner_name: string | null;
  winner_email: string | null;
  winner_phone: string | null;
  winner_bid_cents: number | null;
  reserve_met: number;
};

type Bid = {
  id: string;
  bidder_name: string;
  bidder_email: string;
  bidder_phone: string | null;
  amount_cents: number;
  created_at: string;
};

function toLocalInput(isoish: string) {
  // "2026-07-17 12:00:00" -> datetime-local
  const d = new Date(isoish.includes("T") ? isoish : isoish.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminAuctions() {
  const toast = useToast();
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<{ auction: Auction; bids: Bid[] } | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [form, setForm] = useState({
    product_id: "",
    title: "",
    description: "",
    starting: "50",
    reserve: "",
    increment: "5",
    buy_now: "",
    starts_at: "",
    ends_at: "",
    go_live: true,
  });

  async function load() {
    const data = await api<{ auctions: Auction[] }>("/api/admin/auctions");
    setAuctions(data.auctions);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load auctions", "err"));
    api<{ products: Product[] }>("/api/admin/products")
      .then((d) => setProducts(d.products))
      .catch(() => {});

    const now = new Date();
    const end = new Date(now.getTime() + 3 * 86400000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setForm((f) => ({ ...f, starts_at: fmt(now), ends_at: fmt(end) }));
  }, []);

  function pickProduct(productId: string) {
    const p = products.find((x) => x.id === productId);
    setForm((f) => ({
      ...f,
      product_id: productId,
      title: p ? `Auction: ${p.name}` : f.title,
      description: p?.description || f.description,
      starting: p ? String(Math.max(25, Math.round(p.price_cents * 0.4) / 100)) : f.starting,
      buy_now: p ? String(p.price_cents / 100) : f.buy_now,
    }));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/admin/auctions", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          product_id: form.product_id || null,
          starting_bid_cents: Math.round(Number(form.starting) * 100),
          reserve_cents: form.reserve ? Math.round(Number(form.reserve) * 100) : null,
          bid_increment_cents: Math.round(Number(form.increment) * 100),
          buy_now_cents: form.buy_now ? Math.round(Number(form.buy_now) * 100) : null,
          starts_at: form.starts_at,
          ends_at: form.ends_at,
          go_live: form.go_live,
        }),
      });
      setCreateOpen(false);
      toast.push("Auction created");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Create failed", "err");
    }
  }

  async function openDetail(id: string) {
    const data = await api<{ auction: Auction; bids: Bid[] }>(`/api/admin/auctions/${id}`);
    setDetail(data);
  }

  async function endNow(id: string) {
    await api(`/api/admin/auctions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ended" }),
    });
    toast.push("Auction closed");
    setDetail(null);
    await load();
  }

  async function cancel(id: string) {
    await api(`/api/admin/auctions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    });
    toast.push("Auction cancelled", "info");
    setDetail(null);
    await load();
  }

  async function extendDay(a: Auction) {
    const ends = new Date(
      (a.ends_at.includes("T") ? a.ends_at : a.ends_at.replace(" ", "T") + "Z"),
    );
    ends.setDate(ends.getDate() + 1);
    await api(`/api/admin/auctions/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ends_at: ends.toISOString() }),
    });
    toast.push("Extended by 1 day");
    await load();
    if (detail?.auction.id === a.id) await openDetail(a.id);
  }

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Auctions</h1>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
          + New auction
        </button>
      </div>

      <div className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Auction</th>
              <th>Status</th>
              <th>Current</th>
              <th>Bids</th>
              <th>Ends</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {auctions.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.title}</strong>
                  <div className="muted">
                    <Link to={`/auctions/${a.slug}`} target="_blank" rel="noreferrer">
                      View listing
                    </Link>
                  </div>
                </td>
                <td>
                  <span className={`status ${a.status}`}>{a.status}</span>
                  {a.reserve_cents != null && (
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      {a.reserve_met ? "Reserve met" : `Reserve ${money(a.reserve_cents)}`}
                    </div>
                  )}
                </td>
                <td>{money(a.current_bid_cents)}</td>
                <td>{a.bid_count}</td>
                <td>{a.ends_at}</td>
                <td>
                  <button className="btn btn-outline btn-sm" type="button" onClick={() => openDetail(a.id)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
            {!auctions.length && (
              <tr>
                <td colSpan={6} className="muted">
                  No auctions yet — create one from inventory or a custom listing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={createOpen}
        title="Create auction"
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form="create-auction-form">
              Launch auction
            </button>
          </>
        }
      >
        <form id="create-auction-form" onSubmit={create}>
          <div className="field">
            <label>Link inventory item (optional)</label>
            <select value={form.product_id} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">Custom listing — no product link</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price_cents)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Title</label>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Starting bid ($)</label>
              <input
                required
                type="number"
                step="0.01"
                value={form.starting}
                onChange={(e) => setForm({ ...form, starting: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Bid increment ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.increment}
                onChange={(e) => setForm({ ...form, increment: e.target.value })}
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Reserve price ($ optional)</label>
              <input
                type="number"
                step="0.01"
                value={form.reserve}
                onChange={(e) => setForm({ ...form, reserve: e.target.value })}
                placeholder="Hidden minimum"
              />
            </div>
            <div className="field">
              <label>Buy It Now ($ optional)</label>
              <input
                type="number"
                step="0.01"
                value={form.buy_now}
                onChange={(e) => setForm({ ...form, buy_now: e.target.value })}
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Starts</label>
              <input
                required
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Ends</label>
              <input
                required
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              />
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.go_live}
              onChange={(e) => setForm({ ...form, go_live: e.target.checked })}
            />
            Go live immediately
          </label>
        </form>
      </Modal>

      <Modal
        open={!!detail}
        title={detail?.auction.title || "Auction"}
        onClose={() => setDetail(null)}
        wide
        footer={
          detail && ["live", "scheduled"].includes(detail.auction.status) ? (
            <>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => extendDay(detail.auction)}
              >
                Extend +1 day
              </button>
              {detail.auction.status === "live" && (
                <button className="btn btn-primary" type="button" onClick={() => endNow(detail.auction.id)}>
                  End &amp; settle now
                </button>
              )}
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => setCancelId(detail.auction.id)}
              >
                Cancel auction
              </button>
            </>
          ) : undefined
        }
      >
        {detail && (
          <>
            <div className="summary-row">
              <span>Status</span>
              <span className={`status ${detail.auction.status}`}>{detail.auction.status}</span>
            </div>
            <div className="summary-row">
              <span>Current bid</span>
              <strong>{money(detail.auction.current_bid_cents)}</strong>
            </div>
            <div className="summary-row">
              <span>Reserve</span>
              <span>
                {detail.auction.reserve_cents != null
                  ? `${money(detail.auction.reserve_cents)} (${detail.auction.reserve_met ? "met" : "not met"})`
                  : "None"}
              </span>
            </div>
            <div className="summary-row">
              <span>Schedule</span>
              <span>
                {toLocalInput(detail.auction.starts_at)} → {toLocalInput(detail.auction.ends_at)}
              </span>
            </div>
            {detail.auction.winner_email && (
              <div className="admin-panel" style={{ marginTop: "0.75rem" }}>
                <h4 style={{ marginTop: 0 }}>Winner</h4>
                <p style={{ margin: 0 }}>
                  {detail.auction.winner_name} · {detail.auction.winner_email}
                  {detail.auction.winner_phone ? ` · ${detail.auction.winner_phone}` : ""}
                </p>
                <p className="muted">
                  Winning bid {money(detail.auction.winner_bid_cents || 0)} — contact them to arrange
                  payment & delivery.
                </p>
              </div>
            )}
            <h4>Bids</h4>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Bidder</th>
                  <th>Email</th>
                  <th>Amount</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {detail.bids.map((b) => (
                  <tr key={b.id}>
                    <td>{b.bidder_name}</td>
                    <td>{b.bidder_email}</td>
                    <td>{money(b.amount_cents)}</td>
                    <td>{b.created_at}</td>
                  </tr>
                ))}
                {!detail.bids.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No bids yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </Modal>

      <ConfirmModal
        open={!!cancelId}
        title="Cancel auction?"
        message="Bidding will stop and the listing will be marked cancelled. Existing bids are kept for your records."
        confirmLabel="Cancel auction"
        danger
        onClose={() => setCancelId(null)}
        onConfirm={() => {
          if (cancelId) void cancel(cancelId);
        }}
      />
    </div>
  );
}
