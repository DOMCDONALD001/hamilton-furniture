-- Simple delivery config (replaces complex multi-zone setup for storefront)
INSERT OR IGNORE INTO store_settings (key, value) VALUES
  ('delivery_allowed_zips', '["45011","45013","45014","45015","45030","45042","45044","45056","45067","45069"]'),
  ('delivery_flat_fee_cents', '7500'),
  ('delivery_free_above_cents', '150000'),
  ('delivery_pickup_enabled', '1'),
  ('delivery_enabled', '1'),
  ('delivery_eta_text', '1–3 business days'),
  ('delivery_outside_message', 'Sorry — we only deliver to selected Hamilton-area ZIP codes. Choose store pickup or contact us for a custom quote.');
