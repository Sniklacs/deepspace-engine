// Tests for husk → sub colony claiming (game/subcolonies.ts).
// Owner 2026-10-03: husks are claimable, 24h setup, planet-locked,
// first-come-first-serve, research inheritance, reverb.
import { describe, expect, test } from "bun:test";
import {
  SUBCOLONY_CLAIM_COST,
  SUBCOLONY_SETUP_MS,
  SUBCOLONY_UPKEEP_PER_DAY,
  SUBCOLONY_GARRISON_CAP,
  SUBCOLONY_STARVE_MS,
  bleedSubColonyTroops,
  claimHusk,
  enqueueSubColonyMuster,
  isActiveSubColony,
  isClaimableHusk,
  isSettingUp,
  mySubColonies,
  resolveStarvedSubColonies,
  resolveSubColonies,
  resolveSubColonyMusters,
  seizeSubColony,
  setupRemaining,
  shipSubColonySupplies,
  subColonyReverb,
  subColonyTechIds,
  subColonyTroopCount,
  subColonyUpkeepPerDay,
} from "./subcolonies";
import { colonyKey, emptyWorldMap, type KnownColony } from "./worldmap";
import { WORLD_CONFIG_PUBLIC } from "./world-config";
import type { GameState } from "./types";

const NOW = 1_700_000_000_000;
const HOME = WORLD_CONFIG_PUBLIC.worldId;

function husk(id: string, serverId: string = HOME): KnownColony {
  return {
    id,
    serverId,
    ownerName: "Old Owner",
    race: "draconians",
    status: "husk",
    lastScouted: NOW - 1000,
  };
}

function testState(supplies = 100_000): GameState {
  const s = {
    gameId: "colony-1",
    playerName: "TestWarlord",
    resources: { supplies },
    techsResearched: ["tech-a", "tech-b", "tech-c"],
    worldMap: emptyWorldMap(NOW),
  } as unknown as GameState;
  return s;
}

function addHusk(state: GameState, id: string, serverId: string = HOME): string {
  const wm = state.worldMap!;
  const key = colonyKey(serverId, id);
  wm.known[key] = husk(id, serverId);
  return key;
}

describe("claim validation", () => {
  test("claims an unclaimed husk on the home world", () => {
    const s = testState();
    const key = addHusk(s, "husk-1");
    const res = claimHusk(s, key, NOW);
    expect(res.ok).toBe(true);
    const c = s.worldMap!.known[key];
    expect(c.status).toBe("setting_up");
    expect(c.subClaim?.claimedBy).toBe("colony-1");
    expect(c.subClaim?.claimedByName).toBe("TestWarlord");
    expect(c.subClaim?.setupCompleteAt).toBe(NOW + SUBCOLONY_SETUP_MS);
    expect(s.resources.supplies).toBe(100_000 - SUBCOLONY_CLAIM_COST);
  });

  test("rejects non-husks", () => {
    const s = testState();
    const key = addHusk(s, "husk-1");
    s.worldMap!.known[key].status = "abandoned";
    const res = claimHusk(s, key, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Only husks/);
  });

  test("rejects already-claimed husks (first come, first serve)", () => {
    const s = testState();
    const key = addHusk(s, "husk-1");
    expect(claimHusk(s, key, NOW).ok).toBe(true);
    const res2 = claimHusk(s, key, NOW + 1000);
    expect(res2.ok).toBe(false);
    expect(res2.error).toMatch(/already being supplied by TestWarlord/);
  });

  test("rejects when supplies are short", () => {
    const s = testState(100); // not enough
    const key = addHusk(s, "husk-1");
    const res = claimHusk(s, key, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Need .* supplies/);
    expect(s.resources.supplies).toBe(100); // not deducted
  });

  test("rejects off-world husks (planet-locked)", () => {
    const s = testState();
    const key = addHusk(s, "husk-1", "some-other-world");
    const res = claimHusk(s, key, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/planet-locked/);
  });

  test("rejects unknown colony", () => {
    const s = testState();
    const res = claimHusk(s, "nope:nada", NOW);
    expect(res.ok).toBe(false);
  });
});

