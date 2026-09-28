-- Note: order status CHECK cannot be widened on D1 without breaking FKs.
-- Driver reports set orders.status = 'processing' and create delivery_issues rows.
-- Admin resolves reports and chooses the next order status from the Reports page.
SELECT 1;
