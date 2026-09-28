import type { Env } from "./types";
import { id } from "./types";
import { getSetting, orderNumber, resolveDelivery, getDeliveryConfig } from "./helpers";
import { sendEmail } from "./email";
import { createSquarePayment, getSquareConfig } from "./square";
import { addOrderEvent } from "./order-events";
import type { Auction, Bid } from "./auction-helpers";

export type SettlementBid = Bid & { customer_id?: string | null };

export function moneyLabel(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function createAuctionSettlement(
  env: Env,
  auction: Auction,
  high: SettlementBid,
  origin: string,
) {
  // Already settled?
  const existing = await env.DB.prepare(
    `SELECT settlement_order_id, settlement_token FROM auctions WHERE id = ?`,
  )
    .bind(auction.id)
    .first<{ settlement_order_id: string | null; settlement_token: string | null }>();
  if (existing?.settlement_order_id && existing?.settlement_token) {
    return {
      orderId: existing.settlement_order_id,
      token: existing.settlement_token,
      orderNumber: null as string | null,
      created: false,
    };
  }

  const orderId = id("ord");
  const num = orderNumber();
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const bidCents = high.amount_cents;

  let productName = auction.title;
  let productSku = `AUC-${auction.slug.slice(0, 12)}`;
  let productId: string | null = auction.product_id;
  if (auction.product_id) {
    const product = await env.DB.prepare(
      `SELECT id, name, sku FROM products WHERE id = ?`,
    )
      .bind(auction.product_id)
      .first<{ id: string; name: string; sku: string }>();
    if (product) {
      productName = product.name;
      productSku = product.sku;
      productId = product.id;
    }
  }

  const taxBps = Number(await getSetting(env.DB, "tax_rate_bps", "725")) || 0;
  const taxCents = Math.round((bidCents * taxBps) / 10000);
  const totalCents = bidCents + taxCents;

  await env.DB.prepare(
    `INSERT INTO orders (
      id, order_number, status, payment_status, customer_name, customer_email, customer_phone,
      shipping_address1, shipping_city, shipping_state, shipping_zip, shipping_notes,
      delivery_method, subtotal_cents, discount_cents, delivery_cents, tax_cents, total_cents,
      customer_id, payment_method, sale_channel, auction_id
    ) VALUES (?, ?, 'pending', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, 'pickup', ?, 0, 0, ?, ?, ?, 'auction_pending', 'auction', ?)`,
  )
    .bind(
      orderId,
      num,
      high.bidder_name,
      high.bidder_email.toLowerCase(),
      high.bidder_phone || null,
      "Awaiting winner choice",
      "Tupelo",
      "MS",
      "38801",
      `Auction win: ${auction.title}`,
      bidCents,
      taxCents,
      totalCents,
      high.customer_id || null,
      auction.id,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO order_items (id, order_id, product_id, product_name, product_sku, unit_price_cents, quantity, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(id("oi"), orderId, productId, productName, productSku, bidCents, bidCents)
    .run();

  await env.DB.prepare(
    `UPDATE auctions SET
      settlement_order_id = ?,
      settlement_token = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(orderId, token, auction.id)
    .run();

  await addOrderEvent(
    env.DB,
    orderId,
    "auction_won",
    `Won auction "${auction.title}" for ${moneyLabel(bidCents)}. Awaiting payment.`,
  );

  await sendAuctionWonEmail(env, {
    origin,
    token,
    orderNumber: num,
    winnerName: high.bidder_name,
    winnerEmail: high.bidder_email,
    auctionTitle: auction.title,
    bidCents,
    taxCents,
    totalCents,
  });

  await env.DB.prepare(
    `UPDATE auctions SET settlement_email_sent_at = datetime('now') WHERE id = ?`,
  )
    .bind(auction.id)
    .run();

  return { orderId, token, orderNumber: num, created: true };
}

export async function sendAuctionWonEmail(
  env: Env,
  args: {
    origin: string;
    token: string;
    orderNumber: string;
    winnerName: string;
    winnerEmail: string;
    auctionTitle: string;
    bidCents: number;
    taxCents: number;
    totalCents: number;
  },
) {
  const payUrl = `${args.origin.replace(/\/$/, "")}/auctions/pay/${args.token}`;
  const store =
    (await getSetting(env.DB, "brand_name", env.STORE_NAME || "Hamilton's Odds N Ends")) ||
    "Hamilton's Odds N Ends";

  const html = `<!doctype html><html><body style="font-family:Georgia,serif;color:#1a231e;background:#f7f4ef;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 8px;font-size:22px">You won the auction!</h1>
    <p style="margin:0 0 16px;color:#555">Hi ${escapeHtml(args.winnerName)} — congratulations. You won <strong>${escapeHtml(args.auctionTitle)}</strong>.</p>
    <p style="margin:0 0 8px"><strong>Winning bid:</strong> ${moneyLabel(args.bidCents)}</p>
    <p style="margin:0 0 8px"><strong>Est. tax:</strong> ${moneyLabel(args.taxCents)} (final total updates if you choose delivery)</p>
    <p style="margin:0 0 8px"><strong>Reference:</strong> ${escapeHtml(args.orderNumber)}</p>
    <p style="margin:16px 0;color:#555">Next step: pay online and choose how you want the item.</p>
    <ul style="color:#555;line-height:1.5;margin:0 0 16px;padding-left:18px">
      <li><strong>Store pickup</strong> — free</li>
      <li><strong>Delivery</strong> — paid based on your ZIP (Tupelo / extended area)</li>
    </ul>
    <p style="margin:0 0 20px"><a href="${escapeHtml(payUrl)}" style="display:inline-block;background:#243029;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Pay &amp; arrange pickup or delivery</a></p>
    <p style="margin:0;font-size:13px;color:#777">If the button doesn’t work, open this link:<br/>${escapeHtml(payUrl)}</p>
    <p style="margin:16px 0 0;font-size:13px;color:#777">— ${escapeHtml(store)}</p>
  </div>
  </body></html>`;

  const notify = (await getSetting(env.DB, "notify_email", "")).trim() || "hamiltonsbikes216@gmail.com";
  const recipients = [args.winnerEmail];
  if (notify && notify.toLowerCase() !== args.winnerEmail.toLowerCase()) {
    recipients.push(notify);
  }

  return sendEmail(env, {
    to: recipients,
    subject: `You won · ${args.auctionTitle} · pay to claim`,
    html,
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function loadSettlementByToken(env: Env, token: string) {
  const auction = await env.DB.prepare(
    `SELECT * FROM auctions WHERE settlement_token = ?`,
  )
    .bind(token)
    .first<
      Auction & {
        settlement_order_id: string | null;
        settlement_token: string | null;
        settlement_email_sent_at: string | null;
      }
    >();
  if (!auction?.settlement_order_id) return null;

  const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`)
    .bind(auction.settlement_order_id)
    .first<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      customer_name: string;
      customer_email: string;
      customer_phone: string | null;
      subtotal_cents: number;
      delivery_cents: number;
      tax_cents: number;
      total_cents: number;
      delivery_method: string;
      shipping_address1: string;
      shipping_address2: string | null;
      shipping_city: string;
      shipping_state: string;
      shipping_zip: string;
      delivery_date: string | null;
      delivery_window: string | null;
      auction_id: string | null;
    }>();
  if (!order) return null;

  const { results: items } = await env.DB.prepare(
    `SELECT product_name, product_sku, unit_price_cents, quantity, line_total_cents
     FROM order_items WHERE order_id = ?`,
  )
    .bind(order.id)
    .all();

  return { auction, order, items: items || [] };
}

export async function previewSettlementDelivery(
  env: Env,
  opts: {
    bidCents: number;
    method: "pickup" | "delivery";
    zip: string;
  },
) {
  const config = await getDeliveryConfig(env.DB);
  const taxBps = Number(await getSetting(env.DB, "tax_rate_bps", "725")) || 0;
  const delivery = resolveDelivery({
    config,
    method: opts.method,
    zip: opts.zip,
    subtotalAfterDiscount: opts.bidCents,
    freeShippingPromo: false,
    item_count: 1,
  });
  if (!delivery.ok) {
    return { ok: false as const, error: delivery.error || "Delivery unavailable" };
  }
  const taxable = opts.bidCents + delivery.delivery_cents;
  const taxCents = Math.round((taxable * taxBps) / 10000);
  const totalCents = taxable + taxCents;
  return {
    ok: true as const,
    delivery_cents: delivery.delivery_cents,
    tax_cents: taxCents,
    total_cents: totalCents,
    subtotal_cents: opts.bidCents,
    eta_text: delivery.eta_text,
    zone: delivery.zone,
  };
}

export async function payAuctionSettlement(
  env: Env,
  args: {
    token: string;
    sourceId: string;
    idempotencyKey: string;
    method: "pickup" | "delivery";
    zip: string;
    shipping_address1?: string;
    shipping_address2?: string;
    shipping_city?: string;
    shipping_state?: string;
    shipping_notes?: string;
    delivery_date?: string;
    delivery_window?: string;
    customer_phone?: string;
  },
) {
  const loaded = await loadSettlementByToken(env, args.token);
  if (!loaded) return { ok: false as const, error: "Settlement not found", status: 404 as const };
  const { auction, order } = loaded;

  if (order.payment_status === "paid") {
    return {
      ok: true as const,
      already_paid: true as const,
      order_number: order.order_number,
      order_id: order.id,
    };
  }
  if (auction.status !== "sold") {
    return { ok: false as const, error: "Auction is not in a sold state", status: 409 as const };
  }

  const square = await getSquareConfig(env);
  if (!square.configured) {
    return { ok: false as const, error: "Payments unavailable right now", status: 503 as const };
  }
  if (!args.sourceId?.trim()) {
    return { ok: false as const, error: "Card payment required", status: 400 as const };
  }

  if (args.method === "delivery") {
    if (!args.shipping_address1?.trim() || !args.shipping_city?.trim() || !args.zip?.trim()) {
      return { ok: false as const, error: "Delivery address is required", status: 400 as const };
    }
    if (!args.delivery_date?.trim() || !args.delivery_window?.trim()) {
      return { ok: false as const, error: "Choose a delivery date and time window", status: 400 as const };
    }
  }

  const preview = await previewSettlementDelivery(env, {
    bidCents: order.subtotal_cents,
    method: args.method,
    zip: args.method === "pickup" ? "38801" : args.zip,
  });
  if (!preview.ok) {
    return { ok: false as const, error: preview.error, status: 400 as const };
  }

  const paid = await createSquarePayment(env, {
    sourceId: args.sourceId,
    amountCents: preview.total_cents,
    idempotencyKey: args.idempotencyKey || crypto.randomUUID(),
    orderNumber: order.order_number,
    customerEmail: order.customer_email,
    customerName: order.customer_name,
    note: `Auction settlement ${auction.title}`,
  });
  if (!paid.ok) {
    return { ok: false as const, error: paid.error, status: 402 as const };
  }

  const isPickup = args.method === "pickup";
  await env.DB.prepare(
    `UPDATE orders SET
      payment_status = 'paid',
      status = 'confirmed',
      payment_method = 'square',
      square_payment_id = ?,
      delivery_method = ?,
      delivery_cents = ?,
      tax_cents = ?,
      total_cents = ?,
      shipping_address1 = ?,
      shipping_address2 = ?,
      shipping_city = ?,
      shipping_state = ?,
      shipping_zip = ?,
      shipping_notes = ?,
      delivery_date = ?,
      delivery_window = ?,
      customer_phone = COALESCE(?, customer_phone),
      updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      paid.paymentId,
      args.method,
      preview.delivery_cents,
      preview.tax_cents,
      preview.total_cents,
      isPickup ? "Store pickup" : args.shipping_address1!.trim(),
      isPickup ? null : args.shipping_address2?.trim() || null,
      isPickup ? "Tupelo" : args.shipping_city!.trim(),
      isPickup ? "MS" : (args.shipping_state || "MS").trim(),
      isPickup ? "38801" : args.zip.trim(),
      args.shipping_notes?.trim() || `Auction: ${auction.title}`,
      isPickup ? null : args.delivery_date || null,
      isPickup ? null : args.delivery_window || null,
      args.customer_phone?.trim() || null,
      order.id,
    )
    .run();

  await addOrderEvent(env.DB, order.id, "paid", "Auction winner paid online");
  await addOrderEvent(
    env.DB,
    order.id,
    "confirmed",
    isPickup ? "Winner chose free store pickup" : "Winner chose paid delivery",
  );

  return {
    ok: true as const,
    already_paid: false as const,
    order_number: order.order_number,
    order_id: order.id,
    total_cents: preview.total_cents,
    payment_id: paid.paymentId,
  };
}
