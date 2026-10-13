// BEACHHEADS PHASE 1 — model tests (design/beachhead.md).
// Pins: layout scale (§3), presence = control (§2), dedication (§4),
// conversion timing + defender re-entry (§4A), the multi-world threat
// model (§5), and determinism (no Math.random — same inputs, same war).
import { describe, expect, test } from "bun:test";
import {
  BEACHHEAD_CONFIG,
  advanceBeachhead,
  assaultBunker,
  beachheadSummary,
  bunkerViewState,
  chorusController,
  conversionProgress,
  forceCount,
  forceCounts,
  garrisonBunker,
  generateBeachheadLayout,
  relieveBunker,
  seedFirstStripBeachhead,
  type Beachhead,
  type ControllerRef,
} from "./beachheads";
import {
  addCohort,
  emptyRoster,
  rosterByType,
  rosterCount,
  type TroopRoster,
} from "./troops";

const T0 = 1_700_000_000_000;

function rosterWith(spec: Partial<Record<string, number>>, now = T0): TroopRoster {
  const r = emptyRoster();
  for (const [type, count] of Object.entries(spec)) {
    if (count) addCohort(r, type as never, count, now);
  }
  return r;
}

const ME: ControllerRef = { colonyId: "colony-a", colonyName: "Aurel", worldId: "world-a" };
const OTHER_WORLD: ControllerRef = { colonyId: "colony-b", colonyName: "Brakka", worldId: "world-b" };
const THIRD_WORLD: ControllerRef = { colonyId: "colony-c", colonyName: "Cyra", worldId: "world-c" };

function freshStrip(now = T0): Beachhead {
  return seedFirstStripBeachhead({ id: "bh-t", name: "Beachhead Test", worldId: "world-a", now });
}

function emptyBunker(bh: Beachhead) {
  const b = bh.bunkers.find((x) => !x.garrison && !x.conversion);
  if (!b) throw new Error("no empty bunker in strip");
  return b;
}

function chorusBunker(bh: Beachhead) {
  const b = bh.bunkers.find((x) => x.garrison?.owner.colonyId === "chorus");
  if (!b) throw new Error("no chorus bunker in strip");
  return b;
}

