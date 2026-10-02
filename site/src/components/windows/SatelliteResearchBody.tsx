// SatelliteResearchBody — a satellite's research window (owner 2026-10-01).
//
// Tap a satellite on the circuit map → this window opens right there with the
// research — start/queue the climb without leaving the page, close it yourself.
// It renders the SAME SatelliteResearchCard the Lab uses: one component, two
// homes, zero drift.
import { useMemo } from "react";
import { useT } from "../i18n/I18n";
import { SatelliteResearchCard } from "../ResearchViews";
import { generateAtlas, nodeById } from "../../game/map";
import { WORLD_CONFIG_PUBLIC } from "../../game/world-config";
import type { GameState, Leader } from "../../game/types";

export function SatelliteResearchBody({ state, now, nodeId, onBeginResearch }: {
  state: GameState;
  now: number;
  nodeId: string;
  onBeginResearch: (techId: string, leaderId: string) => void;
}) {
  const t = useT();
  const circuit = useMemo(
    () => generateAtlas({ worldId: WORLD_CONFIG_PUBLIC.worldId, raceId: WORLD_CONFIG_PUBLIC.raceLock }),
    [],
  );
  const node = nodeById(circuit, nodeId);
  const freeLeaders: Leader[] = state.leaders.filter((l) => l.status === "active" && !l.assignment);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3">
      <p className="text-[11px] leading-relaxed text-gray-400">
        {t(
          "windows.satResearchIntro",
          "Restore this satellite without leaving the map. Appoint a Leader to bring it online, then climb it through stages 1–3. The window stays open until you close it.",
        )}
      </p>
      <SatelliteResearchCard
        state={state}
        now={now}
        nodeId={nodeId}
        nodeName={node?.name ?? nodeId}
        freeLeaders={freeLeaders}
        onBeginResearch={onBeginResearch}
      />
    </div>
  );
}
