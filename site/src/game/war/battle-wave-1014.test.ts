// BATTLE WAVE 2026-10-14 — the live-bug wave from Hans's battle on build
// 4e666a0. Pins, in one place:
//   • the rear-flank lift + driven descent landing BEHIND the enemy line
//     (the headline: comms promised the drop, zero units lifted);
//   • commitment keyed on genuine fire contact + fallback always open
//     (pure-judge cases live in scene-orders.test.ts; here: the sim
//     stamps and the step-off disengage are source-pinned);
//   • the allegiance census: every dealDamage call site in the scene is
//     either side-clean direct fire or a NAMED splash mechanic — a new
//     call site fails this test until a human classifies it;
//   • entry announcements name a sector (sectorLabel) and ping it;
//   • refusals speak in the persistent comms feed, not only the toast;
//   • the map view's pan/zoom math (radar viewport helpers);
//   • quick-pick Exit Law (44px ✕) + Cover above the fold; mode pill.
// Run: bun test site/src/game/war/battle-wave-1014.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoScene, scatterLanding } from "./battle-scene-model";
import {
  commitJumpDrop,
  enemyLineY,
  isBehindLines,
  judgeJumpDrop,
  sectorLabel,
} from "./scene-orders";
import {
  RADAR_VIEW_FULL,
  centerRadarView,
  panRadarView,
  radarBoxToWorld,
  radarViewSpan,
  radarWorldToBox,
  zoomRadarView,
} from "./battle-radar-feed";
import {
  closeBattleWindows,
  closeOtherBattleWindows,
  openWindow,
  resetWindows,
  visibleWindows,
  windowSnapshot,
} from "../windows/window-store";

const here = dirname(fileURLToPath(import.meta.url));
const sceneSrc = readFileSync(join(here, "../../components/BattleScene/BattleScene.tsx"), "utf8");
const quickPickSrc = readFileSync(join(here, "../../components/BattleScene/SquadQuickPick.tsx"), "utf8");
const hudSrc = readFileSync(join(here, "../../components/BattleScene/BattleHud.tsx"), "utf8");
const radarSrc = readFileSync(join(here, "../../components/BattleScene/BattleRadar.tsx"), "utf8");

/** The demo muster at build time has everyone in staging; by the time a
 *  commander orders a rear drop the defender line is ON the field. Put it
 *  there so enemyLineY / isBehindLines see the real geometry. */
function fieldAtOrderTime() {
  const scene = buildDemoScene(1_000_000);
  for (const u of scene.units) {
    if (u.side === "defender" && u.state === "staging") u.state = "holding";
  }
  return scene.units;
}

describe("rear flank — the driven drop (owner 2026-10-14)", () => {
  test("demo rear squad: judge passes, commitJumpDrop lifts ALL of it from staging", () => {
    const units = fieldAtOrderTime();
    const rear = units.filter((u) => u.squadId === "A3" && u.state !== "dead");
    expect(rear.length).toBeGreaterThan(0);
    expect(rear.every((u) => u.state === "staging")).toBe(true);
    expect(judgeJumpDrop(rear).ok).toBe(true);
    const lineY = enemyLineY(units, "attacker");
    expect(lineY).not.toBeNull();
    // Behind lines per the doctrine definition: deeper than the whole
    // defender formation (demo line sits at y≈0.05) plus the margin.
    const dest = { x: 0.85, y: 0.01 };
    expect(isBehindLines(dest, units, "attacker")).toBe(true);
    const lifted = commitJumpDrop(rear, dest, 200, () => 0.5);
    expect(lifted).toBe(rear.length);
    expect(rear.every((u) => u.state === "descending")).toBe(true);
    expect(rear.every((u) => Math.abs(u.tx - dest.x) <= 0.026 && Math.abs(u.ty - dest.y) <= 0.026)).toBe(true);
  });

  test("driven descent lands the rear BEHIND the enemy line (component descent math)", () => {
    const units = fieldAtOrderTime().map((u) => ({ ...u }));
    const rear = units.filter((u) => u.squadId === "A3");
    const dest = { x: 0.85, y: 0.01 };
    commitJumpDrop(rear, dest, 200, () => 0.5);
    // The component's descent block, replicated: fall 0.16*sdt*10 toward
    // (tx,ty) per step; land at d < 0.02 via scatterLanding → advancing.
    const sdt = 1 / 30;
    let steps = 0;
    while (rear.some((u) => u.state === "descending") && steps < 4000) {
      steps += 1;
      for (const u of rear) {
        if (u.state !== "descending") continue;
        const dx = u.tx - u.x;
        const dy = u.ty - u.y;
        const d = Math.hypot(dx, dy);
        const fall = 0.16 * sdt * 10;
        if (d < 0.02) {
          const res = scatterLanding(units, u.id, u.tx, u.ty, 0.5);
          u.x = res.x; u.y = res.y; u.tx = res.x; u.ty = res.y;
          u.state = "advancing";
        } else {
          u.x += (dx / d) * Math.min(d, fall);
          u.y += (dy / d) * Math.min(d, fall);
        }
      }
    }
    expect(rear.every((u) => u.state === "advancing")).toBe(true);
    const lineY = enemyLineY(units, "attacker")!;
    // Landed at the ordered point — behind the defender line, NOT at the
    // friendly rear (the live bug: entry materialized behind the commander).
    for (const u of rear) {
      expect(u.y).toBeLessThan(lineY);
      expect(Math.hypot(u.x - dest.x, u.y - dest.y)).toBeLessThan(0.09);
      expect(u.side).toBe("attacker"); // allegiance never flips on entry
    }
  });
});

