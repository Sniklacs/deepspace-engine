// battle-scene-ui-store.test.ts — the shared UI state for the 2D battle
// scene (owner 2026-10-05).
//
// The canvas and the floating glass control window read/write the same
// store. These tests pin the action contracts: toggles flip, the gunner
// lifecycle clears its lock, the clock/kills move, and resetSceneUI drops
// per-scene state while keeping the player's layer preferences.
// Run: bun test site/src/game/war/battle-scene-ui-store.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  setVectorOn,
  setTurretsOn,
  setLogisticsFx,
  setManual,
  setDayNight,
  setCameraMode,
  setBattleSpeed,
  setLabelsOn,
  cycleDayNight,
  cycleBattleSpeed,
  setGunner,
  setGunTarget,
  setClock,
  bumpKill,
  registerTurrets,
  registerRoster,
  resetSceneUI,
  resetSceneUIStore,
  BATTLE_SPEED_MUL,
} from "./battle-scene-ui-store";

beforeEach(() => {
  resetSceneUIStore();
});

describe("toggles", () => {
  test("vector layers flip individually", () => {
    setVectorOn("MAIN", false);
    expect(sceneUISnapshot().vectorsOn.MAIN).toBe(false);
    expect(sceneUISnapshot().vectorsOn.REAR).toBe(true);
    setVectorOn("MAIN", true);
    expect(sceneUISnapshot().vectorsOn.MAIN).toBe(true);
  });

  test("turrets / logistics fx flip", () => {
    setTurretsOn(false);
    setLogisticsFx(false);
    expect(sceneUISnapshot().turretsOn).toBe(false);
    expect(sceneUISnapshot().logisticsFx).toBe(false);
  });

  test("manual mode flips", () => {
    setManual(true);
    expect(sceneUISnapshot().manual).toBe(true);
  });

  test("day/night cycles auto → night → day → auto", () => {
    expect(sceneUISnapshot().dayNight).toBe("auto");
    cycleDayNight();
    expect(sceneUISnapshot().dayNight).toBe("night");
    cycleDayNight();
    expect(sceneUISnapshot().dayNight).toBe("day");
    cycleDayNight();
    expect(sceneUISnapshot().dayNight).toBe("auto");
    setDayNight("night");
    expect(sceneUISnapshot().dayNight).toBe("night");
  });
});

describe("camera mode", () => {
  test("defaults to tactical and flips to ground", () => {
    expect(sceneUISnapshot().cameraMode).toBe("tactical");
    setCameraMode("ground");
    expect(sceneUISnapshot().cameraMode).toBe("ground");
    setCameraMode("tactical");
    expect(sceneUISnapshot().cameraMode).toBe("tactical");
  });

  test("no-ops when the mode is unchanged", () => {
    let calls = 0;
    const unsub = subscribeSceneUI(() => {
      calls += 1;
    });
    setCameraMode("tactical");
    unsub();
    expect(calls).toBe(0);
  });

  test("survives a scene reset like the other player preferences", () => {
    setCameraMode("ground");
    resetSceneUI();
    expect(sceneUISnapshot().cameraMode).toBe("ground");
  });
});

describe("battle speed", () => {
  test("defaults to slow, multipliers ascend", () => {
    expect(sceneUISnapshot().battleSpeed).toBe("slow");
    expect(BATTLE_SPEED_MUL.slow).toBeLessThan(BATTLE_SPEED_MUL.normal);
    expect(BATTLE_SPEED_MUL.normal).toBeLessThan(BATTLE_SPEED_MUL.fast);
  });

  test("flips and cycles slow → normal → fast → slow", () => {
    setBattleSpeed("fast");
    expect(sceneUISnapshot().battleSpeed).toBe("fast");
    cycleBattleSpeed();
    expect(sceneUISnapshot().battleSpeed).toBe("slow");
    cycleBattleSpeed();
    expect(sceneUISnapshot().battleSpeed).toBe("normal");
  });

  test("no-ops when unchanged", () => {
    let calls = 0;
    const unsub = subscribeSceneUI(() => {
      calls += 1;
    });
    setBattleSpeed("slow");
    unsub();
    expect(calls).toBe(0);
  });

  test("survives a scene reset like the other player preferences", () => {
    setBattleSpeed("fast");
    resetSceneUI();
    expect(sceneUISnapshot().battleSpeed).toBe("fast");
  });
});

describe("unit labels", () => {
  test("default on, flips, survives a scene reset", () => {
    expect(sceneUISnapshot().labelsOn).toBe(true);
    setLabelsOn(false);
    expect(sceneUISnapshot().labelsOn).toBe(false);
    resetSceneUI();
    expect(sceneUISnapshot().labelsOn).toBe(false);
  });
});

describe("field force roster", () => {
  test("registers counts and clears on scene reset", () => {
    registerRoster([
      { side: "attacker", kind: "bulwark", count: 12 },
      { side: "defender", kind: "thunder", count: 3 },
    ]);
    expect(sceneUISnapshot().roster).toEqual([
      { side: "attacker", kind: "bulwark", count: 12 },
      { side: "defender", kind: "thunder", count: 3 },
    ]);
    resetSceneUI();
    expect(sceneUISnapshot().roster).toEqual([]);
  });
});

describe("gunner lifecycle", () => {
  test("taking and leaving the gunner cam clears the target lock", () => {
    registerTurrets([{ id: "t1", idx: 0 }]);
    setGunner("t1");
    setGunTarget("u9");
    expect(sceneUISnapshot().gunnerId).toBe("t1");
    expect(sceneUISnapshot().gunTarget).toBe("u9");
    setGunner(null);
    expect(sceneUISnapshot().gunnerId).toBeNull();
    expect(sceneUISnapshot().gunTarget).toBeNull();
  });
});

describe("clock and kills", () => {
  test("clock advances and kills tally per side", () => {
    setClock(42.5);
    expect(sceneUISnapshot().tS).toBe(42.5);
    bumpKill("attacker");
    bumpKill("defender");
    bumpKill("defender");
    expect(sceneUISnapshot().kills).toEqual({ attacker: 1, defender: 2 });
  });

  test("subscribers are notified", () => {
    let calls = 0;
    const unsub = subscribeSceneUI(() => {
      calls += 1;
    });
    setManual(true);
    unsub();
    setManual(false);
    expect(calls).toBe(1);
  });
});

describe("resetSceneUI", () => {
  test("drops per-scene state but keeps layer preferences", () => {
    setVectorOn("REAR", false);
    setManual(true);
    setClock(90);
    bumpKill("attacker");
    registerTurrets([{ id: "t1", idx: 0 }]);
    setGunner("t1");
    resetSceneUI();
    const s = sceneUISnapshot();
    expect(s.tS).toBe(0);
    expect(s.kills).toEqual({ attacker: 0, defender: 0 });
    expect(s.gunnerId).toBeNull();
    expect(s.gunTarget).toBeNull();
    expect(s.turrets).toEqual([]);
    // The player's layer/command preferences survive a scene change.
    expect(s.vectorsOn.REAR).toBe(false);
    expect(s.manual).toBe(true);
  });
});
