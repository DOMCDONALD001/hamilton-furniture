import { useEffect, useMemo, useState } from "react";
import { api, money } from "../../lib/api";
import { Modal, useToast } from "../../components/AdminUI";

type RevenueData = {
  from: string;
  to: string;
  summary: {
    order_count: number;
    gross_cents: number;
    discount_cents: number;
    delivery_cents: number;
    tax_cents: number;
    total_cents: number;
    paid_cents: number;
    unpaid_cents: number;
    cancelled_cents: number;
    refunded_cents: number;
    delivery_orders: number;
    pickup_orders: number;
  };
  daily: Array<{
    day: string;
    orders: number;
    total_cents: number;
    paid_cents: number;
    delivery_cents: number;
  }>;
  by_status: Array<{ status: string; n: number; total_cents: number }>;
  top_products: Array<{
    product_name: string;
    product_sku: string;
    qty: number;
    revenue_cents: number;
  }>;
  orders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    status: string;
    payment_status: string;
    delivery_method: string;
    subtotal_cents: number;
    discount_cents: number;
    delivery_cents: number;
    tax_cents: number;
    total_cents: number;
    created_at: string;
  }>;
};

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function AdminRevenue() {
  const toast = useToast();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<RevenueData | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  async function load(f = from, t = to) {
    const d = await api<RevenueData>(
      `/api/admin/revenue?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`,
    );
    setData(d);
  }

  useEffect(() => {
    load().catch(() => toast.push("Could not load revenue", "err"));
  }, []);

  const dayOrders = useMemo(() => {
    if (!data || !dayOpen) return [];
    return data.orders.filter((o) => o.created_at.slice(0, 10) === dayOpen);
  }, [data, dayOpen]);

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["order_number", "date", "customer", "status", "payment", "method", "subtotal", "discount", "delivery", "tax", "total"],
      ...data.orders.map((o) => [
        o.order_number,
        o.created_at,
        o.customer_name,
        o.status,
        o.payment_status,
        o.delivery_method,
        (o.subtotal_cents / 100).toFixed(2),
        (o.discount_cents / 100).toFixed(2),
        (o.delivery_cents / 100).toFixed(2),
        (o.tax_cents / 100).toFixed(2),
        (o.total_cents / 100).toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hamilton-statement-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.push("Statement CSV downloaded");
  }

  function preset(days: number) {
    const f = daysAgo(days);
    const t = new Date().toISOString().slice(0, 10);
    setFrom(f);
    setTo(t);
    load(f, t);
  }

  if (!data) return <p>Loading revenue…</p>;
  const s = data.summary;

  return (
    <div>
      <h1>Revenue & statements</h1>
      <div className="toolbar">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn btn-primary btn-sm" type="button" onClick={() => load()}>
          Run report
        </button>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => preset(7)}>
          7 days
        </button>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => preset(30)}>
          30 days
        </button>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => setStatementOpen(true)}>
          View statement
        </button>
        <button className="btn btn-outline btn-sm" type="button" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Gross sales</div>
          <div className="value">{money(s.gross_cents)}</div>
        </div>
        <div className="stat">
          <div className="label">Collected (paid)</div>
          <div className="value">{money(s.paid_cents)}</div>
        </div>
        <div className="stat">
          <div className="label">Outstanding</div>
          <div className="value">{money(s.unpaid_cents)}</div>
        </div>
        <div className="stat">
          <div className="label">Orders</div>
          <div className="value">{s.order_count}</div>
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat">
          <div className="label">Discounts given</div>
          <div className="value" style={{ fontSize: "1.2rem" }}>{money(s.discount_cents)}</div>
        </div>
        <div className="stat">
          <div className="label">Delivery fees</div>
          <div className="value" style={{ fontSize: "1.2rem" }}>{money(s.delivery_cents)}</div>
        </div>
        <div className="stat">
          <div className="label">Tax</div>
          <div className="value" style={{ fontSize: "1.2rem" }}>{money(s.tax_cents)}</div>
        </div>
        <div className="stat">
          <div className="label">Net order total</div>
          <div className="value" style={{ fontSize: "1.2rem" }}>{money(s.total_cents)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "1rem" }}>
        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Daily breakdown</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Orders</th>
                <th>Sales</th>
                <th>Paid</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td>{d.orders}</td>
                  <td>{money(d.total_cents)}</td>
                  <td>{money(d.paid_cents)}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" type="button" onClick={() => setDayOpen(d.day)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
              {!data.daily.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No orders in this range yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div className="admin-panel">
            <h3 style={{ marginTop: 0 }}>Fulfillment mix</h3>
            <div className="summary-row">
              <span>Delivery orders</span>
              <strong>{s.delivery_orders}</strong>
            </div>
            <div className="summary-row">
              <span>Pickup orders</span>
              <strong>{s.pickup_orders}</strong>
            </div>
            <div className="summary-row">
              <span>Cancelled</span>
              <strong>{money(s.cancelled_cents)}</strong>
            </div>
            <div className="summary-row">
              <span>Refunded</span>
              <strong>{money(s.refunded_cents)}</strong>
            </div>
          </div>

          <div className="admin-panel">
            <h3 style={{ marginTop: 0 }}>By status</h3>
            {data.by_status.map((row) => (
              <div className="summary-row" key={row.status}>
                <span className={`status ${row.status}`}>{row.status.replaceAll("_", " ")}</span>
                <span>
                  {row.n} · {money(row.total_cents)}
                </span>
              </div>
            ))}
          </div>

          <div className="admin-panel">
            <h3 style={{ marginTop: 0 }}>Top products</h3>
            {data.top_products.map((p) => (
              <div className="summary-row" key={p.product_sku}>
                <span>
                  {p.product_name}
                  <div className="muted">{p.qty} sold</div>
                </span>
                <strong>{money(p.revenue_cents)}</strong>
              </div>
            ))}
            {!data.top_products.length && <p className="muted">No product sales yet.</p>}
          </div>
        </div>
      </div>

      <Modal
        open={statementOpen}
        title={`Statement · ${from} → ${to}`}
        onClose={() => setStatementOpen(false)}
        wide
        footer={
          <>
            <button className="btn btn-outline" type="button" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn btn-primary" type="button" onClick={exportCsv}>
              Download CSV
            </button>
          </>
        }
      >
        <div className="statement-sheet">
          <h3 style={{ marginTop: 0 }}>Hamilton Odds N Ends Furniture</h3>
          <p className="muted">Sales statement for {from} through {to}</p>
          <div className="summary-row total">
            <span>Gross merchandise</span>
            <span>{money(s.gross_cents)}</span>
          </div>
          <div className="summary-row">
            <span>Less discounts</span>
            <span>−{money(s.discount_cents)}</span>
          </div>
          <div className="summary-row">
            <span>Delivery income</span>
            <span>{money(s.delivery_cents)}</span>
          </div>
          <div className="summary-row">
            <span>Tax collected</span>
            <span>{money(s.tax_cents)}</span>
          </div>
          <div className="summary-row total">
            <span>Order totals</span>
            <span>{money(s.total_cents)}</span>
          </div>
          <div className="summary-row">
            <span>Paid / collected</span>
            <span>{money(s.paid_cents)}</span>
          </div>
          <div className="summary-row">
            <span>Accounts receivable (unpaid)</span>
            <span>{money(s.unpaid_cents)}</span>
          </div>
          <table className="admin-table" style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Payment</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.slice(0, 40).map((o) => (
                <tr key={o.id}>
                  <td>{o.order_number}</td>
                  <td>{o.customer_name}</td>
                  <td>{o.payment_status}</td>
                  <td>{money(o.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal
        open={!!dayOpen}
        title={dayOpen ? `Orders on ${dayOpen}` : "Day"}
        onClose={() => setDayOpen(null)}
        wide
      >
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
            {dayOrders.map((o) => (
              <tr key={o.id}>
                <td>{o.order_number}</td>
                <td>{o.customer_name}</td>
                <td>
                  <span className={`status ${o.status}`}>{o.status}</span>
                </td>
                <td>{money(o.total_cents)}</td>
              </tr>
            ))}
            {!dayOrders.length && (
              <tr>
                <td colSpan={4}>No orders</td>
              </tr>
            )}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
