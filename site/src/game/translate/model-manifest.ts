// model-manifest.ts — THE ONE PLACE THE TRANSLATION PACK IS DESCRIBED.
//
// The game-owned translator is the owner's rule (2026-10-01): Meta's M2M100-418M
// (MIT — verified on the facebook/m2m100_418M model card), converted to ONNX by
// Xenova, running in the browser via Transformers.js v3. One model, direct
// many-to-many translation across all 20 directions of en / es / pt-BR / ru / fa
// — no pivot through English, no server, no key, no language detection (chat
// already stamps the sender's UI locale).
//
// THE PACK. Transformers.js loads a model as a SET of files, not one blob:
//   - config.json, tokenizer.json, tokenizer_config.json — the model + tokenizer
//     definitions (fatal: the pipeline will not start without them)
//   - generation_config.json — decoding defaults (optional, tiny, included)
//   - onnx/encoder_model_quantized.onnx — the q8 ("quantized") encoder
//   - onnx/decoder_model_merged_quantized.onnx — the q8 merged decoder
//     (Transformers.js v3 loads `decoder_model_merged` for seq2seq models; the
//     separate decoder / decoder_with_past pair is not requested)
//
// Quantisation note (verified 2026-10-01 against the HF repo, not assumed): the
// files literally named `*_int8.onnx` in Xenova/m2m100_418M are ~820 MB for the
// decoder — larger than the q8 `_quantized` pair (288 + 344 MB). The q8 merged
// set below is the smallest working set the repo ships: ~632 MB of ONNX +
// ~8 MB of tokenizer/configs. The owner approved the ~600 MB size class
// ("go ahead and do the 500 MB one, that's fine").
//
// THREE THINGS THIS FILE DECIDES, AND WHY EACH ONE MATTERS:
//
//   1. THE ROUTE. Every file has a full `url` under R2_BASE_URL (Cloudflare R2,
//      zero egress fees). Change the base URL in exactly one place — the
//      exported R2_BASE_URL constant below — and every file URL follows.
//   2. THE SIZE AND THE HASH. `bytes` is what the server must send, exactly;
//      `sha256` is what the assembled file must hash to. The downloader checks
//      both per file — a truncated or reordered transfer fails loudly instead
//      of being cached and loaded as a corrupt model.
//   3. THE IDENTITY — and therefore the incrementality. `id` carries the model
//      AND its quantisation version. The cache bucket (`dse-model-v1`,
//      `src/game/pwa/storage.ts`) is on the service worker's keep-list, so a
//      publish does NOT evict it and a player who already has the pack makes
//      ZERO requests on the next update. Publishing a *new* pack is the only
//      thing that costs a download, and that is deliberate: new file URLs.

/**
 * THE ONE LINE A DEPLOY FLIPS. The public Cloudflare R2 bucket the translation
 * pack is served from (owner-provided 2026-10-01). Model files live at the
 * bucket root, so every file URL is `${R2_BASE_URL}/${file.path}`.
 */
export const R2_BASE_URL = "https://pub-06ebde2d7f0340d79319d029ddcb06aa.r2.dev";

/** One file of the pack: where it lives, how big it is, what it must hash to. */
export interface PackFile {
  /** repo-relative path, e.g. "onnx/encoder_model_quantized.onnx" */
  path: string;
  /** the exact byte length the server must send */
  bytes: number;
  /** the sha256 of the whole file — always pinned for the real pack */
  sha256: string;
}

/** The whole downloadable translator: an identity, a label, and its files. */
export interface ModelPack {
  /** versioned identity — bump it whenever any byte changes */
  id: string;
  /** what it is, for the diagnostics line */
  label: string;
  /** every file Transformers.js will ask for, in download order */
  files: PackFile[];
}

export const TRANSLATE_PACK: ModelPack = {
  id: "m2m100-418m-q8-r2-v1",
  label: "m2m100_418M q8 (MIT) — the on-device translator",
  files: [
    {
      path: "config.json",
      bytes: 908,
      sha256: "1dbdf77ddc7809acd4c54ccf0eab46f840b40174afb1b6f6de8787244e832938",
    },
    {
      path: "tokenizer.json",
      bytes: 7988527,
      sha256: "03d9e111731c2d71f39a2c2a88499743e4c251385d07f0384b4349a23ba54363",
    },
    {
      path: "tokenizer_config.json",
      bytes: 1813,
      sha256: "bacfd4b9da25a61e01f17abe660465f616c9a1a3f5e23ab9ad3326c3788f2d9f",
    },
    {
      path: "generation_config.json",
      bytes: 233,
      sha256: "722210dd0bee7bef4e8e7f9a8574d8c56a2dfff723d73f390ce67892740b9009",
    },
    {
      path: "onnx/encoder_model_quantized.onnx",
      bytes: 287856370,
      sha256: "13a94e354a9140764eb81102d77d3ec6952d796e6f113c651eeb3c3443da0386",
    },
    {
      path: "onnx/decoder_model_merged_quantized.onnx",
      bytes: 344128178,
      sha256: "007654bcabb6cea6fd3bde34ce933137b431330b3755781145d7b6906270b45a",
    },
  ],
};

/** The model id handed to Transformers.js. Valid HF-id format; the files come
 *  from R2_BASE_URL via the engine's remote-host override, not from HF. */
export const TRANSFORMERS_MODEL_ID = "unbound/m2m100-418m-q8";

/** The full URL one pack file is fetched from — and the key it is cached under. */
export function packFileUrl(file: PackFile): string {
  return `${R2_BASE_URL}/${file.path}`;
}

/** Total bytes of the whole pack (what the progress bar measures against). */
export function packTotalBytes(pack: ModelPack = TRANSLATE_PACK): number {
  return pack.files.reduce((sum, f) => sum + f.bytes, 0);
}

/** How much is fetched per request — also the granularity of resume. */
export const PACK_CHUNK_BYTES = 8_000_000;

/** How many chunks one file is split into (the last one may be short). */
export function packFileChunkCount(file: PackFile): number {
  return Math.ceil(file.bytes / PACK_CHUNK_BYTES);
}

/** Byte range of one chunk of one file, half-open: `[start, end)`. */
export function packChunkRange(file: PackFile, index: number): { start: number; end: number } {
  const start = index * PACK_CHUNK_BYTES;
  const end = Math.min(start + PACK_CHUNK_BYTES, file.bytes);
  return { start, end };
}

/** The cache key one chunk is stored under (a query, not a fragment — fragments are dropped). */
export function packChunkCacheKey(file: PackFile, index: number): string {
  return `${packFileUrl(file)}?chunk=${String(index)}`;
}

/** The cache key the pack's completion receipt is stored under. */
export function packReceiptCacheKey(pack: ModelPack = TRANSLATE_PACK): string {
  return `${R2_BASE_URL}/pack-receipt.json?pack=${encodeURIComponent(pack.id)}`;
}
