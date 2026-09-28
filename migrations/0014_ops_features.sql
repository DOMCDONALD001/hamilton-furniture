-- Delivery windows, addresses, returns, order events
ALTER TABLE orders ADD COLUMN delivery_date TEXT;
ALTER TABLE orders ADD COLUMN delivery_window TEXT;
ALTER TABLE orders ADD COLUMN sale_channel TEXT DEFAULT 'online';

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  name TEXT,
  phone TEXT,
  address1 TEXT NOT NULL,
  address2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OH',
  zip TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

CREATE TABLE IF NOT EXISTS return_claims (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id TEXT,
  customer_email TEXT NOT NULL,
  claim_type TEXT NOT NULL
    CHECK (claim_type IN ('return', 'damage', 'wrong_item', 'missing', 'other')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'approved', 'denied', 'resolved')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_claims_status ON return_claims(status, created_at);
CREATE INDEX IF NOT EXISTS idx_return_claims_order ON return_claims(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

INSERT OR IGNORE INTO store_settings (key, value) VALUES
  ('delivery_windows_json', '["9am–12pm","12pm–3pm","3pm–6pm"]'),
  ('delivery_lead_days', '1'),
  ('delivery_max_days', '14'),
  ('notify_email', ''),
  ('email_from_name', 'Hamilton''s Odds N Ends Furniture');
