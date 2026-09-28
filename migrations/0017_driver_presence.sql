-- Live driver GPS heartbeat for admin monitoring
CREATE TABLE IF NOT EXISTS driver_presence (
  driver_id TEXT PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy_m REAL,
  heading REAL,
  speed_mps REAL,
  route_id TEXT,
  stop_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_presence_updated ON driver_presence(updated_at);
