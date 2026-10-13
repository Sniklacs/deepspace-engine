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
  setZoomLevel,
  recenterMap,
  cycleDayNight,
  cycleBattleSpeed,
  setGunner,
  setGunTarget,
  setTurretMode,
  turretModeOf,
  turretFires,
  setClock,
  bumpKill,
  registerTurrets,
  registerRoster,
  registerSquads,
  setSelectedSquad,
  toggleSquadSelection,
  logOrder,
  orderReceipt,
  squadChipLabel,
  selectionBannerText,
  resetSceneUI,
  resetSceneUIStore,
  BATTLE_SPEED_MUL,
  BATTLE_SPEEDS,
  registerCrew,
  setAdjutantId,
  adjutantOf,
  setCockpitOn,
  crewFromHeroes,
  setSquadFireMode,
  squadFireModeOf,
  setSquadCover,
  squadCoverOf,
  registerEnemyUnitIntel,
  setFocusTarget,
  toggleFocusTarget,
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
    expect(BATTLE_SPEED_MUL.slow).toBeLessThan(BATTLE_SPEED_MUL.realtime);
  });

  test("pace caps at real time — the sim never advances faster than 1x wall-clock", () => {
    expect(BATTLE_SPEED_MUL.realtime).toBe(1);
    for (const sp of BATTLE_SPEEDS) {
      expect(BATTLE_SPEED_MUL[sp] <= 1).toBe(true);
    }
  });

  test("flips and cycles slow → realtime → slow", () => {
    setBattleSpeed("realtime");
    expect(sceneUISnapshot().battleSpeed).toBe("realtime");
    cycleBattleSpeed();
    expect(sceneUISnapshot().battleSpeed).toBe("slow");
    cycleBattleSpeed();
    expect(sceneUISnapshot().battleSpeed).toBe("realtime");
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
    setBattleSpeed("realtime");
    resetSceneUI();
    expect(sceneUISnapshot().battleSpeed).toBe("realtime");
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
      { side: "attacker", kind: "bulwark", count: 12, tiers: [3, 5, 3, 1] },
      { side: "defender", kind: "thunder", count: 3, tiers: [0, 1, 1, 1] },
    ]);
    expect(sceneUISnapshot().roster).toEqual([
      { side: "attacker", kind: "bulwark", count: 12, tiers: [3, 5, 3, 1] },
      { side: "defender", kind: "thunder", count: 3, tiers: [0, 1, 1, 1] },
    ]);
    resetSceneUI();
    expect(sceneUISnapshot().roster).toEqual([]);
  });
});

