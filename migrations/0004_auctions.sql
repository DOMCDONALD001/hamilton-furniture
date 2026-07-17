CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starting_bid_cents INTEGER NOT NULL,
  current_bid_cents INTEGER NOT NULL DEFAULT 0,
  reserve_cents INTEGER,
  bid_increment_cents INTEGER NOT NULL DEFAULT 500,
  buy_now_cents INTEGER,
  bid_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled', 'sold')),
  winner_name TEXT,
  winner_email TEXT,
  winner_phone TEXT,
  winner_bid_cents INTEGER,
  reserve_met INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
CREATE INDEX IF NOT EXISTS idx_auctions_ends ON auctions(ends_at);
CREATE INDEX IF NOT EXISTS idx_auctions_slug ON auctions(slug);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  bidder_name TEXT NOT NULL,
  bidder_email TEXT NOT NULL,
  bidder_phone TEXT,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id, created_at DESC);

-- Sample live auction (ends in 3 days)
INSERT OR IGNORE INTO auctions (
  id, slug, product_id, title, description,
  starting_bid_cents, current_bid_cents, reserve_cents, bid_increment_cents, buy_now_cents,
  starts_at, ends_at, status
) VALUES (
  'auc_demo1',
  'vintage-brass-floor-lamp-auction',
  'prod_odds1',
  'Auction: Vintage Brass Floor Lamp',
  'Bid on this classic adjustable brass floor lamp with linen shade. Fully rewired. Highest bid wins — local pickup or delivery available after close.',
  5000,
  5000,
  8000,
  500,
  15000,
  datetime('now', '-1 hour'),
  datetime('now', '+3 days'),
  'live'
);
