import type { Env } from "./types";
import { OWNER_EMAIL } from "./auth";
import { getSetting } from "./helpers";
import { customerStatusCopy, isPickupMethod, orderStatusLabel } from "./order-status";

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export async function sendEmail(env: Env, args: SendArgs) {
  const apiKey = (env.RESEND_API_KEY || "").trim();
  const fromSetting = (await getSetting(env.DB, "email_from", "")).trim();
  const fromEmail =
    fromSetting || (env.EMAIL_FROM || "").trim() || "onboarding@resend.dev";
  const fromName =
    (await getSetting(env.DB, "email_from_name", env.STORE_NAME || "Hamilton's Odds N Ends Furniture")) ||
    "Hamilton's Odds N Ends Furniture";
  const replyTo =
    args.replyTo ||
    (await getSetting(env.DB, "store_email", "")).trim() ||
    (await getNotifyEmail(env));

  if (!apiKey) {
    console.log(
      `[email:skipped] to=${Array.isArray(args.to) ? args.to.join(",") : args.to} subject=${args.subject}`,
    );
    return { ok: false as const, skipped: true as const, error: "RESEND_API_KEY not set" };
  }

  const to = Array.isArray(args.to) ? args.to : [args.to];
  const payload: Record<string, unknown> = {
    from: `${fromName} <${fromEmail}>`,
    to,
    subject: args.subject,
    html: args.html,
    text: args.text || stripHtml(args.html),
  };
  if (replyTo) payload.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email:fail] from=${fromEmail} to=${to.join(",")} ${res.status} ${body}`);
    return {
      ok: false as const,
      skipped: false as const,
      error: body || `Email failed (${res.status})`,
      from: fromEmail,
    };
  }

  return { ok: true as const, from: fromEmail };
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function orderEmailHtml(opts: {
  title: string;
  intro: string;
  orderNumber: string;
  status: string;
  statusLabel?: string;
  fulfillment?: string;
  totalLabel: string;
  trackUrl: string;
  extra?: string;
}) {
  const statusText = opts.statusLabel || opts.status.replaceAll("_", " ");
  return `<!doctype html><html><body style="font-family:Georgia,serif;color:#1a231e;background:#f7f4ef;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 8px;font-size:22px">${escapeHtml(opts.title)}</h1>
    <p style="margin:0 0 16px;color:#555">${escapeHtml(opts.intro)}</p>
    <p style="margin:0 0 8px"><strong>Order:</strong> ${escapeHtml(opts.orderNumber)}</p>
    ${opts.fulfillment ? `<p style="margin:0 0 8px"><strong>Fulfillment:</strong> ${escapeHtml(opts.fulfillment)}</p>` : ""}
    <p style="margin:0 0 8px"><strong>Status:</strong> ${escapeHtml(statusText)}</p>
    <p style="margin:0 0 16px"><strong>Total:</strong> ${escapeHtml(opts.totalLabel)}</p>
    ${opts.extra ? `<p style="margin:0 0 16px;color:#555">${opts.extra}</p>` : ""}
    <p style="margin:0"><a href="${escapeHtml(opts.trackUrl)}" style="display:inline-block;background:#243029;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Track your order</a></p>
    <p style="margin:24px 0 0;font-size:12px;color:#888">Hamilton's Odds N Ends Furniture</p>
  </div>
  </body></html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Store owner inbox for order copies. Falls back to admin owner email. */
export async function getNotifyEmail(env: Env) {
  const configured = (await getSetting(env.DB, "notify_email", "")).trim();
  return configured || OWNER_EMAIL;
}

function ownerAlertHtml(opts: {
  kindLabel: string;
  orderNumber: string;
  customerEmail: string;
  customerName?: string;
  totalLabel: string;
  status: string;
  adminUrl: string;
  extra?: string;
}) {
  return `<!doctype html><html><body style="font-family:Georgia,serif;color:#1a231e;background:#f7f4ef;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:12px;padding:24px">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a6a3a;font-weight:700">Store alert</p>
    <h1 style="margin:0 0 8px;font-size:22px">${escapeHtml(opts.kindLabel)}</h1>
    <p style="margin:0 0 16px;color:#555">You have an order that needs attention.</p>
    <p style="margin:0 0 8px"><strong>Order:</strong> ${escapeHtml(opts.orderNumber)}</p>
    <p style="margin:0 0 8px"><strong>Customer:</strong> ${escapeHtml(opts.customerName || "—")} &lt;${escapeHtml(opts.customerEmail)}&gt;</p>
    <p style="margin:0 0 8px"><strong>Status:</strong> ${escapeHtml(opts.status.replaceAll("_", " "))}</p>
    <p style="margin:0 0 16px"><strong>Total:</strong> ${escapeHtml(opts.totalLabel)}</p>
    ${opts.extra ? `<p style="margin:0 0 16px;color:#555">${escapeHtml(opts.extra)}</p>` : ""}
    <p style="margin:0"><a href="${escapeHtml(opts.adminUrl)}" style="display:inline-block;background:#243029;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open admin orders</a></p>
  </div>
  </body></html>`;
}

