// BattleSceneFullscreen — the full-screen battle scene (owner 2026-10-05).
//
// "Watch practice battle" in the Arena tab's Proving ground section opens
// the scene FULL SCREEN: the tactical canvas fills the viewport edge to
// edge, with only a slim SceneHeader overlay and one small Controls button.
// The control deck lives in the floating glass "battle-controls" window,
// summoned by the Controls button and dismissed by tapping it again (or the
// window's ×). Unmounting closes the controls window so no glass is left
// floating over the Arena.

import { useEffect, useRef } from "react";
import { BattleScene } from "./BattleScene";
import { closeWindowsOfKind } from "../../game/windows/window-store";
import type { CrewMember } from "../../game/war/battle-scene-ui-store";
import type { SceneBattle } from "../../game/war/battle-scene-model";
import type { SavedFormation, SlotLoads } from "../../game/war/playbook";
import type { CompactReplay } from "../../game/war/battle-replays";

export interface FormationDraft {
  name: string;
  playId: string;
  loads: SlotLoads;
  slotMeta?: SavedFormation["slotMeta"];
  replayId?: string;
}

export interface DoctrineDraft {
  name: string;
  playId: string;
  loads: SlotLoads;
  slotMeta?: SavedFormation["slotMeta"];
  replay?: CompactReplay;
  battleName: string;
  victor: "attacker" | "defender" | null;
  durationS: number;
  killsAttacker: number;
  killsDefender: number;
}

export function BattleSceneFullscreen({
  scene,
  onClose,
  onSaveFormation,
  onSaveDoctrine,
  crew,
  attackerRace,
  defenderRace,
  liveCasualties,
}: {
  scene: SceneBattle;
  onClose: () => void;
  onSaveFormation?: (draft: FormationDraft) => void;
  onSaveDoctrine?: (draft: DoctrineDraft) => void;
  /** the player's heroes — the cockpit's bridge crew (owner 2026-10-12) */
  crew?: CrewMember[];
  /** the two sides' races — per-race directional unit sprites (owner 2026-10-12) */
  attackerRace?: string | null;
  defenderRace?: string | null;
  /**
   * The live Battle entity's losses so far (owner 2026-10-13, drop-in
   * audit): the embedded scene in BattlesTab already matched its
   * casualties to the entity — the fullscreen helm silently ran its own
   * local curve instead, so taking the helm full-screen showed a
   * DIFFERENT war than the one the engine is resolving. Forwarded
   * straight through so both views of a battle agree.
   */
  liveCasualties?: { attacker: number; defender: number } | null;
}) {
  // IN-HOUSE NAVIGATION (Exit Law corollary, owner 2026-10-13): the
  // battle opens as component state inside the /play route, so the
  // browser's own back button used to eject the player ALL the way to
  // the landing page — one press, whole session gone. The scene now owns
  // one history entry: mount pushes it (preserving the router's own
  // state fields), a browser back lands on it and simply EXITS THE
  // BATTLE — one back-step, one in-game step — and an in-game exit
  // consumes the entry again on the way out so the stack stays honest.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    let exitedViaBack = false;
    const onPopState = () => {
      exitedViaBack = true;
      onCloseRef.current();
    };
    try {
      window.history.pushState(
        { ...(window.history.state ?? {}), unboundBattleScene: true },
        "",
      );
      window.addEventListener("popstate", onPopState);
    } catch {
      /* history unavailable (SSR/embedded webview) — the in-game exits
         still work; only the back-button courtesy is lost. */
    }
    // BattleScene itself opens the squads window on mount and closes it on
    // unmount; the controls window is fullscreen-only chrome here.
    return () => {
      try {
        window.removeEventListener("popstate", onPopState);
        if (!exitedViaBack) window.history.back();
      } catch {
        /* ignore — nothing to consume */
      }
      closeWindowsOfKind("battle-controls");
      closeWindowsOfKind("battle-squads");
    };
  }, []);

  return <BattleScene scene={scene} variant="fullscreen" onClose={onClose} onSaveFormation={onSaveFormation} onSaveDoctrine={onSaveDoctrine} crew={crew} attackerRace={attackerRace} defenderRace={defenderRace} liveCasualties={liveCasualties} />;
}
