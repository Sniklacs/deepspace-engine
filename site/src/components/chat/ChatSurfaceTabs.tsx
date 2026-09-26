// ChatSurfaceTabs — the five surfaces as a 44px tablist (chat-mail-spec §3.2).
//
// The roving-tabindex pattern is `SegmentedControl`'s, unchanged: role=tablist /
// role=tab / aria-selected, the active tab is the only one with tabIndex 0, arrows
// and Home/End move focus AND select. What it does NOT reuse is the segmented
// pill look: five surfaces (World · Covenant · Rooms · Personal · Mail) need an
// icon over a label, and the label floor is 11px — the smallest the catalogue is
// allowed to go — so every segment is `flex-1 min-w-[64px]` inside a horizontally
// SCROLLABLE strip. A longer Persian label then scrolls instead of squeezing the
// floor, which is the failure mode this layout exists to prevent.
//
// `surfaceLabel` is deliberately a switch with the literal key at each arm: the
// i18n gate reads call sites, so a lookup built from a variable would silently stop
// being covered (and `i18n-verify` §6 would report the keys as unused). Loud is
// better than clever here.
import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { T } from "../../game/i18n";
import { CHAT_SURFACES, type ChatSurface } from "../../game/chat/chat-types";
import { Icon, type IconName } from "../icons";
import { useT } from "../i18n/I18n";

/** The player-facing name of a surface, in the player's language and direction. */
export function surfaceLabel(t: T, surface: ChatSurface): string {
  switch (surface) {
    case "world":
      return t("chat.surface.world", "World");
    case "covenant":
      return t("chat.surface.covenant", "Covenant");
    case "rooms":
      return t("chat.surface.rooms", "Rooms");
    case "personal":
      return t("chat.surface.personal", "Personal");
    case "mail":
      return t("chat.surface.mail", "Mail");
  }
}

/** One glyph per surface, in the shell's line dialect. */
const TAB_ICON: Record<ChatSurface, IconName> = {
  world: "globe",
  covenant: "users",
  rooms: "hash",
  personal: "chat",
  mail: "mail",
};

export function ChatSurfaceTabs({
  value,
  onChange,
}: {
  value: ChatSurface;
  onChange: (surface: ChatSurface) => void;
}) {
  const t = useT();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (from: number, delta: number) => {
    const next = CHAT_SURFACES[(from + delta + CHAT_SURFACES.length) % CHAT_SURFACES.length];
    refs.current[next]?.focus();
    onChange(next);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(i, -1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      refs.current[CHAT_SURFACES[0]]?.focus();
      onChange(CHAT_SURFACES[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = CHAT_SURFACES[CHAT_SURFACES.length - 1];
      refs.current[last]?.focus();
      onChange(last);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={t("chat.surfacesAria", "Chat surfaces")}
      data-testid="chat-tabs"
      className="flex flex-none overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CHAT_SURFACES.map((s, i) => {
        const active = s === value;
        return (
          <button
            key={s}
            ref={(el) => {
              refs.current[s] = el;
            }}
            role="tab"
            id={`chat-tab-${s}`}
            data-testid={`chat-tab-${s}`}
            aria-selected={active}
            aria-controls={`chat-panel-${s}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(s)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex min-h-tap min-w-[64px] flex-1 flex-col items-center justify-center gap-0.5 px-1.5 py-1 text-[11px] font-semibold leading-none transition-colors ${
              active ? "bg-ember text-black" : "text-text-2 hover:text-text-1"
            }`}
          >
            <Icon name={TAB_ICON[s]} size={16} aria-hidden="true" />
            <span className="max-w-full truncate">{surfaceLabel(t, s)}</span>
          </button>
        );
      })}
    </div>
  );
}
