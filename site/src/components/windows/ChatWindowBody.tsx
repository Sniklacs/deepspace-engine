// ChatWindowBody — the chat surface as a window's content (owner 2026-10-01).
//
// The WindowFrame owns the chrome (title bar, minimize, close); this body is
// the surface tabs plus `ChatSurfaceBody` (chat/SurfacePanels.tsx), which
// renders every surface — World, Covenant, Rooms, Personal, Mail — and the
// composer as the column's last flex child. Slice A2 (2026-10-12) made all
// five surfaces live; A1's world-only body is history.
//
// Bigger by default (owner: "bigger window so you can see chats better") —
// the frame is near-full-screen on phones.
import { useEffect, useSyncExternalStore } from "react";
import { useT } from "../i18n/I18n";
import { ChatSurfaceTabs, surfaceLabel } from "../chat/ChatSurfaceTabs";
import { ChatSurfaceBody } from "../chat/SurfacePanels";
import {
  chatServerSnapshot,
  chatSnapshot,
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {sub && <p className="flex-none px-4 pt-2 text-xs text-text-3">{sub}</p>}
      <ChatSurfaceTabs value={chat.surface} onChange={setChatSurface} />
      <ChatSurfaceBody />
    </div>
  );
}
