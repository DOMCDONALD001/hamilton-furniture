import type { Env } from "./types";
import { getSetting } from "./helpers";

export type SquareConfig = {
  configured: boolean;
  applicationId: string;
  locationId: string;
  accessToken: string;
  environment: "sandbox" | "production";
  /** True when Admin → Settings has Live payments enabled */
  liveFromSettings: boolean;
};

/**
 * Resolve Square credentials.
 * Live on → production keys from Settings.
 * Live off → sandbox keys from Settings (prefilled from Worker env), falling back to env.
 */
export async function getSquareConfig(env: Env): Promise<SquareConfig> {
  const live = (await getSetting(env.DB, "square_live", "0")) === "1";

  if (live) {
    const applicationId = (await getSetting(env.DB, "square_application_id", "")).trim();
    const locationId = (await getSetting(env.DB, "square_location_id", "")).trim();
    const accessToken = (await getSetting(env.DB, "square_access_token", "")).trim();
    return {
      configured: !!(applicationId && locationId && accessToken),
      applicationId,
      locationId,
      accessToken,
      environment: "production",
      liveFromSettings: true,
    };
  }

  const applicationId =
    (await getSetting(env.DB, "square_sandbox_application_id", "")).trim() ||
    (env.SQUARE_APPLICATION_ID || "").trim();
  const locationId =
    (await getSetting(env.DB, "square_sandbox_location_id", "")).trim() ||
    (env.SQUARE_LOCATION_ID || "").trim();
  const accessToken =
    (await getSetting(env.DB, "square_sandbox_access_token", "")).trim() ||
    (env.SQUARE_ACCESS_TOKEN || "").trim();
  const environment =
    (env.SQUARE_ENVIRONMENT || "").toLowerCase() === "production"
      ? "production"
      : "sandbox";

  return {
    configured: !!(applicationId && locationId && accessToken),
    applicationId,
    locationId,
    accessToken,
    environment,
    liveFromSettings: false,
  };
}

