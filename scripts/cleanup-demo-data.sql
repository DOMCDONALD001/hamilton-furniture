-- Removes test/demo transactional data ahead of going live.
-- Preserves: products, product_images, categories, delivery_zones,
-- admin_accounts, drivers, customers, store_settings.

DELETE FROM return_claims;
DELETE FROM order_refunds;
DELETE FROM order_events;
DELETE FROM delivery_issues;
DELETE FROM delivery_route_stops;
DELETE FROM delivery_routes;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM bids;
DELETE FROM auctions;
DELETE FROM discounts;
DELETE FROM driver_presence;
