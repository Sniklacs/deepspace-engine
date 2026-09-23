// ChatDock — a RESERVED ROOM, not a feature (game-ui-shell-spec §1.6).
//
// The plan reserves a persistent bottom dock for the four-tier chat
// (World · Covenant · Rooms · PMs). v1 ships NO dock: this component renders
// nothing, `--dock-h` stays `0px`, and `.shell-body` already reserves the space
// through that variable — so when chat lands, nothing on screen moves.
// During Act I (prologue.stage === "height") the dock stays suppressed: the
// story owns the screen and the narrator must not compete with a chat bar.
export interface ChatDockProps {
  /** true while The Fall's height stands — the dock is suppressed entirely */
  suppressed?: boolean;
}

export default function ChatDock({ suppressed = false }: ChatDockProps) {
  void suppressed;
  return null;
}
