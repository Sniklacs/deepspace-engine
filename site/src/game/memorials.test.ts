// BATTLE MEMORIALS tests (owner 2026-09-30): permanent plaques at major-battle
// sites. Qualification: 1,000+ total casualties (or owner discretion via force).
// Plaques never wipe; the victor's epitaph locks forever once set.
import { describe, expect, test } from "vitest";
import {
  MEMORIAL_CASUALTY_THRESHOLD,
  addEpitaph,
  allMemorials,
  createMemorial,
  ensureMemorials,
  findMemorialByBattle,
  memorialInputFromBattle,
  memorialNodeIds,
  memorialsForNode,
  qualifiesForMemorial,
  setEpitaphOnState,
  totalCasualties,
} from "./memorials";

function input(overrides: Partial<Parameters<typeof createMemorial>[0]> = {}) {
  return {
    battleId: "raid-1",
    nodeId: "node-7",
    siteName: "Testwarlord's colony",
    season: "season-1",
    attackerName: "Attacker",
    defenderName: "Defender",
    attackerLosses: 600,
    defenderLosses: 500,
    victor: "attacker" as const,
    ...overrides,
  };
}

describe("memorial qualification", () => {
  test("threshold is 1,000 total casualties", () => {
    expect(MEMORIAL_CASUALTY_THRESHOLD).toBe(1000);
  });

  test("1,100 total casualties qualifies", () => {
    expect(qualifiesForMemorial(600, 500)).toBe(true);
  });

  test("999 total casualties does not qualify", () => {
    expect(qualifiesForMemorial(500, 499)).toBe(false);
  });

  test("totalCasualties sums both sides", () => {
    expect(totalCasualties(300, 700)).toBe(1000);
  });
});

describe("createMemorial", () => {
  test("creates a plaque for a qualifying battle", () => {
    const p = createMemorial(input());
    expect(p).not.toBeNull();
    expect(p!.battleId).toBe("raid-1");
    expect(p!.nodeId).toBe("node-7");
    expect(p!.siteName).toBe("Testwarlord's colony");
    expect(p!.attackerLosses).toBe(600);
    expect(p!.defenderLosses).toBe(500);
    expect(p!.victor).toBe("attacker");
    expect(p!.epitaph).toBeNull();
    expect(p!.epitaphBy).toBeNull();
  });

  test("records fallen heroes", () => {
    const p = createMemorial(input({ fallenHeroes: ["Kaaroth", "Ilyra Voss"] }));
    expect(p!.fallenHeroes).toEqual(["Kaaroth", "Ilyra Voss"]);
  });

  test("returns null below threshold without force", () => {
    const p = createMemorial(input({ attackerLosses: 100, defenderLosses: 100 }));
    expect(p).toBeNull();
  });

  test("force creates a plaque below threshold (owner discretion)", () => {
    const p = createMemorial(input({ attackerLosses: 100, defenderLosses: 100, force: true }));
    expect(p).not.toBeNull();
  });
});

describe("addEpitaph", () => {
  test("victor sets the epitaph once", () => {
    const p = createMemorial(input())!;
    const err = addEpitaph(p, "They held the line.", "Attacker");
    expect(err).toBeNull();
    expect(p.epitaph).toBe("They held the line.");
    expect(p.epitaphBy).toBe("Attacker");
  });

  test("second epitaph is rejected — locked forever", () => {
    const p = createMemorial(input())!;
    expect(addEpitaph(p, "First.", "Attacker")).toBeNull();
    const err = addEpitaph(p, "Second.", "Attacker");
    expect(err).not.toBeNull();
    expect(p.epitaph).toBe("First.");
  });

  test("empty epitaph is rejected", () => {
    const p = createMemorial(input())!;
    const err = addEpitaph(p, "   ", "Attacker");
    expect(err).not.toBeNull();
    expect(p.epitaph).toBeNull();
  });

  test("epitaph is capped at 140 chars", () => {
    const p = createMemorial(input())!;
    const long = "x".repeat(200);
    expect(addEpitaph(p, long, "Attacker")).toBeNull();
    expect(p.epitaph!.length).toBe(140);
  });
});

