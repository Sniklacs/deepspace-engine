// model-manifest.test.ts — the translation pack's identity, pinned.
//
// These tests pin what the owner approved (2026-10-01): the R2 base URL he
// provided, the exact files Transformers.js will ask for, and the byte sizes +
// sha256 hashes verified against the Xenova/m2m100_418M repo. If any of these
// change, the download contract changes, and that must be a deliberate edit.

import { describe, expect, test } from "bun:test";
import {
  PACK_CHUNK_BYTES,
  R2_BASE_URL,
  TRANSLATE_PACK,
  packChunkCacheKey,
  packChunkRange,
  packFileChunkCount,
  packFileUrl,
  packReceiptCacheKey,
  packTotalBytes,
} from "./model-manifest";

describe("R2 base URL", () => {
  test("is the owner-provided public bucket URL", () => {
    expect(R2_BASE_URL).toBe("https://pub-06ebde2d7f0340d79319d029ddcb06aa.r2.dev");
  });

  test("file URLs are bucket-root URLs", () => {
    const file = TRANSLATE_PACK.files[0]!;
    expect(packFileUrl(file)).toBe(`${R2_BASE_URL}/${file.path}`);
    expect(packFileUrl(file).includes("//onnx")).toBe(false);
  });
});

describe("pack integrity", () => {
  test("every file has a path, a positive size, and a pinned 64-hex sha256", () => {
    expect(TRANSLATE_PACK.files.length).toBeGreaterThan(0);
    const paths = new Set<string>();
    for (const f of TRANSLATE_PACK.files) {
      expect(f.path.length).toBeGreaterThan(0);
      expect(f.bytes).toBeGreaterThan(0);
      expect(/^[0-9a-f]{64}$/.test(f.sha256)).toBe(true);
      expect(paths.has(f.path)).toBe(false);
      paths.add(f.path);
    }
  });

  test("contains exactly the files Transformers.js requests for a q8 seq2seq pipeline", () => {
    const paths = TRANSLATE_PACK.files.map((f) => f.path).sort();
    expect(paths).toEqual(
      [
        "config.json",
        "generation_config.json",
        "onnx/decoder_model_merged_quantized.onnx",
        "onnx/encoder_model_quantized.onnx",
        "tokenizer.json",
        "tokenizer_config.json",
      ].sort(),
    );
  });

  test("ONNX sizes match the verified HuggingFace figures", () => {
    const byPath = Object.fromEntries(TRANSLATE_PACK.files.map((f) => [f.path, f]));
    expect(byPath["onnx/encoder_model_quantized.onnx"].bytes).toBe(287856370);
    expect(byPath["onnx/decoder_model_merged_quantized.onnx"].bytes).toBe(344128178);
    expect(byPath["onnx/encoder_model_quantized.onnx"].sha256).toBe(
      "13a94e354a9140764eb81102d77d3ec6952d796e6f113c651eeb3c3443da0386",
    );
    expect(byPath["onnx/decoder_model_merged_quantized.onnx"].sha256).toBe(
      "007654bcabb6cea6fd3bde34ce933137b431330b3755781145d7b6906270b45a",
    );
  });

  test("total is the sum of the files (~640 MB pack)", () => {
    const total = packTotalBytes();
    expect(total).toBe(TRANSLATE_PACK.files.reduce((n, f) => n + f.bytes, 0));
    // The owner approved the ~600 MB size class; this pins the order of magnitude.
    expect(total).toBeGreaterThan(600_000_000);
    expect(total).toBeLessThan(700_000_000);
  });

  test("pack id is versioned", () => {
    expect(TRANSLATE_PACK.id).toBe("m2m100-418m-q8-r2-v1");
    expect(TRANSLATE_PACK.label.length).toBeGreaterThan(0);
  });
});

describe("chunking math", () => {
  test("chunk ranges tile each file exactly", () => {
    for (const f of TRANSLATE_PACK.files) {
      const n = packFileChunkCount(f);
      expect(n).toBe(Math.ceil(f.bytes / PACK_CHUNK_BYTES));
      let covered = 0;
      for (let i = 0; i < n; i++) {
        const r = packChunkRange(f, i);
        expect(r.start).toBe(covered);
        expect(r.end).toBeGreaterThan(r.start);
        expect(r.end <= f.bytes).toBe(true);
        covered = r.end;
      }
      expect(covered).toBe(f.bytes);
    }
  });

  test("chunk cache keys are unique per file and index", () => {
    const keys = new Set<string>();
    for (const f of TRANSLATE_PACK.files.slice(0, 2)) {
      for (let i = 0; i < Math.min(3, packFileChunkCount(f)); i++) {
        const k = packChunkCacheKey(f, i);
        expect(keys.has(k)).toBe(false);
        keys.add(k);
      }
    }
  });

  test("receipt key is stable per pack id", () => {
    expect(packReceiptCacheKey()).toBe(packReceiptCacheKey(TRANSLATE_PACK));
    expect(packReceiptCacheKey().includes(encodeURIComponent(TRANSLATE_PACK.id))).toBe(true);
  });
});
