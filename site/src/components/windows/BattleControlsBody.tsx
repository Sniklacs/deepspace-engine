// BattleControlsBody — the floating glass control deck for the full-screen
// battle scene (owner 2026-10-05).
//
// Rendered inside the EVE-style window framework as the "battle-controls"
// window kind: translucent, draggable by the title bar, resizable by the
// corner grip, size/position remembered per kind. Shares the scene UI store
// with the canvas, so the player's hands work the same controls whether the
// window is open or not. The scene itself defaults to a clean full-screen
// view; the player summons this glass only when they want their hands on it.

import { useSyncExternalStore, useEffect, useState } from "react";
import { sound } from "../../game/sound";
import { battleSfx } from "../../game/war/battle-sfx";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setVectorOn,
  setTurretsOn,
  setLogisticsFx,
  setManual,
  setCameraMode,
  setBattleSpeed,
  setLabelsOn,
  setZoomLevel,
  setSelectedSquad,
  recenterMap,
  cycleDayNight,
  setGunner,
  BATTLE_SPEEDS,
  type BattleSpeed,
} from "../../game/war/battle-scene-ui-store";
import { TROOP_KINDS, UNIT_KIND_LABEL } from "../../game/war/battle-scene-model";
import type { ManeuverVector } from "../../game/war/war-types";
import { BattleClock } from "../BattleScene/BattleClock";
import { ToggleSwitch } from "../BattleScene/ToggleSwitch";

const ART = "/art/battle/units";

/** Three-way battle-speed selector in the skeuomorphic deck style —
 *  SLOW / NORMAL / FAST. SLOW is the default: the fight breathes. */
