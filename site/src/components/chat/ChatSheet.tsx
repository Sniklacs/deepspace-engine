// ChatSheet — the chat surface (chat-mail-spec §3.2, D3).
//
// A 85vh `Sheet` (the SHIPPED primitive — not a second modal, and not the 300px
// push-panel the shell spec once proposed: five tabs + a thread + a composer +
// a keyboard do not fit in 300px). This file owns the VIEW STATE and nothing
// else: it reads the chat store, says which surface is on screen, and hands the
// scrolling region to `MessageList` and the input line to `Composer`. There is no
// message data here, no fetch here and no rule here.
//
// THE KEYBOARD RULE (§3.2) is the most likely defect on the phones this beta
// targets, so it is structural rather than hopeful:
//   • nothing inside the sheet is `position: fixed` — the composer is the LAST
//     FLEX CHILD, so it rides the panel's own box;
//   • the panel is clamped from `window.visualViewport`, guarded — where the API
//     is absent (or there is no keyboard) nothing is set and the CSS falls back
//     to the shipped 85vh/bottom:0;
//   • the lift (`--chat-vk`) is the part of the layout viewport the keyboard
//     covers. Both variables exist only while this sheet is open, so no other
//     sheet inherits them.
import { useEffect, useSyncExternalStore } from "react";
import { Sheet, SheetHeader } from "../Sheet";
import { EmptyRow } from "../ui/RowButton";
import { useT } from "../i18n/I18n";
import { ChatSurfaceTabs, surfaceLabel } from "./ChatSurfaceTabs";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import {
  chatServerSnapshot,
  chatSnapshot,
  closeChat,
  refreshChat,
  setChatSurface,
  subscribeChat,
} from "../../game/chat/chat-store";

/** Height of the visual viewport, in px. Set only while the keyboard can matter. */
const VV_H = "--chat-vvh";
/** How much of the layout viewport the keyboard covers, in px. */
const VV_K = "--chat-vk";

/**
 * Clamp the sheet to the VISUAL viewport while it is open (§3.2). Guarded twice:
 * no `visualViewport` (older Safari, a server render) is a no-op, and the
 * variables are removed on close so the next sheet is untouched.
 */
function useKeyboardClamp(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return; // no API: the shipped 85vh layout stands, nothing is faked
    const root = document.documentElement;
    const apply = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      root.style.setProperty(VV_H, `${Math.round(vv.height)}px`);
      root.style.setProperty(VV_K, `${Math.round(covered > 0 ? covered : 0)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty(VV_H);
      root.style.removeProperty(VV_K);
    };
  }, [active]);
}

export function ChatSheet() {
  const t = useT();
  const chat = useSyncExternalStore(subscribeChat, chatSnapshot, chatServerSnapshot);
  useKeyboardClamp(chat.open);

  const title = surfaceLabel(t, chat.surface);
  const sub =
    chat.surface === "world"
      ? t("chat.world.sub", "Everyone on this world")
      : chat.surface === "covenant"
        ? t("chat.covenant.sub", "Your Covenant's channel")
        : undefined;

  // The World surface is the ONE live channel in A1 (the store says so plainly).
  // The other four render an honest state, never a fake channel: Covenant is a
  // lock that waits for a Covenant SYSTEM to exist (D1), and Rooms, Personal and
  // Mail are the surfaces slice A2 mounts. "Opens later" is the whole truth.
  const body = chat.signedOut ? (
    <EmptyRow icon="chat" text={t("chat.loggedOut", "Sign in to talk with your world.")} />
  ) : chat.surface === "world" ? (
    <MessageList
      messages={chat.messages}
      me={chat.me}
      phase={chat.phase}
      errorText={chat.errorKey === "chat.loadFailed" ? t("chat.loadFailed", "The channel did not load.") : null}
      retryText={t("chat.retry", "Try again")}
      openingText={t("chat.opening", "Opening the channel…")}
      onRetry={() => void refreshChat()}
      emptyText={t("chat.world.empty", "The world channel is quiet. Say the first thing.")}
    />
  ) : chat.surface === "covenant" ? (
    <EmptyRow icon="users" text={t("chat.covenant.none", "You are not in a Covenant yet. This channel opens the day you join one.")} />
  ) : (
    <EmptyRow icon="hash" text={t("chat.locked", "Opens later")} />
  );

  return (
    <Sheet
      open={chat.open}
      onClose={closeChat}
      labelledBy="chat-sheet-title"
      title={title}
      panelClass="chat-sheet-panel"
    >
      <SheetHeader id="chat-sheet-title" title={title} subtitle={sub} onClose={closeChat} />
      <ChatSurfaceTabs value={chat.surface} onChange={setChatSurface} />
      <div
        id={`chat-panel-${chat.surface}`}
        role="tabpanel"
        aria-labelledby={`chat-tab-${chat.surface}`}
        className="sheet-body flex min-h-0 flex-col gap-3 px-4 py-3"
      >
        {body}
      </div>
      {/* The composer is the LAST flex child and exists only where a player may
          write (§3.2). No fixed bar, no floating input. */}
      {chat.surface === "world" && !chat.signedOut ? <Composer /> : null}
    </Sheet>
  );
}

export default ChatSheet;