describe("24h setup", () => {
  test("SUBCOLONY_SETUP_MS is 24 hours", () => {
    expect(SUBCOLONY_SETUP_MS).toBe(24 * 3600_000);
  });

  test("setting_up → sub_colony after 24h via resolveSubColonies", () => {
    const s = testState();
    const key = addHusk(s, "husk-1");
    claimHusk(s, key, NOW);
    const c = s.worldMap!.known[key];

    expect(isSettingUp(c, NOW + 1000)).toBe(true);
    expect(isActiveSubColony(c, NOW + 1000)).toBe(false);
    expect(setupRemaining(c, NOW + 1000)).toBeGreaterThan(0);

    const resolved = resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    expect(resolved).toBe(1);
    expect(c.status).toBe("sub_colony");
    expect(isSettingUp(c, NOW + SUBCOLONY_SETUP_MS + 1)).toBe(false);
    expect(isActiveSubColony(c, NOW + SUBCOLONY_SETUP_MS + 1)).toBe(true);
    expect(setupRemaining(c, NOW + SUBCOLONY_SETUP_MS + 1)).toBe(0);
  });

  test("ownership transfers to claimer on activation", () => {
    const s = testState();
    const key = addHusk(s, "husk-1");
    claimHusk(s, key, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    expect(s.worldMap!.known[key].ownerName).toBe("TestWarlord");
  });

  test("resolve is idempotent", () => {
    const s = testState();
    const key = addHusk(s, "husk-1");
    claimHusk(s, key, NOW);
    expect(resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1)).toBe(1);
    expect(resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 2)).toBe(0);
  });
});

describe("sub colony muster (2x speed)", () => {
  function activeSub(key: string, id: string): string {
    const s = testState();
    const k = addHusk(s, id);
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    return k;
  }

  test("musters troops at 2x speed", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    // Home muster for 100 troops = 100 * 30s = 3000s. Sub = half.
    const res = enqueueSubColonyMuster(s, k, "bulwark", 100, NOW);
    expect(res.ok).toBe(true);
    const c = s.worldMap!.known[k];
    const order = c.subMusterQueue![0];
    expect(order.completesAt - NOW).toBe(Math.ceil((100 * 30_000) / 2));
    // Cost deducted (same as home: 4 supplies per weight).
    expect(s.resources.supplies).toBe(100_000 - SUBCOLONY_CLAIM_COST - 100 * 4);
  });

  test("rejects muster at non-sub-colony", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    const res = enqueueSubColonyMuster(s, k, "bulwark", 100, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Not an active sub colony/);
  });

  test("rejects muster at someone else's sub colony", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    s.worldMap!.known[k].subClaim!.claimedBy = "rival-1";
    const res = enqueueSubColonyMuster(s, k, "bulwark", 100, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Not your sub colony/);
  });

  test("rejects over garrison cap", () => {
    const s = testState(10_000_000);
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    const res = enqueueSubColonyMuster(s, k, "bulwark", SUBCOLONY_GARRISON_CAP + 1, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Garrison cap/);
  });

  test("rejects duplicate type queue", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    expect(enqueueSubColonyMuster(s, k, "bulwark", 100, NOW).ok).toBe(true);
    const res2 = enqueueSubColonyMuster(s, k, "bulwark", 50, NOW + 1000);
    expect(res2.ok).toBe(false);
    expect(res2.error).toMatch(/already running/);
  });

  test("resolveSubColonyMusters completes orders into the garrison", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    enqueueSubColonyMuster(s, k, "bulwark", 100, NOW);
    enqueueSubColonyMuster(s, k, "reaver", 50, NOW);
    expect(subColonyTroopCount(s.worldMap!.known[k])).toBe(150); // queued counts
    const doneAt = NOW + Math.ceil((100 * 30_000) / 2) + 1;
    expect(resolveSubColonyMusters(s, doneAt)).toBe(2);
    const c = s.worldMap!.known[k];
    expect(c.subMusterQueue).toHaveLength(0);
    expect(subColonyTroopCount(c)).toBe(150);
  });
});

