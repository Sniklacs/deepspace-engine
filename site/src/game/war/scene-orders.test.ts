// scene-orders.test.ts — the click-to-command legality judge
// (owner 2026-10-05).
//
// The doctrine, enforced: siege never sweeps, rear entries need their
// Warden tail, engaged units are locked (the one-way door). Illegal orders
// are rejected WITH the reason — never silent.
// Run: bun test site/src/game/war/scene-orders.test.ts
import { describe, expect, test } from "bun:test";
import type { SceneUnit } from "./battle-scene-model";
import type { ManeuverVector } from "./war-types";
import {
  buildSquads,
  isDrivable,
  destLaneOf,
  destLabel,
  hasLongeyeCover,
  judgeMoveOrder,
  DEEP_Y,
  ORDER_DELAY_S,
  squadEyeCount,
  stampOrder,
  stepOffUnits,
} from "./scene-orders";

let n = 0;
function unit(
  kind: SceneUnit["kind"],
  vector: ManeuverVector,
  side: SceneUnit["side"] = "attacker",
  state: SceneUnit["state"] = "holding",
  squadId?: string,
): SceneUnit {
  const player = { MAIN: 0, FLANK_LEFT: 1, FLANK_RIGHT: 2, REAR: 3, RESERVE: 4 }[vector];
  return {
    id: `t${n++}`,
    side,
    kind,
    tier: 2,
    vector,
    squadId: squadId ?? (side === "attacker" ? `A${player}` : "D"),
    x: 0.3,
    y: 0.5,
    tx: 0.4,
    ty: 0.5,
    hp01: 1,
    state,
    enterAtS: 30,
  };
}

describe("buildSquads", () => {
  test("groups attacker units into five buses by vector, defender into the AI", () => {
    const units = [
      unit("bulwark", "MAIN"),
      unit("reaver", "MAIN"),
      unit("reaver", "FLANK_LEFT"),
      unit("thunder", "REAR"),
      unit("warden", "REAR", "defender"),
    ];
    const squads = buildSquads(units);
    const ids = squads.map((s) => s.id).sort();
    expect(ids).toEqual(["A0", "A1", "A3", "D"]);
    const main = squads.find((s) => s.id === "A0")!;
    expect(main.name).toBe("Squad 1 — Main");
    expect(main.unitIds).toHaveLength(2);
    expect(isDrivable(main)).toBe(true);
    const ai = squads.find((s) => s.id === "D")!;
    expect(isDrivable(ai)).toBe(false);
  });

  test("excludes the dead from squads", () => {
    const units = [unit("bulwark", "MAIN"), unit("reaver", "MAIN", "attacker", "dead")];
    const squads = buildSquads(units);
    expect(squads.find((s) => s.id === "A0")!.unitIds).toHaveLength(1);
  });
});

describe("destLaneOf / destLabel", () => {
  test("flank bands map to their lanes", () => {
    expect(destLaneOf(0.22)).toBe("FLANK_LEFT");
    expect(destLaneOf(1.2)).toBe("FLANK_RIGHT");
    expect(destLaneOf(0.75)).toBe("MIDDLE");
  });

  test("labels read doctrinally", () => {
    expect(destLabel(0.3, 0.9)).toBe("FLANK LEFT");
    expect(destLabel(1.2, 0.9)).toBe("FLANK RIGHT");
    expect(destLabel(0.75, 0.2)).toBe("REAR");
    expect(destLabel(0.75, 0.9)).toBe("MAIN");
    expect(DEEP_Y).toBe(0.5);
  });
});

