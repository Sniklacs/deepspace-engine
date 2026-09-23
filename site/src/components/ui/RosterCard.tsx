// RosterCard + PortraitFrame — the Leader / hero card (game-ui-shell-spec §2.4).
//
// G4 STRUCTURAL NEVER-LIST: this component has no price slot, no pack slot, no
// "get / unlock" affordance, no RNG shape and no timer. A hero is earned by a
// deed or an Oracle's vouch; there is nothing here to buy. The portrait is a
// DELIBERATE placeholder (sigil plate + initial on the race-accent tint) until
// real art exists — §2.6 lists the portraits to commission.
import { Icon } from "../icons";
import type { IconName } from "../icons";

export function PortraitFrame({
  accent,
  name,
  className = "",
}: {
  /** `race.accent` — identity tint only, never a literal */
  accent: string;
  name: string;
  className?: string;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`relative flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-line bg-surf-3 ${className}`}
      style={{ background: accent + "1a" }}
    >
      <Icon name="emblem" size={30} className="absolute text-text-3/50" />
      <span className="relative text-base font-bold text-text-1">{initial}</span>
    </span>
  );
}

export function RosterCard({
  kind,
  name,
  roleLine,
  level,
  pct,
  accent,
  badge,
  onClick,
}: {
  kind: "leader" | "hero";
  name: string;
  roleLine: string;
  level: number;
  /** 0–100 xp progress */
  pct: number;
  accent: string;
  /** the optional provenance line (a deed's NAME only — never a raw id) */
  badge?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <PortraitFrame accent={accent} name={name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-text-1">{name}</p>
        <p className="truncate text-[11px] text-text-3">{roleLine}</p>
        <p className="num mt-1 text-[11px] text-ember-soft">Lv {level}</p>
        <div
          role="progressbar"
          aria-label={`${name} — experience`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="mt-1 h-1 rounded bg-surf-4"
        >
          <div className="h-1 rounded bg-ember" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        {badge ? <p className="mt-1 truncate text-[11px] text-text-3">{badge}</p> : null}
      </div>
    </>
  );
  const cls = "flex w-[168px] flex-none gap-2 rounded-2xl border border-line bg-surf-2 p-2 text-left";
  if (!onClick) return <article className={cls}>{inner}</article>;
  return (
    <button
      type="button"
      data-kind={kind}
      aria-haspopup="dialog"
      aria-label={`${name} — ${roleLine}`}
      onClick={onClick}
      className={`${cls} transition-colors hover:bg-surf-3`}
    >
      {inner}
    </button>
  );
}

/** The strip's honest empty half — no link, because no flow exists yet. */
export function RosterEmpty({ text, icon = "person" }: { text: string; icon?: IconName }) {
  return (
    <p className="flex w-[168px] flex-none items-center gap-2 rounded-2xl border border-dashed border-line bg-surf-2/50 p-2 text-[11px] leading-tight text-text-3">
      <Icon name={icon} size={18} className="shrink-0 text-text-3" aria-hidden="true" />
      {text}
    </p>
  );
}