/** Always emails the store owner in a separate send (never tied to customer delivery). */
export async function notifyOwnerOrder(
  env: Env,
  args: {
    orderNumber: string;
    customerEmail: string;
    customerName?: string;
    status: string;
    totalCents: number;
    kind: string;
    origin: string;
    extra?: string;
  },
) {
  const notify = await getNotifyEmail(env);
  if (!notify) return { ok: false as const, skipped: true as const, error: "no notify email" };

  const kindLabel =
    args.kind === "paid" || args.kind === "confirmed"
      ? "New paid order"
      : `Order update · ${args.kind.replaceAll("_", " ")}`;
  const totalLabel = `$${(args.totalCents / 100).toFixed(2)}`;
  const adminUrl = `${args.origin.replace(/\/$/, "")}/admin/orders`;

  return sendEmail(env, {
    to: notify,
    subject: `${kindLabel} · ${args.orderNumber} · ${totalLabel}`,
    html: ownerAlertHtml({
      kindLabel,
      orderNumber: args.orderNumber,
      customerEmail: args.customerEmail || "—",
      customerName: args.customerName,
      totalLabel,
      status: args.status,
      adminUrl,
      extra: args.extra,
    }),
  });
}



export async function notifyOrderEvent(
  env: Env,
  args: {
    customerEmail: string;
    customerName?: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    kind: string;
    origin: string;
    extra?: string;
    deliveryMethod?: string | null;
    /** When true, still email owner (default). Set false for manual customer-only resends. */
    notifyOwner?: boolean;
  },
) {
  const method = args.deliveryMethod || null;
  const copy = customerStatusCopy(args.kind, args.status, method);
  const trackUrl = `${args.origin.replace(/\/$/, "")}/orders?number=${encodeURIComponent(args.orderNumber)}&email=${encodeURIComponent(args.customerEmail)}`;
  const totalLabel = `$${(args.totalCents / 100).toFixed(2)}`;
  const statusLabel = orderStatusLabel(args.status, method);
  const fulfillment = isPickupMethod(method) ? "Store pickup" : "Delivery";

  if (args.notifyOwner !== false) {
    await notifyOwnerOrder(env, {
      orderNumber: args.orderNumber,
      customerEmail: args.customerEmail,
      customerName: args.customerName,
      status: `${statusLabel}${isPickupMethod(method) ? " (pickup)" : ""}`,
      totalCents: args.totalCents,
      kind: args.kind,
      origin: args.origin,
      extra: args.extra,
    });
  }

  const email = (args.customerEmail || "").trim().toLowerCase();
  if (
    !email ||
    email.endsWith("@hamiltonoddsnends.local") ||
    email.endsWith("@hamiltonsoddsandends.local")
  ) {
    return { ok: false as const, skipped: true as const, error: "no customer email", ownerOnly: true as const };
  }

  const html = orderEmailHtml({
    title: copy.title,
    intro: copy.intro,
    orderNumber: args.orderNumber,
    status: args.status,
    statusLabel,
    fulfillment,
    totalLabel,
    trackUrl,
    extra: args.extra,
  });

  const result = await sendEmail(env, {
    to: email,
    subject: `${copy.title} · ${args.orderNumber}`,
    html,
  });

  if (!result.ok) {
    console.error(
      `[email:customer-fail] order=${args.orderNumber} to=${email} error=${"error" in result ? result.error : "unknown"}`,
    );
  }

  return result;
}

/** Email customer for checkout / status changes. Always attempts customer send. */
export async function emailOrderIfNeeded(
  env: Env,
  origin: string,
  order: {
    customer_email: string;
    customer_name?: string;
    order_number: string;
    status: string;
    total_cents: number;
    delivery_method?: string | null;
  },
  kind: string,
  extra?: string,
) {
  const k = (kind || order.status || "update").trim();
  if (!k) return;
  return notifyOrderEvent(env, {
    customerEmail: order.customer_email || "",
    customerName: order.customer_name,
    orderNumber: order.order_number,
    status: order.status,
    totalCents: order.total_cents,
    kind: k,
    origin,
    extra,
    deliveryMethod: order.delivery_method,
  });
}
