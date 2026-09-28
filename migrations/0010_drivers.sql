-- Driver accounts (separate from admin — delivery status + issues only)
CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS driver_sessions (
  token TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  route_date TEXT NOT NULL,
  driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'assigned', 'in_progress', 'completed', 'cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_route_stops (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES delivery_routes(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id),
  stop_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'en_route', 'delivered', 'failed', 'skipped')),
  delivered_at TEXT,
  driver_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (route_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_route_stops_route ON delivery_route_stops(route_id, stop_order);
CREATE INDEX IF NOT EXISTS idx_route_stops_order ON delivery_route_stops(order_id);
CREATE INDEX IF NOT EXISTS idx_routes_driver_date ON delivery_routes(driver_id, route_date);

CREATE TABLE IF NOT EXISTS delivery_issues (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  route_id TEXT REFERENCES delivery_routes(id) ON DELETE SET NULL,
  stop_id TEXT REFERENCES delivery_route_stops(id) ON DELETE SET NULL,
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  issue_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_delivery_issues_status ON delivery_issues(status, created_at);
