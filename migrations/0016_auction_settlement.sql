-- Auction winner settlement: unpaid order + pay token
ALTER TABLE auctions ADD COLUMN settlement_order_id TEXT;
ALTER TABLE auctions ADD COLUMN settlement_token TEXT;
ALTER TABLE auctions ADD COLUMN settlement_email_sent_at TEXT;

ALTER TABLE orders ADD COLUMN auction_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_auction ON orders(auction_id);
CREATE INDEX IF NOT EXISTS idx_auctions_settlement_token ON auctions(settlement_token);
