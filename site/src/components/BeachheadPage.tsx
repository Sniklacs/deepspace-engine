// ============================================================================
// BEACHHEAD PAGE — the wide war on its own full-screen stage
// (design/beachhead-layout-2026-10-15.md §6, Slice 1).
//
// One module, one page (owner doctrine): the beachhead used to live as a
// 440px card buried in the Battles tab, and the WorldGlobe's beachhead
// marker was a dead end. Slice 1 gives it a place of its own — a
// full-screen stage on the CircuitPage pattern (100dvh, its own slim
// chrome, ◀ Return to the Cradle) — hosting the existing BeachheadView
// wide view at stage size. No mechanics change here: same camera, same
// garrison/assault/relieve orders, same model. The field, presence, and
// shared-state work are later slices of the same layout.
//
// EXIT LAW: the header's Return is a visible ≥44px exit back to the
// Cradle, always on screen; the view's own panel ✕ rides along inside.
// ============================================================================
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import BeachheadView from "./BeachheadView";
import { useT } from "./i18n/I18n";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

export default function BeachheadPage({
  state,
  now,
  token,
  onAction,
  onClose,
}: {
  state: GameState;
  now: number;
  token?: string;
  onAction?: Act;
  /** ◀ Return — play.tsx switches back to the Cradle tab (and restores
   *  focus to the Beachhead nav button, the CircuitPage pattern). */
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      className="flex h-screen flex-col bg-surf-0 text-gray-200"
      style={{ height: "100dvh" }}
      data-testid="beachhead-page"
    >
      {/* slim stage chrome — 56px, surf-1, always on screen (Exit Law) */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surf-1 px-2 md:px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("beachhead.returnToCradle", "Return to the Cradle")}
          title={t("beachhead.returnToCradle", "Return to the Cradle")}
          className="flex h-11 min-w-11 flex-none items-center justify-center gap-1.5 rounded-lg px-2 text-text-2 hover:bg-white/10"
        >
          <span aria-hidden="true">◀</span>
          <span className="hidden text-sm font-medium md:inline">
            {t("beachhead.returnToCradleShort", "Return to Cradle")}
          </span>
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight text-text-1">
            {t("beachhead.pageTitle", "THE BEACHHEAD")}
          </h1>
          <p className="truncate text-sm leading-tight text-text-3">
            {t("beachhead.pageSub", "The wide war — the whole front, on its own stage")}
          </p>
        </div>
      </header>

      {/* the stage: the wide view at full size, scrolling only if the
          bunker panel pushes past the fold on small screens */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-y-auto">
        <BeachheadView state={state} now={now} token={token} onAction={onAction} variant="page" />
      </div>
    </div>
  );
}