export function squareApiBase(environment: "sandbox" | "production") {
  return environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

type CreatePaymentResult =
  | {
      ok: true;
      paymentId: string;
      status: string;
      receiptUrl?: string | null;
    }
  | { ok: false; error: string };

export async function createSquarePayment(
  env: Env,
  args: {
    sourceId: string;
    amountCents: number;
    idempotencyKey: string;
    orderNumber: string;
    customerEmail: string;
    customerName: string;
    note?: string;
  },
): Promise<CreatePaymentResult> {
  const config = await getSquareConfig(env);
  if (!config.configured) {
    return { ok: false, error: "Square payments are not configured" };
  }
  if (args.amountCents < 1) {
    return { ok: false, error: "Order total must be at least $0.01" };
  }

  const body = {
    source_id: args.sourceId,
    idempotency_key: args.idempotencyKey,
    amount_money: {
      amount: args.amountCents,
      currency: "USD",
    },
    location_id: config.locationId,
    autocomplete: true,
    reference_id: args.orderNumber.slice(0, 40),
    note: (args.note || `Order ${args.orderNumber}`).slice(0, 500),
    buyer_email_address: args.customerEmail,
  };

  const res = await fetch(`${squareApiBase(config.environment)}/v2/payments`, {
    method: "POST",
    headers: squareHeaders(config.accessToken),
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    payment?: {
      id?: string;
      status?: string;
      receipt_url?: string | null;
    };
    errors?: Array<{ detail?: string; code?: string; category?: string }>;
  };

  if (!res.ok || !data.payment?.id) {
    const detail =
      data.errors?.map((e) => e.detail || e.code).filter(Boolean).join("; ") ||
      `Square payment failed (${res.status})`;
    return { ok: false, error: detail };
  }

  return {
    ok: true,
    paymentId: data.payment.id,
    status: data.payment.status || "COMPLETED",
    receiptUrl: data.payment.receipt_url || null,
  };
}

type CreateRefundResult =
  | {
      ok: true;
      refundId: string;
      status: string;
    }
  | { ok: false; error: string };

export async function createSquareRefund(
  env: Env,
  args: {
    paymentId: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
  },
): Promise<CreateRefundResult> {
  const config = await getSquareConfig(env);
  if (!config.configured) {
    return { ok: false, error: "Square payments are not configured" };
  }
  if (args.amountCents < 1) {
    return { ok: false, error: "Refund amount must be at least $0.01" };
  }
  const reason = args.reason.trim();
  if (!reason) {
    return { ok: false, error: "Refund reason is required" };
  }

  const body = {
    idempotency_key: args.idempotencyKey,
    payment_id: args.paymentId,
    amount_money: {
      amount: args.amountCents,
      currency: "USD",
    },
    reason: reason.slice(0, 192),
  };

  const res = await fetch(`${squareApiBase(config.environment)}/v2/refunds`, {
    method: "POST",
    headers: squareHeaders(config.accessToken),
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    refund?: {
      id?: string;
      status?: string;
    };
    errors?: Array<{ detail?: string; code?: string; category?: string }>;
  };

  if (!res.ok || !data.refund?.id) {
    const detail =
      data.errors?.map((e) => e.detail || e.code).filter(Boolean).join("; ") ||
      `Square refund failed (${res.status})`;
    return { ok: false, error: detail };
  }

  return {
    ok: true,
    refundId: data.refund.id,
    status: data.refund.status || "COMPLETED",
  };
}

type SquareCustomerResult =
  | { ok: true; customerId: string }
  | { ok: false; error: string };

type SquareCardResult =
  | {
      ok: true;
      cardId: string;
      brand?: string | null;
      last4?: string | null;
    }
  | { ok: false; error: string };

function squareHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "Square-Version": "2025-01-23",
  };
}

/** Find Square customer by email, or create one. */
export async function findOrCreateSquareCustomer(
  env: Env,
  args: { email: string; name: string; phone?: string | null; referenceId?: string },
): Promise<SquareCustomerResult> {
  const config = await getSquareConfig(env);
  if (!config.configured) {
    return { ok: false, error: "Square payments are not configured" };
  }

  const email = args.email.trim().toLowerCase();
  const search = await fetch(
    `${squareApiBase(config.environment)}/v2/customers/search`,
    {
      method: "POST",
      headers: squareHeaders(config.accessToken),
      body: JSON.stringify({
        query: {
          filter: {
            email_address: { exact: email },
          },
        },
        limit: 1,
      }),
    },
  );
  const searchData = (await search.json()) as {
    customers?: Array<{ id?: string }>;
    errors?: Array<{ detail?: string; code?: string }>;
  };
  const existing = searchData.customers?.[0]?.id;
  if (existing) return { ok: true, customerId: existing };

  const parts = args.name.trim().split(/\s+/);
  const given = parts[0] || "Customer";
  const family = parts.slice(1).join(" ") || undefined;

  const create = await fetch(`${squareApiBase(config.environment)}/v2/customers`, {
    method: "POST",
    headers: squareHeaders(config.accessToken),
    body: JSON.stringify({
      given_name: given.slice(0, 300),
      family_name: family?.slice(0, 300),
      email_address: email,
      phone_number: args.phone?.trim() || undefined,
      reference_id: args.referenceId?.slice(0, 100),
      idempotency_key: crypto.randomUUID(),
    }),
  });
  const createData = (await create.json()) as {
    customer?: { id?: string };
    errors?: Array<{ detail?: string; code?: string }>;
  };
  if (!create.ok || !createData.customer?.id) {
    const detail =
      createData.errors?.map((e) => e.detail || e.code).filter(Boolean).join("; ") ||
      `Square customer create failed (${create.status})`;
    return { ok: false, error: detail };
  }
  return { ok: true, customerId: createData.customer.id };
}

/** Store the card used on a completed payment for later charges. */
export async function saveSquareCardFromPayment(
  env: Env,
  args: {
    paymentId: string;
    customerId: string;
    idempotencyKey: string;
  },
): Promise<SquareCardResult> {
  const config = await getSquareConfig(env);
  if (!config.configured) {
    return { ok: false, error: "Square payments are not configured" };
  }

  const res = await fetch(`${squareApiBase(config.environment)}/v2/cards`, {
    method: "POST",
    headers: squareHeaders(config.accessToken),
    body: JSON.stringify({
      idempotency_key: args.idempotencyKey,
      source_id: args.paymentId,
      card: {
        customer_id: args.customerId,
      },
    }),
  });

  const data = (await res.json()) as {
    card?: {
      id?: string;
      card_brand?: string | null;
      last_4?: string | null;
    };
    errors?: Array<{ detail?: string; code?: string }>;
  };

  if (!res.ok || !data.card?.id) {
    const detail =
      data.errors?.map((e) => e.detail || e.code).filter(Boolean).join("; ") ||
      `Square card save failed (${res.status})`;
    return { ok: false, error: detail };
  }

  return {
    ok: true,
    cardId: data.card.id,
    brand: data.card.card_brand || null,
    last4: data.card.last_4 || null,
  };
}

/** Charge a saved card on file (delivery adjustments, etc.). */
export async function chargeSquareCardOnFile(
  env: Env,
  args: {
    cardId: string;
    customerId: string;
    amountCents: number;
    idempotencyKey: string;
    orderNumber: string;
    customerEmail: string;
    note?: string;
  },
): Promise<CreatePaymentResult> {
  const config = await getSquareConfig(env);
  if (!config.configured) {
    return { ok: false, error: "Square payments are not configured" };
  }
  if (args.amountCents < 1) {
    return { ok: false, error: "Charge amount must be at least $0.01" };
  }

  const body = {
    source_id: args.cardId,
    customer_id: args.customerId,
    idempotency_key: args.idempotencyKey,
    amount_money: {
      amount: args.amountCents,
      currency: "USD",
    },
    location_id: config.locationId,
    autocomplete: true,
    reference_id: args.orderNumber.slice(0, 40),
    note: (args.note || `Adjustment ${args.orderNumber}`).slice(0, 500),
    buyer_email_address: args.customerEmail,
  };

  const res = await fetch(`${squareApiBase(config.environment)}/v2/payments`, {
    method: "POST",
    headers: squareHeaders(config.accessToken),
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    payment?: {
      id?: string;
      status?: string;
      receipt_url?: string | null;
    };
    errors?: Array<{ detail?: string; code?: string; category?: string }>;
  };

  if (!res.ok || !data.payment?.id) {
    const detail =
      data.errors?.map((e) => e.detail || e.code).filter(Boolean).join("; ") ||
      `Square charge failed (${res.status})`;
    return { ok: false, error: detail };
  }

  return {
    ok: true,
    paymentId: data.payment.id,
    status: data.payment.status || "COMPLETED",
    receiptUrl: data.payment.receipt_url || null,
  };
}
