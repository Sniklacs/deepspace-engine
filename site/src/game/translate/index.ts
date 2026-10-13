// index.ts — THE TRANSLATOR'S PUBLIC DOOR.
//
// One import for the rest of the app. It owns three things and nothing else:
//
//   1. THE WEIGHTS. `prepareTranslator()` inspects the device, and if the pack is
//      not there yet it starts the download — with real progress the Settings
//      row subscribes to. Nothing cloud-based, no pack to get wrong.
//      BUT ONLY ON AN EXPLICIT PLAYER ACT (owner crash fix, round 3,
//      2026-10-13): the pack is ~600 MB and the engine is a WASM runtime
//      holding all of it in renderer memory. Preparing at boot OOM-killed
//      mid-range Android WebViews before the solar system painted (round 1);
//      deferring the prepare to a timer + idle callback killed them again
//      ~30 s after a smooth boot (round 3 — Chrome's "Aw, Snap"). So the old
//      "the download starts on its own" rule is DEAD: no boot prepare, no
//      deferred auto-prepare, no engine construction on a timer or idle
//      callback, ever. Preparation starts only when the player acts: a
//      Translate tap (`requestTranslation`) or opening the translator row in
//      Settings (`TranslatorNote`). Boot only INSPECTS (`inspectTranslator`).
//
//   2. THE ENGINE SEAM. Once the pack is on the device, the ML runtime is loaded
//      with a DYNAMIC import (`./runtime/engine` — the effect-scoped precedent
//      from `routes/__root.tsx`) and registered with `engine-seam.ts`. If no
//      runtime can be created, NOTHING is registered — the seam keeps returning
//      null and the UI says translation is preparing, in the player's own
//      language. A null seam is the honest state; a fake translation is not.
//
//   3. THE ASYNC BRIDGE. The seam is synchronous by contract ("the UI never awaits
//      inside a render"), and a 418M model cannot answer in a render. So the
//      engine's `text()` only ever returns something already cached, and
//      `requestTranslation()` fills that cache in the background and tells the
//      subscriber when the line is ready. First tap: the honest "preparing" state.
//      Second tap onward, same string: translated from the cache, instantly.
//
// Nothing here renders anything, and nothing here knows about React.

import { registerTranslationEngine, type TranslationEngine } from "../i18n/engine-seam";
import { TRANSLATE_PACK } from "./model-manifest";
import { MODEL_CACHE } from "../pwa/storage";
import {
  clearWeights,
  ensureWeights,
  inspectWeights,
  subscribeWeights,
  weightsState,
  type WeightsEnvironment,
  type WeightsState,
} from "./weights";
import type { TranslatorRuntime, TranslatorRuntimeContext } from "./runtime/engine";

export type { WeightsState, WeightsPhase, WeightsEnvironment, WeightsReceipt } from "./weights";
export {
  clearWeights,
  ensureWeights,
  hashStoredWeights,
  inspectWeights,
  setWeightsEnvironment,
  subscribeWeights,
  weightsEnvironment,
  weightsState,
} from "./weights";
export * from "./model-manifest";

/** The runtime factory, injectable so a harness can prove the wiring without a model. */
type RuntimeFactory = (ctx: TranslatorRuntimeContext) => Promise<TranslatorRuntime | null>;

async function loadRuntime(ctx: TranslatorRuntimeContext): Promise<TranslatorRuntime | null> {
  const mod = await import("./runtime/engine");
  return mod.createRuntime(ctx);
}

let runtimeFactory: RuntimeFactory = loadRuntime;
let runtime: TranslatorRuntime | null = null;
let runtimeFailed: string | null = null;
/** Where the registered engine came from — always the weights pipeline now. */
let engineKind: "weights" | null = null;

/** Harness seam only: the app never calls this. */
export function __setRuntimeFactory(factory: RuntimeFactory | null): void {
  runtimeFactory = factory ?? loadRuntime;
}

/** `${to}::${from}::${text}` — the key the sync half of the seam answers from. */
function cacheKey(text: string, from: string, to: string): string {
  return `${to}::${from}::${text}`;
}

const translated = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();
const engineSubscribers = new Set<() => void>();

function announce(): void {
  for (const fn of engineSubscribers) {
    try {
      fn();
    } catch {
      /* a subscriber that throws must not break a translation */
    }
  }
}

/** Subscribe to "the engine changed" (registered / a new line landed in the cache). */
export function subscribeTranslator(fn: () => void): () => void {
  engineSubscribers.add(fn);
  const offWeights = subscribeWeights(() => {
    fn();
  });
  return () => {
    engineSubscribers.delete(fn);
    offWeights();
  };
}

/** The engine the seam is holding right now — null until a runtime is registered. */
export function translatorEngineName(): string | null {
  return runtime?.name ?? null;
}

/** Can this device translate live text at all, right now? */
export function translatorAvailable(): boolean {
  return runtime !== null;
}

