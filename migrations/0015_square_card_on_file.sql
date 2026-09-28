-- Save Square customer + card on file so admin can adjust delivery and re-charge
ALTER TABLE orders ADD COLUMN square_customer_id TEXT;
ALTER TABLE orders ADD COLUMN square_card_id TEXT;
ALTER TABLE orders ADD COLUMN card_brand TEXT;
ALTER TABLE orders ADD COLUMN card_last4 TEXT;

ALTER TABLE bids ADD COLUMN customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bids_customer ON bids(customer_id);