describe("judgeMoveOrder", () => {
  test("thunder ordered to a flank is rejected — siege never sweeps", () => {
    const squad = [unit("thunder", "REAR"), unit("warden", "REAR")];
    const v = judgeMoveOrder(squad, { x: 0.5, y: 0.22 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/flank/i);
  });

  test("thunder ordered deep is rejected — too slow for a deep strike", () => {
    const squad = [unit("thunder", "MAIN"), unit("warden", "MAIN")];
    const v = judgeMoveOrder(squad, { x: 0.85, y: 0.2 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/slow/i);
  });

  test("deep strike without warden escort is rejected", () => {
    const squad = [unit("reaver", "FLANK_LEFT"), unit("reaver", "FLANK_LEFT")];
    const v = judgeMoveOrder(squad, { x: 0.85, y: 0.2 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/warden/i);
  });

  test("deep strike with a warden tail is accepted", () => {
    const squad = [
      unit("reaver", "FLANK_LEFT"),
      unit("reaver", "FLANK_LEFT"),
      unit("reaver", "FLANK_LEFT"),
      unit("warden", "FLANK_LEFT"),
    ];
    const v = judgeMoveOrder(squad, { x: 0.85, y: 0.2 });
    expect(v).toEqual({ ok: true });
  });

  test("engaged squad is locked — the one-way door", () => {
    const squad = [unit("reaver", "MAIN", "attacker", "engaged"), unit("bulwark", "MAIN")];
    const v = judgeMoveOrder(squad, { x: 0.4, y: 0.5 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/commitment/i);
  });

  test("legal moves are accepted", () => {
    const reavers = [unit("reaver", "FLANK_LEFT"), unit("reaver", "FLANK_LEFT")];
    expect(judgeMoveOrder(reavers, { x: 0.75, y: 0.9 })).toEqual({ ok: true });
    const main = [unit("bulwark", "MAIN"), unit("reaver", "MAIN")];
    expect(judgeMoveOrder(main, { x: 0.45, y: 0.5 })).toEqual({ ok: true });
    // Thunder pushing up the middle is honest siege work.
    const siege = [unit("thunder", "MAIN"), unit("bulwark", "MAIN")];
    expect(judgeMoveOrder(siege, { x: 0.75, y: 0.9 })).toEqual({ ok: true });
  });

  test("a squad of only the dead has nothing to order", () => {
    const squad = [unit("reaver", "MAIN", "attacker", "dead")];
    const v = judgeMoveOrder(squad, { x: 0.4, y: 0.5 });
    expect(v.ok).toBe(false);
  });
});

describe("order response time", () => {
  test("stampOrder sets the destination now, step-off after the delay", () => {
    const u = unit("reaver", "MAIN");
    stampOrder(u, 1.0, 1.2, 100);
    expect(u.tx).toBe(1.0);
    expect(u.ty).toBe(1.2);
    expect(u.moveAtS).toBe(100 + ORDER_DELAY_S);
    expect(ORDER_DELAY_S).toBe(3);
  });

  test("stepOffUnits returns only units whose delay has elapsed", () => {
    const a = unit("reaver", "MAIN");
    const b = unit("reaver", "MAIN");
    stampOrder(a, 1, 1, 100); // steps off at 103
    stampOrder(b, 1, 1, 100);
    b.moveAtS = 200; // far future
    expect(stepOffUnits([a, b], 102).length).toBe(0);
    expect(stepOffUnits([a, b], 103).map((u) => u.id)).toEqual([a.id]);
    const c = unit("reaver", "MAIN"); // no order stamped — never steps off
    expect(stepOffUnits([c], 9999).length).toBe(0);
  });

  test("the delay is symmetric — AI orders stamp the same way", () => {
    const u = unit("bulwark", "MAIN", "defender", "holding", "D");
    stampOrder(u, 0.75, 1.0, 50);
    expect(u.moveAtS).toBe(53);
    expect(stepOffUnits([u], 52).length).toBe(0);
    expect(stepOffUnits([u], 53).length).toBe(1);
  });
});

describe("longeye coverage is positional", () => {
  test("squadEyeCount counts living longeyes in the squad", () => {
    const eye = unit("longeye", "FLANK_LEFT");
    const deadEye = unit("longeye", "FLANK_LEFT", "attacker", "dead");
    const wrongSquad = unit("longeye", "MAIN");
    const defenderEye = unit("longeye", "FLANK_LEFT", "defender", "holding", "D");
    const units = [eye, deadEye, wrongSquad, defenderEye];
    // A1 = FLANK_LEFT squad; dead eyes and defender eyes don't count.
    expect(squadEyeCount(units, "A1")).toBe(1);
    expect(squadEyeCount(units, "A0")).toBe(1);
  });

  test("hasLongeyeCover: same-vector rule — eyes only watch their own sector", () => {
    const units = [unit("longeye", "FLANK_LEFT"), unit("bulwark", "MAIN")];
    expect(hasLongeyeCover(units, "FLANK_LEFT")).toBe(true);
    expect(hasLongeyeCover(units, "FLANK_RIGHT")).toBe(false);
    expect(hasLongeyeCover(units, "MAIN")).toBe(false);
    expect(hasLongeyeCover(units, "REAR")).toBe(false);
  });

  test("no living longeyes anywhere = no coverage anywhere", () => {
    const units = [unit("bulwark", "MAIN"), unit("reaver", "FLANK_LEFT")];
    for (const v of ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"] as const) {
      expect(hasLongeyeCover(units, v)).toBe(false);
    }
  });

  test("dead eyes give no coverage — the sector goes blind", () => {
    const units = [unit("longeye", "REAR", "attacker", "dead")];
    expect(hasLongeyeCover(units, "REAR")).toBe(false);
  });
});
