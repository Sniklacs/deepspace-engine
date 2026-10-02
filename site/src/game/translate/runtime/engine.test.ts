// runtime/engine.test.ts — the translation engine's seam, against a fake pipeline.
//
// The real Transformers.js pipeline is never constructed here: `createRuntime`
// takes its pipeline through an injectable `deps` promise, so these tests prove
// the language mapping, the honesty contract (null, never a guess), and the
// lifecycle — without downloading 600 MB.

import { describe, expect, test, beforeEach } from "bun:test";
import { createRuntime, createTestRuntime, type TranslatorRuntimeContext } from "./engine";
import { TRANSLATE_PACK } from "../model-manifest";

// engine.ts bails outside a browser; the seam under test is the mapping +
// honesty, so a minimal window stand-in is enough.
beforeEach(() => {
  (globalThis as Record<string, unknown>)["window"] = globalThis;
});

function ctx(): TranslatorRuntimeContext {
  return { pack: TRANSLATE_PACK, cacheName: "dse-model-v1" };
}

function fastCtx(): TranslatorRuntimeContext {
  return { ...ctx(), inferenceTimeoutMs: 50 };
}

interface Call {
  text: string;
  src: string;
  tgt: string;
}

function fakeDeps(impl?: (text: string, opts: { src_lang: string; tgt_lang: string }) => string) {
  const calls: Call[] = [];
  const pipe = async (text: string, opts: { src_lang: string; tgt_lang: string; max_new_tokens: number }) => {
    calls.push({ text, src: opts.src_lang, tgt: opts.tgt_lang });
    if (impl) return [{ translation_text: impl(text, opts) }];
    return [{ translation_text: `[${opts.tgt_lang}] ${text}` }];
  };
  const deps = createTestRuntime(async () => pipe);
  return { deps, calls };
}

