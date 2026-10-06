// BattleHud — the on-field command layer (owner 2026-10-06). Mid-battle
// control lives ON the field: the Controls glass is setup-only (toggled on
// at battle start, checked, then left closed), and after that everything
// is tap-and-move from the screen itself. This layer carries what a
// commander touches mid-fight:
//
//   • the TURRET toggle — open a turret (take the gunner cam) / close it,
//     one tap each, plus a hold-fire pip per gun. Never via Controls.
//   • the RESERVE strip — on-call squads as 🪂 chips right on the field:
//     tap the chip, tap the map, the reserve hot-drops. No Controls visit.
//   • the squad strip — every bus, tap to select, tap the map to order.
//   • the pace toggle — SLOW ↔ REALTIME (capped at 1x, never faster).
//   • comms bubbles + the selection banner + the kill tally — critical
//     state visible at a glance, nothing hidden behind the Controls toggle.
//
// Reads/writes the shared scene-UI store, so the HUD, the canvas, and the
// Controls glass never disagree. Phone-first: chips are thumb-sized and
// the labels stay short.

import { useSyncExternalStore } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setSelectedSquad,
  setTurretMode,
  turretModeOf,
  cycleBattleSpeed,
  orderReceipt,
  selectionBannerText,
  BATTLE_SPEED_MUL,
  type TurretMode,
} from "../../game/war/battle-scene-ui-store";
import { battleSfx } from "../../game/war/battle-sfx";
import type { CommsBubble } from "../../game/war/battle-comms";
import { CommsBubbles } from "./CommsBubbles";

const CHIP =
  "rounded-full border px-3 py-2 text-[11px] font-semibold backdrop-blur-md transition active:scale-[0.97]";

