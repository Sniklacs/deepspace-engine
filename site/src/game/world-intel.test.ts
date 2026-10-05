// world-intel.test.ts — WS D: world flavor determinism, live counts, alliance
// turf anchoring + estimate fallback.
import { describe, expect, test } from "bun:test";
import {
  allianceTurf,
  colonyCounts,
  topAlliances,
  worldFlavor,
} from "./world-intel";
import { colonyGlobePosition } from "./globe-layers";
import type { Alliance, AllianceMember } from "./war/alliances";
import type { KnownColony } from "./worldmap";

function member(colonyId: string, colonyName: string): AllianceMember {
  return { colonyId, colonyName, role: "member", joinedAt: 1 };
}

function alliance(id: string, name: string, members: AllianceMember[]): Alliance {
  return {
    id,
    name,
    banner: "🏳️",
    motto: "",
    members,
    applications: [],
    invites: [],
    foundedAt: 1,
    founderId: members[0]?.colonyId ?? "x",
    homeServerId: "watchers-beta",
    version: 1,
  };
}

function colony(id: string, ownerName: string, status: KnownColony["status"] = "active"): KnownColony {
  return {
    id,
    serverId: "watchers-beta",
    ownerName,
    race: "watchers",
    status,
    lastScouted: 1,
  };
}

describe("worldFlavor", () => {
  test("deterministic per worldId", () => {
    const a = worldFlavor("watchers-beta");
    const b = worldFlavor("watchers-beta");
    expect(a).toEqual(b);
  });
  test("sane ranges", () => {
    for (const id of ["watchers-beta", "grays-world", "nephilim-world", "x"]) {
      const f = worldFlavor(id);
      expect(f.diameterKm >= 6400 && f.diameterKm <= 19000).toBe(true);
      expect(f.meanTempC >= -50 && f.meanTempC <= 45).toBe(true);
    }
  });
});

describe("colonyCounts", () => {
  test("empty / undefined", () => {
    expect(colonyCounts(undefined)).toEqual({
      total: 0, active: 0, abandoned: 0, husk: 0, settingUp: 0,
    });
  });
  test("breaks down by status; sub colonies fold into active", () => {
    const known: Record<string, KnownColony> = {
      a: colony("a", "A", "active"),
      b: colony("b", "B", "abandoned"),
      c: colony("c", "C", "husk"),
      d: colony("d", "D", "sub_colony"),
      e: colony("e", "E", "setting_up"),
    };
    expect(colonyCounts(known)).toEqual({
      total: 5, active: 3, abandoned: 1, husk: 1, settingUp: 1,
    });
  });
});

describe("topAlliances", () => {
  test("top 3 by member count, ties by name", () => {
    const a = alliance("a", "Zulu", [member("1", "A"), member("2", "B")]);
    const b = alliance("b", "Alpha", [member("3", "C"), member("4", "D")]);
    const c = alliance("c", "Big", [member("5", "E"), member("6", "F"), member("7", "G")]);
    const d = alliance("d", "Small", [member("8", "H")]);
    const names = topAlliances({ a, b, c, d }).map((x) => x.name);
    expect(names).toEqual(["Big", "Alpha", "Zulu"]);
  });
  test("absent store → empty", () => {
    expect(topAlliances(undefined)).toEqual([]);
  });
});

describe("allianceTurf", () => {
  test("centroid of matched member colonies", () => {
    const known: Record<string, KnownColony> = {
      "watchers-beta:a": colony("a", "Alice"),
      "watchers-beta:b": colony("b", "Bob"),
    };
    const a = alliance("al", "Al", [member("a", "Alice"), member("b", "Bob")]);
    const turf = allianceTurf(a, known, undefined);
    expect(turf.estimated).toBe(false);
    expect(turf.anchored).toBe(2);
    const pa = colonyGlobePosition("watchers-beta:a");
    const pb = colonyGlobePosition("watchers-beta:b");
    expect(turf.lat).toBeCloseTo((pa.lat + pb.lat) / 2, 9);
    expect(turf.lon).toBeCloseTo((pa.lon + pb.lon) / 2, 9);
  });
  test("player's own colony anchors via the home key", () => {
    const a = alliance("al", "Al", [member("game-1", "Me")]);
    const turf = allianceTurf(a, {}, "game-1");
    expect(turf.estimated).toBe(false);
    expect(turf.anchored).toBe(1);
    const home = colonyGlobePosition("home:game-1");
    expect(turf.lat).toBeCloseTo(home.lat, 9);
    expect(turf.lon).toBeCloseTo(home.lon, 9);
  });
  test("no matchable members → stable hash fallback, flagged estimated", () => {
    const a = alliance("al", "Al", [member("ghost", "Ghost")]);
    const t1 = allianceTurf(a, {}, undefined);
    const t2 = allianceTurf(a, {}, undefined);
    expect(t1.estimated).toBe(true);
    expect(t1.anchored).toBe(0);
    expect(t1).toEqual(t2);
    expect(t1.lat >= -68 && t1.lat <= 68).toBe(true);
  });
  test("name match is case-insensitive", () => {
    const known: Record<string, KnownColony> = {
      "watchers-beta:a": colony("a", "Alice"),
    };
    const a = alliance("al", "Al", [member("other-id", "ALICE")]);
    const turf = allianceTurf(a, known, undefined);
    expect(turf.estimated).toBe(false);
    expect(turf.anchored).toBe(1);
  });
});
