/** Human-friendly order status labels (pickup vs delivery). */

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

export function fulfillmentLabel(method?: string | null) {
  return isPickupMethod(method) ? "Store pickup" : "Delivery";
}

export type StatusOption = { value: string; label: string };

/** Admin status dropdown options for an order. */
export function statusOptionsForMethod(method?: string | null): StatusOption[] {
  const pickup = isPickupMethod(method);
  return [
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Order confirmed" },
    {
      value: "processing",
      label: pickup ? "Preparing for pickup" : "Preparing / processing",
    },
    {
      value: "out_for_delivery",
      label: pickup ? "Ready for pickup" : "Out for delivery",
    },
    {
      value: "delivered",
      label: pickup ? "Picked up" : "Delivered",
    },
    { value: "cancelled", label: "Cancelled" },
    { value: "refunded", label: "Refunded" },
  ];
}
