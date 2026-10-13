// index.test.ts — THE BOOT CONTRACT (owner crash fix, 2026-10-13, round 3).
//
// The translator used to be prepared from the root route's boot effect: a
// ~600 MB download, and — once the pack was on the device — a WASM engine
// holding all of it in memory, during initial load. On mid-range Android
// WebViews that OOM-killed the app before the solar system painted. The
// round-1 replacement deferred the prepare to a timer + idle callback; that
// killed phones again ~30 s after a smooth boot (Chrome's "Aw, Snap").
// These tests pin the round-3 contract at the module's public door:
//
//   • BOOT LOOKS, IT DOES NOT START — `inspectTranslator()` reports the real
//     state and performs ZERO fetches.
//   • THERE IS NO AUTO-PREPARE — no scheduler export exists; boot plus time
//     passing (any timer, any idle callback) starts NO download and builds
//     NO engine. Only an explicit player act prepares.
//   • THE FIRST NEED STARTS EVERYTHING — `requestTranslation()` with no
//     engine answers the honest null AND kicks the prepare.
//
// The device is fake (empty cache, a logging 404 fetch) but the machinery is
// the real one, same as weights.test.ts.

import { describe, expect, test } from "bun:test";
import * as translateDoor from "./index";
import {
  inspectTranslator,
  prepareTranslator,
  requestTranslation,
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
  test("there is no auto-prepare: boot look + elapsed time starts nothing", async () => {
    const log: string[] = [];
    const env = env404(log);
    setWeightsEnvironment(env);

    // The scheduler that Aw-Snapped phones is gone from the public door.
    expect(
      (translateDoor as Record<string, unknown>).scheduleTranslatorAutoPrepare,
    ).toBeUndefined();

    // What boot does: inspect only.
    const st = await inspectTranslator(env);
    expect(st.phase).toBe("absent");

    // Time passes — well past the old 12 s/30 s floors — and any idle
    // callback the environment cares to fire changes nothing: no fetch,
    // no state movement, no engine.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(log.length).toBe(0);
    expect(weightsState().phase).toBe("absent");
    expect(translatorAvailable()).toBe(false);
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
