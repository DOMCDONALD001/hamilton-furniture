-- Normalize single color strings into JSON arrays for multi-color support
UPDATE products
SET color = json_array(color)
WHERE color IS NOT NULL
  AND color != ''
  AND substr(trim(color), 1, 1) != '[';
