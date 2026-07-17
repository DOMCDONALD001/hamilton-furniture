import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, money } from "../../lib/api";
import { Modal, useToast } from "../../components/AdminUI";

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

export function AdminOrders() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryDollars, setDeliveryDollars] = useState("");
  const [shipOpen, setShipOpen] = useState(false);

  async function load() {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    const data = await api<{ orders: Order[] }>(`/api/admin/orders${qs}`);
    setOrders(data.orders);
    const focus = params.get("focus");
    if (focus) {
      const found = data.orders.find((o) => o.id === focus);
      if (found) await openOrder(found, true);
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter]);

  async function openOrder(order: Order, autoShip = false) {
    const data = await api<{ order: Order; items: Item[] }>(`/api/admin/orders/${order.id}`);
    setSelected(data.order);
    setItems(data.items);
    setNotes(data.order.admin_notes || "");
    setDeliveryDollars(String(data.order.delivery_cents / 100));
    if (autoShip || params.get("ship") === "1") setShipOpen(true);
  }

  async function patch(payload: Record<string, unknown>) {
    if (!selected) return;
    const data = await api<{ order: Order }>(`/api/admin/orders/${selected.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setSelected(data.order);
    toast.push("Order updated");
    await load();
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
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: "1rem" }}>
        <div className="admin-panel">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => openOrder(o)}>
                  <td>{o.order_number}</td>
                  <td>{o.customer_name}</td>
                  <td>
                    <span className={`status ${o.status}`}>{o.status}</span>
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
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>{selected.order_number}</h3>
                <button className="btn btn-primary btn-sm" type="button" onClick={() => setShipOpen(true)}>
                  Packing slip / ship details
                </button>
              </div>
              <p>
                {selected.customer_name} · {selected.customer_email}
                {selected.customer_phone ? ` · ${selected.customer_phone}` : ""}
              </p>
              <p>
                <strong>{selected.delivery_method === "pickup" ? "Pickup" : "Ship to"}:</strong>{" "}
                {selected.shipping_address1}
                {selected.shipping_address2 ? `, ${selected.shipping_address2}` : ""},{" "}
                {selected.shipping_city}, {selected.shipping_state} {selected.shipping_zip}
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
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
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
                    Update
                  </button>
                </div>
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
            </>
          )}
        </div>
      </div>

      <Modal
        open={shipOpen && !!selected}
        title={`Ship · ${selected?.order_number || ""}`}
        onClose={() => setShipOpen(false)}
        wide
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={() => window.print()}>
              Print slip
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                patch({ status: "out_for_delivery" });
                setShipOpen(false);
              }}
            >
              Mark out for delivery
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
              <strong>Deliver to:</strong>
              <br />
              {selected.shipping_address1}
              {selected.shipping_address2 ? `, ${selected.shipping_address2}` : ""}
              <br />
              {selected.shipping_city}, {selected.shipping_state} {selected.shipping_zip}
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
