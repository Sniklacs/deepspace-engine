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
  squadStanceOf,
  setSquadWeaponsHold,
  setSquadHoldPosition,
  setSiegeHoldAll,
  setSiegeAimArmed,
  BATTLE_SPEED_MUL,
  type TurretMode,
} from "../../game/war/battle-scene-ui-store";
import { battleSfx } from "../../game/war/battle-sfx";
import type { CommsBubble } from "../../game/war/battle-comms";
import { CommsBubbles } from "./CommsBubbles";
import { BattleRadar } from "./BattleRadar";

/**
 * Squad display order (owner 2026-10-11): the line squads 1·2·3, then the
 * support — Reserve, then Rear at the bottom. Squad ids are A0..A4
 * (MAIN, FLANK_LEFT, FLANK_RIGHT, REAR, RESERVE).
 */
const SQUAD_ORDER = ["A0", "A1", "A2", "A4", "A3"];
function squadRank(id: string): number {
  const i = SQUAD_ORDER.indexOf(id);
  return i === -1 ? 99 : i;
}

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
    // Casualties visibly add up (owner 2026-10-11): total is the ORIGINAL
    // headcount, so dead = total − alive ticks up gradually as the squad
    // bleeds. That's the number Hans watches.
    const dead = Math.max(0, sq.total - sq.alive);
    // Stance at a glance (owner 2026-10-11): 🔇 weapons hold, ⚓ holding
    // position — the toggles themselves live in the selected cluster below.
    const stance = squadStanceOf(ui, sq.id, sq.hasThunders ?? false);
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
            ? `${sq.name}, on-call reserve, ${sq.alive} of ${sq.total}, ${dead} lost. Tap the map to hot-drop it.`
            : `${sq.name}, ${sq.alive} of ${sq.total}, ${dead} casualties.`
        }
        // pointer-events-auto: the strip container is pointer-events-none so
        // the map stays tappable around the chips; each chip must opt back
        // in or taps fall through to the canvas and select the nearest unit
        // instead of the chip that was tapped (QA 2026-10-06: taps aimed at
        // the reserve chip kept selecting Squad 4). min-h keeps ≥40px thumb
        // targets at phone widths.
        className={`${CHIP} pointer-events-auto min-h-[22px] w-full touch-manipulation items-center justify-between !px-1.5 !py-0.5 !text-[9px] !rounded-md ${
          selected
            ? "border-white/70 bg-white/15 text-white"
            : sq.onCallReserve
              ? "border-sky-400/60 bg-sky-950/60 font-bold text-sky-100"
              : "border-white/15 bg-black/55 text-zinc-200"
        }`}
      >
        <span className="flex items-center">
          {sq.onCallReserve && <span aria-hidden="true" className="mr-1">🪂</span>}
          {sq.eyes && <span aria-hidden="true" className="mr-1">👁</span>}
          {stance.weaponsHold && <span aria-hidden="true" className="mr-1" title="Weapons hold">🔇</span>}
          {stance.holdPosition && <span aria-hidden="true" className="mr-1" title="Holding position">⚓</span>}
          {sq.name}
        </span>
        <span className="tabular-nums text-zinc-400">
          <span style={{ color: "#34d399" }}>{sq.alive}</span>/{sq.total}
          {dead > 0 && (
            <span className="ml-1.5 font-bold" style={{ color: "#f87171" }} data-testid={`hud-casualties-${sq.id}`}>
              −{dead}
            </span>
          )}
        </span>
      </button>
    );
  };

  // Squads in command order: 1·2·3, Reserve, Rear (owner 2026-10-11).
  const orderedSquads = [...ui.squads].sort((a, b) => squadRank(a.id) - squadRank(b.id));

  return (
    <>
      {/* comms — persistent bubbles, tap to confirm read */}
      <CommsBubbles
        comms={comms}
        onDismiss={onDismissComms}
        className={fs ? "" : "top-2"}
        style={commsStyle}
      />

      {/* radar — bottom-left, above the Legend chip. The whole field in one
          glance: friend/foe dots, turret diamonds, event pings, scale bar.
          (owner 2026-10-11) */}
      <div
        className="pointer-events-none absolute left-2 z-30"
        style={{ bottom: `calc(${stripBottom} + 3rem)` }}
        data-testid="battle-hud-radar"
      >
        <BattleRadar />
      </div>

      {/* squads — bottom-right vertical list, top to bottom:
          Squad 1·2·3, Reserve, Rear (owner 2026-10-11). Tap a squad, tap the
          map to order it. Casualty counts tick up live on each button. */}
      <div
        className="pointer-events-none absolute right-2 z-30 flex w-[196px] flex-col items-stretch gap-1.5"
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
        {/* stance cluster — the selected squad's field toggles, one tap each
            (owner 2026-10-11): WEAPONS LIVE/HOLD, MOVE/HOLD POSITION, plus
            the siege aim for thunder squads. */}
        {selectedSquad &&
          (() => {
            const stance = squadStanceOf(ui, selectedSquad.id, selectedSquad.hasThunders ?? false);
            return (
              <div
                className="pointer-events-none flex flex-wrap items-center justify-end gap-1.5"
                data-testid="hud-stance-cluster"
              >
                <button
                  type="button"
                  onClick={() => { battleSfx.uiClick(); setSquadWeaponsHold(selectedSquad.id, !stance.weaponsHold); }}
                  data-testid="hud-stance-weapons"
                  aria-pressed={stance.weaponsHold}
                  aria-label={`${selectedSquad.name}: weapons ${stance.weaponsHold ? "holding" : "live"}. Tap to ${stance.weaponsHold ? "go live" : "hold fire"}.`}
                  className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
                    stance.weaponsHold
                      ? "border-amber-300/50 bg-amber-950/60 text-amber-200"
                      : "border-white/15 bg-black/55 text-zinc-200"
                  }`}
                >
                  {stance.weaponsHold ? "🔇 HOLD" : "🔥 LIVE"}
                </button>
                <button
                  type="button"
                  onClick={() => { battleSfx.uiClick(); setSquadHoldPosition(selectedSquad.id, !stance.holdPosition); }}
                  data-testid="hud-stance-move"
                  aria-pressed={stance.holdPosition}
                  aria-label={`${selectedSquad.name}: ${stance.holdPosition ? "holding position" : "free to move"}. Tap to ${stance.holdPosition ? "allow movement" : "hold position"}.`}
                  className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
                    stance.holdPosition
                      ? "border-sky-300/50 bg-sky-950/60 text-sky-200"
                      : "border-white/15 bg-black/55 text-zinc-200"
                  }`}
                >
                  {stance.holdPosition ? "⚓ HOLD" : "➤ MOVE"}
                </button>
                {selectedSquad.hasThunders && (
                  <button
                    type="button"
                    onClick={() => { battleSfx.uiClick(); setSiegeAimArmed(!ui.siegeAimArmed); }}
                    data-testid="hud-stance-aim"
                    aria-pressed={ui.siegeAimArmed}
                    aria-label={
                      ui.siegeAimArmed
                        ? "Siege aim armed — tap the map to place the targeter"
                        : "Arm the siege aim — tap the map to drop the targeter"
                    }
                    className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
                      ui.siegeAimArmed
                        ? "border-orange-300/60 bg-orange-950/60 text-orange-200"
                        : "border-white/15 bg-black/55 text-zinc-200"
                    }`}
                  >
                    {ui.siegeAimArmed ? "✥ Aiming…" : "✥ Aim"}
                  </button>
                )}
              </div>
            );
          })()}
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
        <div className="flex flex-wrap items-center justify-end gap-1.5">
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
        <div className="flex flex-col items-stretch gap-1.5">
          {orderedSquads.length === 0 ? (
            <span className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1.5 text-[10px] text-zinc-500 backdrop-blur-md">
              Mustering…
            </span>
          ) : (
            orderedSquads.map(squadChip)
          )}
        </div>
        {reserves.length > 0 && (
          <p className="pointer-events-none text-right text-[10px] font-semibold text-sky-300/90">
            🪂 {reserves.map((r) => r.name).join(", ")} on call — tap, then tap the map
          </p>
        )}
        {/* turret + pace ride under the squad list */}
        <div className="flex flex-col items-stretch gap-1.5" data-testid="battle-hud-command">
          {ui.turrets.map((t) => turretButton(t.id, t.idx))}
          {/* siege panic button (owner 2026-10-11): every thunder holds its
              shells while this is on — one tap, always on the field, so the
              battery can go silent the moment Reavers enter the blast zone. */}
          {ui.squads.some((s) => s.hasThunders && s.alive > 0) && (
            <button
              type="button"
              onClick={() => { battleSfx.uiClick(); setSiegeHoldAll(!ui.siegeHoldAll); }}
              data-testid="hud-siege-toggle"
              aria-pressed={ui.siegeHoldAll}
              aria-label={
                ui.siegeHoldAll
                  ? "Siege guns are silent — tap to resume bombardment"
                  : "Siege guns are firing — tap to silence them instantly"
              }
              className={`${CHIP} pointer-events-auto min-h-[44px] touch-manipulation ${
                ui.siegeHoldAll
                  ? "border-amber-300/50 bg-amber-950/60 text-amber-200"
                  : "border-orange-400/40 bg-orange-950/50 text-orange-200"
              }`}
            >
              {ui.siegeHoldAll ? "💥 Siege: OFF" : "💥 Siege: ON"}
            </button>
          )}
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
      </div>
    </>
  );
}
