/** Big, readable auction countdown blocks */
export function CountdownBlocks({
  totalSec,
  label = "Time left",
}: {
  totalSec: number;
  label?: string;
}) {
  const safe = Math.max(0, totalSec);
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (safe <= 0) {
    return (
      <div className="countdown-wrap">
        <div className="countdown-label">{label}</div>
        <div className="countdown-ended">Ended</div>
      </div>
    );
  }

  const parts = [
    ...(days > 0 ? [{ value: days, unit: days === 1 ? "Day" : "Days" }] : []),
    { value: hours, unit: "Hours" },
    { value: mins, unit: "Mins" },
    { value: secs, unit: "Secs" },
  ];

  return (
    <div className="countdown-wrap">
      <div className="countdown-label">{label}</div>
      <div className="countdown-blocks" aria-label={`${label}: ${days}d ${hours}h ${mins}m ${secs}s`}>
        {parts.map((p) => (
          <div className="countdown-block" key={p.unit}>
            <span className="countdown-num">{String(p.value).padStart(2, "0")}</span>
            <span className="countdown-unit">{p.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
