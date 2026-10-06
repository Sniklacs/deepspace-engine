// BATTLE CLOCK — the shared timeline (owner 2026-10-06).
//
// "The clock is there to steer everybody in a direction. They don't have to
// follow it, but it gives them an idea of where they should be."
//
// Descriptive, not prescriptive: approach → scout flyby → touchdown →
// position → first contact → weapons-free → escalation windows → timeline
// end. A "you are here" caret marks the battle's arc, the next event is
// named with its countdown, and the remaining-time readout frames the
// raid-fail as the timeline running out — not a punishment. In future PvP
// both sides read the same clock: the shared frame that keeps two humans
// from fighting in different battles.

import {
  BATTLE_CLOCK_BUDGET_S,
  CLOCK_END_S,
  ESCALATION_INTERVAL_S,
  FLYBY_START_S,
  fmtSceneClock,
  SCENE_PHASES,
} from "../../game/war/battle-scene-model";

interface TimelineEvent {
  atS: number;
  label: string;
  color: string;
}

const WEAPONS_FREE_S = 90;

const TIMELINE: TimelineEvent[] = [
  { atS: 0, label: "APPROACH", color: "#38bdf8" },
  { atS: FLYBY_START_S, label: "SCOUT FLYBY", color: "#67e8f9" },
  { atS: 30, label: "TOUCHDOWN", color: "#a3e635" },
  { atS: 75, label: "FIRST CONTACT", color: "#fbbf24" },
  { atS: WEAPONS_FREE_S, label: "WEAPONS FREE", color: "#f87171" },
  { atS: WEAPONS_FREE_S + ESCALATION_INTERVAL_S, label: "ESCALATION 1", color: "#fb923c" },
  { atS: WEAPONS_FREE_S + ESCALATION_INTERVAL_S * 2, label: "ESCALATION 2", color: "#fb923c" },
  { atS: WEAPONS_FREE_S + ESCALATION_INTERVAL_S * 3, label: "ESCALATION 3", color: "#fb923c" },
  { atS: CLOCK_END_S, label: "TIMELINE END", color: "#e879f9" },
];

/** Phase label for the timeline's phase readout. */
export function phaseLabelAt(tS: number): string {
  const p = SCENE_PHASES.filter((s) => s.atS <= tS).pop();
  return p ? p.label : "APPROACH";
}

export function BattleClock({ tS, compact = false }: { tS: number; compact?: boolean }) {
  const clamped = Math.min(tS, CLOCK_END_S);
  const posPct = (clamped / CLOCK_END_S) * 100;
  const next = TIMELINE.find((e) => e.atS > tS) ?? null;
  const remaining = Math.max(0, CLOCK_END_S - tS);
  const ended = tS >= CLOCK_END_S;
  return (
    <div className={`flex ${compact ? "flex-row items-center gap-3" : "flex-col gap-2"}`} aria-label="Battle clock">
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono text-2xl font-bold tabular-nums text-zinc-50"
          style={{ textShadow: "0 0 18px rgba(56,189,248,0.45)" }}
        >
          {fmtSceneClock(tS)}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">battle clock</span>
        <span className="text-[10px] tabular-nums text-zinc-500" data-testid="battle-clock-remaining">
          {ended ? "timeline ended" : `${fmtSceneClock(remaining)} left`}
        </span>
      </div>
      <div className={`${compact ? "flex-1" : ""} min-w-0`}>
        {/* the shared timeline — "you are here" caret, next event named */}
        <div className="relative h-2 rounded-full bg-zinc-800" role="img" aria-label={`Battle timeline, ${fmtSceneClock(tS)} elapsed`}>
          {/* position window (unload & set positions) — the green stretch */}
          <div
            className="absolute inset-y-0 rounded-full bg-lime-400/20"
            style={{ left: `${(30 / CLOCK_END_S) * 100}%`, width: `${(45 / CLOCK_END_S) * 100}%` }}
          />
          {TIMELINE.map((e) => {
            const passed = e.atS <= tS;
            return (
              <div
                key={e.label}
                className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${(e.atS / CLOCK_END_S) * 100}%`,
                  background: passed ? e.color : "#3f3f46",
                  boxShadow: passed ? `0 0 6px ${e.color}` : "none",
                }}
                title={`${e.label} — ${fmtSceneClock(e.atS)}`}
              />
            );
          })}
          {/* you-are-here caret */}
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${posPct}%` }}
            data-testid="battle-clock-caret"
          >
            <div className="h-3.5 w-[3px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
            {phaseLabelAt(tS)}
            <span className="ml-1 normal-case tracking-normal text-zinc-600">
              · {fmtSceneClock(BATTLE_CLOCK_BUDGET_S)} window
            </span>
          </span>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-300/90" data-testid="battle-clock-next">
            {next ? `next: ${next.label} in ${fmtSceneClock(next.atS - tS)}` : "timeline complete"}
          </span>
        </div>
      </div>
    </div>
  );
}
