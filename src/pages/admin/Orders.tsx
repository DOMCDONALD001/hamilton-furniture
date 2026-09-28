import { useEffect, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, money } from "../../lib/api";
import {
  downloadPackingSlipPdf,
  downloadPackingSlipsPdf,
  printPackingSlipsPdf,
  viewPackingSlipPdf,
  viewPackingSlipsPdf,
  type PackingSlipPdfInput,
} from "../../lib/pdf";
import { Modal, useToast } from "../../components/AdminUI";
import {
  fulfillmentLabel,
  isPickupMethod,
  orderStatusLabel,
  statusOptionsForMethod,
} from "../../lib/orderStatus";

type Order = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address1: string;
  shipping_address2?: string | null;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  shipping_notes?: string | null;
  delivery_method: string;
  subtotal_cents: number;
  discount_cents: number;
  delivery_cents: number;
  tax_cents: number;
  total_cents: number;
  admin_notes: string | null;
  created_at: string;
  square_payment_id?: string | null;
  square_card_id?: string | null;
  square_customer_id?: string | null;
  card_brand?: string | null;
  card_last4?: string | null;
  payment_method?: string | null;
  refunded_cents?: number | null;
  refund_reason?: string | null;
};

type RefundRow = {
  id: string;
  amount_cents: number;
  reason: string;
  square_refund_id: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
};

type Item = {
  product_name: string;
  product_sku: string;
  product_id: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  image?: string | null;
  product?: {
    id: string;
    name: string;
    sku: string;
    slug: string;
    description?: string;
    condition?: string;
    brand?: string | null;
    dimensions?: string | null;
    weight_lbs?: number | null;
    material?: string | null;
    color?: string | null;
  } | null;
  ship_label?: {
    name: string;
    sku: string;
    qty: number;
    dimensions: string | null;
    weight_lbs: number | null;
    condition: string | null;
    color: string | null;
    material: string | null;
  };
};

const STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
];

