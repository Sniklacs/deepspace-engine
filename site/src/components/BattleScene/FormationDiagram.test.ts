// FormationDiagram layout tests — the 2026-10-06 sizing fix.
//
// The builder's diagram used to render overlapping slot boxes (a six-slot
// column cannot fit 52-unit boxes into ~250 usable units): later boxes
// covered earlier boxes' click targets and label clicks were dead.
// layoutDiagramSlots must leave EVERY template collision-free.

import { describe, expect, test } from "bun:test";
import {
  DIAGRAM_W,
  SLOT_BOX_H,
  SLOT_BOX_W,
  layoutDiagramSlots,
} from "./FormationDiagram";
import {
  PLAYBOOK,
  blankSlots,
  formationSlots,
  type PlaySlot,
  type SavedFormation,
} from "../../game/war/playbook";

const EPS = 0.5;

function assertClean(
  slots: PlaySlot[],
  layout: { cx: number[]; cy: number[]; viewH: number },
) {
  const { cx, cy, viewH } = layout;
  expect(cx.length).toBe(slots.length);
  expect(cy.length).toBe(slots.length);
  for (let i = 0; i < slots.length; i++) {
    // finite, fully inside the canvas
    expect(Number.isFinite(cx[i])).toBe(true);
    expect(Number.isFinite(cy[i])).toBe(true);
    expect(cx[i] - SLOT_BOX_W / 2 >= -EPS).toBe(true);
    expect(cx[i] + SLOT_BOX_W / 2 <= DIAGRAM_W + EPS).toBe(true);
    expect(cy[i] - SLOT_BOX_H / 2 >= -EPS).toBe(true);
    expect(cy[i] + SLOT_BOX_H / 2 <= viewH + EPS).toBe(true);
    // pairwise: no box touches another
    for (let j = i + 1; j < slots.length; j++) {
      const xTouch = Math.abs(cx[i] - cx[j]) < SLOT_BOX_W - EPS;
      const yTouch = Math.abs(cy[i] - cy[j]) < SLOT_BOX_H - EPS;
      expect(xTouch && yTouch).toBe(false);
    }
  }
}

describe("layoutDiagramSlots", () => {
  test("every playbook play is collision-free, compact and full", () => {
    for (const play of PLAYBOOK) {
      for (const baseH of [200, 300]) {
        const layout = layoutDiagramSlots(play.slots, baseH);
        assertClean(play.slots, layout);
        // the viewBox never shrinks below the requested base
        expect(layout.viewH >= baseH).toBe(true);
      }
    }
  });

  test("blank custom slots are collision-free", () => {
    const slots = blankSlots();
    assertClean(slots, layoutDiagramSlots(slots, 300));
    assertClean(slots, layoutDiagramSlots(slots, 200));
  });

  test("the reported case: mixed wedge full-size grows to fit, no overlaps", () => {
    const play = PLAYBOOK.find((p) => p.id === "mixed-wedge")!;
    const layout = layoutDiagramSlots(play.slots, 300);
    assertClean(play.slots, layout);
    // six stacked slots cannot fit in 300 — the viewBox must grow
    expect(layout.viewH > 300).toBe(true);
  });

  test("pathological custom slots: stacked, NaN, off-canvas", () => {
    const mk = (
      id: string,
      dx: number,
      dy: number,
    ): PlaySlot => ({
      id,
      name: id,
      vector: "MAIN",
      entry: { kind: "start" },
      dx,
      dy,
    });
    const slots = [
      mk("a", 0.5, 0.5),
      mk("b", 0.5, 0.5), // exact stack
      mk("c", 0.51, 0.5), // near stack
      mk("d", NaN, NaN), // garbage coordinates
      mk("e", -2, 99), // off-canvas
      mk("f", 0.05, 0.05), // near the corner
    ];
    assertClean(slots, layoutDiagramSlots(slots, 300));
  });

  test("formationSlots output (renames + dx/dy overrides) lays out clean", () => {
    const f = {
      id: "x",
      name: "x",
      playId: "mixed-wedge",
      locked: true,
      loads: {},
      slotMeta: {
        wedge: { name: "Spearhead", dx: 0.5, dy: 0.3 },
        reserve: { dy: 0.99 },
      },
      createdAt: 0,
      updatedAt: 0,
    } as SavedFormation;
    const slots = formationSlots(f);
    expect(slots.find((s) => s.id === "wedge")?.name).toBe("Spearhead");
    assertClean(slots, layoutDiagramSlots(slots, 300));
  });

  test("empty slot list keeps the base height", () => {
    const layout = layoutDiagramSlots([], 300);
    expect(layout.cx).toEqual([]);
    expect(layout.cy).toEqual([]);
    expect(layout.viewH).toBe(300);
  });
});
