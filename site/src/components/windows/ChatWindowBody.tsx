// ChatWindowBody — the chat surface as a window's content (owner 2026-10-01).
//
// Refactored from ChatSheet: the same tabs + thread + composer + keyboard
// clamp, but the WindowFrame owns the chrome (title bar, minimize, close) so
// there is no Sheet, no backdrop, no swipe-down close, no auto-close. The
// window stays open until the player closes or minimizes it.
//
// Bigger by default (owner: "bigger window so you can see chats better") —
// the frame is near-full-screen on phones.
import { useEffect, useSyncExternalStore } from "react";
import { EmptyRow } from "../ui/RowButton";
import { useT } from "../i18n/I18n";
import { ChatSurfaceTabs, surfaceLabel } from "../chat/ChatSurfaceTabs";
import { Composer } from "../chat/Composer";
import { MessageList } from "../chat/MessageList";
import {
  chatServerSnapshot,
  chatSnapshot,
  refreshChat,
  setChatSurface,
  subscribeChat,
} from "../../game/chat/chat-store";
import { patchWindow } from "../../game/windows/window-store";

/** Height of the visual viewport, in px. Set only while the keyboard can matter. */
const VV_H = "--chat-vvh";
/** How much of the layout viewport the keyboard covers, in px. */
const VV_K = "--chat-vk";

/**
 * Clamp the window to the VISUAL viewport while it is open. Same rule as the
 * old sheet: nothing inside is position:fixed, the composer is the last flex
 * child, and the variables are removed when the window closes.
 */
function useKeyboardClamp(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
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

export function ChatWindowBody({ windowId }: { windowId: string }) {
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

  // The frame's title bar names the live surface.
  useEffect(() => {
    patchWindow(windowId, { titleFallback: title });
  }, [windowId, title]);

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
    <div className="flex h-full min-h-0 flex-col">
      {sub && <p className="flex-none px-4 pt-2 text-xs text-text-3">{sub}</p>}
      <ChatSurfaceTabs value={chat.surface} onChange={setChatSurface} />
      <div
        id={`chat-panel-${chat.surface}`}
        role="tabpanel"
        aria-labelledby={`chat-tab-${chat.surface}`}
        className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3"
      >
        {body}
      </div>
      {/* The composer is the LAST flex child and exists only where a player may
          write. No fixed bar, no floating input. */}
      {chat.surface === "world" && !chat.signedOut ? <Composer /> : null}
    </div>
  );
}
