// BattleControlsBody — the floating glass control deck for the full-screen
// battle scene (owner 2026-10-05).
//
// Rendered inside the EVE-style window framework as the "battle-controls"
// window kind: translucent, draggable by the title bar, resizable by the
// corner grip, size/position remembered per kind. Shares the scene UI store
// with the canvas, so the player's hands work the same controls whether the
// window is open or not. The scene itself defaults to a clean full-screen
// view; the player summons this glass only when they want their hands on it.

import { useSyncExternalStore } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setVectorOn,
  setTurretsOn,
  setLogisticsFx,
  setManual,
  setCameraMode,
  cycleDayNight,
  setGunner,
} from "../../game/war/battle-scene-ui-store";
import type { ManeuverVector } from "../../game/war/war-types";
import { BattleClock } from "../BattleScene/BattleClock";
import { ToggleSwitch } from "../BattleScene/ToggleSwitch";

const VEC_LABEL: Record<ManeuverVector, string> = {
  MAIN: "Main",
  FLANK_LEFT: "Flank L",
  FLANK_RIGHT: "Flank R",
  REAR: "Rear",
  RESERVE: "Reserve",
};

function dayNightLabel(m: "auto" | "day" | "night"): string {
  return m === "auto" ? "Day/night auto" : m === "day" ? "Day" : "Night";
}

export function BattleControlsBody() {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const gunner = ui.gunnerId ? ui.turrets.find((t) => t.id === ui.gunnerId) ?? null : null;

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3" data-testid="battle-controls-body">
      {/* doctrine clock — the shared battle timer */}
      <BattleClock tS={ui.tS} compact />

      {/* command */}
      <section aria-label="Command">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Command</p>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <ToggleSwitch
            label={ui.manual ? "Manual" : "Auto"}
            on={ui.manual}
            onChange={setManual}
            accent={ui.manual ? "#f87171" : "#a3e635"}
          />
          <ToggleSwitch
            label={dayNightLabel(ui.dayNight)}
            on={ui.dayNight !== "day"}
            onChange={cycleDayNight}
            accent="#38bdf8"
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          {ui.manual
            ? "Manual: turrets hold fire until you take the gunner cam. Pick a turret below, or tap one on the map."
            : "Auto: turrets engage on their own. Flip to manual to take a gun yourself."}
        </p>
      </section>

      {/* camera — tactical overhead or down in the dirt */}
      <section aria-label="Camera">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Camera</p>
        <ToggleSwitch
          label={ui.cameraMode === "ground" ? "Ground" : "Tactical"}
          on={ui.cameraMode === "ground"}
          onChange={(on) => setCameraMode(on ? "ground" : "tactical")}
          accent="#f0abfc"
        />
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          {ui.cameraMode === "ground"
            ? "Ground: down in the dirt with the advance — spot your targets, then pull back up."
            : "Tactical: the overhead view. Flip to ground to ride with the troops."}
        </p>
      </section>

      {/* vector layers */}
      <section aria-label="Vector layers">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Vector layers</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2.5">
          {(Object.keys(VEC_LABEL) as ManeuverVector[]).map((v) => (
            <ToggleSwitch
              key={v}
              label={VEC_LABEL[v]}
              on={ui.vectorsOn[v]}
              onChange={(on) => setVectorOn(v, on)}
              accent="#a78bfa"
            />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2.5">
          <ToggleSwitch label="Turrets" on={ui.turretsOn} onChange={setTurretsOn} accent="#67e8f9" />
          <ToggleSwitch label="Logistics FX" on={ui.logisticsFx} onChange={setLogisticsFx} accent="#5eead4" />
        </div>
      </section>

      {/* gunner cam */}
      <section aria-label="Gunner cam">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Gunner cam</p>
        {!gunner ? (
          ui.turrets.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No turrets on the field yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ui.turrets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setGunner(t.id); setManual(true); }}
                  data-testid={`gunner-pick-${t.id}`}
                  className="rounded-lg border border-cyan-300/40 bg-cyan-950/40 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-900/50"
                >
                  Turret {t.idx + 1}
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="rounded-lg border border-cyan-300/40 bg-cyan-950/40 p-2.5">
            <p className="text-[11px] font-semibold text-cyan-200">
              Gunner cam — Turret {gunner.idx + 1}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {ui.gunTarget ? "Target locked — tracers are yours." : "Tap an enemy on the map to engage."}
            </p>
            <button
              type="button"
              onClick={() => setGunner(null)}
              data-testid="gunner-exit"
              className="mt-2 rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-text-2 hover:text-text-1"
            >
              Exit gunner ✕
            </button>
          </div>
        )}
      </section>

      {/* tally */}
      <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[11px] text-zinc-500">
        <span>Phase 1 live view — observing only.</span>
        <span className="tabular-nums">
          <span className="text-amber-400/90">{ui.kills.attacker}✕</span>
          <span className="mx-1">·</span>
          <span className="text-rose-400/90">{ui.kills.defender}✕</span>
          <span className="ml-1">down</span>
        </span>
      </div>
    </div>
  );
}
