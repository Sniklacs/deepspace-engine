// AppShell — the game's frame: ribbon (sticky top) · screen body · bottom nav.
//
// game-ui-shell-spec §1.1 (the skeleton) with ONE deliberate structural note:
// the `<main>` element stays inside each screen (the shell's body region is the
// `#screen` wrapper), so there is exactly one `<main>` per screen and never a
// `<main>` inside a `<main>`. Everything else is the spec's skeleton:
//
//   • the ribbon is `sticky` (never auto-hiding) and the nav is `fixed`;
//   • `.shell-body` reserves nav + dock + safe-area + 16px, so NO in-flow
//     element — least of all The Fall's narration plate — can ever be parked
//     under the nav (that is what makes §8.1 structural, not a promise);
//   • the body never scrolls horizontally (`overflow-x: clip` on `.app-shell`);
//   • the chat dock's room is reserved by `--dock-h` (0px today) and the dock
//     renders nothing in v1 (§1.6);
//   • one navigation, ever: this replaced the old web header in the same commit.
import type { ReactNode } from "react";
import Ribbon from "./Ribbon";
import BottomNav from "./BottomNav";
import ChatDock from "./ChatDock";
import { WindowHost, type WindowCtx } from "../windows/WindowHost";
import type { Tab } from "../../game/nav-slots";
import type { NavBadge } from "../../game/nav-badges";
import type { GameState } from "../../game/types";
import { useT } from "../i18n/I18n";
import type { GameResult } from "../../game/api";
import FloatingHelpButton from "../FloatingHelp";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

export default function AppShell({
  state,
  tab,
  isWide = false,
  unread,
  busy = false,
  badges,
  onSwitch,
  onIdentity,
  onLedger,
  onReports,
  onMailbox,
  onOpenStores,
  onAlertGo,
  children,
  windowCtx,
  token,
  onAction,
}: {
  state: GameState;
  tab: Tab;
  /** `data-shell-layout` switch (§7) — the wide case is CSS-only, not this slice */
  isWide?: boolean;
  unread: number;
  busy?: boolean;
  badges: Record<string, NavBadge>;
  onSwitch: (t: Tab) => void;
  onIdentity: () => void;
  onLedger: () => void;
  onReports: () => void;
  /** opens the mailbox sheet (owner 2026-10-03) */
  onMailbox: () => void;
  onOpenStores: () => void;
  onAlertGo: () => void;
  children: ReactNode;
  /**
   * The window framework's game context (owner 2026-10-01): EVE-style windows
   * mount here, in the frame, so they survive tab switches and route changes.
   * Windows never auto-close — the store is the truth.
   */
  windowCtx?: WindowCtx | null;
  /** auth token for the floating help button's one-tap actions */
  token?: string;
  /** server-action poster for the floating help button */
  onAction?: Act;
}) {
  const t = useT();
  return (
    <div className="app-shell" data-shell-layout={isWide ? "wide" : "phone"}>
      {/* First focusable node (§3.6): straight to the screen, past the chrome. */}
      <a
        href="#screen"
        className="sr-only rounded-xl border border-line bg-surf-2 px-3 py-2 text-[13px] text-text-1 focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-[80]"
      >
        {t("app.skipToCradle")}
      </a>
      <Ribbon
        state={state}
        unread={unread}
        busy={busy}
        onIdentity={onIdentity}
        onLedger={onLedger}
        onReports={onReports}
        onMailbox={onMailbox}
        onOpenStores={onOpenStores}
        onAlertGo={onAlertGo}
      />
      <div id="screen" className="shell-body">
        {children}
      </div>
      {/* The chat dock, in the stack the layout reserved for it: screen body,
          44px bar, nav. Its room is paid for by `--dock-h` (set by the bar
          itself), so it moves nothing — and during The Fall's height it is
          suppressed entirely: the story owns the screen, and a chat bar must not
          compete with the narrator (game-ui-shell-spec §1.6). */}
      <ChatDock suppressed={state.prologue?.stage === "height"} />
      <BottomNav tab={tab} onSwitch={onSwitch} badges={badges} />
      {/* ATLAS (Hans Oct 11 2026): a floating globe button on every scene —
          one tap jumps to the world map from anywhere. Hidden on the world
          tab itself, where you're already there.
          STACK DISCIPLINE (owner 2026-10-14 — the dead-exit fix): the right
          column above the nav is a STACK, and this button owns the band
          above the help FAB (nav+16 … +72) and the window tray
          (nav+dock+8 … ~+44): bottom = nav + dock + 52px clears both for
          every state of the other floaters, so the Atlas can never be
          painted over by a sibling at the same z-index again. It sat at
          bottom-24 (96px) — dead center under the help button's box
          (80–136px), which renders later in this frame and won the tap. */}
      {tab !== "world" && (
        <button
          type="button"
          onClick={() => onSwitch("world")}
          aria-label={t("app.atlas", "Atlas — open the world map")}
          title={t("app.atlas", "Atlas — open the world map")}
          data-testid="atlas-fab"
          style={{ bottom: "calc(var(--spacing-nav) + var(--dock-h, 0px) + env(safe-area-inset-bottom, 0px) + 52px)" }}
          className="fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/40 bg-[#141007]/90 text-2xl shadow-lg backdrop-blur-sm active:scale-95"
        >
          <span aria-hidden>🌍</span>
        </button>
      )}
      {/* The window layer — above nav/dock, below toasts. Mounted in the frame
          so windows outlive tab switches and route changes. */}
      <WindowHost ctx={windowCtx ?? null} />
      {/* The global 🤝 (owner 2026-10-02): always visible when alliance mates
          can use help ticks or a distress beacon is up — on every tab. */}
      {onAction && (
        <FloatingHelpButton state={state} token={token} onAction={onAction} />
      )}
    </div>
  );
}
