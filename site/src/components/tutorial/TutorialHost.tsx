// TUTORIAL HOST — mounted once in the /play shell (and on the founding
// screens). Renders whatever the school currently needs: the guided battle
// scene when the battle act is open, otherwise the floating lesson card
// riding over the game while the player does the steps on the real pages.
// With no run active it renders nothing — the school never nags uninvited.
import { useEffect, useRef } from "react";
import type { CrewMember } from "../../game/war/battle-scene-ui-store";
import { noteTutEvent } from "../../game/tutorial/framework";
import { useTutorial } from "../../game/tutorial/ui-store";
import GuidedBattle from "./GuidedBattle";
import TutorialCard from "./TutorialCard";

export default function TutorialHost({
  crew,
  attackerRace,
  defenderRace,
  currentTab,
}: {
  crew?: CrewMember[];
  attackerRace?: string | null;
  defenderRace?: string | null;
  /** the shell's current page — when a run starts, the page the player is
   *  already standing on counts as visited (they shouldn't have to leave
   *  and come back to satisfy a "go to" step). */
  currentTab?: string;
}) {
  const { run, battleOpen, cardOpen } = useTutorial();
  const startedActRef = useRef<string | null>(null);
  useEffect(() => {
    const actId = run && run.status === "active" ? run.actId : null;
    if (actId && startedActRef.current !== actId) {
      startedActRef.current = actId;
      if (currentTab) noteTutEvent({ name: "tab", orderKind: currentTab });
    }
    if (!actId) startedActRef.current = null;
  }, [run, currentTab]);
  if (battleOpen) {
    return <GuidedBattle crew={crew} attackerRace={attackerRace} defenderRace={defenderRace} />;
  }
  if (run && cardOpen) {
    return (
      <div className="fixed bottom-3 left-3 z-[120] w-[min(92vw,380px)]" data-testid="tutorial-card-float">
        <TutorialCard />
      </div>
    );
  }
  return null;
}
