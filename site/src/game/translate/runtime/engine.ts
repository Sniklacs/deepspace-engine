// runtime/engine.ts — THE DROP-IN POINT FOR THE ACTUAL ML RUNTIME.
//
// `index.ts` loads this module with a DYNAMIC import (the same shape as the
// client-only effect work in `routes/__root.tsx`), so whatever a real runtime
// weighs — onnxruntime-web and its wasm, a tokenizer, 100 MB of nothing anyone
// needs on first paint — it stays out of the app's initial bundle and is only
// fetched once the weights are actually on the device.
//
// TODAY THIS RETURNS null, DELIBERATELY, AND THAT IS THE HONEST ANSWER.
//
// `engine-seam.ts` states the contract: an engine "returns null when it cannot
// help — never a guess wrapped in confidence". Nothing in this repository can run
// m2m100_418M yet: no ML runtime is a dependency (`package.json`), and a fake
// translator that returns its input, or a dictionary dressed up as a model, would
// put wrong text in front of a Persian player and call it translation. So the
// pipeline stops here and says so: the UI shows "translation is preparing" in the
// player's own language (catalogue key `translator.notReady`) rather than a
// button that pretends.
//
// WHAT SHIPPING REAL INFERENCE TAKES, EXACTLY (this is the whole to-do list):
//   1. `bun add onnxruntime-web` (or a wasm build of your own) — one dependency,
//      its typings must pass `scripts/typecheck-guard.ts`.
//   2. Serve the real weights at the manifest's slot (see `model-manifest.ts`
//      `ACTIVE_MODEL_ID`) and pin their sha256.
//   3. Replace the body below with a runtime that builds a session from
//      `ctx.readWeights()` and a tokenizer for the five shipped languages, and
//      returns `{ name, translate }`. NOTHING ELSE CHANGES: the loader, the cache
//      survival, the progress UI and the seam are already wired and gated.
//
// COOP/COEP: a threaded wasm runtime needs SharedArrayBuffer, which needs
// `cross-origin-embedder-policy` / `cross-origin-opener-policy` headers, which
// `serve.ts` does not set today. Single-threaded wasm needs neither.

import type { ModelProfile } from "../model-manifest";

export interface TranslatorRuntimeContext {
  model: ModelProfile;
  /** the cached weights, chunk by chunk and in order — never one 603 MB buffer */
  readWeights: () => AsyncIterable<Uint8Array>;
  /** the Cache Storage bucket the weights live in (`dse-model-v1`) */
  cacheName: string;
}

export interface TranslatorRuntime {
  /** for the diagnostics line, e.g. "m2m100-418m-onnx-web" */
  name: string;
  /** null when it cannot translate this string — never the input echoed back */
  translate(text: string, from: string, to: string): Promise<string | null>;
  dispose?(): void;
}

export async function createRuntime(_ctx: TranslatorRuntimeContext): Promise<TranslatorRuntime | null> {
  return null;
}
