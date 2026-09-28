-- Per-offer control for homepage offer strip (checkout codes still work when hidden)
ALTER TABLE discounts ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 1;
