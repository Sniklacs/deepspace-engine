// ChatSheet — the chat surface as a sheet (chat-mail-spec §3.2, D3).
//
// The window (ChatWindowBody) is the surface the shell actually opens; this
// sheet renders the SAME body (`ChatSurfaceBody`, SurfacePanels.tsx) inside
// the shipped `Sheet` primitive for any surface that still mounts it, so the
// two can never drift apart. Slice A2 (2026-10-12) made all five surfaces
// live in that shared body.
//
// THE KEYBOARD RULE (§3.2) is structural: nothing inside the sheet is
// `position: fixed` — the composer is the panel column's LAST FLEX CHILD —
// and the panel is clamped from `window.visualViewport` while open.
import { useEffect, useSyncExternalStore } from "react";
import { Sheet, SheetHeader } from "../Sheet";
import { useT } from "../i18n/I18n";
import { ChatSurfaceTabs, surfaceLabel } from "./ChatSurfaceTabs";
import { ChatSurfaceBody } from "./SurfacePanels";
import {
  chatServerSnapshot,
  chatSnapshot,
  closeChat,
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
      <ChatSurfaceBody />
    </Sheet>
  );
}

export default ChatSheet;
