#!/usr/bin/env bun
/**
 * verify-weights.ts — WHAT IS ACTUALLY ON DISK, AGAINST WHAT THE MANIFEST CLAIMS.
 *
 * The one thing a deploy must get right before the real model goes live: the file
 * served at `/models/<name>` has to be the exact byte length and the exact sha256
 * the manifest pins. If they disagree, every player downloads 603 MB and then the
 * loader (correctly) throws it away.
 *
 * Usage:
 *   cd site
 *   bun run scripts/verify-weights.ts                 # the profile in the manifest
 *   bun run scripts/verify-weights.ts m2m100          # a named profile, before flipping
 *
 * Run it from `site/` (it reads `./models`). It streams the file, so hashing 603 MB
 * does not need 603 MB of memory.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { MODEL, MODEL_PROFILES, type ModelProfile } from "../src/game/translate/model-manifest";

const dir = "models";
const wanted = process.argv[2];
const profile: ModelProfile =
  wanted === undefined
    ? MODEL
    : ((MODEL_PROFILES as Record<string, ModelProfile>)[wanted] ??
      (() => {
        throw new Error(`unknown profile "${wanted}" — try: ${Object.keys(MODEL_PROFILES).join(", ")}`);
      })());

const path = `${dir}/${profile.file}`;
let size: number;
try {
  size = statSync(path).size;
} catch {
  console.log(`MISSING  ${path}`);
  console.log(`         the manifest expects ${String(profile.bytes)} bytes (sha256 ${profile.sha256 ?? "unpinned"})`);
  console.log(`         regenerate the stand-in with: bun run scripts/probe-weights.ts`);
  process.exit(1);
}

const hash = createHash("sha256");
await new Promise<void>((resolve, reject) => {
  createReadStream(path)
    .on("data", (chunk) => hash.update(chunk))
    .on("error", reject)
    .on("end", () => {
      resolve();
    });
});
const sha = hash.digest("hex");

const sizeMatches = size === profile.bytes;
const shaMatches = profile.sha256 !== null && sha === profile.sha256;
console.log(`file      ${path}`);
console.log(`profile   ${profile.id}  (${profile.label})`);
console.log(`bytes     ${String(size)}  manifest ${String(profile.bytes)}  ${sizeMatches ? "OK" : "MISMATCH"}`);
console.log(`sha256    ${sha}`);
console.log(`          manifest ${profile.sha256 ?? "(unpinned)"}  ${shaMatches ? "OK" : profile.sha256 === null ? "TO PIN" : "MISMATCH"}`);
console.log(`chunks    ${String(Math.ceil(profile.bytes / profile.chunkBytes))} × ${String(profile.chunkBytes)} bytes`);
if (!sizeMatches || (profile.sha256 !== null && !shaMatches)) process.exit(2);
console.log(`\nVERDICT: the served bytes match the manifest${profile.sha256 === null ? " in length; paste the sha256 above into the manifest to make this an integrity check" : ""}.`);
