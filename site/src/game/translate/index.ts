// index.ts — THE TRANSLATOR'S PUBLIC DOOR.
//
// One import for the rest of the app. It owns three things and nothing else:
//
//   1. THE WEIGHTS. `prepareTranslator()` inspects the device, and if the model is
//      not there yet it starts the download — unprompted, in the background, with
//      real progress the Settings row subscribes to. That is the owner's rule:
//      "build the Persian translator into where they have to download it — I don't
//      want players getting disgruntled because they can't translate." No opt-in,
//      no prompt, no pack to get wrong, nothing cloud-based.
//
//   2. THE ENGINE SEAM. Once the weights are on the device, the ML runtime is
//      loaded with a DYNAMIC import (`./runtime/engine` — the effect-scoped
//      precedent from `routes/__root.tsx`) and registered with `engine-seam.ts`.
//      If no runtime can be created, NOTHING is registered — the seam keeps
//      returning null and the UI says translation is preparing, in the player's
//      own language. A null seam is the honest state; a fake translation is not.
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
import { MODEL, SHIPS_REAL_WEIGHTS } from "./model-manifest";
import { MODEL_CACHE } from "../pwa/storage";
import {
  clearWeights,
  ensureWeights,
  inspectWeights,
  streamStoredWeights,
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
  streamStoredWeights,
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
  if (phase === "ready") return "the weights are on this device; no inference runtime is installed yet";
  if (phase === "unsupported") return "this browser cannot keep the translator on the device";
  if (phase === "failed") return weightsState().error ?? "the download failed";
  return "the weights are not on this device yet";
}

/** The state a Settings row renders. Derived, never stored twice. */
export interface TranslatorStatus {
  weights: WeightsState;
  /** the engine's own name (a diagnostics line), null when none is registered */
  engine: string | null;
  /** true only when an engine is really answerable */
  available: boolean;
  /** true when the manifest slot is the real 603 MB model, not the stand-in */
  realWeights: boolean;
  blocker: string | null;
}

export function translatorStatus(): TranslatorStatus {
  return {
    weights: weightsState(),
    engine: translatorEngineName(),
    available: translatorAvailable(),
    realWeights: SHIPS_REAL_WEIGHTS,
    blocker: translatorBlocker(),
  };
}

let started: Promise<TranslatorStatus> | null = null;

/**
 * Boot the translator: look at the device, download what is missing, load the
 * runtime. Called once from a client effect. Safe to call again — it re-checks and
 * costs nothing when everything is already in place.
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
  const state = await ensureWeights(MODEL, env);
  if (state.phase === "ready") await registerEngine(env);
  return translatorStatus();
}

/** Try again after a failure — the same call, a different starting point. */
export function retryTranslator(env?: WeightsEnvironment): Promise<TranslatorStatus> {
  return run(env);
}

/** Free the space: drop the cached weights (the runtime goes with them). */
export async function freeTranslatorSpace(env?: WeightsEnvironment): Promise<TranslatorStatus> {
  runtime?.dispose?.();
  runtime = null;
  translated.clear();
  await clearWeights(MODEL, env);
  announce();
  return translatorStatus();
}

/** Load the ML runtime against the bytes on the device and register it. */
async function registerEngine(env?: WeightsEnvironment): Promise<void> {
  if (runtime) return;
  try {
    const created = await runtimeFactory({
      model: MODEL,
      cacheName: MODEL_CACHE,
      readWeights: () => streamStoredWeights(MODEL, env),
    });
    if (!created) {
      runtimeFailed = "the weights are on this device; no inference runtime is installed yet";
      announce();
      return;
    }
    runtime = created;
    runtimeFailed = null;
    const engine: TranslationEngine = {
      name: created.name,
      // Synchronous by contract: answers only from what is already translated.
      text: (text, from, to) => translated.get(cacheKey(text, from, to)) ?? null,
    };
    registerTranslationEngine(engine);
    announce();
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
  if (!runtime) return Promise.resolve(null);
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
  return inspectWeights(MODEL, env);
}
