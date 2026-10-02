// Tests for gleaning expeditions (game/worldmap.ts pure functions) —
// design/abandoned-colonies-world-map.md §3.
// Run: bun test site/src/game/gleaning.test.ts
import { describe, expect, test } from "bun:test";
import {
  EMPTY_LOOT,
  GLEAN_DURATION_MS,
  beginGleanRun,
  colonyKey,
  emptyWorldMap,
  gleanReady,
  isHusk,
  lootAfterTake,
  lootTotal,
  resolveGleanRun,
  type ColonyLoot,
  type KnownColony,
  type WorldMapState,
} from "./worldmap";

const NOW = 1_700_000_000_000;

function abandonedColony(loot: ColonyLoot): KnownColony {
  return {
    id: "col-1",
    serverId: "server-1",
    ownerName: "TestOwner",
    race: "grays",
    status: "abandoned",
    lastScouted: NOW,
    loot: { ...loot },
    mercenaries: null,
  };
}

function withColony(wm: WorldMapState, colony: KnownColony): string {
  const key = colonyKey(colony.serverId, colony.id);
  wm.known[key] = colony;
  return key;
}

describe("gleaning", () => {
  test("beginGleanRun creates an expedition for an abandoned colony", () => {
    const wm = emptyWorldMap(NOW);
    const key = withColony(wm, abandonedColony({ ...EMPTY_LOOT, supplies: 1000, embers: 50 }));
    
    const r = beginGleanRun(wm, key, NOW);
    expect(r.ok).toBe(true);
    expect(r.run).toBeDefined();
    expect(r.run!.status).toBe("out");
    expect(r.run!.colonyId).toBe("col-1");
    expect(wm.gleanRuns.length).toBe(1);
  });

  test("beginGleanRun fails for active colony", () => {
    const wm = emptyWorldMap(NOW);
    const col = abandonedColony(EMPTY_LOOT);
    col.status = "active";
    const key = withColony(wm, col);
    
    const r = beginGleanRun(wm, key, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/active/i);
  });

  test("beginGleanRun fails for husk (no loot, no mercs)", () => {
    const wm = emptyWorldMap(NOW);
    const key = withColony(wm, abandonedColony(EMPTY_LOOT)); // Empty = husk
    
    const r = beginGleanRun(wm, key, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/husk/i);
    // Colony status should be updated to husk
    expect(wm.known[key].status).toBe("husk");
  });

  test("beginGleanRun fails if expedition already out", () => {
    const wm = emptyWorldMap(NOW);
    const key = withColony(wm, abandonedColony({ ...EMPTY_LOOT, supplies: 1000 }));
    
    const r1 = beginGleanRun(wm, key, NOW);
    expect(r1.ok).toBe(true);
    const r2 = beginGleanRun(wm, key, NOW);
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/already/i);
  });

  test("beginGleanRun fails for unknown colony", () => {
    const wm = emptyWorldMap(NOW);
    const r = beginGleanRun(wm, "nope:col-99", NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/map/i);
  });

  test("gleanReady is false before duration, true after", () => {
    const wm = emptyWorldMap(NOW);
    const key = withColony(wm, abandonedColony({ ...EMPTY_LOOT, supplies: 1000 }));
    const r = beginGleanRun(wm, key, NOW);
    expect(r.ok).toBe(true);
    const run = r.run!;
    
    expect(gleanReady(run, NOW + GLEAN_DURATION_MS - 1000)).toBe(false);
    expect(gleanReady(run, NOW + GLEAN_DURATION_MS)).toBe(true);
    expect(gleanReady(run, NOW + GLEAN_DURATION_MS + 1000)).toBe(true);
  });

  test("resolveGleanRun transfers loot and empties colony", () => {
    const wm = emptyWorldMap(NOW);
    const key = withColony(wm, abandonedColony({ ...EMPTY_LOOT, supplies: 1000, embers: 50, fuel: 25 }));
    
    const begin = beginGleanRun(wm, key, NOW);
    expect(begin.ok).toBe(true);
    const runId = begin.run!.id;
    
    const later = NOW + GLEAN_DURATION_MS + 1000;
    const resolve = resolveGleanRun(wm, runId, later);
    expect(resolve.ok).toBe(true);
    expect(resolve.lootTaken).toBeDefined();
    expect(resolve.lootTaken!.supplies).toBe(1000);
    expect(resolve.lootTaken!.embers).toBe(50);
    expect(resolve.lootTaken!.fuel).toBe(25);
    
    // Colony loot should now be empty
    const colony = wm.known[key];
    expect(colony.loot!.supplies).toBe(0);
    expect(lootTotal(colony.loot!)).toBe(0);
  });

  test("resolveGleanRun marks husk when fully gleaned", () => {
    const wm = emptyWorldMap(NOW);
    const key = withColony(wm, abandonedColony({ ...EMPTY_LOOT, supplies: 500 }));
    
    const begin = beginGleanRun(wm, key, NOW);
    expect(begin.ok).toBe(true);
    
    const later = NOW + GLEAN_DURATION_MS + 1000;
    const resolve = resolveGleanRun(wm, begin.run!.id, later);
    expect(resolve.ok).toBe(true);
    
    // Colony should now be a husk (no loot, no mercs)
    const colony = wm.known[key];
    expect(colony.status).toBe("husk");
    expect(isHusk(colony.loot!, colony.mercenaries ?? null)).toBe(true);
  });

  test("resolveGleanRun fails if not yet complete", () => {
    const wm = emptyWorldMap(NOW);
    const key = withColony(wm, abandonedColony({ ...EMPTY_LOOT, supplies: 1000 }));
    
    const begin = beginGleanRun(wm, key, NOW);
    expect(begin.ok).toBe(true);
    
    const early = NOW + GLEAN_DURATION_MS - 1000;
    const resolve = resolveGleanRun(wm, begin.run!.id, early);
    expect(resolve.ok).toBe(false);
    expect(resolve.error).toMatch(/still out/i);
  });

  test("resolveGleanRun fails for unknown run", () => {
    const wm = emptyWorldMap(NOW);
    const r = resolveGleanRun(wm, "glean-999", NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test("partial gleaning: lootAfterTake leaves remainder", () => {
    const loot: ColonyLoot = { ...EMPTY_LOOT, supplies: 1000, embers: 100 };
    const taken: ColonyLoot = { ...EMPTY_LOOT, supplies: 400, embers: 100 };
    const remaining = lootAfterTake(loot, taken);
    expect(remaining.supplies).toBe(600);
    expect(remaining.embers).toBe(0);
    expect(lootTotal(remaining)).toBe(600);
  });
});
