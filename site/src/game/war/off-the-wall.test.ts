// OFF THE WALL — the live layer's contract (design/war-room-walls.md).
// The wall is LIVE or it's a poster: these tests pin the feed to the real
// battle ledger, the lesson to the last battle, the rotation to the day,
// and the owner's locked scrawl to its exact characters.

import { describe, expect, test } from "bun:test";
import {
  WALL_MAXIMS,
  WALL_FIELD_MARKS,
  WALL_SCRAWLS,
  wallLiveFeed,
  lessonMaximFor,
  wallContextualTips,
  wallOracleWord,
  rotateDaily,
  freshScrawls,
  wallDayKey,
  type WallBattleSlice,
  type WallContext,
} from "./off-the-wall";

const ME = "colony-me";
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0); // Oct 13 2026

function battle(partial: Partial<WallBattleSlice> & { id: string }): WallBattleSlice {
  return {
    zoneName: "Ashen Wastes",
    status: "active",
    startedAt: NOW - 60_000,
    attacker: { colonyId: ME, colonyName: "Mine", troops: 100 },
    defender: { colonyId: "colony-foe", colonyName: "Foe", troops: 100 },
    casualties: { attacker: 0, defender: 0 },
    result: null,
    ...partial,
  };
}

function ctx(partial: Partial<WallContext> = {}): WallContext {
  return { me: ME, battles: [], chorusAttention: 0, corruption: 0, now: NOW, ...partial };
}

describe("the corpus", () => {
  test("the playbook board carries all 24 maxims, each with a magnified body", () => {
    expect(WALL_MAXIMS.length).toBe(24);
    for (const m of WALL_MAXIMS) {
      expect(m.chalk.length).toBeGreaterThan(0);
      expect(m.body && m.body.length).toBeGreaterThan(m.chalk.length);
    }
  });

  test("the prominent locked wall lines are exact", () => {
    const byId = Object.fromEntries(WALL_MAXIMS.map((m) => [m.id, m.chalk]));
    expect(byId["clock-45"]).toBe("45 seconds to get your shit straight.");
    expect(byId["commitment"]).toBe("Casualties means commitment.");
    expect(byId["relief"]).toBe("Rescue is a maneuver, not a button.");
  });

  test("field marks carry the Oct 11 doctrine additions", () => {
    expect(WALL_FIELD_MARKS.map((m) => m.id)).toEqual(["rear-entry", "breach", "siege-falloff", "shields", "governor"]);
  });

  test("the owner's extraction scrawl is VERBATIM and locked, first on the board", () => {
    expect(WALL_SCRAWLS[0].id).toBe("extraction");
    expect(WALL_SCRAWLS[0].locked).toBe(true);
    expect(WALL_SCRAWLS[0].chalk).toBe(
      "I hope you have that elite squad at home waiting, ready to roll if shit hits the fan and your ass needs carrying out of there.",
    );
  });

  test("scrawls are never explained — no bodies, per spec", () => {
    for (const s of WALL_SCRAWLS) expect(s.body).toBeUndefined();
  });
});

describe("wallLiveFeed — the war board reads the real ledger", () => {
  test("no battles: no fronts, no last battle, the approach lesson", () => {
    const feed = wallLiveFeed(ctx());
    expect(feed.fronts).toEqual([]);
    expect(feed.lastBattle).toBeNull();
    expect(feed.battlesFought).toBe(0);
    expect(feed.lessonMaximId).toBe("approach");
  });

  test("active fronts list only the player's, with the foe named", () => {
    const feed = wallLiveFeed(
      ctx({
        battles: [
          battle({ id: "b1" }),
          battle({
            id: "b2",
            zoneName: "Far Shore",
            attacker: { colonyId: "colony-x", colonyName: "X", troops: 50 },
            defender: { colonyId: ME, colonyName: "Mine", troops: 50 },
          }),
          battle({
            id: "b3",
            attacker: { colonyId: "colony-x", colonyName: "X", troops: 50 },
            defender: { colonyId: "colony-y", colonyName: "Y", troops: 50 },
          }),
        ],
      }),
    );
    expect(feed.fronts.length).toBe(2);
    expect(feed.fronts.find((f) => f.battleId === "b1")?.attacking).toBe(true);
    expect(feed.fronts.find((f) => f.battleId === "b2")?.attacking).toBe(false);
    expect(feed.fronts.find((f) => f.battleId === "b2")?.foeName).toBe("X");
  });

  test("the last battle is the most recently ENDED of the player's, with sides read correctly", () => {
    const feed = wallLiveFeed(
      ctx({
        battles: [
          battle({
            id: "old",
            status: "resolved",
            casualties: { attacker: 5, defender: 9 },
            result: { outcome: "attacker_victory", winnerColonyId: ME, endedAt: NOW - 10_000 },
          }),
          battle({
            id: "new",
            status: "resolved",
            attacker: { colonyId: "colony-foe", colonyName: "Foe", troops: 80 },
            defender: { colonyId: ME, colonyName: "Mine", troops: 80 },
            casualties: { attacker: 3, defender: 12 },
            result: { outcome: "attacker_victory", winnerColonyId: "colony-foe", endedAt: NOW - 1_000 },
          }),
        ],
      }),
    );
    expect(feed.battlesFought).toBe(2);
    expect(feed.lastBattle?.battleId).toBe("new");
    expect(feed.lastBattle?.won).toBe(false);
    // I defended: my casualties are the DEFENDER's number.
    expect(feed.lastBattle?.myCasualties).toBe(12);
    expect(feed.lastBattle?.theirCasualties).toBe(3);
    expect(feed.lessonMaximId).toBe("commitment");
  });
});

