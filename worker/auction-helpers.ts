import type { Env } from "./types";
import { id, slugify } from "./types";
import { createAuctionSettlement, type SettlementBid } from "./auction-settle";

export type Auction = {
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
  settlement_order_id?: string | null;
  settlement_token?: string | null;
  settlement_email_sent_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type Bid = {
  id: string;
  auction_id: string;
  bidder_name: string;
  bidder_email: string;
  bidder_phone: string | null;
  amount_cents: number;
  created_at: string;
  customer_id?: string | null;
};

/** Promote scheduled→live and close expired live auctions. */
export async function settleAuctions(env: Env, origin: string) {
  await env.DB.prepare(
    `UPDATE auctions SET status = 'live', updated_at = datetime('now')
     WHERE status = 'scheduled' AND datetime(starts_at) <= datetime('now')`,
  ).run();

  const { results: expired } = await env.DB.prepare(
    `SELECT * FROM auctions WHERE status = 'live' AND datetime(ends_at) <= datetime('now')`,
  ).all<Auction>();

  for (const a of expired || []) {
    await closeAuction(env, a, origin);
  }
}

export async function closeAuction(env: Env, auction: Auction, origin: string) {
  const high = await env.DB.prepare(
    `SELECT * FROM bids WHERE auction_id = ? ORDER BY amount_cents DESC, created_at ASC LIMIT 1`,
  )
    .bind(auction.id)
    .first<SettlementBid>();

  const reserve = auction.reserve_cents;
  const met = !!high && (reserve == null || high.amount_cents >= reserve);

  if (met && high) {
    const updated = await env.DB.prepare(
      `UPDATE auctions SET
        status = 'sold',
        winner_name = ?,
        winner_email = ?,
        winner_phone = ?,
        winner_bid_cents = ?,
        reserve_met = 1,
        current_bid_cents = ?,
        updated_at = datetime('now')
       WHERE id = ? AND status = 'live'`,
    )
      .bind(
        high.bidder_name,
        high.bidder_email,
        high.bidder_phone,
        high.amount_cents,
        high.amount_cents,
        auction.id,
      )
      .run();

    // Only settle once (avoid duplicate orders if called twice)
    if (updated.meta.changes) {
      if (auction.product_id) {
        await env.DB.prepare(
          `UPDATE products SET stock = 0, status = 'out_of_stock', updated_at = datetime('now') WHERE id = ?`,
        )
          .bind(auction.product_id)
          .run();
      }

      try {
        await createAuctionSettlement(env, { ...auction, status: "sold" }, high, origin);
      } catch (err) {
        console.error("[auction:settlement]", err);
      }
    }
  } else {
    await env.DB.prepare(
      `UPDATE auctions SET
        status = 'ended',
        reserve_met = 0,
        updated_at = datetime('now')
       WHERE id = ? AND status = 'live'`,
    )
      .bind(auction.id)
      .run();
  }
}

export function minNextBid(auction: Auction) {
  if (auction.bid_count <= 0 || auction.current_bid_cents <= 0) {
    return auction.starting_bid_cents;
  }
  return auction.current_bid_cents + auction.bid_increment_cents;
}

export function publicAuction(a: Auction) {
  const now = Date.now();
  const endsMs = Date.parse(
    a.ends_at.includes("T") ? a.ends_at : a.ends_at.replace(" ", "T") + "Z",
  );
  const startsMs = Date.parse(
    a.starts_at.includes("T") ? a.starts_at : a.starts_at.replace(" ", "T") + "Z",
  );

  return {
    ...a,
    min_next_bid_cents: minNextBid(a),
    has_reserve: a.reserve_cents != null,
    reserve_met:
      !!a.reserve_met ||
      (a.reserve_cents != null && a.current_bid_cents >= a.reserve_cents),
    seconds_remaining:
      a.status === "live" ? Math.max(0, Math.floor((endsMs - now) / 1000)) : 0,
    starts_in_seconds:
      a.status === "scheduled" ? Math.max(0, Math.floor((startsMs - now) / 1000)) : 0,
  };
}

export function auctionSlug(title: string) {
  return `${slugify(title)}-${id("a").slice(-6)}`;
}

export type { Env };
