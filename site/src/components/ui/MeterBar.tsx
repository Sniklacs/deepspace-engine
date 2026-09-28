// MeterBar — one linear meter (game-ui-shell-spec §5.3).
//
// Never colour-only: the fill AND the .num percentage AND the word "high" at
// ≥50 carry the state. No pulse — timers and meters stay calm; the only
// animation reserved for live war items is the existing report-blink (A.5).
import { Bdi } from "./Bdi";
import { useLang, useT } from "../i18n/I18n";
import { formatNumber } from "../../game/i18n/format";

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
  const t = useT();
  const lang = useLang();
  const pct = Math.max(0, Math.min(100, value));
  const high = showHigh && pct >= 50;
  // ONE isolated run for the reading: a numeral beside a bidi-moved `%` is the
  // exact shape that re-orders in a right-to-left line. The digits come from the
  // shared formatter, so a Persian phone reads 50%, never >50 with Persian-Indic
  // digits.
  const shown = `${formatNumber(lang, Math.round(pct))}%`;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-text-2">{label}</span>
        <span className="flex items-baseline gap-1.5">
          {high ? <span className="font-semibold text-hazard-soft">{t("meter.high")}</span> : null}
          <b className="text-text-1"><Bdi dir="ltr" className="num">{shown}</Bdi></b>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={high ? `${shown} ${t("meter.high")}` : shown}
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
