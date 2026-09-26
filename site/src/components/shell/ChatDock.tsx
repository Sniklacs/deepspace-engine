// ChatDock — the 44px persistent chat bar (chat-mail-spec §3.1, D3).
//
// It replaces the v1 stub that rendered nothing. The room was already reserved:
// `.shell-body` subtracts `var(--dock-h, 0px)`, so until something assigns
// `--dock-h` the layout pays nothing. This component assigns it — once, on the
// document root, while the bar is really on screen — and removes it again when
// the bar goes away (Act I's height, or a screen the shell does not frame). The
// RESERVED ROOM is therefore filled by the bar that pays for it: nothing on
// screen moves when the bar appears, and nothing is left empty when it doesn't.
//
// THREE THINGS THIS BAR IS NOT, all of them deliberate:
//   • it is NOT a nav tab and does not join `NAV_IDS` (the nav is navigation;
//     this is a conversation);
//   • its chip is NOT a nav badge — `nav-badges.ts` keeps its contract ("an
//     action is available here"), and the two counters never share a signal;
//   • it never carries the Chorus alarm. The alarm lives in the ribbon, and
//     `reportOpen`'s bell is a third, separate thing (D14).
//
// AND ONE THING IT HONESTLY CANNOT DO YET: in A1 only the World surface is live,
// and World is never counted (D11). So the chip reads 0 today even though the
// plumbing under it is real; A2's Personal, joined Rooms and Mail are what put a
// number here. A zero chip is not rendered at all — "nothing new" is stated by
// the bar's own label, never by a "0".
import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "../icons";
import { useLang, useT } from "../i18n/I18n";
import { surfaceLabel } from "../chat/ChatSurfaceTabs";
import { Bdi } from "../ui/Bdi";
import { formatNumber } from "../../game/i18n/format";
import {
  chatChip,
  chatServerSnapshot,
  chatSnapshot,
  openChat,
  setDockVisible,
  subscribeChat,
} from "../../game/chat/chat-store";

export interface ChatDockProps {
  /** true while The Fall's height stands — the dock is suppressed entirely */
  suppressed?: boolean;
}

/** The CSS variable `.shell-body` (and the toast) read to reserve the bar's room. */
const DOCK_H = "--dock-h";

export default function ChatDock({ suppressed = false }: ChatDockProps) {
  const t = useT();
  const lang = useLang();
  const chat = useSyncExternalStore(subscribeChat, chatSnapshot, chatServerSnapshot);

  // The poll's first gate (D8): the store polls only while the bar is on screen.
  // A suppressed dock is not on screen, so it must not keep the poll alive.
  useEffect(() => {
    setDockVisible(!suppressed);
    return () => setDockVisible(false);
  }, [suppressed]);

  // The reserved room (D3/§2). `--dock-h` is assigned HERE and nowhere else, and
  // it is removed on the way out so a suppressed dock leaves no gap behind it.
  useEffect(() => {
    const root = document.documentElement;
    if (suppressed) {
      root.style.removeProperty(DOCK_H);
      return;
    }
    root.style.setProperty(DOCK_H, "var(--spacing-dock)");
    return () => {
      root.style.removeProperty(DOCK_H);
    };
  }, [suppressed]);

  if (suppressed) return null;

  // Priority order Personal → Mail → Rooms, and World/Covenant can never appear
  // in it (unreadChip enforces that structurally). With nothing unread the label
  // is the last surface the player opened.
  const chip = chatChip();
  const surface = chip.surface ?? chat.lastSurface;
  const name = surfaceLabel(t, surface);
  const count = formatNumber(lang, chip.n);
  // `{n}` and `{surface}` are both values this app computed — never a name typed
  // by a player — so the sentence reads correctly in all five languages and the
  // digit is the Latin one the formatter pinned.
  const label =
    chip.n > 0
      ? t("chat.barNew", "Chat — {surface}, {n} new", { surface: name, n: count })
      : t("chat.barClear", "Chat — {surface}, nothing new", { surface: name });

  return (
    <button
      type="button"
      data-testid="chat-dock-bar"
      aria-haspopup="dialog"
      aria-label={label}
      onClick={() => openChat()}
      className="fixed inset-x-0 bottom-[calc(var(--spacing-nav)+var(--safe-inset-bottom))] z-40 flex h-dock min-h-tap w-full items-center gap-2 border-t border-line-strong bg-surf-1/95 px-3 text-start backdrop-blur-sm"
    >
      <Icon name="chat" size={16} aria-hidden="true" className="shrink-0 text-text-3" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">{name}</span>
      {chip.n > 0 ? (
        <Bdi
          dir="ltr"
          className="num shrink-0 rounded-full bg-ember/20 px-2 py-0.5 text-[11px] font-semibold text-ember-soft"
        >
          {count}
        </Bdi>
      ) : null}
    </button>
  );
}
