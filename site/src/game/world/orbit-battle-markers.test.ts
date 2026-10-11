// Tests for the orbit dust-cloud markers (game/world/orbit-battle-markers.ts).
// Run: bun test site/src/game/world/orbit-battle-markers.test.ts
import { describe, expect, test } from "bun:test";
import {
  battleFeed,
  battleIntensity,
  battleKind,
  buildOrbitBattleFeeds,
  casualtyRatePerSec,
  clusterOrbitFeeds,
  defaultBattlePosition,
  drawOrbitBattleMarkers,
  feedSeed,
  INTENSITY_REFERENCE,
  ORBIT_FEED_MAX,
  type OrbitBattleFeed,
} from "./orbit-battle-markers";
import type { Battle } from "../war/war-types";

/** Minimal battle fixture — only the fields the marker feed reads at
 *  runtime (plus the entity's identity fields), cast to Battle. */
function makeBattle(over: Record<string, unknown> = {}): Battle {
  return {
    id: "b1",
    zoneId: "outer-ruins",
    status: "active",
    startedAt: Date.now() - 5 * 60_000,
    durationMs: 30 * 60_000,
    attacker: { troops: 1000, colonyName: "Snacks Hell" },
    defender: { troops: 800, colonyName: "The Chorus" },
    casualties: { attacker: 120, defender: 200 },
    decisions: [],
    ...over,
  } as unknown as Battle;
}

function makeFeed(over: Partial<OrbitBattleFeed> = {}): OrbitBattleFeed {
  return {
    id: "f1",
    lat: 10,
    lon: 20,
    kind: "chorus",
    intensity: 0.5,
    troops: 1800,
    ...over,
  };
}

