// BattleSceneFullscreen — the full-screen battle scene (owner 2026-10-05).
//
// "Watch practice battle" in the Arena tab's Proving ground section opens
// the scene FULL SCREEN: the tactical canvas fills the viewport edge to
// edge, with only a slim SceneHeader overlay and one small Controls button.
// The control deck lives in the floating glass "battle-controls" window,
// summoned by the Controls button and dismissed by tapping it again (or the
// window's ×). Unmounting closes the controls window so no glass is left
// floating over the Arena.

import { useEffect } from "react";
import { BattleScene } from "./BattleScene";
import { closeWindowsOfKind } from "../../game/windows/window-store";
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
}: {
  scene: SceneBattle;
  onClose: () => void;
  onSaveFormation?: (draft: FormationDraft) => void;
  onSaveDoctrine?: (draft: DoctrineDraft) => void;
}) {
  useEffect(() => {
    return () => {
      closeWindowsOfKind("battle-controls");
    };
  }, []);

  return <BattleScene scene={scene} variant="fullscreen" onClose={onClose} onSaveFormation={onSaveFormation} onSaveDoctrine={onSaveDoctrine} />;
}
