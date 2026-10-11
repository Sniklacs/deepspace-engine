import { describe, expect, test } from "bun:test";
import { encodeFormationShare, decodeFormationShare, extractShareCode } from "./formation-share";
import { formationFromBattle, type SlotLoads } from "./playbook";
import { compactReplay, type BattleReplay } from "./battle-replays";

const draft: { name: string; playId: string; loads: SlotLoads; slotMeta: { __slots: never[] } } = {
  name: "Hammer 10/11",
  playId: "custom",
  loads: {
    A0: [
      { type: "bulwark", tier: 2, count: 10 },
      { type: "reaver", tier: 2, count: 8 },
    ],
    A4: [{ type: "thunder", tier: 3, count: 4 }],
  },
  slotMeta: { __slots: [] },
};

describe("formation share codes", () => {
  test("round-trips through encode/decode", () => {
    const code = encodeFormationShare(draft);
    expect(code.startsWith("DOCTRINE-")).toBe(true);
    // copy-paste safe: only unreserved URL chars
    expect(/^[A-Za-z0-9\-_]+$/.test(code)).toBe(true);
    const back = decodeFormationShare(code);
    expect(back?.name).toBe("Hammer 10/11");
    expect(back?.playId).toBe("custom");
    expect(back?.loads).toEqual(draft.loads);
  });

  test("extracts from surrounding prose / URLs", () => {
    const code = encodeFormationShare(draft);
    expect(extractShareCode(`check this out: ${code} it's great`)).toBe(code);
    expect(extractShareCode(`https://the-unbound-chi.vercel.app/war?formation=${code}`)).toBe(code);
    expect(decodeFormationShare(`sent you ${code}!`)?.name).toBe("Hammer 10/11");
  });

  test("rejects garbage", () => {
    expect(decodeFormationShare("")).toBeNull();
    expect(decodeFormationShare("hello world")).toBeNull();
    expect(decodeFormationShare("DOCTRINE-!!!")).toBeNull();
    expect(decodeFormationShare("DOCTRINE-" + btoa("not json").replace(/=+$/, ""))).toBeNull();
  });
});

describe("formationFromBattle", () => {
  test("captures squads, composition, and starting positions", () => {
    const out = formationFromBattle(
      [
        { id: "A0", name: "Squad 1" },
        { id: "A4", name: "Rear" },
      ],
      [
        { squadId: "A0", kind: "bulwark", tier: 2, x: 0.4, y: 0.5, vector: "MAIN" },
        { squadId: "A0", kind: "bulwark", tier: 2, x: 0.42, y: 0.52, vector: "MAIN" },
        { squadId: "A0", kind: "reaver", tier: 3, x: 0.41, y: 0.51, vector: "MAIN" },
        { squadId: "A4", kind: "thunder", tier: 3, x: 0.5, y: 0.8, vector: "REAR", onCall: true },
        { squadId: "A4", kind: "thunder", tier: 3, x: 0.52, y: 0.81, vector: "REAR", onCall: true },
      ],
    );
    expect(out.playId).toBe("custom");
    expect(out.loads["A0"]).toEqual([
      { type: "bulwark", tier: 2, count: 2 },
      { type: "reaver", tier: 3, count: 1 },
    ]);
    expect(out.loads["A4"]).toEqual([{ type: "thunder", tier: 3, count: 2 }]);
    const slots = (out.slotMeta as { __slots: { id: string; dx: number; dy: number; vector: string; entry: { kind: string } }[] }).__slots;
    const s0 = slots.find((s) => s.id === "A0")!;
    expect(s0.vector).toBe("MAIN");
    expect(s0.entry.kind).toBe("start");
    expect(s0.dx).toBeCloseTo(0.41, 2);
    const s4 = slots.find((s) => s.id === "A4")!;
    expect(s4.vector).toBe("REAR");
    expect(s4.entry.kind).toBe("oncall");
  });

  test("skips empty squads", () => {
    const out = formationFromBattle([{ id: "A0", name: "Squad 1" }], []);
    expect(Object.keys(out.loads)).toHaveLength(0);
  });
});

describe("compactReplay", () => {
  function bigReplay(frames: number, units: number): BattleReplay {
    const fs = [];
    for (let f = 0; f < frames; f++) {
      const us = [];
      for (let i = 0; i < units; i++) {
        us.push({ i: `u${i}`, x: 0.123456, y: 0.654321, s: (i % 2 === 0 ? "attacker" : "defender") as "attacker" | "defender", k: "bulwark", st: "advancing" });
      }
      fs.push({ t: f, units: us });
    }
    return {
      id: "r1", battleId: "b1", name: "T", attackerName: "A", defenderName: "D",
      victor: "attacker", startedAt: 0, endedAt: frames * 1000, durationS: frames,
      pvp: false, retention: "pending", squads: [], kills: { attacker: 0, defender: 0 },
      orders: [], keyMoments: [], frames: fs, events: [],
    };
  }

  test("fits the byte budget via adaptive downsampling", () => {
    const compact = compactReplay(bigReplay(300, 100));
    const bytes = JSON.stringify(compact).length;
    expect(bytes <= 24 * 1024).toBe(true);
    expect(compact.frames.length).toBeGreaterThan(0);
    expect(compact.victor).toBe("attacker");
    expect(compact.kinds.includes("bulwark")).toBe(true);
  });

  test("small replays keep full resolution", () => {
    const compact = compactReplay(bigReplay(10, 5));
    expect(compact.frames.length).toBe(10);
    expect(compact.stepS).toBe(1);
  });
});
