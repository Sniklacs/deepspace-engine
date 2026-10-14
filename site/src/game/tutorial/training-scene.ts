// TRAINING SCENE — the guided first battle's muster. This is the game's own
// demo scene (battle-scene-model.buildDemoScene — the same synthetic battle
// the Arena's practice view runs on the real engine), re-mustered for
// teaching. Nothing here forks the engine: it is the demo scene object with
// its unit table adjusted, the way a drill instructor stacks a deck.
//
// Adjustments, and why:
//   · Attacker waves arrive at teaching pace (MAIN/FLANK inside seconds,
//     REAR at 20 sim-seconds) instead of the demo's full battle timing —
//     a lesson cannot wait ten wall-minutes for its subject to arrive.
//   · The RESERVE stays embarked and on call with a far-off auto-entry, so
//     the hot-drop lesson belongs to the player's hand, not the timer.
//   · The defending garrison fights at half strength (hp01 × 0.5): the
//     brief is a FORGIVING battle — survivable first, always (the same
//     principle as the prologue's §12.3). The Chorus still shoots back;
//     lessons about flinch and commitment need real fire, just not a
//     execution.
import { buildDemoScene, type SceneBattle } from "../war/battle-scene-model";
import type { ManeuverVector } from "../war/war-types";

const ATTACKER_ENTER_AT_S: Partial<Record<ManeuverVector, number>> = {
  MAIN: 4,
  FLANK_LEFT: 7,
  FLANK_RIGHT: 9,
  REAR: 20,
  // RESERVE deliberately absent: it waits for the commander's tap.
};
const RESERVE_AUTO_ENTER_S = 3600;

export function buildTrainingScene(nowMs: number): SceneBattle {
  const demo = buildDemoScene(nowMs);
  const units = demo.units.map((u) => {
    if (u.side === "defender") {
      return { ...u, hp01: Math.max(0.1, u.hp01 * 0.5) };
    }
    if (u.vector === "RESERVE") {
      return { ...u, enterAtS: RESERVE_AUTO_ENTER_S, onCall: true };
    }
    const enterAtS = ATTACKER_ENTER_AT_S[u.vector];
    return enterAtS !== undefined ? { ...u, enterAtS } : u;
  });
  return {
    ...demo,
    id: "guided-first-battle",
    name: "Guided first battle — Muster Flats",
    tier: "Guided",
    units,
    troops: { attacker: demo.troops.attacker, defender: Math.round(demo.troops.defender / 2) },
  };
}