describe("layout (§3 — designed sectors, scale is data)", () => {
  test("first strip: 50 bunkers in 2 sectors", () => {
    const { sectors, bunkers } = generateBeachheadLayout("bh-x", 50);
    expect(bunkers.length).toBe(50);
    expect(sectors.length).toBe(2);
    expect(sectors.every((s) => s.bunkerIds.length === 25)).toBe(true);
    expect(new Set(bunkers.map((b) => b.id)).size).toBe(50);
    for (const b of bunkers) {
      expect(b.x >= 0 && b.x <= 1).toBe(true);
      expect(b.y >= 0 && b.y <= 1).toBe(true);
    }
  });

  test("design target: 1,000 bunkers generate as data, same contract", () => {
    const { sectors, bunkers } = generateBeachheadLayout("bh-big", BEACHHEAD_CONFIG.designTargetBunkers);
    expect(bunkers.length).toBe(1000);
    expect(sectors.length).toBe(40);
    expect(new Set(bunkers.map((b) => b.id)).size).toBe(1000);
    // Every sector has depth behind its shore (rows present per sector).
    for (const s of sectors) {
      const depths = new Set(bunkers.filter((b) => s.bunkerIds.includes(b.id)).map((b) => b.depth));
      expect(depths.size).toBe(3);
    }
  });

  test("deterministic: same seed key, identical map", () => {
    const a = generateBeachheadLayout("bh-x", 50);
    const b = generateBeachheadLayout("bh-x", 50);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("seeded strip: Chorus holds pickets + strongpoint, rest empty (§6)", () => {
    const bh = freshStrip();
    const held = bh.bunkers.filter((b) => b.garrison?.owner.colonyId === "chorus");
    expect(held.length).toBeGreaterThan(0);
    expect(held.length).toBeLessThan(50);
    const empty = bh.bunkers.filter((b) => bunkerViewState(b) === "empty");
    expect(empty.length + held.length).toBe(50);
    // G3 flavor: tanks forward — every Chorus garrison fields bulwarks.
    for (const b of held) expect(forceCounts(b.garrison).bulwark).toBeGreaterThan(0);
  });
});

describe("occupancy (§2 — presence = control)", () => {
  test("garrisoning an empty bunker holds it instantly — no timer", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 10, warden: 4 });
    const res = garrisonBunker(bh, b.id, ME, roster, { bulwark: 6, warden: 2 }, T0);
    expect(res.ok).toBe(true);
    expect(bunkerViewState(b)).toBe("held");
    expect(b.controller?.colonyId).toBe("colony-a");
    expect(forceCount(b.garrison)).toBe(8);
    expect(b.conversion).toBeNull();
  });

  test("dedication (§4): garrisoned troops LEAVE the home roster", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 10 });
    garrisonBunker(bh, b.id, ME, roster, { bulwark: 7 }, T0);
    expect(rosterByType(roster).bulwark).toBe(3);
    expect(rosterCount(roster)).toBe(3);
  });

  test("can't garrison more than the roster holds", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 3 });
    const res = garrisonBunker(bh, b.id, ME, roster, { bulwark: 9 }, T0);
    expect(res.ok).toBe(false);
    expect(bunkerViewState(b)).toBe("empty");
    expect(rosterByType(roster).bulwark).toBe(3); // failed draw mutates nothing
  });

  test("walking into an enemy garrison is refused — assault is the verb", () => {
    const bh = freshStrip();
    const b = chorusBunker(bh);
    const roster = rosterWith({ bulwark: 10 });
    const res = garrisonBunker(bh, b.id, ME, roster, { bulwark: 5 }, T0);
    expect(res.ok).toBe(false);
    expect(b.garrison?.owner.colonyId).toBe("chorus");
  });

  test("a claim without bodies is still an open door (§2)", () => {
    const bh = freshStrip();
    const b = chorusBunker(bh);
    // The Chorus claim stands but its bodies are gone (beaten elsewhere).
    b.garrison = null;
    const roster = rosterWith({ reaver: 5 });
    const res = garrisonBunker(bh, b.id, ME, roster, { reaver: 5 }, T0);
    expect(res.ok).toBe(true);
    expect(b.controller?.colonyId).toBe("colony-a");
    expect(b.conversion).toBeNull(); // nobody was beaten HERE — no conversion
  });

  test("reinforcing your own garrison merges the force", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 20 });
    garrisonBunker(bh, b.id, ME, roster, { bulwark: 5 }, T0);
    const res = garrisonBunker(bh, b.id, ME, roster, { bulwark: 5 }, T0 + 1000);
    expect(res.ok).toBe(true);
    expect(forceCounts(b.garrison).bulwark).toBe(10);
  });
});

