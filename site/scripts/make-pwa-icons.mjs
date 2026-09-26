#!/usr/bin/env node
/**
 * make-pwa-icons — regenerate the installable-app icons.
 *
 * WHY A GENERATOR: the home-screen icon is delivery plumbing, not art direction.
 * `public/art/` holds race emblems (The Grays, The Watchers, …) — each one is a
 * RACE's identity, so shipping one of them as the app icon would brand the whole
 * game as that race. The brand mark this draws is therefore built from the
 * design tokens alone (styles/app.css §1): the dark Blacksite surfaces and the
 * ember accent, plus the dashed-ring geometry every race emblem already uses.
 *
 * REPLACING IT (the designer's job, flagged in the PR): drop new PNGs at the
 * same four paths with the same pixel sizes — no code change, nothing to
 * re-wire. `pwa-tests/pwa-verify.ts` reads the pixel size out of each file's
 * IHDR, so a replacement that is the wrong size fails the gate instead of
 * shipping a blurry icon.
 *
 * USAGE:  node scripts/make-pwa-icons.mjs
 *         CHROME_PATH=/path/to/chrome node scripts/make-pwa-icons.mjs
 * It needs a Chromium binary (playwright's is used if CHROME_PATH is unset) and
 * nothing else — no image library is installed on this box on purpose.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(SITE, "public", "icons");

// ---- tokens (must match styles/app.css §1: @theme + :root) -------------------
const SURF_0 = "#070910"; // page base
const SURF_3 = "#161d26"; // raised card
const EMBER = "#ff9d3c"; // the accent: resources, positive, primary CTA

/**
 * The mark, in a 0 0 48 48 viewBox, drawn at `scale` about the centre.
 * A hexagon ring (the Cradle — a component, a hive, a rebuilt thing) with a
 * solid ember core, and the dashed outer ring the race emblems already use.
 */
function mark(scale) {
  const hex = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    hex.push(`${(24 + 15.5 * Math.cos(a)).toFixed(2)},${(24 + 15.5 * Math.sin(a)).toFixed(2)}`);
  }
  return `
  <g transform="translate(24 24) scale(${scale}) translate(-24 -24)"
     fill="none" stroke="${EMBER}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="24" cy="24" r="21" stroke-width="1" stroke-dasharray="3 5" opacity="0.5" />
    <polygon points="${hex.join(" ")}" stroke-width="2.4" />
    <polygon points="24,17.5 30.5,24 24,30.5 17.5,24" fill="${EMBER}" stroke="none" />
  </g>`;
}

function svg(size, scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${SURF_3}" />
      <stop offset="1" stop-color="${SURF_0}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="48" height="48" fill="url(#bg)" />${mark(scale)}
</svg>`;
}

// `scale` 1 = the mark as drawn; maskable icons shrink it so it sits well inside
// the mask's safe circle (the inner 80%) whatever shape a launcher crops to.
const TARGETS = [
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.82 },
  { file: "apple-touch-icon-180.png", size: 180, scale: 1 },
];

const CHROME =
  process.env.CHROME_PATH ||
  ["/opt/browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p) ||
  undefined;

// The box installs playwright globally rather than in this package, and NODE_PATH
// does not apply to ESM imports — so try the bare specifier, then the global path.
async function loadPlaywright() {
  for (const spec of ["playwright", "/usr/lib/node_modules/playwright/index.mjs"]) {
    try {
      return await import(spec);
    } catch {
      /* try the next one */
    }
  }
  throw new Error("playwright is not installed — set CHROME_PATH and provide playwright, or drop replacement PNGs at public/icons/");
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
mkdirSync(OUT_DIR, { recursive: true });
for (const t of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: t.size, height: t.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>${svg(t.size, t.scale)}`,
    { waitUntil: "load" },
  );
  const buf = await page.screenshot({ type: "png" });
  writeFileSync(join(OUT_DIR, t.file), buf);
  console.log(`${t.file} — ${t.size}x${t.size}, ${buf.length} bytes`);
  await page.close();
}
await browser.close();
console.log(`icons written to ${OUT_DIR}`);
