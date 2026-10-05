// BATTLE CLOCK — the shared clock that keeps all five players in step
// (Battle Scene P1). Phase markers: APPROACH → TOUCHDOWN → FIRST CONTACT →
// WEAPONS FREE. Ticks every frame from the scene clock; the active phase
// glows, passed phases dim, future phases are hollow.

import { SCENE_PHASES, fmtSceneClock, scenePhaseAt } from "../../game/war/battle-scene-model";

const PHASE_COLORS: Record<string, string> = {
  approach: "#38bdf8",
  touchdown: "#a3e635",
  contact: "#fbbf24",
  "weapons-free": "#f87171",
};

export function BattleClock({ tS, compact = false }: { tS: number; compact?: boolean }) {
  const active = scenePhaseAt(tS);
  return (
    <div className={`flex ${compact ? "flex-row items-center gap-3" : "flex-col gap-2"}`} aria-label="Battle clock">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold tabular-nums text-zinc-50" style={{ textShadow: "0 0 18px rgba(56,189,248,0.45)" }}>
          {fmtSceneClock(tS)}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">battle clock</span>
      </div>
      <div className={`flex ${compact ? "flex-1" : ""} items-center gap-1`}>
        {SCENE_PHASES.map((p, i) => {
          const isActive = p.phase === active;
          const passed = p.atS < tS && !isActive;
          const color = PHASE_COLORS[p.phase] ?? "#a1a1aa";
          return (
            <div key={p.phase} className="flex flex-1 items-center gap-1">
              <div className="flex-1">
                <div
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    background: isActive || passed ? color : "#27272a",
                    boxShadow: isActive ? `0 0 8px ${color}` : "none",
                    opacity: passed && !isActive ? 0.45 : 1,
                  }}
                />
                <div
                  className="mt-1 text-[9px] font-semibold uppercase tracking-wider"
                  style={{ color: isActive ? color : passed ? "#52525b" : "#3f3f46" }}
                >
                  {p.label}
                  {i === 0 && <span className="ml-1 normal-case tracking-normal">0:30</span>}
                  {i === 1 && <span className="ml-1 normal-case tracking-normal">0:45</span>}
                  {i === 2 && <span className="ml-1 normal-case tracking-normal">1:00</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