describe("memorial queries", () => {
  test("findMemorialByBattle dedupes on battleId", () => {
    const p = createMemorial(input())!;
    expect(findMemorialByBattle([p], "raid-1")).toBe(p);
    expect(findMemorialByBattle([p], "raid-2")).toBeUndefined();
  });

  test("memorialsForNode filters by node, newest first", () => {
    const a = createMemorial(input({ battleId: "a", nodeId: "n1", at: 1000 }))!;
    const b = createMemorial(input({ battleId: "b", nodeId: "n1", at: 2000 }))!;
    const c = createMemorial(input({ battleId: "c", nodeId: "n2", at: 3000 }))!;
    const out = memorialsForNode([a, b, c], "n1");
    expect(out.map((m) => m.battleId)).toEqual(["b", "a"]);
  });

  test("allMemorials returns newest first", () => {
    const a = createMemorial(input({ battleId: "a", at: 1000 }))!;
    const b = createMemorial(input({ battleId: "b", at: 3000 }))!;
    const c = createMemorial(input({ battleId: "c", at: 2000 }))!;
    expect(allMemorials([a, b, c]).map((m) => m.battleId)).toEqual(["b", "c", "a"]);
  });
});

describe("ensureMemorials", () => {
  test("backfills an empty array on old saves", () => {
    const state = {} as any;
    ensureMemorials(state);
    expect(state.memorials).toEqual([]);
  });

  test("does not clobber existing memorials", () => {
    const p = createMemorial(input())!;
    const state = { memorials: [p] } as any;
    ensureMemorials(state);
    expect(state.memorials).toEqual([p]);
  });
});

function fakeBattle(overrides: any = {}) {
  return {
    id: "bat-1",
    zoneId: "zone-9",
    zoneName: "The Shatterfields",
    bloodless: false,
    casualties: { attacker: 700, defender: 500 },
    result: { outcome: "attacker_victory", winnerColonyId: "c1" },
    attacker: {
      colonyId: "c1",
      colonyName: "Ashen Vanguard",
      heroSquad: [{ name: "Kaaroth" }],
    },
    defender: {
      colonyId: "c2",
      colonyName: "The Null Engine",
      heroSquad: [{ name: "Ilyra Voss" }],
    },
    ...overrides,
  } as any;
}

describe("memorialInputFromBattle", () => {
  test("builds a qualifying input from a resolved battle", () => {
    const mi = memorialInputFromBattle(fakeBattle(), "Season 1: The Ember Fall", 12345);
    expect(mi).not.toBeNull();
    expect(mi!.battleId).toBe("bat-1");
    expect(mi!.nodeId).toBe("zone-9");
    expect(mi!.siteName).toBe("The Shatterfields");
    expect(mi!.season).toBe("Season 1: The Ember Fall");
    expect(mi!.attackerName).toBe("Ashen Vanguard");
    expect(mi!.defenderName).toBe("The Null Engine");
    expect(mi!.attackerLosses).toBe(700);
    expect(mi!.defenderLosses).toBe(500);
    expect(mi!.victor).toBe("attacker");
    expect(mi!.fallenHeroes).toEqual(["Kaaroth", "Ilyra Voss"]);
    expect(mi!.at).toBe(12345);
  });

  test("defender victory maps to defender", () => {
    const mi = memorialInputFromBattle(
      fakeBattle({ result: { outcome: "defender_victory", winnerColonyId: "c2" } }),
      "Season 1",
      1,
    );
    expect(mi!.victor).toBe("defender");
  });

  test("standoff maps to draw", () => {
    const mi = memorialInputFromBattle(
      fakeBattle({ result: { outcome: "standoff" } }),
      "Season 1",
      1,
    );
    expect(mi!.victor).toBe("draw");
  });

  test("bloodless bouts never qualify — nobody died", () => {
    const mi = memorialInputFromBattle(
      fakeBattle({ bloodless: true, casualties: { attacker: 5000, defender: 5000 } }),
      "Season 1",
      1,
    );
    expect(mi).toBeNull();
  });

  test("below-threshold battles return null", () => {
    const mi = memorialInputFromBattle(
      fakeBattle({ casualties: { attacker: 100, defender: 100 } }),
      "Season 1",
      1,
    );
    expect(mi).toBeNull();
  });
});

