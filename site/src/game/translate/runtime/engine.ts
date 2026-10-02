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

type TranslationPipe = (
  text: string,
  opts: { src_lang: string; tgt_lang: string; max_new_tokens: number },
) => Promise<{ translation_text: string }[] | { translation_text: string }>;

interface PipelineDeps {
  loadPipeline: () => Promise<TranslationPipe>;
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
  const cache = await caches.open(ctx.cacheName);
  const match = cache.match.bind(cache);
  const put = cache.put.bind(cache);
  env.customCache = {
    match: (name: string) => match(normalizeCacheKey(name)),
    put: (name: string, response: Response) => put(normalizeCacheKey(name), response),
  };
  env.remoteHost = R2_BASE_URL;
  env.remotePathTemplate = "";
  env.allowLocalModels = false;
  env.allowRemoteModels = true;

  let pipe: { (text: string, opts: object): Promise<unknown>; dispose?: () => void } | null = null;

  const deps: PipelineDeps = {
    loadPipeline: async (): Promise<TranslationPipe> => {
      // WebGPU first for speed; some drivers reject quantised sessions, so a
      // failed WebGPU build falls back to WASM rather than failing the runtime.
      const devices: ("webgpu" | "wasm")[] = [await selectDevice()];
      if (devices[0] !== "wasm") devices.push("wasm");
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
  const active = pipe;
  const deviceNote = resolved.device ?? "wasm";

  return {
    name: `m2m100-418m-q8 (${deviceNote})`,
    async translate(text: string, from: string, to: string): Promise<string | null> {
      const clean = text.trim();
      if (!clean) return null;
      const src = M2M_LANG[from];
      const tgt = M2M_LANG[to];
      if (!src || !tgt || src === tgt) return null;
      try {
        // Chat lines are short; bound the generation so a pathological input
        // cannot spin the decoder on a phone.
        const out = await active(clean, { src_lang: src, tgt_lang: tgt, max_new_tokens: 256 });
        const line = Array.isArray(out) ? out[0]?.translation_text : out?.translation_text;
        return typeof line === "string" && line.trim().length > 0 ? line : null;
      } catch {
        return null;
      }
    },
    dispose(): void {
      resolved.disposePipeline();
    },
  };
}

/** Harness seam: build a runtime around a fake pipeline (the app never calls this). */
export function createTestRuntime(loadPipeline: () => Promise<TranslationPipe>): Promise<PipelineDeps> {
  let pipe: TranslationPipe | null = null;
  return Promise.resolve({
    loadPipeline: async () => {
      pipe = await loadPipeline();
      return pipe;
    },
    disposePipeline: () => {
      pipe = null;
    },
  });
}
