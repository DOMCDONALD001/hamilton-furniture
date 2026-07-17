# Hamilton Odds N Ends Furniture

Modern marketplace-style furniture store on **Cloudflare Workers** with:

- **D1** — products, inventory, orders, discounts, delivery zones
- **R2** — product photo storage
- **Workers + static assets** — storefront + owner admin
- Amazon/eBay-style browse, search, filters, cart, checkout, order tracking

## Quick start (local)

```bash
cd hamilton-furniture
npm install

# Apply database schema + seed products
npm run db:migrate:local

# Start store (API + React)
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

| Area | URL |
|------|-----|
| Storefront | `/` |
| Shop | `/shop` |
| Owner admin | `/admin` |
| Admin login password (local) | `hamilton-admin` |

## What you can manage as owner

- **Inventory** — add/edit products, SKUs, stock, prices, cost, condition, featured flag
- **Photos** — upload images to R2, set primary photo, delete
- **Offers** — percent off, fixed $, free shipping, promo codes, usage limits
- **Orders** — status pipeline, payment status, delivery fee adjustments, notes
- **Delivery** — ZIP-based zones, base fee, per-item fee, free-above threshold
- **Settings** — phone, email, address, tax rate

## Deploy to Cloudflare

1. Log in: `npx wrangler login`

2. Create D1 database:
   ```bash
   npx wrangler d1 create hamilton-furniture-db
   ```
   Copy the `database_id` into `wrangler.jsonc`.

3. Create R2 bucket:
   ```bash
   npx wrangler r2 bucket create hamilton-furniture-images
   ```

4. Apply migrations remotely:
   ```bash
   npm run db:migrate:remote
   ```

5. Set admin password:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   ```

6. Deploy:
   ```bash
   npm run deploy
   ```

## Stack

- React + Vite + React Router
- Hono API on Cloudflare Workers
- Cloudflare D1 (SQLite) + R2 (images)
- Session cookie auth for admin

## Notes

- Checkout creates orders and decrements stock. Payment is marked unpaid by default so you can collect in-store / on delivery / invoice, then mark **Paid** in admin.
- Seed catalog includes sample living, dining, office, bedroom, and odds-and-ends pieces plus promo codes `WELCOME10` and `FREESHIP`.
