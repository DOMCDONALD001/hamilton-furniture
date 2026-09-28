-- Canonical public site URL + correct domain emails
INSERT INTO store_settings (key, value, updated_at) VALUES
  ('site_url', 'https://hamiltonsoddsandends.com', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = datetime('now');

INSERT INTO store_settings (key, value, updated_at) VALUES
  ('email_from', 'orders@hamiltonsoddsandends.com', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = CASE
    WHEN trim(store_settings.value) = '' OR store_settings.value LIKE '%hamiltonoddsnends.com%'
      THEN excluded.value
    ELSE store_settings.value
  END,
  updated_at = datetime('now');

UPDATE store_settings
SET value = 'hello@hamiltonsoddsandends.com', updated_at = datetime('now')
WHERE key = 'store_email'
  AND (
    value LIKE '%hamiltonoddsnends.com%'
    OR value = 'hello@hamiltonoddsnends.com'
  );