describe("assault + conversion (§4A — capture is work, not a flag)", () => {
  function takenBunker() {
    const bh = freshStrip();
    const b = chorusBunker(bh);
    const roster = rosterWith({ bulwark: 60, warden: 20, longeye: 20 });
    const res = assaultBunker(bh, b.id, ME, roster, { bulwark: 60, warden: 20, longeye: 20 }, T0);
    if (!res.ok) throw new Error(res.error);
    return { bh, b, roster };
  }

  test("winning an assault starts a conversion — not instant ownership", () => {
    const { bh, b } = takenBunker();
    expect(b.conversion).not.toBeNull();
    expect(b.garrison).toBeNull(); // crew works inside the conversion, not a garrison yet
    expect(b.conversion?.by.colonyId).toBe("colony-a");
    expect(b.conversion?.defender.colonyId).toBe("chorus");
    expect(b.conversion?.durationMs).toBe(BEACHHEAD_CONFIG.conversionMs);
    expect(bunkerViewState(b)).toBe("converting");
    expect(conversionProgress(bh, b, T0)).toBe(0);
  });

  test("the beaten garrison is gone and the winners paid the winner's toll", () => {
    const bh = freshStrip();
    const b = chorusBunker(bh);
    const before = forceCount(b.garrison);
    expect(before).toBeGreaterThan(0);
    const roster = rosterWith({ bulwark: 60, warden: 20 });
    assaultBunker(bh, b.id, ME, roster, { bulwark: 60, warden: 20 }, T0);
    // Crew = survivors of 80 attackers: winner toll is 4–12% by the curve.
    const crew = forceCount(b.conversion?.crew);
    expect(crew).toBeLessThan(80);
    expect(crew).toBeGreaterThan(60);
  });

  test("a losing assault comes home tolled and the position holds", () => {
    const bh = freshStrip();
    const b = chorusBunker(bh);
    const defBefore = forceCount(b.garrison);
    const roster = rosterWith({ reaver: 2 });
    const res = assaultBunker(bh, b.id, ME, roster, { reaver: 2 }, T0);
    expect(res.ok).toBe(true);
    expect(b.conversion).toBeNull();
    expect(b.garrison?.owner.colonyId).toBe("chorus");
    expect(forceCount(b.garrison) <= defBefore).toBe(true);
    expect(rosterCount(roster) <= 2).toBe(true);
  });

  test("conversion completes on the advance tick — at duration, not before", () => {
    const { bh, b } = takenBunker();
    advanceBeachhead(bh, T0 + BEACHHEAD_CONFIG.conversionMs - 1000);
    expect(b.conversion).not.toBeNull();
    expect(bunkerViewState(b)).toBe("converting");
    const events = advanceBeachhead(bh, T0 + BEACHHEAD_CONFIG.conversionMs + 1000);
    expect(b.conversion).toBeNull();
    expect(bunkerViewState(b)).toBe("held");
    expect(b.garrison?.owner.colonyId).toBe("colony-a");
    expect(events.some((e) => e.kind === "solid" && e.bunkerId === b.id)).toBe(true);
    // Idempotent: a later tick never re-fires the event.
    expect(advanceBeachhead(bh, T0 + BEACHHEAD_CONFIG.conversionMs + 99999).length).toBe(0);
  });

  test("conversion runs while nobody watches (advance is time-driven)", () => {
    const { bh, b } = takenBunker();
    // One single advance far in the future completes it — offline-safe.
    advanceBeachhead(bh, T0 + BEACHHEAD_CONFIG.conversionMs * 3);
    expect(bunkerViewState(b)).toBe("held");
  });

  test("defender re-entry pauses the clock (§4A; SEAM Q3 = pause)", () => {
    const { bh, b } = takenBunker();
    const half = BEACHHEAD_CONFIG.conversionMs / 2;
    advanceBeachhead(bh, T0 + half);
    expect(conversionProgress(bh, b, T0 + half)).toBeCloseTo(0.5, 1);
    // The defender (Chorus) re-enters with real bodies.
    const defRoster = rosterWith({ bulwark: 8, warden: 4 }, T0);
    const chorus = chorusController(bh.worldId);
    const res = garrisonBunker(bh, b.id, chorus, defRoster, { bulwark: 8, warden: 4 }, T0 + half);
    expect(res.ok).toBe(true);
    expect(bunkerViewState(b)).toBe("contested");
    // Far past the original deadline: still converting — the clock froze.
    advanceBeachhead(bh, T0 + BEACHHEAD_CONFIG.conversionMs * 2);
    expect(b.conversion).not.toBeNull();
    expect(conversionProgress(bh, b, T0 + BEACHHEAD_CONFIG.conversionMs * 2)).toBeCloseTo(0.5, 1);
  });

  test("taker clears the re-entry and the clock resumes to solid", () => {
    // This scenario needs a reserve: take with part of the roster, keep 60 back.
    const bh = freshStrip();
    const b = chorusBunker(bh);
    const roster = rosterWith({ bulwark: 120, warden: 20, longeye: 20 });
    const take = assaultBunker(bh, b.id, ME, roster, { bulwark: 60, warden: 20, longeye: 20 }, T0);
    expect(take.ok).toBe(true);
    const half = BEACHHEAD_CONFIG.conversionMs / 2;
    advanceBeachhead(bh, T0 + half);
    const chorus = chorusController(bh.worldId);
    const defRoster = rosterWith({ bulwark: 4 }, T0);
    garrisonBunker(bh, b.id, chorus, defRoster, { bulwark: 4 }, T0 + half);
    expect(bunkerViewState(b)).toBe("contested");
    // Taker assaults the re-entered force with overwhelming strength.
    const res = assaultBunker(bh, b.id, ME, roster, { bulwark: 40 }, T0 + half + 1000);
    expect(res.ok).toBe(true);
    expect(b.conversion?.defenderForce).toBeNull();
    expect(bunkerViewState(b)).toBe("converting");
    advanceBeachhead(bh, T0 + half + BEACHHEAD_CONFIG.conversionMs);
    expect(bunkerViewState(b)).toBe("held");
    expect(b.garrison?.owner.colonyId).toBe("colony-a");
  });

  test("defender retakes mid-conversion: conversion undone, ground restored", () => {
    const { bh, b } = takenBunker();
    const chorus = chorusController(bh.worldId);
    const defRoster = rosterWith({ bulwark: 80, thunder: 20 }, T0);
    const res = assaultBunker(bh, b.id, chorus, defRoster, { bulwark: 80, thunder: 20 }, T0 + 5000);
    expect(res.ok).toBe(true);
    expect(b.conversion).toBeNull();
    expect(bunkerViewState(b)).toBe("held");
    expect(b.garrison?.owner.colonyId).toBe("chorus");
    expect(b.controller?.colonyId).toBe("chorus");
  });

  test("assaulting an empty bunker is refused — walk in instead", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 10 });
    const res = assaultBunker(bh, b.id, ME, roster, { bulwark: 5 }, T0);
    expect(res.ok).toBe(false);
    expect(rosterByType(roster).bulwark).toBe(10);
  });

  test("nobody assaults their own troops", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 30 });
    garrisonBunker(bh, b.id, ME, roster, { bulwark: 10 }, T0);
    const res = assaultBunker(bh, b.id, ME, roster, { bulwark: 5 }, T0);
    expect(res.ok).toBe(false);
  });
});