describe("starvation → husk", () => {
  test("collapses back to husk 48h past the upkeep deadline", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    const liveAt = NOW + SUBCOLONY_SETUP_MS + 1;
    resolveSubColonies(s, liveAt);
    const c = s.worldMap!.known[k];
    const due = c.subClaim!.nextUpkeepDue!;
    // Still alive just before the starve window.
    expect(resolveStarvedSubColonies(s, due + SUBCOLONY_STARVE_MS - 1)).toBe(0);
    expect(c.status).toBe("sub_colony");
    // Past it → husk, claim cleared, troops gone.
    expect(resolveStarvedSubColonies(s, due + SUBCOLONY_STARVE_MS + 1)).toBe(1);
    expect(c.status).toBe("husk");
    expect(c.subClaim).toBeNull();
    expect(c.subTroops).toBeNull();
    expect(isClaimableHusk(c)).toBe(true);
  });

  test("paying upkeep resets the starvation clock", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    const liveAt = NOW + SUBCOLONY_SETUP_MS + 1;
    resolveSubColonies(s, liveAt);
    const c = s.worldMap!.known[k];
    const due = c.subClaim!.nextUpkeepDue!;
    // Pay just before collapse.
    shipSubColonySupplies(s, k, due + SUBCOLONY_STARVE_MS - 1000);
    expect(resolveStarvedSubColonies(s, due + SUBCOLONY_STARVE_MS + 1)).toBe(0);
    expect(c.status).toBe("sub_colony");
  });
});

describe("rival takeover (seizure)", () => {
  test("seizeSubColony transfers ownership, wipes garrison", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    enqueueSubColonyMuster(s, k, "bulwark", 100, NOW);
    resolveSubColonyMusters(s, NOW + Math.ceil((100 * 30_000) / 2) + 1);
    expect(subColonyTroopCount(s.worldMap!.known[k])).toBe(100);

    const res = seizeSubColony(s, k, "rival-1", "RivalLord", NOW + 9999);
    expect(res.ok).toBe(true);
    const c = s.worldMap!.known[k];
    expect(c.status).toBe("sub_colony");
    expect(c.subClaim!.claimedBy).toBe("rival-1");
    expect(c.subClaim!.claimedByName).toBe("RivalLord");
    expect(c.ownerName).toBe("RivalLord");
    // Garrison wiped — taker starts empty at THEIR level.
    expect(subColonyTroopCount(c)).toBe(0);
    // Old owner no longer counts it.
    expect(mySubColonies(s, NOW + 9999)).toHaveLength(0);
  });

  test("bleedSubColonyTroops removes from the garrison", () => {
    const s = testState();
    const k = addHusk(s, "husk-1");
    claimHusk(s, k, NOW);
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    enqueueSubColonyMuster(s, k, "bulwark", 100, NOW);
    resolveSubColonyMusters(s, NOW + Math.ceil((100 * 30_000) / 2) + 1);
    const c = s.worldMap!.known[k];
    const lost = bleedSubColonyTroops(c, 40);
    expect(lost.bulwark).toBe(40);
    expect(subColonyTroopCount(c)).toBe(60);
  });
});
describe("helpers", () => {
  test("isClaimableHusk", () => {
    const h = husk("a");
    expect(isClaimableHusk(h)).toBe(true);
    h.status = "abandoned";
    expect(isClaimableHusk(h)).toBe(false);
    h.status = "husk";
    h.subClaim = {
      claimedBy: "x",
      claimedByName: "X",
      claimedAt: NOW,
      setupCompleteAt: NOW + SUBCOLONY_SETUP_MS,
      suppliesInvested: SUBCOLONY_CLAIM_COST,
    };
    expect(isClaimableHusk(h)).toBe(false);
  });

  test("research inheritance: sub colony uses owner's techs", () => {
    const s = testState();
    expect(subColonyTechIds(s)).toEqual(["tech-a", "tech-b", "tech-c"]);
  });

  test("reverb: base + troop weight", () => {
    expect(subColonyReverb(0)).toBe(500);
    expect(subColonyReverb(1000)).toBe(600);
  });

  test("mySubColonies + upkeep", () => {
    const s = testState();
    const k1 = addHusk(s, "husk-1");
    const k2 = addHusk(s, "husk-2");
    claimHusk(s, k1, NOW);
    claimHusk(s, k2, NOW);
    // Still setting up — not counted yet.
    expect(mySubColonies(s, NOW + 1000)).toHaveLength(0);
    expect(subColonyUpkeepPerDay(s, NOW + 1000)).toBe(0);
    // After setup — both counted.
    resolveSubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1);
    expect(mySubColonies(s, NOW + SUBCOLONY_SETUP_MS + 1)).toHaveLength(2);
    expect(subColonyUpkeepPerDay(s, NOW + SUBCOLONY_SETUP_MS + 1)).toBe(
      2 * SUBCOLONY_UPKEEP_PER_DAY,
    );
  });
});
