// ModuleOverlay — PHASE 2, slice 11: the module overlay pattern (spec §10).
//
// Tapping a building inside the Cradle (INSIDE band) opens its module as an
// OVERLAY over the live world — the world canvas never unmounts, never
// reloads, never shows a loading screen (the one hard rule of the spec).
// Per §2, sheets never hide the world: the overlay is a bottom sheet and
// the canvas keeps rendering live behind/around it.
//
// URL sync goes through the history API (?module=<id>), not the router:
// opening pushes exactly one entry (the back button closes the overlay),
// switching modules replaces, closing strips the param. Back/forward stay
// sane: back closes, forward re-opens. The overlay state machine lives in
// game/world/cradle-entry.ts (ENTER_MODULE/CLOSE_MODULE); this file is the
// host + the pure URL helpers. WorldGlobe owns the wiring.
//
// DOCUMENTED LIMITATION: a cold load of /play?module=troops lands on the
// /play route with its default tab — the world tab (and its canvas) is not
// mounted, so the param is inert until the player opens the world view.
// Full deep-link restore (world tab + entry flow + overlay from a bare URL)
// needs play.tsx tab/URL wiring, which is outside this slice's scope.

import { useT } from "./i18n/I18n";
import type { GameState } from "../game/types";
import {
  CRADLE_MODULES,
  isCradleModuleId,
  type CradleModuleId,
} from "../game/world/cradle-entry";

/** Display labels for the overlay modules (the buildings of the Cradle). */
export const CRADLE_MODULE_LABEL: Record<CradleModuleId, string> = {
  troops: "Barracks",
  forge: "Forge",
  laboratory: "Laboratory",
  loadout: "Loadout Grounds",
  alliance: "Alliance Hall",
  warroom: "War Room",
};

export function cradleModuleLabel(id: CradleModuleId): string {
  return CRADLE_MODULE_LABEL[id];
}

/** The URL search param carrying the open module. */
export const MODULE_PARAM = "module";

/** Read ?module= from a URL string. Null when absent or unknown. Pure. */
export function readModuleParam(url: string): CradleModuleId | null {
  try {
    const m = new URL(url).searchParams.get(MODULE_PARAM);
    return m !== null && isCradleModuleId(m) ? m : null;
  } catch {
    return null;
  }
}

/** Return the URL with ?module= set — or stripped when module is null.
// Preserves every other param, the path, and the hash. Pure. */
export function withModuleParam(url: string, module: CradleModuleId | null): string {
  const u = new URL(url);
  if (module) u.searchParams.set(MODULE_PARAM, module);
  else u.searchParams.delete(MODULE_PARAM);
  return u.toString();
}

/** All module ids, for the INSIDE panel's building grid. */
export function cradleModuleIds(): readonly CradleModuleId[] {
  return CRADLE_MODULES;
}

function OverlayStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{k}</div>
      <div className="text-[13px] font-semibold text-gray-100">{v}</div>
    </div>
  );
}

/**
 * The module overlay host. Renders the open module as a bottom sheet over
 * the live world canvas (sibling of the canvas — the canvas is never
 * touched). Content is a PLACEHOLDER for this slice: live colony stats
 * reused from GameState, marked as such — the full modules re-home here
 * in later slices without rewriting their logic.
 */
export function ModuleOverlay({
  module,
  state,
  onClose,
}: {
  module: CradleModuleId;
  state: GameState;
  onClose: () => void;
}) {
  const t = useT();
  const supplies = state.resources?.supplies ?? 0;
  const embers = state.resources?.embers ?? 0;
  const energy = state.energy ?? 0;

  return (
    <div
      role="dialog"
      aria-label={cradleModuleLabel(module)}
      className="absolute inset-x-0 bottom-0 z-30 max-h-[78%] overflow-y-auto rounded-t-2xl border-t border-sky-300/40 bg-[#0a0d18]/95 backdrop-blur-md"
      style={{ boxShadow: "0 -12px 48px rgba(56,189,248,0.25)" }}
    >
      <div className="flex justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("moduleoverlay.close", "Close module")}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-base text-white"
      >
        ✕
      </button>

      <div className="px-4 pb-6 pt-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-sky-300">
          {t("moduleoverlay.kicker", "Module overlay")}
        </p>
        <h3 className="mt-0.5 text-[17px] font-bold leading-tight text-white">
          {cradleModuleLabel(module)}
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          {t(
            "moduleoverlay.preview",
            "PREVIEW — the full module re-homes here in a later slice. The world stays live behind this panel; the back button (or ✕) closes it.",
          )}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <OverlayStat k={t("moduleoverlay.supplies", "Supplies")} v={supplies.toLocaleString()} />
          <OverlayStat k={t("moduleoverlay.embers", "Embers")} v={embers.toLocaleString()} />
          <OverlayStat k={t("moduleoverlay.energy", "Energy")} v={`${energy}`} />
        </div>
      </div>
    </div>
  );
}
