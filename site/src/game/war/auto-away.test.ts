// auto-away.test.ts — AUTO-run-while-away + drop-in pins (owner 2026-10-13).
//
// Hans's locked rule: "I can exit a battle anytime I want to while it's
// working and finishing up, and I can look at others — nothing has to
// say that you're only fighting one battle at a time."
//
// The architecture that carries it (audited 2026-10-13):
//   • Real battles are ENTITIES in GameState. advanceBattles runs inside
//     the engine's advance (app-level, every tick, whatever is on
//     screen) — a battle resolves on AUTO whether or not its scene is
//     mounted, and appends its report when it concludes.
//   • The 2D scene is a VIEW + helm over one entity (or a demo). It
//     re-derives deterministically from the battle (sceneFromBattle,
//     t0 = battle.startedAt), so exiting and re-entering loses nothing
//     of the war — only the previous session's panel state.
//   • The one scene-layer gap found: BattlesTab's embedded scene matched
//     casualties to the entity, the FULLSCREEN helm did not (it ran its
//     own local curve). Pinned fixed below.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf-8");
const has = (src: string, n: string) => src.includes(n);

describe("auto-away — the war outlives the scene", () => {
  const engine = read("../engine.ts");
  const fs = read("../../components/BattleScene/BattleSceneFullscreen.tsx");
  const tab = read("../../components/BattlesTab.tsx");

  test("the engine advances battles on its own tick, scene or no scene", () => {
    expect(has(engine, "advanceBattles(state, now);")).toBe(true);
  });

  test("the fullscreen helm forwards the entity's live casualties", () => {
    expect(has(fs, "liveCasualties?: { attacker: number; defender: number } | null;")).toBe(true);
    expect(has(fs, "liveCasualties={liveCasualties}")).toBe(true);
  });

  test("BattlesTab feeds the fullscreen the same casualties as the embedded scene", () => {
    expect(has(tab, "liveCasualties={battleMoment(sceneFullscreen.battle, now).casualties}")).toBe(true);
    expect(has(tab, "liveCasualties={battleMoment(selected, now).casualties}")).toBe(true);
  });
});