describe("setEpitaphOnState", () => {
  test("carves the epitaph through state", () => {
    const p = createMemorial(input())!;
    const state = { memorials: [p] } as any;
    expect(setEpitaphOnState(state, p.id, "They held.", "Attacker")).toBeNull();
    expect(state.memorials[0].epitaph).toBe("They held.");
  });

  test("unknown plaque id errors", () => {
    const state = { memorials: [] } as any;
    expect(setEpitaphOnState(state, "nope", "x", "y")).not.toBeNull();
  });

  test("locked epitaph cannot be overwritten", () => {
    const p = createMemorial(input())!;
    const state = { memorials: [p] } as any;
    expect(setEpitaphOnState(state, p.id, "First.", "Attacker")).toBeNull();
    expect(setEpitaphOnState(state, p.id, "Second.", "Attacker")).not.toBeNull();
    expect(state.memorials[0].epitaph).toBe("First.");
  });
});

describe("memorialNodeIds", () => {
  test("collects every memorial-bearing node id", () => {
    const a = createMemorial(input({ battleId: "a", nodeId: "n1" }))!;
    const b = createMemorial(input({ battleId: "b", nodeId: "n2" }))!;
    const ids = memorialNodeIds([a, b]);
    expect(ids.has("n1")).toBe(true);
    expect(ids.has("n2")).toBe(true);
    expect(ids.has("n3")).toBe(false);
  });
});

describe("battle-engine integration", () => {
  test("advanceBattles carves a plaque for a 1,000+ casualty battle", async () => {
    const { advanceBattles, createBattle } = await import("./war/battle-engine");
    const now = Date.now();
    const mkForce = (colonyId: string, colonyName: string, troops: number) => ({
      colonyId,
      colonyName,
      heroSquad: [],
      troops,
      weapons: [],
      fobStage: 4,
    });
    const battle = createBattle(
      {
        zoneId: "zone-9",
        zoneName: "The Shatterfields",
        attacker: mkForce("c1", "Ashen Vanguard", 50000),
        defender: mkForce("c2", "The Null Engine", 50000),
      },
      now - 1000,
    );
    // Force the battle past its end so advanceBattles resolves it.
    battle.startedAt = now - battle.durationMs - 1000;
    const state = { battles: [battle], log: [] } as any;
    const resolved = advanceBattles(state, now);
    expect(resolved).toBe(1);
    expect(state.memorials.length).toBe(1);
    const plaque = state.memorials[0];
    expect(plaque.battleId).toBe(battle.id);
    expect(plaque.siteName).toBe("The Shatterfields");
    expect(plaque.attackerLosses + plaque.defenderLosses).toBeGreaterThanOrEqual(1000);
    // Idempotent: a second tick doesn't double-carve.
    advanceBattles(state, now + 1000);
    expect(state.memorials.length).toBe(1);
  });

  test("advanceBattles skips plaques for small battles", async () => {
    const { advanceBattles, createBattle } = await import("./war/battle-engine");
    const now = Date.now();
    const mkForce = (colonyId: string, colonyName: string, troops: number) => ({
      colonyId,
      colonyName,
      heroSquad: [],
      troops,
      weapons: [],
      fobStage: 4,
    });
    const battle = createBattle(
      {
        zoneId: "zone-1",
        zoneName: "Skirmish Field",
        attacker: mkForce("c1", "A", 10),
        defender: mkForce("c2", "B", 10),
      },
      now - 1000,
    );
    battle.startedAt = now - battle.durationMs - 1000;
    const state = { battles: [battle], log: [] } as any;
    advanceBattles(state, now);
    expect(state.memorials.length).toBe(0);
  });
});
