-- Staging photos from phone before attaching to inventory products.
CREATE TABLE IF NOT EXISTS photo_drop (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_photo_drop_created ON photo_drop(created_at DESC);
