import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, money } from "../lib/api";
import { useCustomer } from "../lib/customer";
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
  const { customer, loading: customerLoading } = useCustomer();
  const [auction, setAuction] = useState<AuctionCard | null>(null);
  const [bids, setBids] = useState<BidRow[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [successOpen, setSuccessOpen] = useState("");
  const [buyOpen, setBuyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    bidder_phone: "",
    amount: "",
  });

  const loginNext = `/account?next=${encodeURIComponent(`/auctions/${slug || ""}`)}`;

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
    if (!auction || !customer) return;
    setSubmitting(true);
    setError("");
    try {
      await api(`/api/auctions/${auction.id}/bid`, {
        method: "POST",
        body: JSON.stringify({
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
    if (!auction || !customer) return;
    setSubmitting(true);
    setError("");
    try {
      await api(`/api/auctions/${auction.id}/buy-now`, {
        method: "POST",
        body: JSON.stringify({
          bidder_phone: form.bidder_phone || undefined,
        }),
      });
      setBuyOpen(false);
      setSuccessOpen(
        "You won with Buy It Now! Check your email for a secure link to pay and choose free pickup or paid delivery.",
      );
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

          {live ? (
            customerLoading ? (
              <div className="buy-box">
                <p className="muted" style={{ margin: 0 }}>
                  Checking your account…
                </p>
              </div>
            ) : !customer ? (
              <div className="buy-box">
                <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Sign in to bid</h3>
                <p className="muted" style={{ margin: 0 }}>
                  An account is required to place bids or use Buy It Now. This helps keep auctions
                  fair and lets us contact winners.
                </p>
                <Link className="btn btn-primary" to={loginNext}>
                  Sign in to participate
                </Link>
                <Link className="btn btn-outline" to={`${loginNext}&mode=register`}>
                  Create account
                </Link>
              </div>
            ) : (
              <form className="buy-box" onSubmit={placeBid}>
                <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Place a bid</h3>
                <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                  Bidding as <strong>{customer.name}</strong> ({customer.email})
                </p>
                <div className="field">
                  <label>Phone (optional)</label>
                  <input
                    value={form.bidder_phone}
                    placeholder={customer.phone || ""}
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
                  {submitting
                    ? "Placing…"
                    : `Bid ${form.amount ? money(Math.round(Number(form.amount) * 100)) : ""}`}
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
            )
          ) : auction.status === "sold" ? (
            <div className="buy-box">
              <strong>Sold</strong>
              <p className="muted" style={{ margin: 0 }}>
                Winning bid {money(auction.current_bid_cents)}. The winner was emailed a secure link
                to pay online and choose free store pickup or paid delivery.
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
              disabled={submitting || !customer}
              onClick={buyNow}
            >
              Confirm {auction.buy_now_cents ? money(auction.buy_now_cents) : ""}
            </button>
          </>
        }
      >
        <p>
          Instantly win this auction for{" "}
          <strong>{auction.buy_now_cents ? money(auction.buy_now_cents) : ""}</strong> as{" "}
          <strong>{customer?.name}</strong>.
        </p>
      </Modal>

      <Modal open={!!successOpen} title="Success" onClose={() => setSuccessOpen("")}>
        <p style={{ margin: 0 }}>{successOpen}</p>
      </Modal>
    </div>
  );
}
