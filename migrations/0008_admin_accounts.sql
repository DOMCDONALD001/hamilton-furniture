-- Account-based admin auth (email + hashed password). No shared default password.
CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  password_hash TEXT,
  password_salt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO admin_accounts (id, email, name)
VALUES ('admin_owner', 'hamiltonsbikes216@gmail.com', 'Store Owner');

-- Tie sessions to an admin account
ALTER TABLE admin_sessions ADD COLUMN admin_id TEXT REFERENCES admin_accounts(id);