describe("commitment + fallback wiring (owner ruling 2026-10-14)", () => {
  test("the sim stamps genuine exchange: shooter on firing, victim on hp loss", () => {
    expect(sceneSrc.includes("u.exchangedAtS = t;")).toBe(true);
    expect(sceneSrc).toMatch(/if \(a > 0\) \{\s*\n\s*\/\/ Taking a damaging hit/);
  });

  test("step-off disengages: an engaged unit with a due order steps off", () => {
    expect(sceneSrc.includes('u.state === "holding" || u.state === "advancing" || u.state === "engaged"')).toBe(true);
  });

  test("refusals speak in the persistent comms feed (not toast-only)", () => {
    const refusalComms = sceneSrc.match(/postComms\("siege", `\$\{name\}: /g) ?? [];
    expect(refusalComms.length >= 4).toBe(true);
  });

  test("the jump-drop promise is gated on an actual lift", () => {
    const liftIdx = sceneSrc.indexOf("const lifted = commitJumpDrop(squadUnits, dest, t)");
    const promiseIdx = sceneSrc.indexOf("Jump ship inbound — combat drop behind their lines");
    expect(liftIdx).toBeGreaterThan(0);
    expect(promiseIdx).toBeGreaterThan(liftIdx);
    expect(sceneSrc.includes("if (lifted === 0)")).toBe(true);
  });

  test("entry announcements name the sector and ping the entry point", () => {
    expect(sceneSrc.includes("sectorLabel(u.x, u.y)")).toBe(true);
    expect(sceneSrc.includes('radarPing(u.x, u.y, "intel")')).toBe(true);
  });

  test("friendly siege splash is NAMED in comms (shells don't discriminate)", () => {
    expect(sceneSrc.includes("Your shells don't discriminate")).toBe(true);
  });
});

describe("allegiance census — every damage call site is classified", () => {
  test("dealDamage call sites in BattleScene are the known, classified set", () => {
    const sites = sceneSrc.match(/dealDamage\(/g) ?? [];
    // CLASSIFIED: (1) direct fire — side-clean via enemiesOf/focusFor;
    // (2) turret fire — side-clean; (3) descent hot-zone fire — the
    // enemy shoots the dropping unit; (4) hot-drop scatter splash — named
    // mechanic, comms-announced; (5) siege shell AoE — named mechanic,
    // "shells don't discriminate", comms-named when it catches its own;
    // (6) catastrophic-grind attrition — the war engine's own casualty
    // curve, applied to either side's engaged/holding units, not fire.
    // A NEW call site must be classified here by a human before this
    // count moves.
    expect(sites.length).toBe(6);
    // Direct-fire targeting never crosses sides:
    expect(sceneSrc.includes("u.side !== side")).toBe(true);
  });
});

describe("sectorLabel", () => {
  test("names rows by depth and columns by thirds", () => {
    expect(sectorLabel(0.85, 0.43)).toBe("behind the enemy line · center");
    expect(sectorLabel(1.2, 0.43)).toBe("behind the enemy line · east");
    expect(sectorLabel(0.2, 0.6)).toBe("at the enemy line · west");
    expect(sectorLabel(0.75, 1.35)).toBe("your rear · center");
  });
});

describe("radar viewport math — the map scrolls (owner 2026-10-14)", () => {
  test("full view is the identity round-trip", () => {
    const p = radarBoxToWorld(0.5, 0.5, RADAR_VIEW_FULL);
    expect(p).toEqual({ x: 0.75, y: 0.75 });
    const b = radarWorldToBox(0.3, 1.2, RADAR_VIEW_FULL);
    expect(b.fx).toBeCloseTo(0.2);
    expect(b.fy).toBeCloseTo(0.8);
  });

  test("pan moves the window and clamps at the overpan slack", () => {
    const v = panRadarView(RADAR_VIEW_FULL, 0.4, 0);
    expect((v.x0 + v.x1) / 2).toBeCloseTo(1.15);
    const hard = panRadarView(RADAR_VIEW_FULL, 99, 0);
    expect((hard.x0 + hard.x1) / 2 <= 1.8 + 1e-9).toBe(true);
  });

  test("zoom keeps the anchor fixed and respects the min span", () => {
    const v = zoomRadarView(RADAR_VIEW_FULL, 0.5, 0.3, 0.4);
    const a = radarWorldToBox(0.3, 0.4, v);
    const before = radarWorldToBox(0.3, 0.4, RADAR_VIEW_FULL);
    expect(a.fx).toBeCloseTo(before.fx);
    expect(a.fy).toBeCloseTo(before.fy);
    expect(radarViewSpan(v)).toBeCloseTo(0.75);
    const deep = zoomRadarView(v, 0.001, 0.3, 0.4);
    expect(radarViewSpan(deep) >= 0.3 - 1e-9).toBe(true);
  });

  test("centerRadarView centers on the point at the given span", () => {
    const v = centerRadarView(0.85, 0.43, 0.8);
    expect((v.x0 + v.x1) / 2).toBeCloseTo(0.85);
    expect((v.y0 + v.y1) / 2).toBeCloseTo(0.43);
    expect(radarViewSpan(v)).toBeCloseTo(0.8);
  });

  test("the expanded radar is pannable; the HUD glance is not", () => {
    expect(hudSrc.includes("pannable")).toBe(true);
    expect(radarSrc.includes('data-testid="radar-center-selected"')).toBe(true);
    expect(radarSrc.includes('data-testid="radar-full-view"')).toBe(true);
  });
});

describe("battle windows are pinned to their battle (owner doctrine 2026-10-14)", () => {
  const battleKinds = () =>
    windowSnapshot().windows.filter((w) => w.kind.startsWith("battle-")).map((w) => `${w.kind}@${w.props.battleId ?? "unkeyed"}`);

  test("exit/conclusion dump: closeBattleWindows retires exactly that battle's set", () => {
    resetWindows();
    openWindow("battle-squads", { props: { battleId: "battle-a" } });
    openWindow("battle-controls", { props: { battleId: "battle-a" } });
    openWindow("battle-enemy-forces", { props: { battleId: "battle-a" }, background: true });
    openWindow("chat", {});
    closeBattleWindows("battle-a");
    expect(battleKinds()).toEqual([]);
    // non-battle windows are never the battle's to dump
    expect(windowSnapshot().windows.some((w) => w.kind === "chat")).toBe(true);
    resetWindows();
  });

  test("jump A→B: the mount sweep retires A's set, B's opens stand", () => {
    resetWindows();
    openWindow("battle-squads", { props: { battleId: "battle-a" } });
    openWindow("battle-controls", { props: { battleId: "battle-a" } });
    closeOtherBattleWindows("battle-b");
    expect(battleKinds()).toEqual([]);
    openWindow("battle-squads", { props: { battleId: "battle-b" } });
    expect(battleKinds()).toEqual(["battle-squads@battle-b"]);
    // B's own set survives a later sweep for B, and A's dump can't take it
    closeOtherBattleWindows("battle-b");
    expect(battleKinds()).toEqual(["battle-squads@battle-b"]);
    closeBattleWindows("battle-a");
    expect(battleKinds()).toEqual(["battle-squads@battle-b"]);
    resetWindows();
  });

  test("unkeyed legacy windows count as the current battle's — dumped with it", () => {
    resetWindows();
    openWindow("battle-enemy-forces", { background: true });
    expect(battleKinds()).toEqual(["battle-enemy-forces@unkeyed"]);
    closeBattleWindows("battle-a");
    expect(battleKinds()).toEqual([]);
    resetWindows();
  });

  test("wiring pins: opens are keyed, conclusion + unmount retire the set", () => {
    expect(sceneSrc.includes('props: { battleId: scene.id }')).toBe(true);
    expect(sceneSrc.includes("closeOtherBattleWindows(scene.id)")).toBe(true);
    expect(sceneSrc.includes("if (resolvedSide) closeBattleWindows(scene.id)")).toBe(true);
    expect(hudSrc.includes("props: { battleId }")).toBe(true);
    expect(visibleWindows).toBeDefined();
  });
});

describe("quick-pick Exit Law + Cover + mode visibility", () => {
  test("quick-pick has a ≥44px close that clears the selection", () => {
    expect(quickPickSrc.includes('data-testid="quickpick-close"')).toBe(true);
    expect(quickPickSrc.includes("min-h-[44px] min-w-[44px]")).toBe(true);
    expect(quickPickSrc.includes("setSelectedSquad(null)")).toBe(true);
  });

  test("Cover renders above Move in the quick pick (above the fold)", () => {
    const fireIdx = quickPickSrc.indexOf("FIRE CONTROL");
    const coverIdx = quickPickSrc.indexOf("<SectionLabel>Cover</SectionLabel>");
    const moveIdx = quickPickSrc.indexOf("testid=\"quickpick-move\"");
    expect(fireIdx >= 0).toBe(true);
    expect(coverIdx).toBeGreaterThan(fireIdx);
    expect(moveIdx).toBeGreaterThan(coverIdx);
  });

  test("the mode pill is always rendered in the HUD", () => {
    expect(hudSrc.includes('data-testid="hud-mode-pill"')).toBe(true);
    expect(hudSrc.includes("AUTO — the plan is driving")).toBe(true);
    expect(hudSrc.includes("MANUAL — you have the helm")).toBe(true);
  });
});
