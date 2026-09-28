import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, money } from "../../lib/api";
import { downloadInventoryReportPdf } from "../../lib/pdf";
import { useToast } from "../../components/AdminUI";

type Summary = {
  sku_count: number;
  active_count: number;
  draft_count: number;
  archived_count: number;
  out_of_stock_count: number;
  low_stock_count: number;
  units_on_hand: number;
  retail_value_cents: number;
  cost_value_cents: number;
  units_sold_all_time: number;
  revenue_all_time_cents: number;
  missing_photos: number;
};

type Row = {
  id: string;
  sku: string;
  name: string;
  status: string;
  condition: string;
  brand: string | null;
  category_name: string | null;
  price_cents: number;
  cost_cents: number | null;
  stock: number;
  low_stock_threshold: number;
  units_sold: number;
  revenue_cents: number;
  image_count: number;
  retail_value_cents: number;
  cost_value_cents: number;
  margin_unit_cents: number | null;
  stock_flag: "out" | "low" | "ok";
  updated_at: string;
};

export function AdminInventoryReport() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [stock, setStock] = useState("");
  const [q, setQ] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [storeInfo, setStoreInfo] = useState({
    store_phone: "",
    store_email: "",
    store_address: "",
  });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (stock) params.set("stock", stock);
      if (q.trim()) params.set("q", q.trim());
      const qs = params.toString() ? `?${params}` : "";
      const data = await api<{ summary: Summary; items: Row[]; generated_at: string }>(
        `/api/admin/inventory-report${qs}`,
      );
      setSummary(data.summary);
      setItems(data.items);
      setGeneratedAt(data.generated_at);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not load inventory report", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
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

  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    if (status) parts.push(`status=${status}`);
    if (stock) parts.push(`stock=${stock}`);
    if (q.trim()) parts.push(`q=${q.trim()}`);
    return parts.join(", ") || "All SKUs";
  }, [status, stock, q]);

  function downloadPdf() {
    if (!summary) return;
    downloadInventoryReportPdf({
      generatedAt: generatedAt || new Date().toISOString(),
      storePhone: storeInfo.store_phone,
      storeEmail: storeInfo.store_email,
      storeAddress: storeInfo.store_address,
      filters: filterLabel,
      summary,
      items: items.map((i) => ({
        sku: i.sku,
        name: i.name,
        category_name: i.category_name,
        status: i.status,
        stock: i.stock,
        stock_flag: i.stock_flag,
        price_cents: i.price_cents,
        cost_cents: i.cost_cents,
        retail_value_cents: i.retail_value_cents,
        units_sold: Number(i.units_sold),
        revenue_cents: Number(i.revenue_cents),
      })),
    });
    toast.push("Inventory PDF downloaded");
  }

  function downloadCsv() {
    const header = [
      "SKU",
      "Name",
      "Category",
      "Status",
      "Condition",
      "Brand",
      "Stock",
      "Stock flag",
      "Price",
      "Cost",
      "Retail value",
      "Cost value",
      "Units sold",
      "Revenue",
      "Photos",
      "Updated",
    ];
    const rows = items.map((i) =>
      [
        i.sku,
        i.name,
        i.category_name || "",
        i.status,
        i.condition,
        i.brand || "",
        i.stock,
        i.stock_flag,
        (i.price_cents / 100).toFixed(2),
        i.cost_cents != null ? (i.cost_cents / 100).toFixed(2) : "",
        (i.retail_value_cents / 100).toFixed(2),
        (i.cost_value_cents / 100).toFixed(2),
        i.units_sold,
        (Number(i.revenue_cents) / 100).toFixed(2),
        i.image_count,
        i.updated_at,
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hamilton-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.push("CSV downloaded");
  }

  return (
    <div>
      <div className="section-head" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Inventory report</h1>
          <p className="muted" style={{ margin: 0 }}>
            SKU tracker — stock, retail/cost value, units sold, and alerts.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn btn-outline btn-sm" to="/admin/products">
            Edit inventory
          </Link>
          <button className="btn btn-outline btn-sm" type="button" disabled={!items.length} onClick={downloadCsv}>
            Download CSV
          </button>
          <button className="btn btn-primary btn-sm" type="button" disabled={!summary} onClick={downloadPdf}>
            Download PDF
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input
          placeholder="Search SKU, name, brand, tag"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="archived">Archived</option>
        </select>
        <select value={stock} onChange={(e) => setStock(e.target.value)}>
          <option value="">All stock levels</option>
          <option value="in">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => load()}>
          Run report
        </button>
      </div>

      {summary && (
        <div className="stats inventory-report-stats" style={{ marginBottom: "1rem" }}>
          <div className="stat">
            <div className="label">SKUs</div>
            <div className="value">{summary.sku_count}</div>
          </div>
          <div className="stat">
            <div className="label">Units on hand</div>
            <div className="value">{summary.units_on_hand}</div>
          </div>
          <div className="stat">
            <div className="label">Retail value</div>
            <div className="value">{money(summary.retail_value_cents)}</div>
          </div>
          <div className="stat">
            <div className="label">Cost value</div>
            <div className="value">{money(summary.cost_value_cents)}</div>
          </div>
          <div className={`stat${summary.low_stock_count > 0 ? " stat-warn" : ""}`}>
            <div className="label">Low stock</div>
            <div className="value">{summary.low_stock_count}</div>
          </div>
          <div className={`stat${summary.out_of_stock_count > 0 ? " stat-danger" : ""}`}>
            <div className="label">Out of stock</div>
            <div className="value">{summary.out_of_stock_count}</div>
          </div>
          <div className="stat">
            <div className="label">Sold (all time)</div>
            <div className="value">{summary.units_sold_all_time}</div>
          </div>
          <div className="stat">
            <div className="label">No photos</div>
            <div className="value">{summary.missing_photos}</div>
          </div>
        </div>
      )}

      <div className="admin-panel" style={{ overflow: "auto" }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !items.length ? (
          <p className="muted">No SKUs match these filters.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Price</th>
                <th>Cost</th>
                <th>On-hand value</th>
                <th>Sold</th>
                <th>Revenue</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  className={
                    i.stock_flag === "low"
                      ? "row-stock-low"
                      : i.stock_flag === "out"
                        ? "row-stock-out"
                        : undefined
                  }
                >
                  <td>
                    <code style={{ fontSize: "0.8rem" }}>{i.sku}</code>
                  </td>
                  <td>
                    <strong>{i.name}</strong>
                    {Number(i.image_count) === 0 && (
                      <div className="muted" style={{ fontSize: "0.75rem", color: "#e0b8b6" }}>
                        No photos
                      </div>
                    )}
                  </td>
                  <td>{i.category_name || "—"}</td>
                  <td>
                    <strong>{i.stock}</strong>
                    {i.stock_flag === "out" && (
                      <span className="stock-flag stock-flag-out"> (out)</span>
                    )}
                    {i.stock_flag === "low" && (
                      <span className="stock-flag stock-flag-low"> (low)</span>
                    )}
                  </td>
                  <td>{money(i.price_cents)}</td>
                  <td>{i.cost_cents != null ? money(i.cost_cents) : "—"}</td>
                  <td>
                    <div>{money(i.retail_value_cents)}</div>
                    {i.cost_value_cents > 0 && (
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        cost {money(i.cost_value_cents)}
                      </div>
                    )}
                  </td>
                  <td>{i.units_sold}</td>
                  <td>{money(Number(i.revenue_cents))}</td>
                  <td>
                    <span className={`status ${i.status}`}>{i.status}</span>
                  </td>
                  <td>
                    <Link className="btn btn-outline btn-sm" to="/admin/products">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