describe("createRuntime", () => {
  test("maps the game's five codes to M2M100 languages, direct (no pivot)", async () => {
    const { deps, calls } = fakeDeps();
    const rt = await createRuntime(ctx(), deps);
    expect(rt).not.toBeNull();
    await rt!.translate("Hello", "en", "es");
    await rt!.translate("Olá", "pt-BR", "ru");
    await rt!.translate("سلام", "fa", "en");
    expect(calls).toEqual([
      { text: "Hello", src: "en", tgt: "es" },
      { text: "Olá", src: "pt", tgt: "ru" },
      { text: "سلام", src: "fa", tgt: "en" },
    ]);
  });

  test("returns the pipeline's translation text", async () => {
    const { deps } = fakeDeps(() => "Hola mundo");
    const rt = await createRuntime(ctx(), deps);
    expect(await rt!.translate("Hello world", "en", "es")).toBe("Hola mundo");
  });

  test("honesty: null for empty, same-language, and unknown languages — never echoed", async () => {
    const { deps, calls } = fakeDeps();
    const rt = await createRuntime(ctx(), deps);
    expect(await rt!.translate("   ", "en", "es")).toBeNull();
    expect(await rt!.translate("Hello", "en", "en")).toBeNull();
    expect(await rt!.translate("Hello", "xx", "es")).toBeNull();
    expect(await rt!.translate("Hello", "en", "xx")).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("honesty: null when the pipeline throws or answers empty", async () => {
    const { deps } = fakeDeps(() => {
      throw new Error("driver exploded");
    });
    const rt = await createRuntime(ctx(), deps);
    expect(await rt!.translate("Hello", "en", "es")).toBeNull();

    const { deps: deps2 } = fakeDeps(() => "   ");
    const rt2 = await createRuntime(ctx(), deps2);
    expect(await rt2!.translate("Hello", "en", "es")).toBeNull();
  });

  test("null when the pipeline cannot be built", async () => {
    const deps = createTestRuntime(async () => {
      throw new Error("no WebGPU, no WASM");
    });
    expect(await createRuntime(ctx(), deps)).toBeNull();
  });

  test("WebGPU inference failure rebuilds once on WASM and retries the same request", async () => {
    // Hans's phone: the WebGPU session BUILDS, then the first real inference
    // throws (quantised op the driver cannot run). The runtime must dispose,
    // rebuild explicitly on WASM, and retry — the player never sees the seam.
    const loads: (string | undefined)[] = [];
    const webgpuPipe = async (): Promise<{ translation_text: string }[]> => {
      throw new Error("WebGPU: quantized op not supported by this driver");
    };
    const wasmPipe = async (
      text: string,
      opts: { src_lang: string; tgt_lang: string; max_new_tokens: number },
    ): Promise<{ translation_text: string }[]> => {
      return [{ translation_text: `[${opts.tgt_lang}] ${text}` }];
    };
    const deps = createTestRuntime(async (forceDevice) => {
      loads.push(forceDevice);
      return forceDevice === "wasm" ? wasmPipe : webgpuPipe;
    }, "webgpu");
    const rt = await createRuntime(ctx(), deps);
    expect(rt).not.toBeNull();

    const out = await rt!.translate("Hello", "en", "es");
    expect(out).toBe("[es] Hello");
    // initial build (unforced) + exactly one forced WASM rebuild
    expect(loads).toEqual([undefined, "wasm"]);
    // the recovered fallback clears the error slate — Settings stays clean
    expect(rt!.lastError).toBeNull();

    // a second translation rides the WASM pipeline: no further rebuilds
    expect(await rt!.translate("Adios", "es", "en")).toBe("[en] Adios");
    expect(loads).toEqual([undefined, "wasm"]);
  });

  test("a hung inference fails honestly instead of spinning forever", async () => {
    // Hans 2026-10-02: "Translating…" never resolved. A pipe that never
    // settles must reject by the timeout so the UI can say so.
    const never = async (): Promise<{ translation_text: string }[]> => {
      await new Promise(() => {});
      throw new Error("unreachable");
    };
    const deps = createTestRuntime(async () => never, "wasm");
    const rt = await createRuntime(fastCtx(), deps);
    expect(rt).not.toBeNull();
    const start = Date.now();
    expect(await rt!.translate("Hello", "en", "es")).toBeNull();
    expect(Date.now() - start).toBeLessThan(5000);
    expect(typeof rt!.lastError).toBe("string");
    expect(rt!.lastError as string).toMatch("timed out");
  });

  test("when WASM also fails, the real error is recorded for Settings", async () => {
    // The WebGPU session BUILDS (so the runtime exists) but its first
    // inference throws; the forced WASM rebuild then fails too. translate()
    // returns null and lastError names the WASM failure for Settings.
    const deps = createTestRuntime(async (forceDevice) => {
      if (forceDevice === "wasm") throw new Error("WASM: out of memory");
      return async (): Promise<{ translation_text: string }[]> => {
        throw new Error("WebGPU: quantized op not supported by this driver");
      };
    }, "webgpu");
    const rt = await createRuntime(ctx(), deps);
    expect(rt).not.toBeNull();
    expect(await rt!.translate("Hello", "en", "es")).toBeNull();
    expect(typeof rt!.lastError).toBe("string");
    expect(rt!.lastError as string).toMatch("out of memory");
  });

  test("the engine note names the device trail, stage, and error", async () => {
    // Hans 2026-10-02: the Settings note said only "null function" — no
    // device, no stage, no error name. The note must carry the full trail so
    // the next phone failure is diagnosable from a screenshot.
    const deps = createTestRuntime(async (forceDevice) => {
      if (forceDevice === "wasm") throw new Error("WASM: out of memory");
      return async (): Promise<{ translation_text: string }[]> => {
        const e = new Error("null function");
        e.name = "RuntimeError";
        throw e;
      };
    }, "webgpu");
    const rt = await createRuntime(ctx(), deps);
    expect(await rt!.translate("Hello", "en", "es")).toBeNull();
    const errNote = rt!.lastError as string;
    expect(errNote).toMatch("webgpu infer");
    expect(errNote).toMatch("wasm build");
    expect(errNote).toMatch("RuntimeError");
    expect(errNote).toMatch("out of memory");
  });

  test("dispose does not throw", async () => {
    const { deps } = fakeDeps();
    const rt = await createRuntime(ctx(), deps);
    let threw = false;
    try {
      rt!.dispose?.();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("runtime name identifies the model", async () => {
    const { deps } = fakeDeps();
    const rt = await createRuntime(ctx(), deps);
    expect(rt!.name.includes("m2m100-418m-q8")).toBe(true);
  });
});

describe("applyPackEnv", () => {
  test("enables the custom cache — without the flag the game's 640 MB is ignored", async () => {
    const { applyPackEnv } = await import("./engine");
    const env: Record<string, unknown> = {};
    applyPackEnv(env, { pack: TRANSLATE_PACK, cacheName: "dse-model-v1" });
    // THE live bug of 2026-10-01: customCache was set but useCustomCache stayed
    // false, so Transformers.js used its default bucket and the downloaded pack
    // sat unused while chat said "preparing" forever.
    expect(env.useCustomCache).toBe(true);
    expect(typeof (env.customCache as Record<string, unknown>).match).toBe("function");
    expect(typeof (env.customCache as Record<string, unknown>).put).toBe("function");
    expect(env.remoteHost).toBe("https://pub-06ebde2d7f0340d79319d029ddcb06aa.r2.dev");
    expect(env.remotePathTemplate).toBe("");
    expect(env.allowLocalModels).toBe(false);
    expect(env.allowRemoteModels).toBe(true);
  });
});
