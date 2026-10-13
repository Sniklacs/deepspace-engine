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
  releaseStagingSquad,
  squadEyeCount,
  stampOrder,
  stepOffUnits,
  enemyLineY,
  isBehindLines,
  lineWardenCount,
  canBreachLine,
  judgeJumpDrop,
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

  test("deep ground move with a warden tail is rejected — rear entry is jump-ship only", () => {
    const squad = [
      unit("reaver", "FLANK_LEFT"),
      unit("reaver", "FLANK_LEFT"),
      unit("reaver", "FLANK_LEFT"),
      unit("warden", "FLANK_LEFT"),
    ];
    // defender line holding at y=0.35 — the destination is behind it
    const field = [...squad, unit("bulwark", "MAIN", "defender"), unit("warden", "MAIN", "defender")];
    field[field.length - 2].y = 0.35;
    field[field.length - 1].y = 0.35;
    const v = judgeMoveOrder(squad, { x: 0.85, y: 0.2 }, field);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/jump drop/i);
  });

  test("ground move short of the line is accepted", () => {
    const squad = [unit("reaver", "FLANK_LEFT"), unit("bulwark", "FLANK_LEFT")];
    const field = [...squad, unit("bulwark", "MAIN", "defender")];
    field[field.length - 1].y = 0.35;
    const v = judgeMoveOrder(squad, { x: 0.4, y: 0.5 }, field);
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

describe("releaseStagingSquad — the call-in (owner 2026-10-13)", () => {
  test("an order pulls a mustering squad's entry up to now", () => {
    const rear = unit("thunder", "REAR", "attacker", "staging", "A3");
    rear.enterAtS = 300; // the rear's preset wave time
    const n = releaseStagingSquad([rear], 95);
    expect(n).toBe(1);
    expect(rear.enterAtS).toBe(95);
    // It does NOT teleport or flip state — the staging block still
    // performs the entry (announcement, dropship roar, state machine).
    expect(rear.state).toBe("staging");
  });

  test("units already due or on the field are untouched", () => {
    const due = unit("reaver", "MAIN", "attacker", "staging", "A0");
    due.enterAtS = 30;
    const onField = unit("reaver", "MAIN", "attacker", "holding", "A0");
    onField.enterAtS = 30;
    expect(releaseStagingSquad([due, onField], 95)).toBe(0);
    expect(due.enterAtS).toBe(30);
    expect(onField.enterAtS).toBe(30);
  });

  test("a whole wave releases together", () => {
    const wave = [0, 1, 2].map(() => {
      const u = unit("warden", "REAR", "attacker", "staging", "A3");
      u.enterAtS = 300;
      return u;
    });
    expect(releaseStagingSquad(wave, 120)).toBe(3);
    expect(wave.every((u) => u.enterAtS === 120)).toBe(true);
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

describe("rear-entry doctrine (owner 2026-10-11)", () => {
  // defender line at y=0.35 (MAIN), attacker line at y=0.9
  function field() {
    const d1 = unit("bulwark", "MAIN", "defender");
    const d2 = unit("warden", "MAIN", "defender");
    const a1 = unit("bulwark", "MAIN", "attacker");
    d1.y = 0.35; d2.y = 0.35; a1.y = 0.9;
    return { d1, d2, a1 };
  }

  test("enemyLineY finds the defender's forward line", () => {
    const { d1, d2, a1 } = field();
    expect(enemyLineY([d1, d2, a1], "attacker")).toBe(0.35);
  });

  test("enemyLineY is null when the enemy line is gone", () => {
    const a1 = unit("bulwark", "MAIN", "attacker");
    expect(enemyLineY([a1], "attacker")).toBe(null);
  });

  test("isBehindLines: north of the defender line is behind", () => {
    const { d1, d2, a1 } = field();
    const all = [d1, d2, a1];
    expect(isBehindLines({ x: 0.75, y: 0.2 }, all, "attacker")).toBe(true);
    expect(isBehindLines({ x: 0.75, y: 0.5 }, all, "attacker")).toBe(false);
  });

  test("lineWardenCount tracks the guards", () => {
    const { d1, d2, a1 } = field();
    expect(lineWardenCount([d1, d2, a1], "attacker")).toBe(1);
    d2.state = "dead";
    expect(lineWardenCount([d1, d2, a1], "attacker")).toBe(0);
  });

  test("canBreachLine: reavers breach only a broken line", () => {
    const { d1, d2, a1 } = field();
    const reavers = [unit("reaver", "FLANK_LEFT"), unit("reaver", "FLANK_LEFT")];
    const bulwarks = [unit("bulwark", "FLANK_LEFT")];
    const all = [d1, d2, a1, ...reavers, ...bulwarks];
    // intact line (warden holding) — nobody breaches
    expect(canBreachLine(reavers, all, "attacker")).toBe(false);
    // grind the warden down — the line breaks
    d2.state = "dead";
    expect(canBreachLine(reavers, all, "attacker")).toBe(true);
    // regular squads still can't
    expect(canBreachLine(bulwarks, all, "attacker")).toBe(false);
  });

  test("judgeJumpDrop needs warden escort", () => {
    const noEscort = [unit("reaver", "FLANK_LEFT"), unit("reaver", "FLANK_LEFT")];
    expect(judgeJumpDrop(noEscort).ok).toBe(false);
    const escort = [
      unit("reaver", "FLANK_LEFT"),
      unit("reaver", "FLANK_LEFT"),
      unit("reaver", "FLANK_LEFT"),
      unit("warden", "FLANK_LEFT"),
    ];
    expect(judgeJumpDrop(escort).ok).toBe(true);
  });

  test("judgeJumpDrop respects the one-way door", () => {
    const escort = [
      unit("reaver", "MAIN", "attacker", "engaged"),
      unit("warden", "MAIN"),
    ];
    expect(judgeJumpDrop(escort).ok).toBe(false);
  });
});