/** Minimal 2D-context mock that records draw calls. */
function mockCtx() {
  const calls: string[] = [];
  const grad = { addColorStop: (..._a: unknown[]) => calls.push("stop") };
  const ctx = {
    calls,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    createRadialGradient: (..._a: unknown[]) => {
      calls.push("grad");
      return grad;
    },
    beginPath: () => calls.push("beginPath"),
    arc: (..._a: unknown[]) => calls.push("arc"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe("battleKind — the orbit color language", () => {
  test("Chorus on either side reads warm/ash (chorus)", () => {
    expect(battleKind(makeBattle())).toBe("chorus");
    expect(
      battleKind(
        makeBattle({
          attacker: { troops: 100, colonyName: "The Chorus" },
          defender: { troops: 100, colonyName: "Rival Colony" },
        }),
      ),
    ).toBe("chorus");
  });

  test("colony-vs-colony reads PvP (red fringe)", () => {
    expect(
      battleKind(
        makeBattle({
          attacker: { troops: 100, colonyName: "Snacks Hell" },
          defender: { troops: 100, colonyName: "Rival Colony" },
        }),
      ),
    ).toBe("pvp");
  });
});

describe("casualtyRatePerSec + battleIntensity — troops × recent casualty rate", () => {
  test("a bleeding battle has a positive rate; a bloodless one is zero", () => {
    const now = Date.now();
    expect(casualtyRatePerSec(makeBattle(), now)).toBeGreaterThan(0);
    expect(
      casualtyRatePerSec(
        makeBattle({ casualties: { attacker: 0, defender: 0 } }),
        now,
      ),
    ).toBe(0);
  });

  test("zero troops → zero intensity, never NaN", () => {
    const b = makeBattle({
      attacker: { troops: 0, colonyName: "A" },
      defender: { troops: 0, colonyName: "The Chorus" },
    });
    expect(battleIntensity(b, Date.now())).toBe(0);
  });

  test("intensity is normalized to [0, 1] and grows with scale", () => {
    const now = Date.now();
    const skirmish = battleIntensity(
      makeBattle({
        attacker: { troops: 60, colonyName: "A" },
        defender: { troops: 40, colonyName: "The Chorus" },
        casualties: { attacker: 4, defender: 6 },
      }),
      now,
    );
    const invasion = battleIntensity(
      makeBattle({
        attacker: { troops: 5000, colonyName: "A" },
        defender: { troops: 4000, colonyName: "The Chorus" },
        casualties: { attacker: 1500, defender: 2100 },
        durationMs: 30 * 60_000,
      }),
      now,
    );
    expect(skirmish).toBeGreaterThan(0);
    expect(skirmish).toBeLessThan(1);
    expect(invasion).toBeGreaterThan(skirmish);
    expect(invasion).toBeLessThan(1.0001);
    expect(INTENSITY_REFERENCE).toBeGreaterThan(0);
  });
});

describe("defaultBattlePosition — battles sit where they are fought", () => {
  test("a Chorus-site battle resolves to its site's globe position", () => {
    const pos = defaultBattlePosition(makeBattle({ zoneId: "outer-ruins" }));
    expect(pos).toBeDefined();
    expect(pos!.lat).toBeGreaterThan(-80);
    expect(pos!.lat).toBeLessThan(80);
  });

  test("unknown zones and PvP battles resolve null (caller falls back)", () => {
    expect(defaultBattlePosition(makeBattle({ zoneId: "nope-not-a-zone" }))).toBeNull();
    expect(
      defaultBattlePosition(
        makeBattle({
          attacker: { troops: 100, colonyName: "A" },
          defender: { troops: 100, colonyName: "B" },
        }),
      ),
    ).toBeNull();
  });
});

describe("battleFeed — what scorches the planet", () => {
  test("resolved battles and arena bouts never become clouds", () => {
    const now = Date.now();
    expect(battleFeed(makeBattle({ status: "resolved" }), now)).toBeNull();
    expect(
      battleFeed(makeBattle({ arena: { challengeId: "c1", stakes: false } }), now),
    ).toBeNull();
  });

  test("an active Chorus battle becomes a feed with intensity", () => {
    const f = battleFeed(makeBattle(), Date.now());
    expect(f).toBeDefined();
    expect(f!.kind).toBe("chorus");
    expect(f!.intensity).toBeGreaterThan(0);
    expect(f!.troops).toBe(1800);
  });

  test("a custom resolver can place PvP battles (e.g. home defense)", () => {
    const b = makeBattle({
      attacker: { troops: 100, colonyName: "A" },
      defender: { troops: 100, colonyName: "B" },
    });
    const f = battleFeed(b, Date.now(), () => ({ lat: 5, lon: 6 }));
    expect(f).toBeDefined();
    expect(f!.lat).toBe(5);
    expect(f!.kind).toBe("pvp");
  });
});

describe("buildOrbitBattleFeeds", () => {
  test("mix of battles → only the live, placeable ones", () => {
    const now = Date.now();
    const feeds = buildOrbitBattleFeeds(
      [
        makeBattle({ id: "live1" }),
        makeBattle({ id: "dead", status: "resolved" }),
        makeBattle({ id: "pvp", attacker: { troops: 50, colonyName: "A" }, defender: { troops: 50, colonyName: "B" } }),
      ],
      now,
      (b) => (b.id === "pvp" ? { lat: 1, lon: 2 } : defaultBattlePosition(b)),
    );
    expect(feeds).toHaveLength(2);
  });
});

describe("clusterOrbitFeeds — the ~40-cloud cap", () => {
  test("at or under the cap nothing merges", () => {
    const feeds = Array.from({ length: ORBIT_FEED_MAX }, (_, i) =>
      makeFeed({ id: `f${i}`, intensity: 0.1 + i / ORBIT_FEED_MAX }),
    );
    expect(clusterOrbitFeeds(feeds)).toHaveLength(ORBIT_FEED_MAX);
  });

  test("past the cap the dimmest merge into one regional haze", () => {
    const feeds = Array.from({ length: ORBIT_FEED_MAX + 5 }, (_, i) =>
      makeFeed({ id: `f${i}`, lat: i, lon: i * 2, intensity: 0.9 - i * 0.01, kind: i % 2 ? "pvp" : "chorus" }),
    );
    const out = clusterOrbitFeeds(feeds);
    expect(out).toHaveLength(ORBIT_FEED_MAX);
    const haze = out.find((f) => f.id === "haze:cluster");
    expect(haze).toBeDefined();
    // a PvP cloud merged in → the haze reads PvP
    expect(haze!.kind).toBe("pvp");
    expect(haze!.troops).toBeGreaterThan(0);
  });

  test("the brightest feeds survive the merge", () => {
    const feeds = Array.from({ length: ORBIT_FEED_MAX + 5 }, (_, i) =>
      makeFeed({ id: `f${i}`, intensity: i / (ORBIT_FEED_MAX + 5) }),
    );
    const out = clusterOrbitFeeds(feeds);
    const ids = out.map((f) => f.id);
    expect(ids.includes(`f${ORBIT_FEED_MAX + 4}`)).toBe(true);
  });
});

describe("feedSeed — deterministic churn phases", () => {
  test("stable per id, in [0, 1)", () => {
    expect(feedSeed("abc")).toBe(feedSeed("abc"));
    expect(feedSeed("abc")).toBeGreaterThan(-0.001);
    expect(feedSeed("abc")).toBeLessThan(1);
    expect(feedSeed("abc") === feedSeed("xyz")).toBe(false);
  });
});

describe("drawOrbitBattleMarkers — volumetric dust, no sprite frames", () => {
  const project = (lat: number, lon: number) => ({ x: lon * 2, y: -lat * 2, visible: true });

  test("draws layered gradients and returns tap hit rects", () => {
    const ctx = mockCtx();
    const hits = drawOrbitBattleMarkers(ctx, [makeFeed(), makeFeed({ id: "f2", kind: "pvp" })], project, {
      globeR: 200,
      time: 1.5,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0].lat).toBe(10);
    expect(hits[0].r).toBeGreaterThan(0);
    // 3 gradient layers per cloud + the PvP fringe ring strokes
    expect(ctx.calls.filter((c) => c === "grad").length).toBe(6);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(1);
  });

  test("invisible or fully faded clouds draw nothing and hit nothing", () => {
    const ctx = mockCtx();
    const hidden = drawOrbitBattleMarkers(ctx, [makeFeed()], () => ({ x: 0, y: 0, visible: false }), {
      globeR: 200,
      time: 0,
    });
    expect(hidden).toHaveLength(0);
    const faded = drawOrbitBattleMarkers(ctx, [makeFeed()], project, { globeR: 200, time: 0, alpha: 0 });
    expect(faded).toHaveLength(0);
    expect(ctx.calls).toHaveLength(0);
  });

  test("empty feed list is a no-op", () => {
    const ctx = mockCtx();
    expect(drawOrbitBattleMarkers(ctx, [], project, { globeR: 200, time: 0 })).toHaveLength(0);
  });
});
