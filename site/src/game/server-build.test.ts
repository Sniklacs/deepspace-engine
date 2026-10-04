// server-build.test.ts — stale server bundle process guard (2026-10-04).
//
// ROOT CAUSE of the still-broken alliance join: the deployed server function
// (.vercel/output/functions/render.func/index.mjs) was STALE — the deploy ran
// `vite build` (client only), which never rebuilds render.func; the server
// bundle is only rebuilt by build-vercel.sh step 3. The 7280f0b code fix was
// correct but never reached the server. These tests pin the process fix:
//   1. build-vercel.sh MUST contain the render.func server-bundle build step
//      with SERVER_BUILD_SHA exported and inlined via --env.
//   2. vercel-entry.ts exports serverBuildSha() and surfaces it via
//      /api/health as `serverBuild`, so a stale server bundle is caught in
//      seconds by comparing it to the deployed commit.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("server bundle build process (2026-10-04 stale-bundle regression)", () => {
  test("build-vercel.sh rebuilds the server function AND stamps the build SHA", () => {
    const script = readFileSync(join(SITE_ROOT, "build-vercel.sh"), "utf-8");
    // The step that was skipped by the broken deploy:
    expect(script).toMatch(/functions\/render\.func\/index\.mjs/);
    expect(script).toMatch(/vercel-entry\.ts/);
    // The SHA stamp that makes a stale server bundle detectable:
    expect(script).toMatch(/--env=SERVER_BUILD_\*/);
    expect(script).toMatch(/export SERVER_BUILD_SHA/);
  });

  test("vercel-entry.ts exports serverBuildSha and surfaces it via /api/health", () => {
    const src = readFileSync(join(SITE_ROOT, "vercel-entry.ts"), "utf-8");
    expect(src).toMatch(/export function serverBuildSha/);
    expect(src).toMatch(/process\.env\.SERVER_BUILD_SHA/);
    expect(src).toMatch(/serverBuild: serverBuildSha\(\)/);
  });
});
