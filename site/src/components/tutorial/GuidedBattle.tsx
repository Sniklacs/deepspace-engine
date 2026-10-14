// GUIDED BATTLE — Act One, mounted. The training scene (the game's own
// demo muster, re-stacked forgiving — see game/tutorial/training-scene.ts)
// plays on the REAL battle scene, full screen, exactly as a live battle
// does. The lesson card rides at the lower-left; the battle observer folds
// the scene's shared UI store into tutorial-bus events, so a step advances
// only when the player truly did the thing — selected the squad, gave the
// order the judge accepted, set the cover, focused the troop, took the
// helm.
//
// Exits, per the Exit Law: the scene's own ✕ leaves the battle (and ends
// the run, progress kept). The card's Leave ends only the LESSONS — the
// scene stays open as free-play practice, because leaving a teacher must
// never eject a player from a fight they chose to be in.
import { useEffect, useMemo } from "react";
import { BattleSceneFullscreen } from "../BattleScene/BattleSceneFullscreen";
import type { CrewMember } from "../../game/war/battle-scene-ui-store";
import { sceneUISnapshot, subscribeSceneUI } from "../../game/war/battle-scene-ui-store";
import { noteTutEvent } from "../../game/tutorial/framework";
import { eventsFromSceneSnapshots } from "../../game/tutorial/battle-observer";
import { buildTrainingScene } from "../../game/tutorial/training-scene";
import { closeGuidedBattle, useTutorial } from "../../game/tutorial/ui-store";
import TutorialCard from "./TutorialCard";

export default function GuidedBattle({
  crew,
  attackerRace,
  defenderRace,
}: {
  crew?: CrewMember[];
  attackerRace?: string | null;
  defenderRace?: string | null;
}) {
  const scene = useMemo(() => buildTrainingScene(Date.now()), []);
  const { cardOpen } = useTutorial();

  useEffect(() => {
    let prev = sceneUISnapshot();
    return subscribeSceneUI(() => {
      const next = sceneUISnapshot();
      const events = eventsFromSceneSnapshots(prev, next);
      prev = next;
      for (const ev of events) noteTutEvent(ev);
    });
  }, []);

  return (
    <>
      <BattleSceneFullscreen
        scene={scene}
        onClose={closeGuidedBattle}
        crew={crew}
        attackerRace={attackerRace}
        defenderRace={defenderRace ?? "watchers"}
      />
      {cardOpen && (
        <div className="fixed bottom-3 left-3 z-[130] w-[min(92vw,380px)]" data-testid="guided-battle-card">
          <TutorialCard />
        </div>
      )}
    </>
  );
}