/** Why it is not available, when it is not — the honest line for a diagnostics view. */
export function translatorBlocker(): string | null {
  if (runtime) return null;
  if (runtimeFailed) return runtimeFailed;
  const phase = weightsState().phase;
  if (phase === "ready") return "the pack is on this device; the translation engine failed to start";
  if (phase === "unsupported") return "this browser cannot keep the translator on the device";
  if (phase === "failed") return weightsState().error ?? "the download failed";
  return "the translator pack is not on this device yet";
}

/** The state a Settings row renders. Derived, never stored twice. */
export interface TranslatorStatus {
  weights: WeightsState;
  /** the engine's own name (a diagnostics line), null when none is registered */
  engine: string | null;
  /** true only when an engine is really answerable */
  available: boolean;
  /** true — the shipped pack is always the real model now (no stand-in) */
  realWeights: boolean;
  /** "weights" when the on-device pipeline answered */
  engineKind: "weights" | null;
  blocker: string | null;
  /** the last inference failure, when one happened — the diagnostics line */
  engineError: string | null;
}

export function translatorStatus(): TranslatorStatus {
  return {
    weights: weightsState(),
    engine: translatorEngineName(),
    available: translatorAvailable(),
    realWeights: true,
    engineKind,
    blocker: translatorBlocker(),
    engineError: runtime?.lastError ?? null,
  };
}

let started: Promise<TranslatorStatus> | null = null;

/**
 * Prepare the translator: look at the device, download what is missing, load
 * the runtime. Called ONLY from explicit player acts — a Translate tap or a
 * translator surface (the Settings row) mounting. Never from boot, never
 * from a timer or idle callback: constructing the ~600 MB WASM engine
 * unprompted is what Aw-Snapped phones (see the header). Safe to call
 * again — it re-checks and costs nothing when everything is already in
 * place. Never throws: every failure lands in the status, not the caller.
 */
export function prepareTranslator(env?: WeightsEnvironment): Promise<TranslatorStatus> {
  if (typeof window === "undefined") return Promise.resolve(translatorStatus());
  if (started) return started;
  started = run(env).finally(() => {
    started = null;
  });
  return started;
}

async function run(env?: WeightsEnvironment): Promise<TranslatorStatus> {
  const state = await ensureWeights(TRANSLATE_PACK, env);
  if (state.phase === "ready") await registerEngine();
  return translatorStatus();
}

/** Try again after a failure — the same call, a different starting point. */
export function retryTranslator(env?: WeightsEnvironment): Promise<TranslatorStatus> {
  return run(env);
}

/** Free the space: drop the cached pack (the runtime goes with it). */
export async function freeTranslatorSpace(env?: WeightsEnvironment): Promise<TranslatorStatus> {
  runtime?.dispose?.();
  runtime = null;
  engineKind = null;
  translated.clear();
  await clearWeights(TRANSLATE_PACK, env);
  announce();
  return translatorStatus();
}

/** Put a created runtime behind the seam: the sync cache, the key filler, the announce. */
function installRuntime(created: TranslatorRuntime): void {
  runtime = created;
  runtimeFailed = null;
  const engine: TranslationEngine = {
    name: created.name,
    // Synchronous by contract: answers only from what is already translated.
    text: (text, from, to) => translated.get(cacheKey(text, from, to)) ?? null,
  };
  registerTranslationEngine(engine);
  announce();
}

/** Load the ML runtime against the pack on the device and register it. */
async function registerEngine(): Promise<void> {
  if (runtime) return;
  try {
    const created = await runtimeFactory({
      pack: TRANSLATE_PACK,
      cacheName: MODEL_CACHE,
    });
    if (!created) {
      runtimeFailed = "the pack is on this device; the translation engine failed to start";
      announce();
      return;
    }
    installRuntime(created);
    engineKind = "weights";
  } catch (err) {
    runtimeFailed = err instanceof Error ? err.message : String(err);
    announce();
  }
}

/**
 * Translate one live string (the per-message "Translate" affordance). Returns null
 * when there is no engine or it cannot help — the caller shows the original text or
 * the honest "preparing" label, never a placeholder pretending to be a translation.
 */
export function requestTranslation(
  text: string,
  from: string,
  to: string,
): Promise<string | null> {
  const already = translated.get(cacheKey(text, from, to));
  if (already !== undefined) return Promise.resolve(already);
  if (!runtime) {
    // The first actual need is what starts everything (boot never does — see
    // the header). This tap still answers with the honest null; the next one
    // finds the engine registered and the cache filling.
    void prepareTranslator();
    return Promise.resolve(null);
  }
  const key = cacheKey(text, from, to);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const active = runtime;
  const job = active
    .translate(text, from, to)
    .then((result) => {
      // The seam's second promise: never an empty string, never a guess.
      if (typeof result !== "string" || result.trim().length === 0) return null;
      translated.set(key, result);
      announce();
      return result;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, job);
  return job;
}

/** Look at the device without starting anything (a Settings open, a harness). */
export function inspectTranslator(env?: WeightsEnvironment): Promise<WeightsState> {
  return inspectWeights(TRANSLATE_PACK, env);
}