export function BattleHud({
  comms,
  onDismissComms,
  variant,
}: {
  comms: CommsBubble[];
  onDismissComms: (id: number) => void;
  /** embedded: rides the canvas wrap; fullscreen: rides the viewport */
  variant: "embedded" | "fullscreen";
}) {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const fs = variant === "fullscreen";
  // Below the slim header overlay in fullscreen; top of the wrap embedded.
  const commsStyle = fs
    ? { top: "calc(env(safe-area-inset-top) + 6.75rem)" }
    : undefined;
  const stripBottom = fs
    ? "calc(env(safe-area-inset-bottom) + 4.25rem)"
    : "0.5rem";

  const selectedSquad = ui.squads.find((s) => s.id === ui.selectedSquadId) ?? null;
  const lastOrder = ui.orderLog[0] ?? null;
  const reserves = ui.squads.filter((s) => s.onCallReserve);

  const turretButton = (id: string, idx: number) => {
    const mode: TurretMode = turretModeOf(ui, id);
    if (mode === "gunner") {
      return (
        <div key={id} className="pointer-events-auto flex items-stretch gap-1">
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setTurretMode(id, "auto"); }}
            data-testid={`turret-toggle-${id}`}
            aria-label={`Close turret ${idx + 1}`}
            className={`${CHIP} border-cyan-300/60 bg-cyan-950/70 font-bold text-cyan-100`}
          >
            🎯 Close turret ✕
          </button>
        </div>
      );
    }
    return (
      <div key={id} className="pointer-events-auto flex items-stretch gap-1">
        <button
          type="button"
          onClick={() => { battleSfx.uiClick(); setTurretMode(id, "gunner"); }}
          data-testid={`turret-toggle-${id}`}
          aria-label={`Open turret ${idx + 1} — take the gunner cam`}
          className={`${CHIP} border-cyan-300/40 bg-black/60 text-cyan-200`}
        >
          🎯 Open turret {idx + 1}
        </button>
        <button
          type="button"
          onClick={() => { battleSfx.uiClick(); setTurretMode(id, mode === "held" ? "auto" : "held"); }}
          data-testid={`turret-hold-${id}`}
          aria-label={
            mode === "held"
              ? `Turret ${idx + 1} is holding fire — tap to let it shoot`
              : `Turret ${idx + 1} is free-firing — tap to hold its fire`
          }
          aria-pressed={mode === "held"}
          className={`${CHIP} px-2.5 ${
            mode === "held"
              ? "border-amber-300/50 bg-amber-950/60 text-amber-200"
              : "border-white/15 bg-black/50 text-zinc-400"
          }`}
        >
          {mode === "held" ? "⏸ held" : "▶ auto"}
        </button>
      </div>
    );
  };

  const squadChip = (sq: (typeof ui.squads)[number]) => {
    const selected = ui.selectedSquadId === sq.id;
    return (
      <button
        key={sq.id}
        type="button"
        onClick={() => { battleSfx.uiClick(); setSelectedSquad(selected ? null : sq.id); }}
        data-testid={`hud-squad-${sq.id}`}
        data-oncall={sq.onCallReserve ? "true" : undefined}
        aria-pressed={selected}
        aria-label={
          sq.onCallReserve
            ? `${sq.name}, on-call reserve, ${sq.alive} of ${sq.total}. Tap the map to hot-drop it.`
            : `${sq.name}, ${sq.alive} of ${sq.total}.`
        }
        // pointer-events-auto: the strip container is pointer-events-none so
        // the map stays tappable around the chips; each chip must opt back
        // in or taps fall through to the canvas and select the nearest unit
        // instead of the chip that was tapped (QA 2026-10-06: taps aimed at
        // the reserve chip kept selecting Squad 4). min-h keeps ≥40px thumb
        // targets at phone widths.
        className={`${CHIP} pointer-events-auto min-h-[44px] touch-manipulation items-center ${
          selected
            ? "border-white/70 bg-white/15 text-white"
            : sq.onCallReserve
              ? "border-sky-400/60 bg-sky-950/60 font-bold text-sky-100"
              : "border-white/15 bg-black/55 text-zinc-200"
        }`}
      >
        {sq.onCallReserve && <span aria-hidden="true" className="mr-1">🪂</span>}
        {sq.eyes && <span aria-hidden="true" className="mr-1">👁</span>}
        {sq.name}{" "}
        <span className="tabular-nums text-zinc-400">
          <span style={{ color: "#34d399" }}>{sq.alive}</span>/{sq.total}
        </span>
      </button>
    );
  };

  return (
    <>
      {/* comms — persistent bubbles, tap to confirm read */}
      <CommsBubbles
        comms={comms}
        onDismiss={onDismissComms}
        className={fs ? "" : "top-2"}
        style={commsStyle}
      />

      {/* squads + reserves — bottom-left, above the Legend chip. z-30 keeps
          the strip above the canvas at every viewport; the container stays
          pointer-events-none so bare map between chips remains tappable —
          chips opt back in (pointer-events-auto) individually. */}
      <div
        className="pointer-events-none absolute left-2 z-30 flex max-w-[72vw] flex-col items-start gap-1.5"
        style={{ bottom: stripBottom }}
        data-testid="battle-hud-squads"
      >
        {selectedSquad && (
          <p
            className="pointer-events-none rounded-lg border border-white/15 bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-100 backdrop-blur-md"
            data-testid="hud-selection-banner"
            data-kind={selectedSquad.onCallReserve ? "hotdrop" : "order"}
            aria-live="polite"
          >
            {selectionBannerText(selectedSquad)}
          </p>
        )}
        {lastOrder &&
          (() => {
            const r = orderReceipt(lastOrder);
            return (
              <p
                className={`pointer-events-none max-w-full truncate rounded-lg border px-2.5 py-1 text-[10px] backdrop-blur-md ${
                  r.tone === "bad"
                    ? "border-red-400/30 bg-red-950/50 text-red-200"
                    : r.tone === "ok"
                      ? "border-emerald-400/25 bg-emerald-950/45 text-emerald-200"
                      : "border-white/10 bg-black/55 text-zinc-400"
                }`}
                data-testid="hud-last-order"
                data-kind={lastOrder.kind ?? "move"}
              >
                {r.text}
              </p>
            );
          })()}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 backdrop-blur-md">
            Squads
          </span>
          <span
            className="rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[10px] tabular-nums text-zinc-400 backdrop-blur-md"
            data-testid="hud-kill-tally"
            aria-label={`Confirmed down: ${ui.kills.attacker} of theirs, ${ui.kills.defender} of yours`}
          >
            <span className="text-amber-400/90">{ui.kills.attacker}✕</span>
            <span className="mx-1">·</span>
            <span className="text-rose-400/90">{ui.kills.defender}✕</span> down
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ui.squads.length === 0 ? (
            <span className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1.5 text-[10px] text-zinc-500 backdrop-blur-md">
              Mustering…
            </span>
          ) : (
            ui.squads.map(squadChip)
          )}
        </div>
        {reserves.length > 0 && (
          <p className="pointer-events-none text-[10px] font-semibold text-sky-300/90">
            🪂 {reserves.map((r) => r.name).join(", ")} on call — tap, then tap the map
          </p>
        )}
      </div>

      {/* turret + pace — bottom-right, above the Controls button */}
      <div
        className="pointer-events-none absolute right-2 z-30 flex flex-col items-end gap-1.5"
        style={{ bottom: stripBottom }}
        data-testid="battle-hud-command"
      >
        {ui.turrets.map((t) => turretButton(t.id, t.idx))}
        <button
          type="button"
          onClick={() => { battleSfx.uiClick(); cycleBattleSpeed(); }}
          data-testid="hud-pace-toggle"
          aria-label={`Battle speed ${ui.battleSpeed === "slow" ? "slow" : "real-time"} (${BATTLE_SPEED_MUL[ui.battleSpeed]}×). Tap to switch.`}
          className={`${CHIP} pointer-events-auto border-white/15 bg-black/55 text-zinc-200`}
        >
          {ui.battleSpeed === "slow" ? "🐢 Slow" : "⏱ Real-time"}
        </button>
      </div>
    </>
  );
}
