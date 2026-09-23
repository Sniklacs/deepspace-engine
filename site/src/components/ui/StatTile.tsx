// StatTile — one number with its label (game-ui-shell-spec §5.3).
// Every figure renders through .num. 64px minimum height keeps the two-up
// strips (status, stores) comfortable to read on a phone.
import type { ReactNode } from "react";
import { Icon } from "../icons";
import type { IconName } from "../icons";
import { MeterBar } from "./MeterBar";

export function StatTile({
  label,
  value,
  sub,
  icon,
  meter,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  /** optional meter under the value (label is reused as the meter's name) */
  meter?: { value: number; danger?: boolean };
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-16 flex-col justify-center rounded-xl border border-line bg-surf-3/60 px-3 py-2 ${className}`}
    >
      <div className="flex items-center gap-1.5">
        {icon ? <Icon name={icon} size={14} className="shrink-0 text-text-3" aria-hidden="true" /> : null}
        <span className="truncate text-[11px] text-text-3">{label}</span>
      </div>
      <div className="num mt-0.5 text-lg font-semibold leading-none text-text-1">{value}</div>
      {meter ? <MeterBar className="mt-1.5" label={label} value={meter.value} danger={meter.danger} /> : null}
      {sub ? <p className="mt-1 text-[11px] leading-tight text-text-3">{sub}</p> : null}
    </div>
  );
}
