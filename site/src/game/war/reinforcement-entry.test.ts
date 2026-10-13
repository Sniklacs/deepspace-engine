// reinforcement-entry.test.ts — pins for the reinforcement-entry repair
// (owner 2026-10-13, the battle-critical bug of the day).
//
// The chain that was broken, end to end:
//   1. buildUnits never set `onCall` on the RESERVE (DemoSpec had no such
//      field) → the reserve never read as deployable, and the hot-drop
//      branch's staging filter was always empty. (Pure behavior pinned in
//      battle-scene-model.test.ts + scene-orders.test.ts.)
//   2. Accepted move orders on staging squads were stamped but the entry
//      appointment (enterAtS 300/480 sim-s away) never moved — the tracer
//      drew, the wave never came. issueOrder now releases the squad via
//      releaseStagingSquad in its accepted path.
//   3. The hold-position gate refused the rear wave's order outright —
//      a thunder squad holds by default, and the gate ran before the
//      call-in could. A squad entirely in staging is now exempt: its
//      order IS its call-in.
//   4. The staging gate held ON-CALL units under Manual command — the
//      Chorus reserve included. On-call staging is the player's side
//      only now.
//
// Points 2–4 live inside the BattleScene component; following the
// exit-law.test.ts precedent they are pinned here as source contracts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const scene = readFileSync(
  join(HERE, "../../components/BattleScene/BattleScene.tsx"),
  "utf-8",
);
const has = (needle: string) => scene.includes(needle);

describe("reinforcement entry — BattleScene wiring pins", () => {
  test("an accepted order on a staging squad releases its entry", () => {
    expect(has("releaseStagingSquad(squadUnits, simTRef.current)")).toBe(true);
  });

  test("the hold-position gate exempts a squad entirely in staging", () => {
    expect(has('const entirelyStaging = squadUnits.length > 0 && squadUnits.every((u) => u.state === "staging");')).toBe(true);
    expect(has("if (!entirelyStaging && squadStanceOf(sceneUISnapshot(), squadId, squadHasThunders).holdPosition)")).toBe(true);
  });

  test("Manual command never holds the enemy's on-call reserve hostage", () => {
    expect(has('if (u.onCall && u.side === "attacker" && ui.manual) continue;')).toBe(true);
  });

  test("the stale 'toggle MOVE' refusal copy is gone", () => {
    expect(has("toggle MOVE to reposition")).toBe(false);
    expect(has("release Hold in the squad's quick-pick to reposition")).toBe(true);
  });
});
