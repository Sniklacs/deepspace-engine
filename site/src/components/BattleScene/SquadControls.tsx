// SquadControls — the shared squad command UI (owner 2026-10-11).
//
// Hans: squad buttons live in an EVE window, not fixed chrome. This module
// owns the squad list + selected-squad panel so the BattleHud window and the
// fixed HUD (if any) render the same controls from the same store.

import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setSelectedSquad,
  orderReceipt,
  selectionBannerText,
  squadStanceOf,
  isSquadLinked,
  squadCoverOf,
  squadFireModeOf,
} from "../../game/war/battle-scene-ui-store";
import { fireModeGlyph } from "../../game/war/squad-command";
import { battleSfx } from "../../game/war/battle-sfx";
import { useSyncExternalStore } from "react";
import { SquadQuickPick } from "./SquadQuickPick";

export const CHIP =
  "rounded-full border px-3 py-2 text-[11px] font-semibold backdrop-blur-md transition active:scale-[0.97]";

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

export type SceneSquad = ReturnType<typeof sceneUISnapshot>["squads"][number];

/** One squad chip: name, stance glyphs, alive/total, ticking casualties. */
export function SquadChip({ sq }: { sq: SceneSquad }) {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const selected = ui.selectedSquadId === sq.id;
  // Casualties visibly add up (owner 2026-10-11): total is the ORIGINAL
  // headcount, so dead = total − alive ticks up gradually as the squad
  // bleeds. That's the number Hans watches.
  const dead = Math.max(0, sq.total - sq.alive);
  const stance = squadStanceOf(ui, sq.id, sq.hasThunders ?? false);
  // Command markers (owner 2026-10-12): bullseye = linked to a target,
  // shield = covering another squad, fire glyph = current fire discipline.
  const linked = isSquadLinked(sq.id);
  const covering = squadCoverOf(sq.id);
  const fireGlyph = fireModeGlyph(squadFireModeOf(sq.id));
  const linkedCount = (ui.squadTargets[sq.id] ?? []).length;
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
          : `${sq.name}, ${sq.alive} of ${sq.total}, ${dead} casualties${linked ? `, targeting ${linkedCount}` : ""}${covering ? ", covering" : ""}.`
      }
      className={`${CHIP} pointer-events-auto min-h-[22px] w-full touch-manipulation items-center justify-between !rounded-md !px-1.5 !py-0.5 !text-[9px] ${
        selected
          ? "border-white/70 bg-white/15 text-white"
          : linked
            ? "border-orange-400/50 bg-orange-950/40 text-orange-100"
            : sq.onCallReserve
              ? "border-sky-400/60 bg-sky-950/60 font-bold text-sky-100"
              : "border-white/15 bg-black/55 text-zinc-200"
      }`}
    >
      <span className="flex items-center">
        {linked && <span aria-hidden="true" className="mr-1" title={`Targeting ${linkedCount}`}>🎯</span>}
        {covering && <span aria-hidden="true" className="mr-1" title="Covering another squad">🛡️</span>}
        {sq.onCallReserve && <span aria-hidden="true" className="mr-1">🪂</span>}
        {sq.eyes && <span aria-hidden="true" className="mr-1">👁</span>}
        {stance.weaponsHold && <span aria-hidden="true" className="mr-1" title="Weapons hold">🔇</span>}
        {stance.holdPosition && <span aria-hidden="true" className="mr-1" title="Holding position">⚓</span>}
        {!stance.weaponsHold && squadFireModeOf(sq.id) !== "free" && (
          <span aria-hidden="true" className="mr-1" title="Fire discipline">{fireGlyph}</span>
        )}
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
}

/** The vertical squad list in command order. */
export function SquadList() {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const orderedSquads = [...ui.squads].sort((a, b) => squadRank(a.id) - squadRank(b.id));
  if (orderedSquads.length === 0) {
    return (
      <span className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1.5 text-[10px] text-zinc-500 backdrop-blur-md">
        Mustering…
      </span>
    );
  }
  return (
    <>
      {orderedSquads.map((sq) => (
        <SquadChip key={sq.id} sq={sq} />
      ))}
    </>
  );
}

/** Selected squad: banner + stance toggles + siege aim + last order + tally. */
export function SelectedSquadPanel() {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const selectedSquad = ui.squads.find((s) => s.id === ui.selectedSquadId) ?? null;
  const lastOrder = ui.orderLog[0] ?? null;
  const reserves = ui.squads.filter((s) => s.onCallReserve);
  return (
    <>
      {selectedSquad && (
        <p
          className="rounded-lg border border-white/15 bg-black/70 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-100 backdrop-blur-md"
          data-testid="hud-selection-banner"
          data-kind={selectedSquad.onCallReserve ? "hotdrop" : "order"}
          aria-live="polite"
        >
          {selectionBannerText(selectedSquad)}
        </p>
      )}
      {/* Hans 2026-10-12: the commander's quick-pick replaces the old stance
          cluster — fire control, move, cover, hold, all in one menu. */}
      {selectedSquad && <SquadQuickPick squad={selectedSquad} />}
      {lastOrder &&
        (() => {
          const r = orderReceipt(lastOrder);
          return (
            <p
              className={`max-w-full truncate rounded-lg border px-2.5 py-1 text-[10px] backdrop-blur-md ${
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
      {reserves.length > 0 && (
        <p className="text-[10px] font-semibold text-sky-300/90">
          🪂 {reserves.map((r) => r.name).join(", ")} on call — tap, then tap the map
        </p>
      )}
    </>
  );
}
