import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
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

const DEFAULT_WINDOWS = ["9am–12pm", "12pm–3pm", "3pm–6pm"];

function parseZipList(text: string) {
  return text
    .split(/[\s,]+/)
    .map((z) => z.replace(/\D/g, "").slice(0, 5))
    .filter((z) => z.length === 5);
}

function parseWindows(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed.map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_WINDOWS];
}

function feeForItems(baseDollars: number, perItemDollars: number, usePerItem: boolean, items: number) {
  const base = Math.round(Number(baseDollars) * 100) || 0;
  const per = usePerItem ? Math.round(Number(perItemDollars) * 100) || 0 : 0;
  const count = Math.max(1, items);
  return base + per * Math.max(0, count - 1);
}

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
  const [windows, setWindows] = useState<string[]>([...DEFAULT_WINDOWS]);
  const [leadDays, setLeadDays] = useState("1");
  const [maxDays, setMaxDays] = useState("14");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [testZip, setTestZip] = useState("");
  const [testItems, setTestItems] = useState("2");
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

    const settings = await api<{ settings: Record<string, string> }>("/api/admin/settings");
    setWindows(parseWindows(settings.settings.delivery_windows_json || ""));
    setLeadDays(settings.settings.delivery_lead_days || "1");
    setMaxDays(settings.settings.delivery_max_days || "14");
    setNotifyEmail(settings.settings.notify_email || "");
  }

  useEffect(() => {
    load().catch(() => toast.push("Failed to load delivery settings", "err"));
  }, []);

  const localExamples = useMemo(() => {
    const items = [1, 2, 3];
    return items.map((n) => ({
      n,
      cents: feeForItems(Number(localFee), Number(perItem), usePerItem, n),
    }));
  }, [localFee, perItem, usePerItem]);

  const extendedExamples = useMemo(() => {
    const items = [1, 2, 3];
    return items.map((n) => ({
      n,
      cents: feeForItems(Number(extendedFee), Number(perItem), usePerItem, n),
    }));
  }, [extendedFee, perItem, usePerItem]);

  const liveTest = useMemo(() => {
    const zip = testZip.replace(/\D/g, "").slice(0, 5);
    const items = Math.max(1, Number(testItems) || 1);
    if (zip.length < 5) return null;
    const local = new Set(parseZipList(localZips));
    const extended = new Set(parseZipList(extendedZips));
    let zone: "local" | "extended" | null = null;
    if (local.has(zip)) zone = "local";
    else if (extended.has(zip)) zone = "extended";
    if (!zone) {
      return { ok: false as const, zip, error: outsideMsg || "Outside delivery area" };
    }
    const base = zone === "local" ? Number(localFee) : Number(extendedFee);
    const cents = feeForItems(base, Number(perItem), usePerItem, items);
    const perCents = usePerItem ? Math.round(Number(perItem) * 100) || 0 : 0;
    const baseCents = Math.round(Number(base) * 100) || 0;
    return {
      ok: true as const,
      zip,
      zone,
      items,
      cents,
      baseCents,
      perCents,
      eta: zone === "local" ? etaLocal : etaExtended,
    };
  }, [
    testZip,
    testItems,
    localZips,
    extendedZips,
    localFee,
    extendedFee,
    perItem,
    usePerItem,
    outsideMsg,
    etaLocal,
    etaExtended,
  ]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const cleaned = windows.map((w) => w.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      toast.push("Add at least one delivery time window", "err");
      return;
    }
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
    setWindows(cleaned);
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        delivery_windows_json: JSON.stringify(cleaned),
        delivery_lead_days: leadDays,
        delivery_max_days: maxDays,
        notify_email: notifyEmail,
      }),
    });
    toast.push("Delivery settings saved");
  }

  function runTest() {
    if (!liveTest) {
      toast.push("Enter a 5-digit ZIP", "err");
      return;
    }
    if (!liveTest.ok) {
      setTestResult(`✗ Not deliverable\n${liveTest.error}`);
      setTestOpen(true);
      return;
    }
    const zoneLabel = liveTest.zone === "extended" ? "Extended area" : "Local area";
    let msg = `✓ ${liveTest.zip} → ${zoneLabel}\nFee: ${money(liveTest.cents)}`;
    if (liveTest.eta) msg += `\nETA: ${liveTest.eta}`;
    msg += `\nBase ${money(liveTest.baseCents)}`;
    if (liveTest.items > 1 && liveTest.perCents > 0) {
      msg += ` + ${liveTest.items - 1} extra item(s) × ${money(liveTest.perCents)}`;
    }
    msg += "\n\n(Uses the fees on this form — save to apply for customers.)";
    setTestResult(msg);
    setTestOpen(true);
  }

  function updateWindow(index: number, value: string) {
    setWindows((list) => list.map((w, i) => (i === index ? value : w)));
  }

  function removeWindow(index: number) {
    setWindows((list) => list.filter((_, i) => i !== index));
  }

  function addWindow(label = "") {
    setWindows((list) => [...list, label]);
  }

  if (!config) return <p>Loading delivery settings…</p>;

  const localCount = parseZipList(localZips).length;
  const extCount = parseZipList(extendedZips).length;

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
                placeholder={"38801\n38804\n38826"}
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
                <div>
                  1 item: <strong>{money(localExamples[0].cents)}</strong>
                </div>
                {usePerItem && (
                  <>
                    <div>
                      2 items: <strong>{money(localExamples[1].cents)}</strong>
                      <span className="muted">
                        {" "}
                        (base + {money(Math.round(Number(perItem) * 100) || 0)})
                      </span>
                    </div>
                    <div>
                      3 items: <strong>{money(localExamples[2].cents)}</strong>
                    </div>
                  </>
                )}
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
                <div>
                  1 item: <strong>{money(extendedExamples[0].cents)}</strong>
                </div>
                {usePerItem && (
                  <>
                    <div>
                      2 items: <strong>{money(extendedExamples[1].cents)}</strong>
                      <span className="muted">
                        {" "}
                        (base + {money(Math.round(Number(perItem) * 100) || 0)})
                      </span>
                    </div>
                    <div>
                      3 items: <strong>{money(extendedExamples[2].cents)}</strong>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Step 4 — Delivery calendar & email</h3>
          <p className="muted">
            Customers pick one of these time windows at checkout. Add or remove rows — no JSON needed.
          </p>
          <div className="field">
            <label>Time windows customers can choose</label>
            <div className="window-list">
              {windows.map((w, i) => (
                <div className="window-row" key={i}>
                  <input
                    value={w}
                    onChange={(e) => updateWindow(i, e.target.value)}
                    placeholder="e.g. 9am–12pm"
                  />
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => removeWindow(i)}
                    disabled={windows.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn btn-outline btn-sm" type="button" onClick={() => addWindow("")}>
                + Add window
              </button>
              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={() => addWindow("9am–12pm")}
              >
                + Morning
              </button>
              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={() => addWindow("12pm–3pm")}
              >
                + Midday
              </button>
              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={() => addWindow("3pm–6pm")}
              >
                + Afternoon
              </button>
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Lead days (soonest)</label>
              <input
                type="number"
                min={0}
                value={leadDays}
                onChange={(e) => setLeadDays(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Max days ahead</label>
              <input
                type="number"
                min={1}
                value={maxDays}
                onChange={(e) => setMaxDays(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Also email store copy to</label>
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="owner@example.com"
            />
          </div>
        </div>

        <div className="admin-panel">
          <h3 style={{ marginTop: 0 }}>Step 5 — Extras (optional)</h3>
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
                min={0}
                value={perItem}
                onChange={(e) => setPerItem(e.target.value)}
              />
              <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0" }}>
                Previews above update as you type. Example local 2 items ={" "}
                <strong>{money(localExamples[1].cents)}</strong>
              </p>
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
          <h3 style={{ marginTop: 0 }}>Test a ZIP (live from this form)</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Uses the fees and ZIP lists above right now — you do not have to save first.
          </p>
          <div className="toolbar">
            <input
              placeholder="ZIP e.g. 38801"
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
          {liveTest?.ok && (
            <div className="price-preview" style={{ marginTop: 12 }}>
              Live quote for {liveTest.zip} ({liveTest.items} item
              {liveTest.items === 1 ? "" : "s"}): <strong>{money(liveTest.cents)}</strong>
              {liveTest.items > 1 && liveTest.perCents > 0 && (
                <span className="muted">
                  {" "}
                  — base {money(liveTest.baseCents)} + {liveTest.items - 1} ×{" "}
                  {money(liveTest.perCents)}
                </span>
              )}
            </div>
          )}
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
