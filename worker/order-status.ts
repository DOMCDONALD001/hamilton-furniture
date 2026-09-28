/**
 * Pickup vs delivery status labels for emails / worker copy.
 * DB still uses the same status keys (out_for_delivery, delivered, …).
 */

export function isPickupMethod(method?: string | null) {
  return (method || "").toLowerCase() === "pickup";
}

export function orderStatusLabel(status: string, method?: string | null) {
  const pickup = isPickupMethod(method);
  const map: Record<string, string> = pickup
    ? {
        pending: "Pending",
        confirmed: "Order confirmed",
        processing: "Preparing for pickup",
        out_for_delivery: "Ready for pickup",
        delivered: "Picked up",
        cancelled: "Cancelled",
        refunded: "Refunded",
      }
    : {
        pending: "Pending",
        confirmed: "Order confirmed",
        processing: "Preparing",
        out_for_delivery: "Out for delivery",
        delivered: "Delivered",
        cancelled: "Cancelled",
        refunded: "Refunded",
      };
  return map[status] || status.replaceAll("_", " ");
}

export function customerStatusCopy(
  kind: string,
  status: string,
  method?: string | null,
): { title: string; intro: string; normalized: string } {
  const pickup = isPickupMethod(method);

  if (pickup) {
    const map: Record<string, { title: string; intro: string; normalized: string }> = {
      paid: {
        title: "Payment received — pickup order confirmed",
        intro: "Thanks for your order! We received your payment. This is a store pickup order.",
        normalized: "paid",
      },
      confirmed: {
        title: "Pickup order confirmed",
        intro: "Your store pickup order is confirmed and will be prepared soon.",
        normalized: "confirmed",
      },
      processing: {
        title: "We’re preparing your pickup",
        intro: "Your items are being prepared for store pickup.",
        normalized: "processing",
      },
      out_for_delivery: {
        title: "Ready for pickup",
        intro: "Your order is ready — you can pick it up at the store.",
        normalized: "out_for_delivery",
      },
      delivered: {
        title: "Picked up — thank you",
        intro: "Your order was marked as picked up. Thanks for shopping with us.",
        normalized: "delivered",
      },
      refunded: {
        title: "Refund issued",
        intro: "A refund was issued for your order.",
        normalized: "refunded",
      },
      cancelled: {
        title: "Order cancelled",
        intro: "Your pickup order has been cancelled. Reply to this email if you have questions.",
        normalized: "cancelled",
      },
    };
    if (map[kind]) return map[kind];
    return {
      title: "Pickup order update",
      intro: `There’s an update on your pickup order. Current status: ${orderStatusLabel(status, method)}.`,
      normalized: "update",
    };
  }

  const map: Record<string, { title: string; intro: string; normalized: string }> = {
    paid: {
      title: "Payment received — order confirmed",
      intro: "Thanks for your order! We received your payment and confirmed it.",
      normalized: "paid",
    },
    confirmed: {
      title: "Order confirmed",
      intro: "Your order is confirmed and will be prepared soon.",
      normalized: "confirmed",
    },
    processing: {
      title: "We’re preparing your order",
      intro: "Your order is being prepared for delivery.",
      normalized: "processing",
    },
    out_for_delivery: {
      title: "Out for delivery",
      intro: "Your furniture is on the way.",
      normalized: "out_for_delivery",
    },
    delivered: {
      title: "Delivered",
      intro: "Your order was marked delivered. Thanks for shopping with us.",
      normalized: "delivered",
    },
    refunded: {
      title: "Refund issued",
      intro: "A refund was issued for your order.",
      normalized: "refunded",
    },
    cancelled: {
      title: "Order cancelled",
      intro: "Your order has been cancelled. Reply to this email if you have questions.",
      normalized: "cancelled",
    },
  };
  if (map[kind]) return map[kind];
  return {
    title: "Order update",
    intro: `There’s an update on your order. Current status: ${orderStatusLabel(status, method)}.`,
    normalized: "update",
  };
}
