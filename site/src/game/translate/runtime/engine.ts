// runtime/engine.ts — THE BROWSER-NATIVE TRANSLATION RUNTIME.
//
// The game-owned translator (owner 2026-10-01): Meta M2M100-418M (MIT), q8 ONNX
// via Transformers.js v3, running on the device. The pack lives in Cache Storage
// (`dse-model-v1`, put there by `weights.ts`); this module hands those bytes to
// Transformers.js through its `env.customCache` hook, so the pipeline never
// re-downloads what the game already fetched — and stays working offline.
//
// HOW THE PIECES FIT:
//   - `createRuntime` is called only after `weights.ts` reports the pack ready.
//   - Transformers.js is loaded with a DYNAMIC import, so its ~MBs of runtime
//     never join the app's initial bundle — they load once, when the translator
//     first initializes.
//   - `env.remoteHost` points at the R2 bucket and `env.remotePathTemplate` is
//     empty (files live at the bucket root). If a file ever missed the cache,
//     the pipeline would fetch it from R2 itself — the game stays working.
//   - WebGPU when the device offers it, WASM when it does not (or when WebGPU
//     session creation fails — some drivers reject quantised sessions).
//   - M2M100 translates DIRECTLY between any pair of its languages: no pivot
//     through English. The game only ever asks for the 20 directions of
//     en / es / pt-BR / ru / fa; chat already stamps the sender's UI locale,
//     so there is no language detection here.
//
// HONESTY CONTRACT: `createRuntime` returns null when the pipeline cannot be
// built, and `translate()` returns null for anything it cannot answer — never
// the input echoed back, never a guess. The UI's preparing state is the truth
// then, not a placeholder.

import { R2_BASE_URL, TRANSFORMERS_MODEL_ID, type ModelPack } from "../model-manifest";

export interface TranslatorRuntimeContext {
  pack: ModelPack;
  /** the Cache Storage bucket the pack lives in (`dse-model-v1`) */
  cacheName: string;
}

export interface TranslatorRuntime {
  /** for the diagnostics line, e.g. "m2m100-418m-q8 (webgpu)" */
  name: string;
  /** null when it cannot translate this string — never the input echoed back */
  translate(text: string, from: string, to: string): Promise<string | null>;
  /** the last inference failure, for the diagnostics line — null when none */
  lastError: string | null;
  dispose?(): void;
}

/** The game's five UI codes -> the M2M100 language token codes. */
const M2M_LANG: Record<string, string> = {
  en: "en",
  es: "es",
  "pt-BR": "pt",
  ru: "ru",
  fa: "fa",
};

/** Collapse the `//` Transformers.js leaves when the remote path template is empty. */
function normalizeCacheKey(name: string): string {
  return name.replace(/([^:])\/{2,}/g, "$1/");
}

/**
 * Point Transformers.js at the game's own pack: the files live in Cache
 * Storage (`dse-model-v1`, put there by weights.ts, hash-verified) under their
 * R2 URLs, and the bucket is the network fallback.
 *
 * THE FLAG THAT MATTERS: `useCustomCache` must be true, or Transformers.js
 * ignores `customCache` entirely and uses its default `transformers-cache`
 * bucket — the game's 640 MB would sit unused while the pipeline re-downloads
 * (or fails) elsewhere. This was the live bug of 2026-10-01: the pack showed
 * as downloaded in Settings while chat said "preparing" forever.
 */
export function applyPackEnv(
  env: {
    useCustomCache?: boolean;
    customCache?: { match: (name: string) => Promise<Response | undefined>; put: (name: string, response: Response) => Promise<void> };
    remoteHost?: string;
    remotePathTemplate?: string;
    allowLocalModels?: boolean;
    allowRemoteModels?: boolean;
  },
  ctx: TranslatorRuntimeContext,
): void {
  env.useCustomCache = true;
  env.customCache = {
    match: (name: string) => caches.open(ctx.cacheName).then((c) => c.match(normalizeCacheKey(name))),
    put: (name: string, response: Response) =>
      caches.open(ctx.cacheName).then((c) => c.put(normalizeCacheKey(name), response)),
  };
  env.remoteHost = R2_BASE_URL;
  env.remotePathTemplate = "";
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
}

type TranslationPipe = (
  text: string,
  opts: { src_lang: string; tgt_lang: string; max_new_tokens: number },
) => Promise<{ translation_text: string }[] | { translation_text: string }>;

interface PipelineDeps {
  loadPipeline: (forceDevice?: "webgpu" | "wasm") => Promise<TranslationPipe>;
  disposePipeline: () => void;
  /** set by loadPipeline: which device the pipeline actually built on */
  device?: string;
}

/** Pick WebGPU when the device offers a real adapter, else WASM. */
async function selectDevice(): Promise<"webgpu" | "wasm"> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return "webgpu";
  } catch {
    /* software WebGL / denied adapter: WASM below */
  }
  return "wasm";
}

