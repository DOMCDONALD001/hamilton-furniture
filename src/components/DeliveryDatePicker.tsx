type Props = {
  dates: string[];
  value: string;
  onChange: (isoDate: string) => void;
  required?: boolean;
  id?: string;
};

function parseLocalIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toLocalIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDeliveryDay(iso: string) {
  if (!iso) return "";
  return parseLocalIso(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Calendar-style picker — shows weekday names, only allows provided ISO dates. */
export function DeliveryDatePicker({ dates, value, onChange, required, id }: Props) {
  const allowed = new Set(dates);
  const first = dates[0] ? parseLocalIso(dates[0]) : new Date();
  const selected = value ? parseLocalIso(value) : first;
  const view = new Date(selected.getFullYear(), selected.getMonth(), 1);

  const monthLabel = view.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const startWeekday = view.getDay(); // 0 Sun
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();

  const cells: Array<{ iso: string | null; label: number | null; enabled: boolean }> = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push({ iso: null, label: null, enabled: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(view.getFullYear(), view.getMonth(), day);
    const iso = toLocalIso(d);
    cells.push({ iso, label: day, enabled: allowed.has(iso) });
  }

  function shiftMonth(delta: number) {
    const next = new Date(view.getFullYear(), view.getMonth() + delta, 1);
    const nextIso = toLocalIso(next);
    // Prefer first allowed date in that month, else keep current value
    const inMonth = dates.find((iso) => {
      const d = parseLocalIso(iso);
      return d.getFullYear() === next.getFullYear() && d.getMonth() === next.getMonth();
    });
    if (inMonth) onChange(inMonth);
    else if (dates.length) {
      // Jump to nearest allowed date toward that month
      const target = next.getTime();
      let best = dates[0];
      let bestDist = Math.abs(parseLocalIso(best).getTime() - target);
      for (const iso of dates) {
        const dist = Math.abs(parseLocalIso(iso).getTime() - target);
        if (dist < bestDist) {
          best = iso;
          bestDist = dist;
        }
      }
      onChange(best);
    }
    void nextIso;
  }

  const canPrev = dates.some((iso) => parseLocalIso(iso) < new Date(view.getFullYear(), view.getMonth(), 1));
  const canNext = dates.some(
    (iso) => parseLocalIso(iso) > new Date(view.getFullYear(), view.getMonth() + 1, 0),
  );

  return (
    <div className="delivery-date-picker" id={id}>
      <input type="hidden" name="delivery_date" value={value} required={required} readOnly />
      <div className="delivery-cal-head">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={!canPrev}
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <strong>{monthLabel}</strong>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={!canNext}
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="delivery-cal-weekdays" aria-hidden="true">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="delivery-cal-grid" role="grid" aria-label="Delivery calendar">
        {cells.map((cell, i) =>
          cell.label == null ? (
            <span key={`e-${i}`} className="delivery-cal-cell is-empty" />
          ) : (
            <button
              key={cell.iso}
              type="button"
              role="gridcell"
              disabled={!cell.enabled}
              className={`delivery-cal-cell${cell.enabled ? "" : " is-disabled"}${
                value === cell.iso ? " is-selected" : ""
              }`}
              onClick={() => cell.iso && cell.enabled && onChange(cell.iso)}
              aria-label={
                cell.iso
                  ? `${formatDeliveryDay(cell.iso)}${cell.enabled ? "" : " (unavailable)"}`
                  : undefined
              }
              aria-pressed={value === cell.iso}
            >
              <span className="delivery-cal-num">{cell.label}</span>
              {cell.enabled && cell.iso && (
                <span className="delivery-cal-dow">
                  {parseLocalIso(cell.iso).toLocaleDateString("en-US", { weekday: "short" })}
                </span>
              )}
            </button>
          ),
        )}
      </div>
      {value ? (
        <p className="delivery-cal-selected muted">
          Selected: <strong>{formatDeliveryDay(value)}</strong>
        </p>
      ) : (
        <p className="delivery-cal-selected muted">Pick a delivery day (Sundays unavailable)</p>
      )}
    </div>
  );
}
