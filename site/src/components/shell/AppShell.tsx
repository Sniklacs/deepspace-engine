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
import type { Tab } from "../../game/nav-slots";
import type { NavBadge } from "../../game/nav-badges";
import type { GameState } from "../../game/types";
import { useT } from "../i18n/I18n";

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
  onOpenStores,
  onAlertGo,
  children,
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
  onOpenStores: () => void;
  onAlertGo: () => void;
  children: ReactNode;
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
    </div>
  );
}