function SpeedSwitch({ value, onChange }: { value: BattleSpeed; onChange: (s: BattleSpeed) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Battle speed"
      className="flex overflow-hidden rounded-lg border border-black/60"
      style={{ background: "linear-gradient(180deg,#1b1d24 0%,#101218 60%,#1b1d24 100%)" }}
    >
      {BATTLE_SPEEDS.map((sp) => {
        const active = value === sp;
        return (
          <button
            key={sp}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(sp)}
            className="flex-1 px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors"
            style={
              active
                ? {
                    background: "linear-gradient(180deg,#3a2f12 0%,#2a220d 100%)",
                    color: "#fbbf24",
                    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.85), 0 0 8px rgba(251,191,36,0.25)",
                  }
                : { color: "#63636b" }
            }
          >
            {sp}
          </button>
        );
      })}
    </div>
  );
}

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
  // Speaker button synced with the game's global mute (mutes SFX + voice).
  const [muted, setMuted] = useState(sound.muted);
  useEffect(() => sound.onMuteChange(setMuted), []);
  /** Wrap a control handler so the toggle throw clicks. */
  const tapped = <T,>(fn: (v: T) => void) => (v: T) => { battleSfx.uiClick(); fn(v); };

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3" data-testid="battle-controls-body">
      {/* doctrine clock — the shared battle timer */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1"><BattleClock tS={ui.tS} compact /></div>
        <button
          type="button"
          aria-label={muted ? "Unmute battle sound" : "Mute battle sound"}
          aria-pressed={muted}
          onClick={() => { setMuted(sound.toggleMute()); }}
          className="shrink-0 rounded-lg border border-black/60 px-2.5 py-2 text-base leading-none"
          style={{ background: "linear-gradient(180deg,#1b1d24 0%,#101218 60%,#1b1d24 100%)" }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* command */}
      <section aria-label="Command">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Command</p>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <ToggleSwitch
            label={ui.manual ? "Manual" : "Auto"}
            on={ui.manual}
            onChange={tapped(setManual)}
            accent={ui.manual ? "#f87171" : "#a3e635"}
          />
          <ToggleSwitch
            label={dayNightLabel(ui.dayNight)}
            on={ui.dayNight !== "day"}
            onChange={tapped(cycleDayNight)}
            accent="#38bdf8"
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          {ui.manual
            ? "Manual: turrets hold fire until you take the gunner cam. Pick a turret below, or tap one on the map."
            : "Auto: turrets engage on their own. Flip to manual to take a gun yourself."}
        </p>
      </section>

      {/* battle speed — slow it down, give the commander time to think */}
      <section aria-label="Battle speed">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Battle speed</p>
        <SpeedSwitch value={ui.battleSpeed} onChange={tapped(setBattleSpeed)} />
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          {ui.battleSpeed === "slow"
            ? "Slow: half pace — read the field, call your shots."
            : ui.battleSpeed === "normal"
              ? "Normal: full pace."
              : "Fast: 1.75x — when you want the tape, not the tension."}
        </p>
      </section>

      {/* field force — know what you're loading, at a glance */}
      <section aria-label="Field force">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Field force</p>
        {ui.roster.length === 0 ? (
          <p className="text-[11px] text-zinc-500">Mustering…</p>
        ) : (
          (["attacker", "defender"] as const).map((side) => {
            const rows = TROOP_KINDS.map((kind) => {
              const entry = ui.roster.find((r) => r.side === side && r.kind === kind);
              return {
                kind,
                count: entry?.count ?? 0,
                tiers: entry?.tiers ?? ([0, 0, 0, 0] as [number, number, number, number]),
              };
            }).filter((r) => r.count > 0);
            if (rows.length === 0) return null;
            return (
              <div key={side} className="mb-2 last:mb-0">
                <p
                  className="mb-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: side === "attacker" ? "#34d399" : "#ef4444" }}
                >
                  {side === "attacker" ? "Attackers" : "Defenders"}
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {rows.map(({ kind, count, tiers }) => (
                    <div key={kind} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <img
                          src={`${ART}/${kind}.webp`}
                          alt=""
                          className="h-6 w-6 shrink-0 object-contain"
                          loading="lazy"
                        />
                        <span className="text-[11px] font-medium text-zinc-200">{UNIT_KIND_LABEL[kind]}</span>
                        <span className="ml-auto text-[11px] tabular-nums text-zinc-400">×{count}</span>
                      </div>
                      <p className="pl-8 text-[10px] tabular-nums text-zinc-500">
                        {tiers.map((n, i) => (n > 0 ? `T${i + 1} ×${n}` : null)).filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* squads — the five buses. tap a squad, then tap the map. */}
      <section aria-label="Squads">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Squads</p>
        {ui.squads.length === 0 ? (
          <p className="text-[11px] text-zinc-500">Mustering…</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {ui.squads.map((sq) => {
              const selected = ui.selectedSquadId === sq.id;
              return (
                <button
                  key={sq.id}
                  type="button"
                  onClick={() => { battleSfx.uiClick(); setSelectedSquad(selected ? null : sq.id); }}
                  data-testid={`squad-pick-${sq.id}`}
                  aria-pressed={selected}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    selected
                      ? "border-white/60 bg-white/10"
                      : "border-white/10 bg-black/40 hover:bg-black/60"
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${selected ? "text-white" : "text-zinc-200"}`}>
                    {sq.name}
                  </span>
                  <span className="text-[11px] tabular-nums text-zinc-400">
                    <span style={{ color: "#34d399" }}>{sq.alive}</span>/{sq.total}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          {ui.selectedSquadId
            ? "Squad selected — tap the map to order it. The judge rules every move."
            : "Tap one of your squads — or tap it on the map — then tap where it goes."}
        </p>
      </section>

      {/* orders — the judged command log */}
      <section aria-label="Orders">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Orders</p>
        {ui.orderLog.length === 0 ? (
          <p className="text-[11px] text-zinc-500">No orders yet — the judge is waiting.</p>
        ) : (
          <div className="flex flex-col gap-1" data-testid="orders-log">
            {ui.orderLog.map((o) => (
              <div
                key={o.id}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
                  o.verdict === "accepted"
                    ? "border-emerald-400/30 bg-emerald-950/30"
                    : "border-red-400/30 bg-red-950/30"
                }`}
              >
                <span className="font-semibold text-zinc-200">{o.squadName}</span>
                <span className="text-zinc-400"> → {o.dest} — </span>
                <span
                  className={`font-bold uppercase tracking-wide ${
                    o.verdict === "accepted" ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {o.verdict}
                </span>
                {o.reason && <span className="block text-red-200/80">{o.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* camera — tactical overhead or down in the dirt */}
      <section aria-label="Camera">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Camera</p>
        <ToggleSwitch
          label={ui.cameraMode === "ground" ? "Ground" : "Tactical"}
          on={ui.cameraMode === "ground"}
          onChange={(on) => { battleSfx.uiClick(); setCameraMode(on ? "ground" : "tactical"); }}
          accent="#f0abfc"
        />
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          {ui.cameraMode === "ground"
            ? "Ground: down in the dirt with the advance — spot your targets, then pull back up."
            : "Tactical: the overhead view. Flip to ground to ride with the troops."}
        </p>
        {/* zoom — pinch / wheel work on the map; these are the phone buttons */}
        <div className="mt-2 flex items-center gap-2">
          <div
            className="flex flex-1 overflow-hidden rounded-lg border border-black/60"
            style={{ background: "linear-gradient(180deg,#1b1d24 0%,#101218 60%,#1b1d24 100%)" }}
            role="group"
            aria-label="Map zoom"
          >
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => { battleSfx.uiClick(); setZoomLevel(ui.zoomLevel / 1.3); }}
              className="flex-1 py-2 text-sm font-bold text-zinc-300 hover:text-white"
            >
              −
            </button>
            <span className="flex items-center px-2 text-[10px] font-bold tabular-nums text-amber-300">
              {Math.round(ui.zoomLevel * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => { battleSfx.uiClick(); setZoomLevel(ui.zoomLevel * 1.3); }}
              className="flex-1 py-2 text-sm font-bold text-zinc-300 hover:text-white"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); recenterMap(); }}
            title="Back to the full field"
            className="shrink-0 rounded-lg border border-white/15 bg-black/50 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 hover:bg-black/80"
          >
            ⌖
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          Drag to pan · pinch or wheel to zoom · double-tap to recenter.
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
              onChange={(on) => { battleSfx.uiClick(); setVectorOn(v, on); }}
              accent="#a78bfa"
            />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2.5">
          <ToggleSwitch label="Turrets" on={ui.turretsOn} onChange={tapped(setTurretsOn)} accent="#67e8f9" />
          <ToggleSwitch label="Logistics FX" on={ui.logisticsFx} onChange={tapped(setLogisticsFx)} accent="#5eead4" />
          <ToggleSwitch label="Labels" on={ui.labelsOn} onChange={tapped(setLabelsOn)} accent="#fbbf24" />
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
                  onClick={() => { battleSfx.uiClick(); setGunner(t.id); setManual(true); }}
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
              onClick={() => { battleSfx.uiClick(); setGunner(null); }}
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
        <span>Click a squad, then click the map.</span>
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
