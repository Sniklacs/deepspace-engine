// MeterBar — one linear meter (game-ui-shell-spec §5.3).
//
// Never colour-only: the fill AND the .num percentage AND the word "high" at
// ≥50 carry the state. No pulse — timers and meters stay calm; the only
// animation reserved for live war items is the existing report-blink (A.5).
export function MeterBar({
  value,
  label,
  danger = false,
  showHigh = true,
  className = "",
}: {
  /** 0–100 */
  value: number;
  /** the accessible name of this meter */
  label: string;
  danger?: boolean;
  showHigh?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const high = showHigh && pct >= 50;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-text-2">{label}</span>
        <span className="flex items-baseline gap-1.5">
          {high ? <span className="font-semibold text-hazard-soft">high</span> : null}
          <b className="num text-text-1">{Math.round(pct)}%</b>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${Math.round(pct)} percent${high ? ", high" : ""}`}
        className="mt-1 h-2 overflow-hidden rounded bg-surf-4"
      >
        <div
          className={`h-2 rounded ${danger ? "bg-danger" : "bg-ember"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
