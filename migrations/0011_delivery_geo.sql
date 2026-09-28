-- GPS pin when a stop is marked delivered
ALTER TABLE delivery_route_stops ADD COLUMN delivered_lat REAL;
ALTER TABLE delivery_route_stops ADD COLUMN delivered_lng REAL;
ALTER TABLE delivery_route_stops ADD COLUMN delivered_accuracy_m REAL;
ALTER TABLE delivery_route_stops ADD COLUMN delivered_geo_at TEXT;