/** Filter dropdown — show both delivery + pickup wording for shared status keys */
const STATUS_FILTER_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Preparing",
  out_for_delivery: "Out for delivery / Ready for pickup",
  delivered: "Delivered / Picked up",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export function AdminOrders() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryDollars, setDeliveryDollars] = useState("");
  const [shipOpen, setShipOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [slipBusy, setSlipBusy] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [restoreStock, setRestoreStock] = useState(true);
  const [refundBusy, setRefundBusy] = useState(false);
  const [storeInfo, setStoreInfo] = useState({
    store_phone: "",
    store_email: "",
    store_address: "",
  });

  async function load() {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    const data = await api<{ orders: Order[] }>(`/api/admin/orders${qs}`);
    setOrders(data.orders);
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (data.orders.some((o) => o.id === id)) next.add(id);
      }
      return next;
    });
    const focus = params.get("focus");
    if (focus) {
      const found = data.orders.find((o) => o.id === focus);
      if (found) await openOrder(found, true);
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter]);

  useEffect(() => {
    api<{ settings: Record<string, string> }>("/api/admin/settings")
      .then((d) =>
        setStoreInfo({
          store_phone: d.settings.store_phone || "",
          store_email: d.settings.store_email || "",
          store_address: d.settings.store_address || "",
        }),
      )
      .catch(() => {});
  }, []);

  function slipInput(order: Order, orderItems: Item[]): PackingSlipPdfInput {
    return {
      order,
      items: orderItems,
      storePhone: storeInfo.store_phone,
      storeEmail: storeInfo.store_email,
      storeAddress: storeInfo.store_address,
    };
  }

  function downloadSlipPdf() {
    if (!selected) return;
    downloadPackingSlipPdf(slipInput(selected, items));
    toast.push("Packing slip PDF downloaded");
  }

  function viewSlipPdf() {
    if (!selected) return;
    viewPackingSlipPdf(slipInput(selected, items));
    toast.push("Opened packing slip PDF");
  }

  function printSlipPdf() {
    if (!selected) return;
    printPackingSlipsPdf([slipInput(selected, items)]);
    toast.push("Print dialog opened");
  }

  async function fetchSlipInputs(orderList: Order[]) {
    const results: PackingSlipPdfInput[] = [];
    for (const order of orderList) {
      if (selected?.id === order.id) {
        results.push(slipInput(selected, items));
        continue;
      }
      const data = await api<{ order: Order; items: Item[] }>(`/api/admin/orders/${order.id}`);
      results.push(slipInput(data.order, data.items));
    }
    return results;
  }

  async function runMassSlips(mode: "print" | "view" | "download") {
    const picked = orders.filter((o) => selectedIds.has(o.id));
    if (!picked.length) {
      toast.push("Select orders first (checkboxes on the left)", "info");
      return;
    }
    setSlipBusy(true);
    try {
      const inputs = await fetchSlipInputs(picked);
      if (mode === "print") {
        printPackingSlipsPdf(inputs);
        toast.push(`Print ready for ${inputs.length} packing slip${inputs.length === 1 ? "" : "s"}`);
      } else if (mode === "view") {
        viewPackingSlipsPdf(inputs);
        toast.push(`Opened ${inputs.length} packing slip${inputs.length === 1 ? "" : "s"}`);
      } else {
        downloadPackingSlipsPdf(inputs);
        toast.push(`Downloaded ${inputs.length} packing slip${inputs.length === 1 ? "" : "s"}`);
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Packing slips failed", "err");
    } finally {
      setSlipBusy(false);
    }
  }

  function toggleSelected(id: string, e?: MouseEvent) {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (orders.length && selectedIds.size === orders.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(orders.map((o) => o.id)));
  }

  async function openOrder(order: Order, autoShip = false) {
    const data = await api<{ order: Order; items: Item[]; refunds?: RefundRow[] }>(
      `/api/admin/orders/${order.id}`,
    );
    setSelected(data.order);
    setItems(data.items);
    setRefunds(data.refunds || []);
    setNotes(data.order.admin_notes || "");
    setDeliveryDollars(String(data.order.delivery_cents / 100));
    if (autoShip || params.get("ship") === "1") setShipOpen(true);
  }

  function openRefundModal() {
    if (!selected) return;
    const remaining = Math.max(0, selected.total_cents - (selected.refunded_cents || 0));
    setRefundAmount((remaining / 100).toFixed(2));
    setRefundReason("");
    setRestoreStock(true);
    setRefundOpen(true);
  }

  async function submitRefund() {
    if (!selected) return;
    const reason = refundReason.trim();
    if (reason.length < 3) {
      toast.push("Enter a refund reason", "err");
      return;
    }
    const dollars = Number(refundAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.push("Enter a valid refund amount", "err");
      return;
    }
    setRefundBusy(true);
    try {
      const data = await api<{ order: Order; refund: RefundRow }>(
        `/api/admin/orders/${selected.id}/refund`,
        {
          method: "POST",
          body: JSON.stringify({
            reason,
            amount_cents: Math.round(dollars * 100),
            restore_stock: restoreStock,
          }),
        },
      );
      setSelected(data.order);
      setRefunds((prev) => [data.refund, ...prev]);
      setNotes(data.order.admin_notes || "");
      setRefundOpen(false);
      toast.push(
        data.order.payment_status === "refunded"
          ? "Full refund issued"
          : `Partial refund of ${money(data.refund.amount_cents)} issued`,
      );
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Refund failed", "err");
    } finally {
      setRefundBusy(false);
    }
  }

  async function patch(payload: Record<string, unknown>) {
    if (!selected) return;
    try {
      const data = await api<{
        order: Order;
        payment_action?: {
          type: "charge" | "refund";
          amount_cents: number;
          payment_id?: string;
          refund_id?: string;
        } | null;
      }>(`/api/admin/orders/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSelected(data.order);
      if (data.payment_action?.type === "charge") {
        toast.push(
          `Charged ${money(data.payment_action.amount_cents)} to card on file`,
        );
      } else if (data.payment_action?.type === "refund") {
        toast.push(
          `Refunded ${money(data.payment_action.amount_cents)} to original card`,
        );
      } else if (payload.status || payload.payment_status) {
        toast.push("Order updated — customer emailed");
      } else {
        toast.push("Order updated");
      }
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Update failed", "err");
    }
  }

  async function emailCustomer() {
    if (!selected) return;
    try {
      await api(`/api/admin/orders/${selected.id}/email`, {
        method: "POST",
        body: JSON.stringify({ kind: "paid" }),
      });
      toast.push(`Confirmation emailed to ${selected.customer_email}`);
    } catch (err) {
      toast.push(
        err instanceof Error
          ? err.message
          : "Customer email failed — verify your domain in Resend",
        "err",
      );
    }
  }

  return (
    <div>
      <h1>Orders & deliveries</h1>
      <div className="toolbar">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: "0.55rem",
            borderRadius: 10,
            background: "#121714",
            color: "#fff",
            border: "1px solid #2f3933",
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_FILTER_LABELS[s] || s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={slipBusy || !selectedIds.size}
          onClick={() => runMassSlips("print")}
        >
          Print selected slips ({selectedIds.size || 0})
        </button>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={slipBusy || !selectedIds.size}
          onClick={() => runMassSlips("view")}
        >
          View selected PDFs
        </button>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          disabled={slipBusy || !selectedIds.size}
          onClick={() => runMassSlips("download")}
        >
          Download selected PDFs
        </button>
      </div>

      <div className="split-layout orders">
        <div className="admin-panel">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && selectedIds.size === orders.length}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          selectedIds.size > 0 && selectedIds.size < orders.length;
                      }
                    }}
                    onChange={toggleSelectAll}
                    aria-label="Select all orders for packing slips"
                    title="Select all for mass packing slips"
                  />
                </th>
                <th>Order</th>
                <th>Customer</th>
                <th>Method</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  style={{ cursor: "pointer" }}
                  className={selectedIds.has(o.id) ? "row-selected" : undefined}
                  onClick={() => openOrder(o)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(o.id)}
                      onChange={() => toggleSelected(o.id)}
                      aria-label={`Select order ${o.order_number}`}
                    />
                  </td>
                  <td>{o.order_number}</td>
                  <td>{o.customer_name}</td>
                  <td>
                    <span
                      className={`status method-${isPickupMethod(o.delivery_method) ? "pickup" : "delivery"}`}
                    >
                      {fulfillmentLabel(o.delivery_method)}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${o.status}`}>
                      {orderStatusLabel(o.status, o.delivery_method)}
                    </span>
                  </td>
                  <td>{money(o.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-panel">
          {!selected ? (
            <p className="muted">Select an order to see what to ship and manage fulfillment.</p>
          ) : (
            <>
              <div className="toolbar" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0 }}>{selected.order_number}</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-outline btn-sm" type="button" onClick={viewSlipPdf}>
                    View PDF
                  </button>
                  <button className="btn btn-outline btn-sm" type="button" onClick={downloadSlipPdf}>
                    Download PDF
                  </button>
                  <button className="btn btn-outline btn-sm" type="button" onClick={printSlipPdf}>
                    Print PDF
                  </button>
                  {(selected.payment_status === "paid" ||
                    selected.payment_status === "partial" ||
                    !!selected.square_payment_id) &&
                    selected.payment_status !== "refunded" &&
                    selected.status !== "refunded" && (
                      <button
                        className="btn btn-outline btn-sm"
                        type="button"
                        onClick={openRefundModal}
                        style={{ borderColor: "#6a3a36", color: "#f0c4b8" }}
                      >
                        Issue refund
                      </button>
                    )}
                  <button className="btn btn-outline btn-sm" type="button" onClick={emailCustomer}>
                    Email customer
                  </button>
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => setShipOpen(true)}>
                    Packing slip / ship details
                  </button>
                </div>
              </div>
              <p>
                {selected.customer_name} · {selected.customer_email}
                {selected.customer_phone ? ` · ${selected.customer_phone}` : ""}
              </p>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Payment: <strong>{selected.payment_status}</strong>
                {selected.payment_method ? ` · ${selected.payment_method}` : ""}
                {(selected.refunded_cents || 0) > 0
                  ? ` · Refunded ${money(selected.refunded_cents || 0)}`
                  : ""}
              </p>
              <p>
                <span
                  className={`status method-${isPickupMethod(selected.delivery_method) ? "pickup" : "delivery"}`}
                >
                  {fulfillmentLabel(selected.delivery_method)}
                </span>{" "}
                <span className={`status ${selected.status}`}>
                  {orderStatusLabel(selected.status, selected.delivery_method)}
                </span>
              </p>
              <p>
                <strong>{isPickupMethod(selected.delivery_method) ? "Pickup" : "Ship to"}:</strong>{" "}
                {selected.shipping_address1}
                {selected.shipping_address2 ? `, ${selected.shipping_address2}` : ""}
                {selected.shipping_city
                  ? `, ${selected.shipping_city}, ${selected.shipping_state} ${selected.shipping_zip}`
                  : ""}
              </p>
              {selected.shipping_notes && (
                <p className="muted">Notes: {selected.shipping_notes}</p>
              )}

              <h4>Items to fulfill</h4>
              <div className="ship-items">
                {items.map((i) => (
                  <div className="ship-item" key={i.product_sku + i.product_name}>
                    <img
                      className="thumb-sm"
                      src={i.image || "/api/images/placeholder"}
                      alt=""
                      style={{ width: 64, height: 64 }}
                    />
                    <div style={{ flex: 1 }}>
                      <strong>
                        {i.quantity}× {i.product_name}
                      </strong>
                      <div className="muted">SKU {i.product_sku}</div>
                      {i.ship_label?.dimensions && (
                        <div className="muted">Size: {i.ship_label.dimensions}</div>
                      )}
                      {i.ship_label?.condition && (
                        <div className="muted">Condition: {i.ship_label.condition}</div>
                      )}
                      {(i.ship_label?.color || i.ship_label?.material) && (
                        <div className="muted">
                          {[i.ship_label.color, i.ship_label.material].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    <strong>{money(i.line_total_cents)}</strong>
                  </div>
                ))}
              </div>

              <div className="summary-row total">
                <span>Total</span>
                <span>{money(selected.total_cents)}</span>
              </div>

              <div className="field" style={{ marginTop: "1rem" }}>
                <label>Order status</label>
                <select
                  value={selected.status}
                  onChange={(e) => patch({ status: e.target.value })}
                >
                  {statusOptionsForMethod(selected.delivery_method).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {isPickupMethod(selected.delivery_method) && (
                  <p className="muted" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
                    For pickup: use <strong>Ready for pickup</strong> when they can come get it, then{" "}
                    <strong>Picked up</strong> when they take it.
                  </p>
                )}
              </div>
              <div className="field">
                <label>Payment status</label>
                <select
                  value={selected.payment_status}
                  onChange={(e) => patch({ payment_status: e.target.value })}
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>
              <div className="field">
                <label>Adjust delivery charge ($)</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    step="0.01"
                    value={deliveryDollars}
                    onChange={(e) => setDeliveryDollars(e.target.value)}
                  />
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() =>
                      patch({ delivery_cents: Math.round(Number(deliveryDollars) * 100) })
                    }
                  >
                    Update & charge/refund
                  </button>
                </div>
                <p className="muted" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
                  {selected.square_card_id
                    ? `Card on file: ${selected.card_brand || "Card"} ····${selected.card_last4 || "????"} — increases charge the card; decreases refund Square.`
                    : selected.square_payment_id
                      ? "Original Square payment on file (refunds OK). No saved card for extra charges — collect separately or use skip override."
                      : "No Square payment on this order — total updates only."}
                </p>
                {!selected.square_card_id && (
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    style={{ marginTop: 8 }}
                    onClick={() =>
                      patch({
                        delivery_cents: Math.round(Number(deliveryDollars) * 100),
                        skip_payment: true,
                      })
                    }
                  >
                    Update totals only (no charge)
                  </button>
                )}
              </div>
              <div className="field">
                <label>Admin notes</label>
                <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  style={{ marginTop: 8 }}
                  onClick={() => patch({ admin_notes: notes })}
                >
                  Save notes
                </button>
              </div>

              {refunds.length > 0 && (
                <div style={{ marginTop: "1.25rem" }}>
                  <h4 style={{ marginTop: 0 }}>Refund history</h4>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Amount</th>
                        <th>Reason</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refunds.map((r) => (
                        <tr key={r.id}>
                          <td>{r.created_at.slice(0, 16).replace("T", " ")}</td>
                          <td>{money(r.amount_cents)}</td>
                          <td>
                            {r.reason}
                            {r.square_refund_id && (
                              <div className="muted" style={{ fontSize: "0.75rem" }}>
                                Square {r.square_refund_id}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`status ${r.status}`}>{r.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        open={refundOpen && !!selected}
        title={selected ? `Refund · ${selected.order_number}` : "Refund"}
        onClose={() => !refundBusy && setRefundOpen(false)}
        footer={
          <>
            <button
              className="btn btn-outline"
              type="button"
              disabled={refundBusy}
              onClick={() => setRefundOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={refundBusy}
              onClick={submitRefund}
              style={{ background: "#6a3a36", borderColor: "#6a3a36" }}
            >
              {refundBusy ? "Refunding…" : "Confirm refund"}
            </button>
          </>
        }
      >
        {selected && (
          <div>
            <p className="muted" style={{ marginTop: 0 }}>
              Order total {money(selected.total_cents)}
              {(selected.refunded_cents || 0) > 0
                ? ` · already refunded ${money(selected.refunded_cents || 0)}`
                : ""}
              .{" "}
              {selected.square_payment_id
                ? "This will refund through Square."
                : "No Square charge on file — status will be updated with your reason only."}
            </p>
            <div className="field">
              <label>Refund amount ($)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Reason (required)</label>
              <textarea
                required
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Customer returned item, damaged in transit, duplicate charge…"
              />
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={restoreStock}
                onChange={(e) => setRestoreStock(e.target.checked)}
              />
              Restore inventory if this is a full refund
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={shipOpen && !!selected}
        title={`${isPickupMethod(selected?.delivery_method) ? "Pickup" : "Ship"} · ${selected?.order_number || ""}`}
        onClose={() => setShipOpen(false)}
        wide
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={viewSlipPdf}>
              View PDF
            </button>
            <button className="btn btn-outline" type="button" onClick={printSlipPdf}>
              Print PDF
            </button>
            <button className="btn btn-outline" type="button" onClick={downloadSlipPdf}>
              Download PDF
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                patch({ status: "out_for_delivery" });
                setShipOpen(false);
              }}
            >
              {isPickupMethod(selected?.delivery_method)
                ? "Mark ready for pickup"
                : "Mark out for delivery"}
            </button>
          </>
        }
      >
        {selected && (
          <div className="packing-slip">
            <p>
              <strong>Customer:</strong> {selected.customer_name}
              <br />
              {selected.customer_email}
              {selected.customer_phone ? ` · ${selected.customer_phone}` : ""}
            </p>
            <p>
              <strong>
                {isPickupMethod(selected.delivery_method) ? "Store pickup" : "Deliver to"}:
              </strong>
              <br />
              {isPickupMethod(selected.delivery_method) ? (
                <>Customer will pick up at the store</>
              ) : (
                <>
                  {selected.shipping_address1}
                  {selected.shipping_address2 ? `, ${selected.shipping_address2}` : ""}
                  <br />
                  {selected.shipping_city}, {selected.shipping_state} {selected.shipping_zip}
                </>
              )}
            </p>
            {selected.shipping_notes && (
              <p>
                <strong>Delivery notes:</strong> {selected.shipping_notes}
              </p>
            )}
            <h4>Pack these items</h4>
            {items.map((i) => (
              <div className="ship-item" key={i.product_sku + "slip"}>
                <img
                  src={i.image || "/api/images/placeholder"}
                  alt=""
                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }}
                />
                <div>
                  <strong>
                    Qty {i.quantity} — {i.product_name}
                  </strong>
                  <div>SKU: {i.product_sku}</div>
                  {i.product?.description && (
                    <div className="muted" style={{ fontSize: "0.85rem", maxWidth: 420 }}>
                      {i.product.description.slice(0, 160)}
                      {i.product.description.length > 160 ? "…" : ""}
                    </div>
                  )}
                  <div className="muted">
                    {[
                      i.ship_label?.dimensions && `Dims ${i.ship_label.dimensions}`,
                      i.ship_label?.weight_lbs != null && `${i.ship_label.weight_lbs} lbs`,
                      i.ship_label?.condition,
                      i.ship_label?.color,
                      i.ship_label?.material,
                      i.product?.brand,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
