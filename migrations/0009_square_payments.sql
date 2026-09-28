-- Square payment tracking on orders
ALTER TABLE orders ADD COLUMN square_payment_id TEXT;
ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'later';
