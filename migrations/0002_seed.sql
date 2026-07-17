INSERT OR IGNORE INTO categories (id, name, slug, description, sort_order) VALUES
  ('cat_living', 'Living Room', 'living-room', 'Sofas, chairs, coffee tables, and entertainment pieces', 1),
  ('cat_bedroom', 'Bedroom', 'bedroom', 'Beds, dressers, nightstands, and storage', 2),
  ('cat_dining', 'Dining', 'dining', 'Tables, chairs, and buffet storage', 3),
  ('cat_office', 'Office', 'office', 'Desks, chairs, and bookcases', 4),
  ('cat_outdoor', 'Outdoor', 'outdoor', 'Patio and garden furniture', 5),
  ('cat_odds', 'Odds & Ends', 'odds-and-ends', 'Unique finds, accents, and one-of-a-kind pieces', 6);

INSERT OR IGNORE INTO delivery_zones (id, name, zip_prefixes, base_cents, per_item_cents, free_above_cents, estimated_days_min, estimated_days_max, sort_order) VALUES
  ('zone_local', 'Local Delivery (Hamilton area)', '["450","451","452"]', 4900, 1500, 150000, 1, 3, 1),
  ('zone_regional', 'Regional Ohio', '["43","44","45","46"]', 8900, 2500, 250000, 3, 7, 2),
  ('zone_pickup', 'Store Pickup', '[]', 0, 0, NULL, 0, 1, 0);

INSERT OR IGNORE INTO store_settings (key, value) VALUES
  ('tax_rate_bps', '725'),
  ('store_phone', '(513) 555-0199'),
  ('store_email', 'hello@hamiltonoddsnends.com'),
  ('store_address', '1420 High Street, Hamilton, OH 45011'),
  ('currency', 'USD'),
  ('low_stock_alert', '2');

INSERT OR IGNORE INTO products (id, sku, name, slug, description, category_id, price_cents, compare_at_cents, cost_cents, stock, condition, brand, dimensions, material, color, featured, status, tags) VALUES
  ('prod_sofa1', 'HOE-SOFA-001', 'Mid-Century Walnut Sofa', 'mid-century-walnut-sofa',
   'A sleek three-seater with walnut legs and soft charcoal upholstery. Perfect for modern living rooms. Gently used, professionally cleaned.',
   'cat_living', 89900, 129900, 42000, 2, 'like_new', 'Hamilton House', '84" W x 34" D x 32" H', 'Walnut / Fabric', 'Charcoal', 1, 'active', '["sofa","mid-century","featured"]'),
  ('prod_table1', 'HOE-TBL-014', 'Reclaimed Oak Dining Table', 'reclaimed-oak-dining-table',
   'Solid reclaimed oak table that seats six. Live-edge accents with a smooth matte finish. One of a kind.',
   'cat_dining', 124500, NULL, 68000, 1, 'good', NULL, '72" L x 36" W x 30" H', 'Reclaimed Oak', 'Natural Oak', 1, 'active', '["dining","oak","unique"]'),
  ('prod_desk1', 'HOE-DSK-008', 'Industrial Writing Desk', 'industrial-writing-desk',
   'Black powder-coated steel frame with a warm walnut top. Built-in cable grommets and a lower shelf.',
   'cat_office', 34900, 44900, 18000, 5, 'new', 'Forge & Form', '48" W x 24" D x 30" H', 'Steel / Walnut', 'Black / Walnut', 1, 'active', '["desk","office","industrial"]'),
  ('prod_bed1', 'HOE-BED-003', 'Platform Queen Bed Frame', 'platform-queen-bed-frame',
   'Low-profile platform bed in matte espresso. No box spring needed. Includes sturdy slat support.',
   'cat_bedroom', 42900, 59900, 21000, 3, 'new', 'Restwell', 'Queen — 63" W x 84" L x 14" H', 'Engineered Wood', 'Espresso', 0, 'active', '["bed","queen","bedroom"]'),
  ('prod_chair1', 'HOE-CHR-021', 'Velvet Accent Chair', 'velvet-accent-chair',
   'Deep emerald velvet with gold-tone tapered legs. Statement piece for corners and reading nooks.',
   'cat_living', 27900, 34900, 14000, 4, 'like_new', NULL, '30" W x 32" D x 34" H', 'Velvet / Wood', 'Emerald', 1, 'active', '["chair","accent","velvet"]'),
  ('prod_odds1', 'HOE-ODD-055', 'Vintage Brass Floor Lamp', 'vintage-brass-floor-lamp',
   'Classic adjustable brass floor lamp with linen shade. Fully rewired and tested. A true odds-and-ends find.',
   'cat_odds', 12500, NULL, 4500, 1, 'good', NULL, '62" H', 'Brass / Linen', 'Brass', 0, 'active', '["lamp","vintage","lighting"]');

INSERT OR IGNORE INTO discounts (id, code, name, description, type, value, min_order_cents, max_uses, starts_at, ends_at, active) VALUES
  ('disc_welcome', 'WELCOME10', 'Welcome 10% Off', '10% off orders over $100', 'percent', 10, 10000, 500, datetime('now'), datetime('now', '+90 days'), 1),
  ('disc_free_ship', 'FREESHIP', 'Free Local Delivery', 'Free delivery on qualifying local orders', 'free_shipping', 0, 75000, NULL, datetime('now'), datetime('now', '+60 days'), 1),
  ('disc_sofa', NULL, 'Sofa Spring Sale', '$100 off Mid-Century Walnut Sofa', 'fixed', 10000, 0, NULL, datetime('now'), datetime('now', '+30 days'), 1);

UPDATE discounts SET product_id = 'prod_sofa1' WHERE id = 'disc_sofa';