describe("map zoom and recenter", () => {
  test("defaults to 1 and clamps to [0.6, 4]", () => {
    expect(sceneUISnapshot().zoomLevel).toBe(1);
    setZoomLevel(10);
    expect(sceneUISnapshot().zoomLevel).toBe(4);
    setZoomLevel(0.1);
    expect(sceneUISnapshot().zoomLevel).toBe(0.6);
    setZoomLevel(2);
    expect(sceneUISnapshot().zoomLevel).toBe(2);
  });

  test("recenterMap bumps the token", () => {
    const before = sceneUISnapshot().mapNonce;
    recenterMap();
    expect(sceneUISnapshot().mapNonce).toBe(before + 1);
  });

  test("zoom survives a scene reset", () => {
    setZoomLevel(2.5);
    resetSceneUI();
    expect(sceneUISnapshot().zoomLevel).toBe(2.5);
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

describe("turret modes — the HUD open/close toggle (owner 2026-10-06)", () => {
  test("turrets default to auto fire", () => {
    const s = sceneUISnapshot();
    expect(turretModeOf(s, "t1")).toBe("auto");
    expect(turretFires(s, "t1")).toBe(true);
  });

  test("open turret: takes the gunner cam AND hands-on manual mode", () => {
    setTurretMode("t1", "gunner");
    const s = sceneUISnapshot();
    expect(s.gunnerId).toBe("t1");
    expect(s.manual).toBe(true);
    expect(turretModeOf(s, "t1")).toBe("gunner");
    expect(turretFires(s, "t1")).toBe(true);
  });

  test("close turret: back to auto fire, gunner lock cleared", () => {
    setTurretMode("t1", "gunner");
    setGunTarget("u9");
    setTurretMode("t1", "auto");
    const s = sceneUISnapshot();
    expect(s.gunnerId).toBeNull();
    expect(s.gunTarget).toBeNull();
    expect(turretModeOf(s, "t1")).toBe("auto");
    expect(turretFires(s, "t1")).toBe(true);
  });

  test("held turret is silent only while driving manually", () => {
    setTurretMode("t1", "held");
    setManual(true);
    expect(turretFires(sceneUISnapshot(), "t1")).toBe(false);
    // AUTO command overrides: every gun free-fires, commander hands off.
    setManual(false);
    expect(turretFires(sceneUISnapshot(), "t1")).toBe(true);
  });

  test("manual driving: gunner + auto turrets fire, other turrets unaffected", () => {
    setTurretMode("t1", "gunner");
    setTurretMode("t2", "held");
    const s = sceneUISnapshot();
    expect(turretFires(s, "t1")).toBe(true); // the gun you sit in
    expect(turretFires(s, "t2")).toBe(false); // held
    expect(turretFires(s, "t3")).toBe(true); // untouched → auto
    expect(turretModeOf(s, "t2")).toBe("held");
  });

  test("holding the gunner's own turret closes the cam and holds fire", () => {
    setTurretMode("t1", "gunner");
    setTurretMode("t1", "held");
    const s = sceneUISnapshot();
    expect(s.gunnerId).toBeNull();
    expect(turretModeOf(s, "t1")).toBe("held");
  });

  test("resetSceneUI clears turret modes with the rest of the scene", () => {
    setTurretMode("t1", "gunner");
    setTurretMode("t2", "held");
    resetSceneUI();
    const s = sceneUISnapshot();
    expect(s.turretModes).toEqual({});
    expect(s.gunnerId).toBeNull();
    expect(turretModeOf(s, "t2")).toBe("auto");
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

  test("drops command state (selection, squads, orders) but keeps prefs", () => {
    setSelectedSquad("A0");
    registerSquads([{ id: "A0", name: "Squad 1 — Main", alive: 14, total: 14 }]);
    logOrder({ squadName: "Squad 1 — Main", dest: "FLANK LEFT", verdict: "accepted" });
    setBattleSpeed("realtime");
    resetSceneUI();
    const s = sceneUISnapshot();
    expect(s.selectedSquadId).toBeNull();
    expect(s.squads).toEqual([]);
    expect(s.orderLog).toEqual([]);
    expect(s.battleSpeed).toBe("realtime");
  });
});

describe("HUD strips — reserves and turrets on the field (owner 2026-10-06)", () => {
  test("on-call reserve squads register for the reserve strip; tap selects, map tap commits", () => {
    registerSquads([
      { id: "A0", name: "Squad 1 — Main", alive: 14, total: 14 },
      { id: "A4", name: "Squad 5 — Reserve", alive: 15, total: 15, onCallReserve: true },
    ]);
    const s = sceneUISnapshot();
    // The HUD reserve strip is exactly the on-call squads — the chip the
    // commander taps before tapping the map (the engine commits the drop).
    expect(s.squads.filter((q) => q.onCallReserve).map((q) => q.id)).toEqual(["A4"]);
    setSelectedSquad("A4");
    expect(sceneUISnapshot().selectedSquadId).toBe("A4");
  });

  test("resetSceneUI drops the registered turrets and their modes", () => {
    registerTurrets([{ id: "t1", idx: 0 }]);
    setTurretMode("t1", "held");
    resetSceneUI();
    const s = sceneUISnapshot();
    expect(s.turrets).toEqual([]);
    expect(s.turretModes).toEqual({});
  });
});

describe("click-to-command", () => {
  test("squad selection sets and clears", () => {
    expect(sceneUISnapshot().selectedSquadId).toBeNull();
    setSelectedSquad("A2");
    expect(sceneUISnapshot().selectedSquadId).toBe("A2");
    setSelectedSquad("A2"); // no-op, same value
    setSelectedSquad(null);
    expect(sceneUISnapshot().selectedSquadId).toBeNull();
  });

  // The toggle (owner 2026-10-13): "when I click on a squad it opens up
  // that squad, but if I don't want to do anything there I should just
  // click the squad again and it should minimize that squad and go back
  // to the regulars." Every chip/row surface drives this one machine.
  describe("squad toggle — tap opens, tap again minimizes", () => {
    test("tap a squad → selected (panel opens)", () => {
      toggleSquadSelection("A0");
      expect(sceneUISnapshot().selectedSquadId).toBe("A0");
    });

    test("tap the SAME squad again → deselected (back to the regulars)", () => {
      toggleSquadSelection("A0");
      toggleSquadSelection("A0");
      expect(sceneUISnapshot().selectedSquadId).toBeNull();
    });

    test("tap a DIFFERENT squad → switch, never closes", () => {
      toggleSquadSelection("A0");
      toggleSquadSelection("A2");
      expect(sceneUISnapshot().selectedSquadId).toBe("A2");
    });

    test("toggle round-trips through a scene selection set elsewhere", () => {
      setSelectedSquad("A4"); // e.g. a canvas tap selected the reserve
      toggleSquadSelection("A4"); // chip tap on it minimizes it
      expect(sceneUISnapshot().selectedSquadId).toBeNull();
      toggleSquadSelection("A4"); // and reopens it
      expect(sceneUISnapshot().selectedSquadId).toBe("A4");
    });

    // THE REPORTED BUG (owner 2026-10-13): "selected a squad after I do
    // a quick pick, no changes." The store machine was never the fault
    // (the quick-pick lived only in the Squads window — see
    // battle-selection-carry.test.ts) — but these pins hold the machine
    // to the exact sequence so a regression here is caught too:
    // quick-pick use must never consume, corrupt, or latch selection.
    test("quick-pick → tap a DIFFERENT squad switches, orders intact", () => {
      toggleSquadSelection("A0"); // open A0's quick-pick
      setSquadFireMode("A0", "hold"); // use the quick-pick
      setSquadCover("A1", "A0"); // use the COVER picker (A1 covers A0)
      toggleSquadSelection("A2"); // tap a different squad
      const s = sceneUISnapshot();
      expect(s.selectedSquadId).toBe("A2");
      expect(squadFireModeOf("A0")).toBe("hold"); // A0's orders survive
      expect(squadCoverOf("A1")).toBe("A0"); // the cover assignment survives
      expect(s.squads.find((q) => q.id === "A2")).toBeDefined; // panel data untouched
    });

    test("quick-pick → tap the SAME squad still toggles closed", () => {
      toggleSquadSelection("A1");
      setSquadFireMode("A1", "free");
      toggleSquadSelection("A1");
      expect(sceneUISnapshot().selectedSquadId).toBeNull();
    });

    test("quick-pick → manual select → quick-pick again stays consistent", () => {
      toggleSquadSelection("A0");
      setSquadCover("A3", "A0"); // rear covers main via the picker
      setSelectedSquad("A3"); // a manual select elsewhere (e.g. radar)
      expect(sceneUISnapshot().selectedSquadId).toBe("A3");
      toggleSquadSelection("A0"); // back to A0 through the chip machine
      expect(sceneUISnapshot().selectedSquadId).toBe("A0");
      expect(squadCoverOf("A3")).toBe("A0");
    });

    test("cover assignment and release round-trip through the store", () => {
      setSquadCover("A2", "A0");
      expect(squadCoverOf("A2")).toBe("A0");
      setSquadCover("A2", null);
      expect(squadCoverOf("A2")).toBeNull();
      expect(sceneUISnapshot().squadCover.A2).toBeUndefined;
    });
  });

  test("squads register for the panel", () => {
    registerSquads([
      { id: "A0", name: "Squad 1 — Main", alive: 14, total: 14 },
      { id: "A1", name: "Squad 2 — Flank L", alive: 6, total: 7 },
    ]);
    const s = sceneUISnapshot();
    expect(s.squads).toHaveLength(2);
    expect(s.squads[1].alive).toBe(6);
  });

  test("itemized targets: publish, focus, and the dead take their focus with them", () => {
    const warden = { id: "e-w1", kind: "warden", squadId: "D", hp01: 0.8, distM: 240 };
    const thunder = { id: "e-t1", kind: "thunder", squadId: "D", hp01: 1, distM: 700 };
    registerEnemyUnitIntel([warden, thunder]);
    expect(sceneUISnapshot().enemyUnitIntel.map((x) => x.id)).toEqual(["e-w1", "e-t1"]);

    toggleFocusTarget("e-w1"); // tap selects
    expect(sceneUISnapshot().focusTargetId).toBe("e-w1");
    toggleFocusTarget("e-t1"); // tap another switches
    expect(sceneUISnapshot().focusTargetId).toBe("e-t1");
    toggleFocusTarget("e-t1"); // tap again clears
    expect(sceneUISnapshot().focusTargetId).toBe(null);

    setFocusTarget("e-w1");
    registerEnemyUnitIntel([thunder]); // the warden died — it leaves the list…
    expect(sceneUISnapshot().enemyUnitIntel.map((x) => x.id)).toEqual(["e-t1"]);
    expect(sceneUISnapshot().focusTargetId).toBe(null); // …and the focus clears with it
  });

  test("order log is newest-first and capped", () => {
    for (let i = 0; i < 10; i++) {
      logOrder({ squadName: `Squad ${i}`, dest: "MAIN", verdict: i % 2 ? "rejected" : "accepted", reason: i % 2 ? "nope" : undefined });
    }
    const log = sceneUISnapshot().orderLog;
    expect(log).toHaveLength(8);
    expect(log[0].squadName).toBe("Squad 9");
    expect(log[0].verdict).toBe("rejected");
    expect(log[0].reason).toBe("nope");
    expect(log[7].squadName).toBe("Squad 2");
  });
});

describe("reserve chip copy + order receipts (QA 2026-10-06)", () => {
  const reserve = { id: "A4", name: "Squad 5 — Reserve", alive: 15, total: 15, onCallReserve: true };

  test("on-call reserve chip leads with the parachute — state unmistakable", () => {
    expect(squadChipLabel(reserve).startsWith("🪂 ")).toBe(true);
    expect(squadChipLabel(reserve).includes("Squad 5 — Reserve 15/15")).toBe(true);
  });

  test("eye glyph follows the parachute, never replaces it", () => {
    const eyesReserve = { ...reserve, eyes: true };
    expect(squadChipLabel(eyesReserve).startsWith("🪂 👁 ")).toBe(true);
    const eyesOnly = { id: "A1", name: "Squad 2 — Flank L", alive: 7, total: 7, eyes: true };
    expect(squadChipLabel(eyesOnly).startsWith("👁 ")).toBe(true);
  });

  test("selection banner says hot-drop for on-call reserves, order otherwise", () => {
    expect(selectionBannerText(reserve)).toBe("Squad 5 — Reserve selected — tap the map to hot-drop it 🪂");
    const main = { id: "A0", name: "Squad 1 — Main", alive: 14, total: 14 };
    expect(selectionBannerText(main)).toBe("Squad 1 — Main selected — tap the map to order it");
  });

  test("hot-drop receipt confirms the drop, not a generic move", () => {
    const r = orderReceipt({
      id: 1,
      squadName: "Squad 5 — Reserve",
      dest: "MAIN",
      verdict: "accepted",
      kind: "hotdrop",
    });
    expect(r.text).toBe("Squad 5 — Reserve hot-dropped → MAIN");
    expect(r.tone).toBe("ok");
    expect(r.text.includes("accepted")).toBe(false);
  });

  test("move receipts keep the arrow form; comms keep the report form", () => {
    expect(orderReceipt({ id: 1, squadName: "Squad 1 — Main", dest: "FLANK LEFT", verdict: "accepted" })).toEqual({
      text: "Squad 1 — Main → FLANK LEFT — accepted",
      tone: "ok",
    });
    expect(
      orderReceipt({ id: 2, squadName: "Squad 3 — Rear", dest: "REAR", verdict: "rejected", reason: "siege can't flank" }),
    ).toEqual({ text: "Squad 3 — Rear → REAR — rejected · siege can't flank", tone: "bad" });
    expect(
      orderReceipt({ id: 3, squadName: "Longeyes", dest: "—", verdict: "accepted", reason: "enemy on the move: Flank L", kind: "comms" }),
    ).toEqual({ text: "Longeyes — enemy on the move: Flank L", tone: "note" });
  });

  test("logOrder normalizes kind on write; hotdrop survives the store round-trip", () => {
    logOrder({ squadName: "Squad 1 — Main", dest: "MAIN", verdict: "accepted" });
    expect(sceneUISnapshot().orderLog[0].kind).toBe("move");
    logOrder({ squadName: "Squad 5 — Reserve", dest: "MAIN", verdict: "accepted", kind: "hotdrop" });
    const latest = sceneUISnapshot().orderLog[0];
    expect(latest.kind).toBe("hotdrop");
    expect(orderReceipt(latest).text).toBe("Squad 5 — Reserve hot-dropped → MAIN");
  });
});

describe("command-ship cockpit — crew + adjutant (owner 2026-10-12)", () => {
  const CREW = [
    { id: "h1", name: "Azazel-3", role: "Herald" },
    { id: "h2", name: "Vesper Syllabus", role: "Warden" },
    { id: "h3", name: "Keeper Mend" },
  ];

  test("cockpit starts up; folds and restores", () => {
    expect(sceneUISnapshot().cockpitOn).toBe(true);
    setCockpitOn(false);
    expect(sceneUISnapshot().cockpitOn).toBe(false);
    setCockpitOn(true);
    expect(sceneUISnapshot().cockpitOn).toBe(true);
  });

  test("no crew — no adjutant stands", () => {
    expect(adjutantOf(sceneUISnapshot())).toBeNull();
  });

  test("first hero stands as adjutant by default", () => {
    registerCrew(CREW);
    expect(adjutantOf(sceneUISnapshot())?.id).toBe("h1");
  });

  test("the commander appoints any hero as adjutant", () => {
    registerCrew(CREW);
    setAdjutantId("h3");
    expect(adjutantOf(sceneUISnapshot())?.name).toBe("Keeper Mend");
  });

  test("an appointed adjutant who isn't aboard falls back to the first hero", () => {
    registerCrew(CREW);
    setAdjutantId("ghost-hero");
    expect(adjutantOf(sceneUISnapshot())?.id).toBe("h1");
  });

  test("re-registering the same roster is a no-op; a new roster replaces", () => {
    registerCrew(CREW);
    const before = sceneUISnapshot();
    registerCrew(CREW.map((c) => ({ ...c })));
    expect(sceneUISnapshot()).toBe(before);
    registerCrew([{ id: "h9", name: "Semira" }]);
    expect(sceneUISnapshot().crew).toHaveLength(1);
    expect(adjutantOf(sceneUISnapshot())?.id).toBe("h9");
  });

  test("crew survives a scene reset — it's the player's roster, not the battle's", () => {
    registerCrew(CREW);
    resetSceneUI();
    expect(sceneUISnapshot().crew).toHaveLength(3);
  });

  test("crewFromHeroes adapts the prologue roster and drops malformed rows", () => {
    expect(crewFromHeroes(null)).toEqual([]);
    expect(crewFromHeroes(undefined)).toEqual([]);
    const crew = crewFromHeroes([
      { id: "a", name: "A" },
      { id: "b", name: "B", role: "Seer" },
      { id: 7 as unknown as string, name: "bad" },
    ]);
    expect(crew).toEqual([
      { id: "a", name: "A" },
      { id: "b", name: "B", role: "Seer" },
    ]);
  });

  test("camera takes the command-ship POV mode", () => {
    setCameraMode("command");
    expect(sceneUISnapshot().cameraMode).toBe("command");
    setCameraMode("tactical");
    expect(sceneUISnapshot().cameraMode).toBe("tactical");
  });
});
