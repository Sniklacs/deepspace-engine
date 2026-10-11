import { describe, expect, test } from "bun:test";
import {
  sweepReplays,
  retentionForBattle,
  defaultBattleName,
  PENDING_REPLAY_TTL_MS,
  type BattleReplay,
} from "./battle-replays";

function replay(over: Partial<BattleReplay> & { id: string }): BattleReplay {
  return {
    battleId: "b1",
    name: "Test",
    attackerName: "A",
    defenderName: "D",
    victor: "attacker",
    startedAt: 0,
    endedAt: 1000,
    durationS: 60,
    pvp: false,
    retention: "pending",
    squads: [],
    kills: { attacker: 0, defender: 0 },
    orders: [],
    keyMoments: [],
    frames: [],
    events: [],
    ...over,
  };
}

describe("battle replay retention", () => {
  test("expired pendings are swept, live ones kept", () => {
    const now = 10_000_000;
    const kept = sweepReplays(
      [
        replay({ id: "old", retention: "pending", expiresAt: now - 1, endedAt: 1 }),
        replay({ id: "fresh", retention: "pending", expiresAt: now + 1000, endedAt: 2 }),
      ],
      now,
    );
    expect(kept.map((r) => r.id)).toEqual(["fresh"]);
  });

  test("manuals and duels survive the sweep", () => {
    const now = 10_000_000;
    const kept = sweepReplays(
      [
        replay({ id: "m", retention: "manual", endedAt: 1 }),
        replay({ id: "d", retention: "duel", pvp: true, endedAt: 2 }),
      ],
      now,
    );
    expect(kept.map((r) => r.id).sort()).toEqual(["d", "m"]);
  });

  test("shelf cap drops oldest non-duels first, never duels", () => {
    const now = 10_000_000;
    const many: BattleReplay[] = [];
    for (let i = 0; i < 40; i++) {
      many.push(replay({ id: `m${i}`, retention: "manual", endedAt: i }));
    }
    many.push(replay({ id: "duel-old", retention: "duel", pvp: true, endedAt: 0 }));
    const kept = sweepReplays(many, now);
    expect(kept.some((r) => r.id === "duel-old")).toBe(true);
    expect(kept.length <= 30).toBe(true);
    // the newest manuals survive
    expect(kept.some((r) => r.id === "m39")).toBe(true);
    expect(kept.some((r) => r.id === "m0")).toBe(false);
  });

  test("retention: duels auto-save, everything else pends", () => {
    expect(retentionForBattle(true)).toBe("duel");
    expect(retentionForBattle(false)).toBe("pending");
  });

  test("pending TTL is 24h", () => {
    expect(PENDING_REPLAY_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  test("default battle name = battle name + date", () => {
    const d = new Date(2026, 9, 11); // Oct 11 2026 local
    expect(defaultBattleName("Chorus Raid", d.getTime())).toBe("Chorus Raid 10/11");
  });
});
