// readiness.test.ts — the Settings row's truth table.
//
// The owner's rule (2026-09-26): "ready" may only ever be claimed when the engine
// is really answerable AND the pack is really on the device. These tests walk the
// cross-product of states and fail if any dishonest row can exist.

import { describe, expect, test } from "bun:test";
import { translatorRow } from "./readiness";
import type { TranslatorStatus } from "./index";
import type { WeightsState } from "./weights";

function weights(over: Partial<WeightsState> = {}): WeightsState {
  return {
    phase: "unknown",
    modelId: "m2m100-418m-q8-r2-v1",
    label: "test",
    totalBytes: 640_000_000,
    cachedBytes: 0,
    receivedBytes: 0,
    percent: 0,
    chunksTotal: 80,
    chunksStored: 0,
    resumed: false,
    ranged: null,
    verified: "pending",
    error: null,
    ...over,
  };
}

function status(over: Partial<TranslatorStatus> = {}): TranslatorStatus {
  return {
    weights: weights(),
    engine: null,
    available: false,
    realWeights: true,
    engineKind: null,
    blocker: "the translator pack is not on this device yet",
    ...over,
  };
}

describe("translatorRow", () => {
  test("hidden when the device has not been looked at, or cannot hold the pack", () => {
    expect(translatorRow(status({ weights: weights({ phase: "unknown" }) })).kind).toBe("hidden");
    expect(translatorRow(status({ weights: weights({ phase: "unsupported" }) })).kind).toBe("hidden");
  });

  test("ready only when the pack is on disk AND the engine answers", () => {
    const ready = status({
      weights: weights({ phase: "ready", cachedBytes: 640_000_000, verified: "ok" }),
      engine: "m2m100-418m-q8 (wasm)",
      available: true,
      engineKind: "weights",
      blocker: null,
    });
    const row = translatorRow(ready);
    expect(row.kind).toBe("ready");
    expect(row.sizeBytes).toBe(640_000_000);
  });

  test("never ready on a partial download, even with an engine", () => {
    const row = translatorRow(
      status({
        weights: weights({ phase: "partial", cachedBytes: 100_000_000, percent: 16 }),
        available: true,
        engine: "m2m100-418m-q8 (wasm)",
        engineKind: "weights",
      }),
    );
    expect(row.kind).toBe("preparing");
    expect(row.showProgress).toBe(true);
    expect(row.percent).toBe(16);
  });

  test("never ready when the pack is on disk but the engine failed to start", () => {
    const row = translatorRow(
      status({
        weights: weights({ phase: "ready", cachedBytes: 640_000_000, verified: "ok" }),
        available: false,
        blocker: "the pack is on this device; the translation engine failed to start",
      }),
    );
    expect(row.kind).toBe("preparing");
  });

  test("failed when the download failed, with retry", () => {
    const row = translatorRow(
      status({ weights: weights({ phase: "failed", cachedBytes: 50_000_000, error: "nope" }) }),
    );
    expect(row.kind).toBe("failed");
    expect(row.canRetry).toBe(true);
    expect(row.canFreeSpace).toBe(true);
  });

  test("downloading shows real progress and the honest byte counts", () => {
    const row = translatorRow(
      status({
        weights: weights({
          phase: "downloading",
          cachedBytes: 320_000_000,
          receivedBytes: 1_000_000,
          percent: 50,
        }),
      }),
    );
    expect(row.kind).toBe("preparing");
    expect(row.showProgress).toBe(true);
    // doneBytes is what is durably on the device — never cached + received.
    expect(row.doneBytes).toBe(320_000_000);
    expect(row.sizeBytes).toBe(640_000_000);
  });

  test("canFreeSpace only when bytes are actually held", () => {
    expect(translatorRow(status()).canFreeSpace).toBe(false);
    expect(
      translatorRow(status({ weights: weights({ phase: "partial", cachedBytes: 10 }) })).canFreeSpace,
    ).toBe(true);
  });
});
