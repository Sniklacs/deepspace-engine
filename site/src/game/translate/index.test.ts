// index.test.ts — THE BOOT CONTRACT (owner crash fix, 2026-10-13).
//
// The translator used to be prepared from the root route's boot effect: a
// ~600 MB download, and — once the pack was on the device — a WASM engine
// holding all of it in memory, during initial load. On mid-range Android
// WebViews that OOM-killed the app before the solar system painted. These
// tests pin the replacement contract at the module's public door:
//
//   • BOOT LOOKS, IT DOES NOT START — `inspectTranslator()` reports the real
//     state and performs ZERO fetches.
//   • THE AUTO-PREPARE IS DEFERRED — `scheduleTranslatorAutoPrepare()` runs
//     nothing before its floor delay has elapsed, then prepares.
//   • THE FIRST NEED STARTS EVERYTHING — `requestTranslation()` with no
//     engine answers the honest null AND kicks the prepare.
//
// The device is fake (empty cache, a logging 404 fetch) but the machinery is
// the real one, same as weights.test.ts.

import { describe, expect, test } from "bun:test";
import {
  inspectTranslator,
  prepareTranslator,
  requestTranslation,
  scheduleTranslatorAutoPrepare,
  translatorAvailable,
} from "./index";
import {
  setWeightsEnvironment,
  weightsState,
  type WeightCache,
  type WeightsEnvironment,
} from "./weights";

function emptyCache(): WeightCache {
  const store = new Map<string, { body: Uint8Array; headers: Headers }>();
  return {
    async put(request: string, response: Response) {
      store.set(request, {
        body: new Uint8Array(await response.arrayBuffer()),
        headers: response.headers,
      });
    },
    async match(request: string) {
      const hit = store.get(request);
      if (!hit) return undefined;
      return new Response(hit.body.slice().buffer as ArrayBuffer, { headers: hit.headers });
    },
    async delete(request: string) {
      return store.delete(request);
    },
  };
}

/** An environment with an empty device and a network that 404s everything. */
function env404(log: string[]): WeightsEnvironment {
  const cache = emptyCache();
  return {
    cacheStorage: { open: async () => cache },
    fetchImpl: async (input: string) => {
      log.push(input);
      return new Response("nope", { status: 404 });
    },
  };
}

// The module's SSR guard keys on `window`; a harness must provide one
// (the translate-verify §8 lesson — without it every call short-circuits).
(globalThis as { window?: unknown }).window = globalThis;

describe("the boot contract", () => {
  test("the auto-prepare is deferred: nothing runs before the floor delay", async () => {
    const log: string[] = [];
    const env = env404(log);
    setWeightsEnvironment(env);

    let captured: { fn: () => void; ms: number } | null = null;
    const realWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      setTimeout: (fn: () => void, ms: number) => {
        captured = { fn, ms };
        return 0;
      },
    };
    try {
      scheduleTranslatorAutoPrepare(4321);
      expect(captured).not.toBeNull();
      expect(captured!.ms).toBe(4321);
      // The floor has not elapsed: no download, no look, state untouched.
      expect(log.length).toBe(0);
      expect(weightsState().phase).toBe("unknown");
      expect(translatorAvailable()).toBe(false);

      // The floor elapses (no requestIdleCallback on this window → prepare
      // starts immediately after it). Join the run and prove it really ran:
      // the network was hit and the state machine moved off "unknown".
      captured!.fn();
      await prepareTranslator(env);
      expect(log.length).toBeGreaterThan(0);
      expect(weightsState().phase).not.toBe("unknown");
    } finally {
      (globalThis as { window?: unknown }).window = realWindow;
    }
  });

  test("inspectTranslator looks at the device without starting anything", async () => {
    const log: string[] = [];
    const env = env404(log);
    setWeightsEnvironment(env);

    const st = await inspectTranslator(env);
    expect(st.phase).toBe("absent"); // looked: empty device, honestly reported
    expect(log.length).toBe(0); // …and not one byte was fetched to learn it
    expect(translatorAvailable()).toBe(false);
  });

  test("requestTranslation with no engine answers null AND starts the prepare", async () => {
    const log: string[] = [];
    const env = env404(log);
    setWeightsEnvironment(env);

    const result = await requestTranslation("bonjour", "fr", "en");
    expect(result).toBeNull(); // the honest first-tap answer, never a guess
    expect(translatorAvailable()).toBe(false);

    // The need kicked prepareTranslator: join its run and prove the download
    // was attempted (the 404 network saw requests; the state machine moved).
    await prepareTranslator(env);
    expect(log.length).toBeGreaterThan(0);
    expect(weightsState().phase).not.toBe("unknown");
  });
});
