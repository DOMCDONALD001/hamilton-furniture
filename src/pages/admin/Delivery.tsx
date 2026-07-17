import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { api, money } from "../../lib/api";
import { Modal, useToast } from "../../components/AdminUI";

type Config = {
  enabled: boolean;
  pickup_enabled: boolean;
  local_zips: string[];
  local_fee_cents: number;
  extended_zips: string[];
  extended_fee_cents: number;
  per_item_cents: number;
  free_above_cents: number | null;
  eta_local: string;
  eta_extended: string;
  outside_message: string;
};

export function AdminDelivery() {
  const toast = useToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [localZips, setLocalZips] = useState("");
  const [extendedZips, setExtendedZips] = useState("");
  const [localFee, setLocalFee] = useState("49");
  const [extendedFee, setExtendedFee] = useState("89");
  const [perItem, setPerItem] = useState("15");
  const [usePerItem, setUsePerItem] = useState(true);
  const [freeAbove, setFreeAbove] = useState("1500");
  const [useFreeAbove, setUseFreeAbove] = useState(true);
  const [etaLocal, setEtaLocal] = useState("1–2 business days");
  const [etaExtended, setEtaExtended] = useState("2–4 business days");
  const [outsideMsg, setOutsideMsg] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [pickup, setPickup] = useState(true);
  const [testZip, setTestZip] = useState("");
  const [testItems, setTestItems] = useState("1");
  const [testOpen, setTestOpen] = useState(false);
  const [testResult, setTestResult] = useState("");

  async function load() {
    const data = await api<{ config: Config }>("/api/admin/delivery");
    const c = data.config;
    setConfig(c);
    setLocalZips((c.local_zips || []).join("\n"));
    setExtendedZips((c.extended_zips || []).join("\n"));
    setLocalFee(String((c.local_fee_cents || 0) / 100));
    setExtendedFee(String((c.extended_fee_cents || 0) / 100));
    setUsePerItem((c.per_item_cents || 0) > 0);
    setPerItem(String((c.per_item_cents || 1500) / 100));
    setUseFreeAbove(c.free_above_cents != null);
    setFreeAbove(c.free_above_cents != null ? String(c.free_above_cents / 100) : "1500");
    setEtaLocal(c.eta_local || "1–2 business days");
    setEtaExtended(c.eta_extended || "2–4 business days");
    setOutsideMsg(c.outside_message);
    setEnabled(c.enabled);
    setPickup(c.pickup_enabled);
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load delivery settings", "err"));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const data = await api<{ config: Config }>("/api/admin/delivery", {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        pickup_enabled: pickup,
        local_zips: localZips,
        extended_zips: extendedZips,
        local_fee_cents: Math.round(Number(localFee) * 100),
        extended_fee_cents: Math.round(Number(extendedFee) * 100),
        per_item_cents: usePerItem ? Math.round(Number(perItem) * 100) : 0,
        free_above_cents: useFreeAbove ? Math.round(Number(freeAbove) * 100) : null,
        eta_local: etaLocal,
        eta_extended: etaExtended,
        outside_message: outsideMsg,
      }),
    });
    setConfig(data.config);
    toast.push("Delivery pricing saved");
  }

  async function runTest() {
    const res = await api<{
      ok: boolean;
      error?: string;
      delivery_cents: number;
      zone?: string;
      eta_text?: string;
      breakdown?: { base_cents: number; per_item_cents: number; items: number };
    }>("/api/delivery/check", {
      method: "POST",
      body: JSON.stringify({
        zip: testZip,
        method: "delivery",
        subtotal_cents: 50000,
        item_count: Number(testItems) || 1,
      }),
    });
    if (res.ok) {
      const zoneLabel = res.zone === "extended" ? "Extended area" : "Local area";
      let msg = `✓ ${testZip} → ${zoneLabel}\nFee: ${money(res.delivery_cents)}`;
      if (res.eta_text) msg += `\nETA: ${res.eta_text}`;
      if (res.breakdown) {
        msg += `\nBase ${money(res.breakdown.base_cents)}`;
        if (res.breakdown.items > 1 && res.breakdown.per_item_cents > 0) {
          msg += ` + ${res.breakdown.items - 1} extra item(s) × ${money(res.breakdown.per_item_cents)}`;
        }
      }
      setTestResult(msg);
    } else {
      setTestResult(`✗ Not deliverable\n${res.error}`);
    }
    setTestOpen(true);
  }

  if (!config) return <p>Loading delivery settings…</p>;

  const localCount = localZips.split(/[\s,]+/).filter((z) => z.replace(/\D/g, "").length === 5).length;
  const extCount = extendedZips.split(/[\s,]+/).filter((z) => z.replace(/\D/g, "").length === 5).length;

  return (
    <div>
      <h1>Delivery pricing</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 640 }}>
        Think of it in 3 steps: <strong>where</strong> you deliver, <strong>how much</strong> for that
        area, and optional <strong>extras</strong> (more items / free over a total).
      </p>

      <form onSubmit={save}>
        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Step 1 — Turn delivery on</h3>
          <div className="toolbar">
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Offer delivery
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={pickup} onChange={(e) => setPickup(e.target.checked)} />
              Offer store pickup (free)
            </label>
          </div>
        </div>

        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Step 2 — Local area (closer / cheaper)</h3>
          <p className="muted">ZIP codes near the store. Customers here pay the local fee.</p>
          <div className="grid-2">
            <div className="field">
              <label>Local ZIP codes ({localCount})</label>
              <textarea
                rows={6}
                value={localZips}
                onChange={(e) => setLocalZips(e.target.value)}
                placeholder={"45011\n45013\n45014"}
              />
            </div>
            <div>
              <div className="field">
                <label>Local delivery price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={localFee}
                  onChange={(e) => setLocalFee(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Local ETA shown to customer</label>
                <input value={etaLocal} onChange={(e) => setEtaLocal(e.target.value)} />
              </div>
              <div className="price-preview">
                Example: 1 item to a local ZIP = <strong>{money(Math.round(Number(localFee) * 100))}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Step 3 — Extended area (farther / higher fee)</h3>
          <p className="muted">
            Optional. Farther ZIPs you still serve, at a higher price. Leave blank if you only do local.
          </p>
          <div className="grid-2">
            <div className="field">
              <label>Extended ZIP codes ({extCount})</label>
              <textarea
                rows={6}
                value={extendedZips}
                onChange={(e) => setExtendedZips(e.target.value)}
                placeholder={"45030\n45044\n45069"}
              />
            </div>
            <div>
              <div className="field">
                <label>Extended delivery price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={extendedFee}
                  onChange={(e) => setExtendedFee(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Extended ETA</label>
                <input value={etaExtended} onChange={(e) => setEtaExtended(e.target.value)} />
              </div>
              <div className="price-preview">
                Example: 1 item to extended ZIP ={" "}
                <strong>{money(Math.round(Number(extendedFee) * 100))}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Step 4 — Extras (optional)</h3>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={usePerItem}
              onChange={(e) => setUsePerItem(e.target.checked)}
            />
            Charge extra for each additional item (first item included in base fee)
          </label>
          {usePerItem && (
            <div className="field" style={{ maxWidth: 280 }}>
              <label>Extra per additional item ($)</label>
              <input
                type="number"
                step="0.01"
                value={perItem}
                onChange={(e) => setPerItem(e.target.value)}
              />
            </div>
          )}
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={useFreeAbove}
              onChange={(e) => setUseFreeAbove(e.target.checked)}
            />
            Free delivery when order is over a minimum
          </label>
          {useFreeAbove && (
            <div className="field" style={{ maxWidth: 280 }}>
              <label>Free delivery over ($)</label>
              <input
                type="number"
                step="0.01"
                value={freeAbove}
                onChange={(e) => setFreeAbove(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label>Message if ZIP is outside both lists</label>
            <textarea rows={2} value={outsideMsg} onChange={(e) => setOutsideMsg(e.target.value)} />
          </div>
        </div>

        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Test a ZIP before customers see it</h3>
          <div className="toolbar">
            <input
              placeholder="ZIP e.g. 45011"
              value={testZip}
              onChange={(e) => setTestZip(e.target.value)}
              style={{ maxWidth: 140 }}
            />
            <input
              type="number"
              min={1}
              value={testItems}
              onChange={(e) => setTestItems(e.target.value)}
              style={{ maxWidth: 80 }}
              title="Item count"
            />
            <span className="muted">items</span>
            <button
              className="btn btn-outline"
              type="button"
              onClick={runTest}
              disabled={testZip.replace(/\D/g, "").length < 5}
            >
              Calculate fee
            </button>
            <button className="btn btn-primary" type="submit">
              Save delivery settings
            </button>
          </div>
        </div>
      </form>

      <Modal open={testOpen} title="Delivery quote" onClose={() => setTestOpen(false)}>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            fontFamily: "Manrope, sans-serif",
            fontSize: "1.05rem",
            lineHeight: 1.5,
          }}
        >
          {testResult}
        </pre>
      </Modal>
    </div>
  );
}
