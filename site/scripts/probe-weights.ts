// probe-weights.ts — the DETERMINISTIC stand-in that fills the weights slot.
//
// The real weights (m2m100_418M, ~603 MB) are served from `site/models/`, which
// is outside `dist/client` and gitignored: they are NOT a build input, they never
// enter the build id, and no deploy re-downloads them (WORKFLOW.md, "Updates must
// stay incremental"). That also means no committed file can be the probe.
//
// So the pipeline is proved against a file this script regenerates byte-for-byte:
// same route, same manifest slot, same size/chunk/hash machinery as the real
// model, small enough to keep on disk. Every byte is real content derived from a
// seed — not zeros — so a stream that silently truncates or reorders chunks
// fails the pinned sha256 instead of passing as a plausible blob.
//
// Usage:  bun run scripts/probe-weights.ts [bytes] [dir]
//         (default 20_000_000 bytes → models/pipeline-probe-v1.bin)
//
// The size and the sha256 this prints are the two numbers the manifest pins.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

export const PROBE_SEED = "dse-pipeline-probe-v1";
export const PROBE_FILE = "pipeline-probe-v1.bin";

/**
 * The deterministic content: 32-byte blocks of sha256(`${seed}:${i}`), filled to
 * exactly `total` bytes. Same seed and same size → same bytes → same hash.
 */
export function probeBytes(total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; offset < total; i++) {
    const block = createHash("sha256").update(`${PROBE_SEED}:${String(i)}`, "utf8").digest();
    const take = Math.min(block.length, total - offset);
    out.set(block.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

export function probeSha(total: number): string {
  return createHash("sha256").update(probeBytes(total)).digest("hex");
}

export function writeProbe(dir = "models", total = 20_000_000): { path: string; bytes: number; sha256: string } {
  const bytes = probeBytes(total);
  const path = `${dir}/${PROBE_FILE}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, bytes);
  return { path, bytes: total, sha256: createHash("sha256").update(bytes).digest("hex") };
}

if (import.meta.main) {
  const total = Number(process.argv[2] ?? 20_000_000);
  const dir = process.argv[3] ?? "models";
  const written = writeProbe(dir, total);
  console.log(`${written.path}  ${String(written.bytes)} bytes  sha256 ${written.sha256}`);
}