describe("relief (§4 — the blessed release)", () => {
  test("relief swaps the garrison and the old bodies march home", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 10, longeye: 6 });
    garrisonBunker(bh, b.id, ME, roster, { bulwark: 8 }, T0);
    expect(rosterByType(roster).bulwark).toBe(2);
    const res = relieveBunker(bh, b.id, ME, roster, { longeye: 6 }, T0 + 1000);
    expect(res.ok).toBe(true);
    expect(forceCounts(b.garrison).longeye).toBe(6);
    expect(forceCounts(b.garrison).bulwark).toBe(0);
    expect(rosterByType(roster).bulwark).toBe(10); // the old garrison came home
  });

  test("only the owner can relieve, and never mid-conversion", () => {
    const bh = freshStrip();
    const b = emptyBunker(bh);
    const roster = rosterWith({ bulwark: 10 });
    garrisonBunker(bh, b.id, ME, roster, { bulwark: 5 }, T0);
    const stranger = rosterWith({ bulwark: 5 });
    expect(relieveBunker(bh, b.id, OTHER_WORLD, stranger, { bulwark: 5 }, T0).ok).toBe(false);
  });
});

describe("threat model (§5 — many worlds, one beachhead)", () => {
  test("troops from three worlds hold bunkers on the same beachhead", () => {
    const bh = freshStrip();
    const [b1, b2, b3] = bh.bunkers.filter((x) => !x.garrison);
    const rA = rosterWith({ bulwark: 10 });
    const rB = rosterWith({ bulwark: 10 });
    const rC = rosterWith({ bulwark: 10 });
    expect(garrisonBunker(bh, b1.id, ME, rA, { bulwark: 5 }, T0).ok).toBe(true);
    expect(garrisonBunker(bh, b2.id, OTHER_WORLD, rB, { bulwark: 5 }, T0).ok).toBe(true);
    expect(garrisonBunker(bh, b3.id, THIRD_WORLD, rC, { bulwark: 5 }, T0).ok).toBe(true);
    const sum = beachheadSummary(bh, ME);
    expect(sum.heldByViewer).toBe(1);
    expect(sum.heldByOthers >= 2).toBe(true); // other worlds + Chorus
  });

  test("a third world cannot walk into someone else's conversion (seam Q10)", () => {
    const bh = freshStrip();
    const b = chorusBunker(bh);
    const roster = rosterWith({ bulwark: 60, warden: 20 });
    assaultBunker(bh, b.id, ME, roster, { bulwark: 60, warden: 20 }, T0);
    expect(b.conversion).not.toBeNull();
    const third = rosterWith({ bulwark: 10 });
    const res = garrisonBunker(bh, b.id, THIRD_WORLD, third, { bulwark: 5 }, T0 + 1000);
    expect(res.ok).toBe(false);
  });
});

describe("determinism", () => {
  test("the same assault from the same state lands identically", () => {
    const run = () => {
      const bh = freshStrip();
      const b = chorusBunker(bh);
      const roster = rosterWith({ bulwark: 40, longeye: 10 });
      assaultBunker(bh, b.id, ME, roster, { bulwark: 40, longeye: 10 }, T0);
      advanceBeachhead(bh, T0 + 60_000);
      return JSON.stringify(bh.bunkers);
    };
    expect(run()).toBe(run());
  });
});
