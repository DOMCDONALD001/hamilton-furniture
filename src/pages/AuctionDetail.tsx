import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, money } from "../lib/api";
import { Modal } from "../components/AdminUI";
import { CountdownBlocks } from "../components/Countdown";
import { type AuctionCard } from "./Auctions";

type BidRow = {
  id: string;
  bidder_name: string;
  amount_cents: number;
  created_at: string;
};

export function AuctionDetailPage() {
  const { slug } = useParams();
  const [auction, setAuction] = useState<AuctionCard | null>(null);
  const [bids, setBids] = useState<BidRow[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [successOpen, setSuccessOpen] = useState("");
  const [buyOpen, setBuyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    bidder_name: "",
    bidder_email: "",
    bidder_phone: "",
    amount: "",
  });

  async function load() {
    if (!slug) return;
    const data = await api<{ auction: AuctionCard; bids: BidRow[] }>(
      `/api/auctions/${slug}`,
    );
    setAuction(data.auction);
    setBids(data.bids);
    setSecs(data.auction.seconds_remaining || data.auction.starts_in_seconds || 0);
    setForm((f) => ({
      ...f,
      amount: ((data.auction.min_next_bid_cents || 0) / 100).toFixed(2),
    }));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (!auction || auction.status !== "live") return;
    const t = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    const poll = setInterval(() => {
      load().catch(() => {});
    }, 15000);
    return () => {
      clearInterval(t);
      clearInterval(poll);
    };
  }, [auction?.id, auction?.status]);

  async function placeBid(e: FormEvent) {
    e.preventDefault();
    if (!auction) return;
    setSubmitting(true);
    setError("");
    try {
      await api(`/api/auctions/${auction.id}/bid`, {
        method: "POST",
        body: JSON.stringify({
          bidder_name: form.bidder_name,
          bidder_email: form.bidder_email,
          bidder_phone: form.bidder_phone || undefined,
          amount_cents: Math.round(Number(form.amount) * 100),
        }),
      });
      setSuccessOpen("You're the high bidder!");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bid failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function buyNow() {
    if (!auction) return;
    setSubmitting(true);
    setError("");
    try {
      await api(`/api/auctions/${auction.id}/buy-now`, {
        method: "POST",
        body: JSON.stringify({
          bidder_name: form.bidder_name,
          bidder_email: form.bidder_email,
          bidder_phone: form.bidder_phone || undefined,
        }),
      });
      setBuyOpen(false);
      setSuccessOpen("You won with Buy It Now! We'll contact you to arrange payment & delivery.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Buy Now failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !auction) return <div className="shell empty">{error}</div>;
  if (!auction) return <div className="shell empty">Loading auction…</div>;

  const live = auction.status === "live";

  return (
    <div className="shell auction-page">
      <div className="pdp">
        <div className="gallery">
          <img src={auction.image || "/api/images/placeholder"} alt={auction.title} />
        </div>
        <div className="pdp-info">
          <div className="breadcrumbs">
            <Link to="/auctions">Auctions</Link> / {auction.status}
          </div>
          <h1>{auction.title}</h1>
          {live ? (
            <CountdownBlocks totalSec={secs} label="Time left" />
          ) : auction.status === "scheduled" ? (
            <CountdownBlocks totalSec={secs} label="Starts in" />
          ) : (
            <div className="countdown-wrap">
              <div className="countdown-label">Status</div>
              <div className="countdown-ended">{auction.status}</div>
            </div>
          )}

          <div className="pdp-price">
            <span className="price">
              {money(auction.current_bid_cents || auction.starting_bid_cents)}
            </span>
            <span className="muted">
              {auction.bid_count} bid{auction.bid_count === 1 ? "" : "s"} · min next{" "}
              {money(auction.min_next_bid_cents)}
            </span>
          </div>

          {auction.has_reserve && (
            <div className={`reserve-flag ${auction.reserve_met ? "met" : ""}`}>
              {auction.reserve_met ? "✓ Reserve met" : "Reserve not yet met"}
            </div>
          )}

          <p style={{ color: "var(--ink-soft)" }}>{auction.description}</p>

          {auction.product && (
            <p className="muted">
              Linked item:{" "}
              <Link to={`/product/${auction.product.slug}`}>{auction.product.name}</Link>
            </p>
          )}

          {live ? (
            <form className="buy-box" onSubmit={placeBid}>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Place a bid</h3>
              <div className="field">
                <label>Your name</label>
                <input
                  required
                  value={form.bidder_name}
                  onChange={(e) => setForm({ ...form, bidder_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  required
                  type="email"
                  value={form.bidder_email}
                  onChange={(e) => setForm({ ...form, bidder_email: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Phone (optional)</label>
                <input
                  value={form.bidder_phone}
                  onChange={(e) => setForm({ ...form, bidder_phone: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Bid amount ($)</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min={(auction.min_next_bid_cents / 100).toFixed(2)}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              {error && <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
              <button className="btn btn-primary" disabled={submitting}>
                {submitting ? "Placing…" : `Bid ${form.amount ? money(Math.round(Number(form.amount) * 100)) : ""}`}
              </button>
              {auction.buy_now_cents != null && (
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setBuyOpen(true)}
                >
                  Buy It Now — {money(auction.buy_now_cents)}
                </button>
              )}
              <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
                Bidding in the last 2 minutes extends the auction by 2 minutes.
              </p>
            </form>
          ) : auction.status === "sold" ? (
            <div className="buy-box">
              <strong>Sold</strong>
              <p className="muted" style={{ margin: 0 }}>
                Winning bid {money(auction.current_bid_cents)}. Winner will be contacted for payment
                and delivery.
              </p>
            </div>
          ) : (
            <div className="buy-box">
              <strong>Auction closed</strong>
              <p className="muted" style={{ margin: 0 }}>
                {auction.status === "ended" && auction.has_reserve && !auction.reserve_met
                  ? "Ended without meeting reserve."
                  : "This auction is no longer accepting bids."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: "3rem" }}>
        <h3 style={{ marginTop: 0 }}>Bid history</h3>
        {bids.length ? (
          <table className="bid-table">
            <thead>
              <tr>
                <th>Bidder</th>
                <th>Amount</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b, i) => (
                <tr key={b.id} className={i === 0 ? "high-bid" : ""}>
                  <td>
                    {b.bidder_name}
                    {i === 0 && live ? " · high bidder" : ""}
                  </td>
                  <td>{money(b.amount_cents)}</td>
                  <td>{new Date(b.created_at.replace(" ", "T") + "Z").toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No bids yet — be the first!</p>
        )}
      </div>

      <Modal
        open={buyOpen}
        title="Buy It Now"
        onClose={() => setBuyOpen(false)}
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={() => setBuyOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={submitting || !form.bidder_name || !form.bidder_email}
              onClick={buyNow}
            >
              Confirm {auction.buy_now_cents ? money(auction.buy_now_cents) : ""}
            </button>
          </>
        }
      >
        <p>
          Instantly win this auction for{" "}
          <strong>{auction.buy_now_cents ? money(auction.buy_now_cents) : ""}</strong>. Enter your
          contact details in the bid form first.
        </p>
        {(!form.bidder_name || !form.bidder_email) && (
          <p style={{ color: "#e8d4b0" }}>Fill in your name and email on the bid form, then confirm.</p>
        )}
      </Modal>

      <Modal open={!!successOpen} title="Success" onClose={() => setSuccessOpen("")}>
        <p style={{ margin: 0 }}>{successOpen}</p>
      </Modal>
    </div>
  );
}
