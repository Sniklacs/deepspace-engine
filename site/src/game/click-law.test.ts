// click-law.test.ts — THE CLICK LAW under the hammer (Hans, Oct 14 2026).
//
// The law's second half is a money bug: a silent button gets pressed and
// pressed, and EVERY press executes. These tests prove the enforcement
// primitive the supply/store controls now share: while one execution is in
// flight, repeat presses — however fast, however many, across re-renders —
// execute NOTHING and charge NOTHING. And the receipt model: every spend
// answers in the fiction's verb with the amount and the running totals.
import { describe, expect, test } from "bun:test";
import {
  createPressGate,
  pressEventId,
  receiptHeadline,
  receiptTotalsLine,
  spendReceipt,
} from "./click-law";

describe("press gate — the lockout", () => {
  test("acquires exactly once until released", () => {
    const gate = createPressGate();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.locked).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.tryAcquire()).toBe(false);
    gate.release();
    expect(gate.locked).toBe(false);
    expect(gate.tryAcquire()).toBe(true);
  });

  test("HAMMER: 50 presses inside one flight execute exactly once and charge exactly once", async () => {
    const gate = createPressGate();
    let executions = 0;
    let charges = 0;
    let supplies = 100;
    // The control's press handler, shaped exactly like the workshop/store
    // handlers: gate first (synchronous), execute only on acquire, release
    // when the flight lands.
    const press = async () => {
      if (!gate.tryAcquire()) return;
      executions += 1;
      await new Promise((r) => setTimeout(r, 25)); // the server round-trip
      charges += 1;
      supplies -= 30; // the one charge lands
      gate.release();
    };
    // Fifty presses in the same instant — the angry-tap scenario.
    await Promise.all(Array.from({ length: 50 }, () => press()));
    expect(executions).toBe(1);
    expect(charges).toBe(1);
    expect(supplies).toBe(70);
    // After the flight lands, the control works again — once per press.
    await press();
    expect(executions).toBe(2);
    expect(charges).toBe(2);
    expect(supplies).toBe(40);
  });

  test("a press that throws still releases the gate (no permanent lockout, no dead button)", async () => {
    const gate = createPressGate();
    const press = async () => {
      if (!gate.tryAcquire()) return false;
      try {
        throw new Error("network died");
      } finally {
        gate.release();
      }
    };
    let threw = false;
    try {
      await press();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(gate.locked).toBe(false);
    expect(gate.tryAcquire()).toBe(true);
  });

  test("each acquired press mints a distinct idempotency key", () => {
    const a = pressEventId("craft-medkit");
    const b = pressEventId("craft-medkit");
    expect(a).not.toBe(b);
    expect(a.startsWith("craft-medkit-")).toBe(true);
  });
});

describe("spend receipts — the fiction's verbs, with running totals", () => {
  test("forge receipt: Forged ✓ +N item, held + supplies after", () => {
    const r = spendReceipt({
      verb: "forged",
      itemLabel: "Medkits",
      amount: 3,
      totals: [
        { label: "held", value: 14 },
        { label: "supplies left", value: 287 },
      ],
    });
    expect(receiptHeadline(r)).toBe("Forged ✓ +3 Medkits");
    expect(receiptTotalsLine(r)).toBe("14 held · 287 supplies left");
  });

  test("buy receipt: Loaded ✓ with the currency left after the spend", () => {
    const r = spendReceipt({
      verb: "loaded",
      itemLabel: "War Bundle — Field Cache",
      amount: 1,
      totals: [{ label: "Votives left", value: 42 }],
    });
    expect(receiptHeadline(r)).toBe("Loaded ✓ +1 War Bundle — Field Cache");
    expect(receiptTotalsLine(r)).toBe("42 Votives left");
  });

  test("amounts and totals are floored to whole units (no fractional kits)", () => {
    const r = spendReceipt({
      verb: "built",
      itemLabel: "Supply Crates",
      amount: 2.9,
      totals: [{ label: "supplies left", value: 10.75 }],
    });
    expect(r.amount).toBe(2);
    expect(r.totals[0].value).toBe(10);
  });
});
