import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../lib/api";
import { CountdownBlocks } from "../components/Countdown";

export type AuctionCard = {
  id: string;
  slug: string;
  title: string;
  description: string;
  starting_bid_cents: number;
  current_bid_cents: number;
  bid_increment_cents: number;
  buy_now_cents: number | null;
  bid_count: number;
  starts_at: string;
  ends_at: string;
  status: string;
  min_next_bid_cents: number;
  has_reserve: boolean;
  reserve_met: boolean;
  seconds_remaining: number;
  starts_in_seconds: number;
  image?: string | null;
  product?: { id: string; name: string; slug: string } | null;
};

export function formatCountdown(totalSec: number) {
  if (totalSec <= 0) return "Ended";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function AuctionsPage() {
  const [auctions, setAuctions] = useState<AuctionCard[]>([]);
  const [tab, setTab] = useState<"live" | "scheduled" | "closed">("live");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const status = tab === "closed" ? "closed" : tab;
    api<{ auctions: AuctionCard[] }>(`/api/auctions?status=${status}`)
      .then((d) => setAuctions(d.auctions))
      .catch(() => setAuctions([]))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="shell auction-page">
      <div className="section-head">
        <div>
          <h2>Auctions</h2>
          <p>Bid on unique furniture finds — highest bid wins</p>
        </div>
      </div>

      <div className="nav-cats" style={{ paddingBottom: "1rem" }}>
        {(["live", "scheduled", "closed"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`chip ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "live" ? "Live now" : t === "scheduled" ? "Upcoming" : "Ended"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">Loading auctions…</div>
      ) : auctions.length ? (
        <div className="product-grid" style={{ marginBottom: "3rem" }}>
          {auctions.map((a) => (
            <AuctionCardView key={a.id} auction={a} />
          ))}
        </div>
      ) : (
        <div className="empty">
          No {tab} auctions right now.
          <div style={{ marginTop: 12 }}>
            <Link className="btn btn-dark btn-sm" to="/shop">
              Browse buy-it-now inventory
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function AuctionCardView({ auction }: { auction: AuctionCard }) {
  const [secs, setSecs] = useState(auction.seconds_remaining || auction.starts_in_seconds);

  useEffect(() => {
    setSecs(auction.seconds_remaining || auction.starts_in_seconds);
    const t = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [auction.id, auction.seconds_remaining, auction.starts_in_seconds]);

  return (
    <Link to={`/auctions/${auction.slug}`} className="product-card auction-card">
      <div className="thumb">
        <img src={auction.image || "/api/images/placeholder"} alt={auction.title} />
        <span className={`pill ${auction.status === "live" ? "sale" : ""}`}>
          {auction.status === "live"
            ? "Live auction"
            : auction.status === "scheduled"
              ? "Upcoming"
              : auction.status}
        </span>
      </div>
      <div className="product-body">
        <div className="auction-card-timer">
          {auction.status === "live" ? (
            <CountdownBlocks totalSec={secs} label="Time left" />
          ) : auction.status === "scheduled" ? (
            <CountdownBlocks totalSec={secs} label="Starts in" />
          ) : (
            <div className="countdown-wrap">
              <div className="countdown-label">Status</div>
              <div className="countdown-ended" style={{ fontSize: "1.1rem" }}>
                {auction.status}
              </div>
            </div>
          )}
        </div>
        <h3>{auction.title}</h3>
        <div className="price-row">
          <span className="price">{money(auction.current_bid_cents || auction.starting_bid_cents)}</span>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {auction.bid_count} bid{auction.bid_count === 1 ? "" : "s"}
          </span>
        </div>
        {auction.has_reserve && (
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            {auction.reserve_met ? "Reserve met" : "Reserve not met"}
          </div>
        )}
      </div>
    </Link>
  );
}