async function realDeps(ctx: TranslatorRuntimeContext): Promise<PipelineDeps> {
  const { env, pipeline } = await import("@huggingface/transformers");

  // Serve the pipeline from the game's own pack cache: every file the pipeline
  // asks for is already on the device under its R2 URL (put there by weights.ts,
  // hash-verified). The key normaliser heals the double slash Transformers.js
  // builds when the remote path template is empty.
  applyPackEnv(env, ctx);

  let pipe: { (text: string, opts: object): Promise<unknown>; dispose?: () => void } | null = null;

  const deps: PipelineDeps = {
    loadPipeline: async (forceDevice?: "webgpu" | "wasm"): Promise<TranslationPipe> => {
      // WebGPU first for speed; some drivers reject quantised sessions, so a
      // failed WebGPU build falls back to WASM rather than failing the runtime.
      // A forced device skips the preference list (the inference fallback below).
      const devices: ("webgpu" | "wasm")[] = forceDevice ? [forceDevice] : [await selectDevice()];
      if (!forceDevice && devices[0] !== "wasm") devices.push("wasm");
      let lastError: unknown = null;
      for (const device of devices) {
        try {
          const created = (await pipeline("translation", TRANSFORMERS_MODEL_ID, {
            dtype: "q8",
            device,
          })) as unknown as {
            (text: string, opts: object): Promise<unknown>;
            dispose?: () => void;
          };
          pipe = created;
          deps.device = device;
          return created as unknown as TranslationPipe;
        } catch (err) {
          lastError = err;
          try {
            pipe?.dispose?.();
          } catch {
            /* disposing a half-built pipeline is best-effort */
          }
          pipe = null;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("the translation pipeline could not be built");
    },
    disposePipeline: () => {
      try {
        pipe?.dispose?.();
      } catch {
        /* a dying pipeline is not an error */
      }
      pipe = null;
    },
  };
  return deps;
}

export async function createRuntime(
  ctx: TranslatorRuntimeContext,
  deps?: Promise<PipelineDeps>,
): Promise<TranslatorRuntime | null> {
  if (typeof window === "undefined") return null;
  let resolved: PipelineDeps;
  try {
    resolved = deps ? await deps : await realDeps(ctx);
  } catch {
    return null;
  }

  let pipe: TranslationPipe | null = null;
  try {
    pipe = await resolved.loadPipeline();
  } catch {
    return null;
  }
  let active = pipe;
  // A driver can BUILD a WebGPU session it then cannot RUN (quantised ops).
  // The first inference that throws on WebGPU rebuilds the pipeline on WASM
  // once and retries — the player never sees the seam.
  let inferenceFellBack = false;
  let lastError: string | null = null;

  async function runInference(clean: string, src: string, tgt: string): Promise<string | null> {
    // Chat lines are short; bound the generation so a pathological input
    // cannot spin the decoder on a phone.
    const out = await active(clean, { src_lang: src, tgt_lang: tgt, max_new_tokens: 256 });
    const line = Array.isArray(out) ? out[0]?.translation_text : out?.translation_text;
    return typeof line === "string" && line.trim().length > 0 ? line : null;
  }

  return {
    get name() {
      return `m2m100-418m-q8 (${resolved.device ?? "wasm"})`;
    },
    get lastError() {
      return lastError;
    },
    async translate(text: string, from: string, to: string): Promise<string | null> {
      const clean = text.trim();
      if (!clean) return null;
      const src = M2M_LANG[from];
      const tgt = M2M_LANG[to];
      if (!src || !tgt || src === tgt) return null;
      try {
        const line = await runInference(clean, src, tgt);
        // A success clears the slate: a recovered fallback is not an error.
        if (line !== null) lastError = null;
        return line;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!inferenceFellBack && resolved.device === "webgpu") {
          inferenceFellBack = true;
          try {
            resolved.disposePipeline();
            active = await resolved.loadPipeline("wasm");
            const line = await runInference(clean, src, tgt);
            if (line !== null) lastError = null;
            return line;
          } catch (err2) {
            lastError = err2 instanceof Error ? err2.message : String(err2);
          }
        }
        return null;
      }
    },
    dispose(): void {
      resolved.disposePipeline();
    },
  };
}

/** Harness seam: build a runtime around a fake pipeline (the app never calls this).
 * The factory receives the forced device (undefined for the initial build),
 * and `device` names what the initial build reports — "webgpu" lets a test
 * drive the inference-fallback path. */
export function createTestRuntime(
  loadPipeline: (forceDevice?: "webgpu" | "wasm") => Promise<TranslationPipe>,
  device: string = "wasm",
): Promise<PipelineDeps> {
  let pipe: TranslationPipe | null = null;
  const deps: PipelineDeps = {
    loadPipeline: async (forceDevice?: "webgpu" | "wasm") => {
      pipe = await loadPipeline(forceDevice);
      deps.device = forceDevice ?? device;
      return pipe;
    },
    disposePipeline: () => {
      pipe = null;
    },
  };
  return Promise.resolve(deps);
}