describe("lessonMaximFor — the wall teaches what the field just taught", () => {
  const base = { battleId: "b", zoneName: "Z", foeName: "F", myCasualties: 0, theirCasualties: 0, endedByRetreat: false, endedAt: 1 };
  test("retreat teaches relief", () => {
    expect(lessonMaximFor({ ...base, won: false, endedByRetreat: true }, 3)).toBe("relief");
  });
  test("a standoff teaches thresholds", () => {
    expect(lessonMaximFor({ ...base, won: null }, 3)).toBe("thresholds");
  });
  test("a bloody win teaches the reserve", () => {
    expect(lessonMaximFor({ ...base, won: true, myCasualties: 20, theirCasualties: 10 }, 3)).toBe("ace");
  });
  test("a clean win teaches first blood", () => {
    expect(lessonMaximFor({ ...base, won: true, myCasualties: 2, theirCasualties: 30 }, 3)).toBe("field-control");
  });
});

describe("daily rotation — same wall all day, new wall tomorrow", () => {
  test("rotateDaily is stable within a day and wraps without repeats", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = rotateDaily(items, NOW, 3);
    const b = rotateDaily(items, NOW + 3_600_000, 3);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(rotateDaily(items, NOW, 99).length).toBe(8);
  });

  test("freshScrawls returns distinct scrawls and the day key is a UTC date", () => {
    const fresh = freshScrawls(NOW);
    expect(fresh.length).toBe(3);
    expect(new Set(fresh.map((s) => s.id)).size).toBe(3);
    expect(wallDayKey(NOW)).toBe("2026-10-13");
  });
});

describe("wallContextualTips — the corpus follows the player's meters", () => {
  test("quiet state: three rotation tips, no forced reasons", () => {
    const tips = wallContextualTips(ctx(), wallLiveFeed(ctx()));
    expect(tips.length).toBe(3);
    expect(tips.every((t) => t.because === "")).toBe(true);
  });

  test("hot meters force their tips to the front with reasons", () => {
    const c = ctx({ chorusAttention: 80, corruption: 90 });
    const tips = wallContextualTips(c, wallLiveFeed(c));
    expect(tips[0].id).toBe("chorus");
    expect(tips[0].because.includes("Chorus")).toBe(true);
    expect(tips[1].id).toBe("corruption");
    expect(tips.length).toBe(3);
  });

  test("a live front surfaces the risk tip", () => {
    const c = ctx({ battles: [battle({ id: "b1" })] });
    const tips = wallContextualTips(c, wallLiveFeed(c));
    expect(tips.some((t) => t.id === "risk")).toBe(true);
  });
});

describe("wallOracleWord — the player's own Oracle, daily", () => {
  test("a known race gets its Oracle's name and one of its riddles", () => {
    const w = wallOracleWord("watchers", NOW);
    expect(w).not.toBeNull();
    expect(w!.oracleName.length).toBeGreaterThan(0);
    expect(w!.line.length).toBeGreaterThan(0);
  });

  test("stable within the day; unknown race or none → null", () => {
    expect(wallOracleWord("grays", NOW)).toEqual(wallOracleWord("grays", NOW + 60_000));
    expect(wallOracleWord(null, NOW)).toBeNull();
    expect(wallOracleWord("not-a-race", NOW)).toBeNull();
  });
});
