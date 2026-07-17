-- Easier delivery pricing: Local vs Extended zones + per-item add-on
INSERT OR IGNORE INTO store_settings (key, value) VALUES
  ('delivery_local_zips', '["45011","45013","45014","45015"]'),
  ('delivery_local_fee_cents', '4900'),
  ('delivery_extended_zips', '["45030","45042","45044","45056","45067","45069"]'),
  ('delivery_extended_fee_cents', '8900'),
  ('delivery_per_item_cents', '1500'),
  ('delivery_eta_local', '1–2 business days'),
  ('delivery_eta_extended', '2–4 business days');

-- Copy legacy flat list into local if local empty (handled in code fallback)
