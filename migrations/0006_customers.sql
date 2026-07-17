-- Optional customer accounts
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);

-- Member-only offers (account holders only — guests cannot use)
ALTER TABLE discounts ADD COLUMN members_only INTEGER NOT NULL DEFAULT 0;

-- Link orders to customer when logged in (optional)
ALTER TABLE orders ADD COLUMN customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;

-- Seed a members-only promo
INSERT OR IGNORE INTO discounts (
  id, code, name, description, type, value, min_order_cents, max_uses, starts_at, ends_at, active, members_only
) VALUES (
  'disc_members',
  'MEMBER15',
  'Member 15% Off',
  'Exclusive 15% off for account holders — create a free account to unlock',
  'percent',
  15,
  5000,
  NULL,
  datetime('now'),
  datetime('now', '+180 days'),
  1,
  1
);
