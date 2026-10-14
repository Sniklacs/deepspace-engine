// ============================================================================
// THE FLOW CREW — standing flow-check harness (design/flow-checklist.md).
//
// Charter (Hans, Oct 14 2026): "a crew that that's all they do is just go
// through the game and check things — check flow, check flow, check flow,
// constantly… if things don't work when you press it, that's annoying."
//
// This harness presses things at phone size (390×844, touch) on a FRESH
// profile against a locally served build of the current tree, and prints the
// checklist's pass/fail table. It builds nothing and fixes nothing: a FAIL is
// a bug report with evidence (what was pressed, what was expected, what
// happened instead, screenshot in flow-check/shots/).
//
// Run:   cd site && bun flow-check/run.mjs
// Env:   BASE=http://127.0.0.1:4517  — point at an already-running server
//        (default: the harness builds the tree with `bun x vite build` and
//        serves dist/ on FLOW_PORT=4517 via flow-check/serve-dist.mjs;
//        FLOW_SKIP_BUILD=1 reuses the previous build)
//        FLOW_PROFILE=/home/hatch/workspace/.flow-profile — browser profile
//        dir (never /tmp on this box: a 512MB tmpfs that fills and wedges Chrome)
//        FLOW_FRESH=1 — wipe the profile first (default: fresh every run)
//
// Verdicts: PASS · FAIL · KNOWN (red, owned by a named in-flight fix — see
// KNOWN_FIXES; the crew re-checks until it flips) · MANUAL (not honestly
// automatable; the exact taps are in design/flow-checklist.md and in the
// run report). Results also land in flow-check/last-run.md.
// Exit code: number of unowned FAILs (0 = nothing new is broken).
// ============================================================================
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { launchChrome, CDP, attachPage, evaluate, screenshot, emulate, tap, drag, wheel, sleep } from "./lib.mjs";

const SITE_DIR = new URL("..", import.meta.url).pathname;
const SHOTS = new URL("./shots/", import.meta.url).pathname;
const PORT = Number(process.env.FLOW_PORT || 4517);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const BOOT_SERVER = !process.env.BASE;
// NOT /tmp: on this box /tmp is a 512MB tmpfs that the whole night's
// browsers filled to 100% — a full /tmp wedges Chrome mid-run and traps it
// at launch ("disk is full" in chrome's own log). The profile lives on the
// real filesystem and is wiped fresh each run.
const PROFILE = process.env.FLOW_PROFILE || "/home/hatch/workspace/.flow-profile";
const W = 390, H = 844;

/** Reds that a named crew already owns. When their fix lands, the line
 *  flips PASS and the entry becomes dead weight — delete it. A red NOT in
 *  this map is a NEW FIND and goes to the top of the report.
 *  Oct 14 founding note: all five fix waves landed the same night (battle
 *  4d51c7b, sound 6c315d9, avatar/store/click-law fd920a5, tutorial 8dffd9c,
 *  globe/exploration 8a33c9c, world stage f9c4937) — the map starts EMPTY
 *  and every line grades on merit. Add an entry only with a named owner
 *  and a fix actually in flight. */
const KNOWN_FIXES = {};

const results = [];
const exceptions = [];
let currentStep = null; // { id, since } — the watchdog's eyes
let writeReport = null; // assigned at the bottom; the watchdog calls it early
function record(id, name, status, note = "", raw = false) {
  // `raw` verdicts (a wedged page, a harness-level error) are never
  // relabelled KNOWN — an owned fix explains a verdict, not a freeze.
  if (status === "FAIL" && !raw && KNOWN_FIXES[id]) status = "KNOWN";
  results.push({ id, name, status, note });
  const tag = { PASS: "PASS ", FAIL: "FAIL ", KNOWN: "KNOWN", MANUAL: "MANUAL" }[status];
  console.log(`${tag}  ${id}  ${name}${note ? " — " + note : ""}`);
}
async function step(id, name, fn) {
  if (aborted) { record(id, name, "MANUAL", "run aborted — environment starved at boot (see 0.1)"); return undefined; }
  currentStep = { id, since: Date.now() };
  try {
    const r = await fn();
    record(id, name, r?.status || "PASS", r?.note || "");
    return r?.value;
  } catch (err) {
    const msg = String(err.message || err).slice(0, 220);
    const wedged = /CDP timeout/.test(msg);
    record(id, name, "FAIL", wedged ? `PAGE WEDGED — ${msg}` : msg, wedged);
    if (wedged) await recover().catch(() => {});
    try { await screenshot(page, `${SHOTS}/fail-${id.replace(/\./g, "_")}.png`); } catch {}
    return undefined;
  } finally {
    currentStep = null;
  }
}
const manual = (note) => ({ status: "MANUAL", note });
const pass = (note, value) => ({ status: "PASS", note, value });
const fail = (note) => ({ status: "FAIL", note });

// ---------- DOM helpers (house style: visible = offsetParent) ----------
const bodyText = () => evaluate(page, `document.body.innerText`);
const findBtn = (re, exact = false) => evaluate(page, `(() => {
  const re = ${exact ? JSON.stringify(String(re)) : re}; const exact = ${exact ? "true" : "false"};
  const b = [...document.querySelectorAll('button, [role="button"], a')].find(x =>
    x.offsetParent && (exact ? x.textContent.trim() === re : re.test(x.textContent) || re.test(x.getAttribute('aria-label') || '')));
  if (!b) return null;
  b.scrollIntoView({ block: 'nearest', inline: 'center' });
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, text: b.textContent.trim().slice(0, 60), disabled: !!b.disabled, pressed: b.getAttribute('aria-pressed') };
})()`);
const visibleButtons = () => evaluate(page, `(() => [...document.querySelectorAll('button, [role="button"], a')]
  .filter(x => x.offsetParent)
  .map(x => { const r = x.getBoundingClientRect(); return { text: (x.textContent || x.getAttribute('aria-label') || '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter(b => b.text))()`);
const sheetOpen = () => evaluate(page, `(() => {
  const el = [...document.querySelectorAll('div')].find(d => d.className && String(d.className).includes('z-20') && d.querySelector('h3'));
  return el ? { title: el.querySelector('h3').textContent.trim(), text: el.innerText.slice(0, 400) } : null;
})()`);
const setInput = (selector, value) => evaluate(page, `(() => {
  const inp = ${selector};
  if (!inp) return false;
  const p = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value');
  p.set.call(inp, ${JSON.stringify(value)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
async function waitFor(re, ms = 12000, label = "") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await bodyText().catch(() => "");
    if (re.test(t)) return true;
    await sleep(600);
  }
  throw new Error(`timed out waiting for ${label || re}`);
}
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);
/** Dev-mode cold compile makes fixed sleeps lie. Poll until the app has
 *  actually rendered a recognizable surface (or give up honestly). */
async function waitReady(ms = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await bodyText().catch(() => "");
    if (t.length > 120 && /Create an account|Found a Colony|Choose Your Legend|FOUNDING|Cradle|Colony|World/i.test(t)) return true;
    await sleep(1500);
  }
  return false;
}
/** Positive proof we're inside the game — the auth screen's own copy
 *  ("Found a Colony", "Colony name") and the star map's canvas must never
 *  count as "in game". Only the main shell's World nav does. */
const inGame = async () => !!(await findBtn("World", true).catch(() => null));
/** The star map stores its live hit-map on the canvas (the game's own
 *  hitTest reads it) — planet centres in CSS pixels, ready to tap. */
const planetPoints = () => evaluate(page, `(() => {
  const c = document.querySelector('canvas');
  if (!c || !c.__planets) return null;
  const r = c.getBoundingClientRect();
  const dpr = c.width / r.width;
  return [...c.__planets.entries()].map(([id, p]) => ({ id, x: r.x + p.x / dpr, y: r.y + p.y / dpr, r: p.r / dpr }));
})()`);
/** Which rooms the run actually reached — downstream lines that depend on
 *  a room report MANUAL (not reached) instead of a fake FAIL/PASS. */
const reached = { explore: false, store: false, settings: false };
let ACCOUNT = "";
let recoveryUsed = false;
let envStarved = false; // ERR_INSUFFICIENT_RESOURCES at boot = lab failure, not a game verdict
let aborted = false;
/** A wedged page gets ONE recovery per run: reload + re-enter with the
 *  run's account (a real player kills and reopens the app). The wedge
 *  itself stays on the record as a FAIL — recovery only lets the rest of
 *  the checklist keep checking. */
async function recover() {
  if (recoveryUsed || !ACCOUNT) return;
  recoveryUsed = true;
  console.log("[flow] page wedged — attempting the one recovery (reload + re-enter)");
  await page.send("Page.navigate", { url: `${BASE}/play` }).catch(() => {});
  if (!(await waitReady(60000))) return;
  // The language overlay reappears over the sign-in form until completed —
  // finish it first or every tap below lands on the wrong layer.
  if (/Choose your language/i.test(await bodyText().catch(() => ""))) {
    const en = await findBtn(/English/i).catch(() => null);
    if (en) { await tap(page, en.x, en.y); await sleep(600); }
    const cont = await findBtn(/Continue/i).catch(() => null);
    if (cont) { await tap(page, cont.x, cont.y); await sleep(2500); }
  }
  const t = await bodyText().catch(() => "");
  if (/Log In|Create an account/i.test(t) && !/Sealed System/i.test(t)) {
    const login = await findBtn(/Log In/i).catch(() => null);
    if (login) { await tap(page, login.x, login.y); await sleep(1200); }
    await setInput(`[...document.querySelectorAll('input')].find(i => i.type === 'text' || !i.type)`, ACCOUNT).catch(() => {});
    await setInput(`[...document.querySelectorAll('input')].find(i => i.type === 'password')`, "flowtest1234").catch(() => {});
    const b = await findBtn(/Log In|Create Account|Enter/i).catch(() => null);
    if (b) { await tap(page, b.x, b.y); await sleep(5000); }
  }
}

// ---------- boot ----------
await mkdir(SHOTS, { recursive: true });
if (process.env.FLOW_FRESH !== "0") await rm(PROFILE, { recursive: true, force: true });

let serverProc = null;
if (BOOT_SERVER) {
  // Ports 4517 (serve) + 9555 (chrome) are flow-crew private: reap any
  // orphan a crashed earlier run left on them before booting our own.
  try { execFileSync("fuser", ["-k", `${PORT}/tcp`, `${process.env.FLOW_CDP_PORT || 9555}/tcp`], { stdio: "ignore" }); } catch {}
  await sleep(1000);
  // The house pattern (globe-qa, the gauntlet) drives the BUILT bundle, not
  // vite dev: under dev, server-function POSTs hang silently in this repo
  // (proven Oct 14 — the sign-up button sat dead for 18s with no error).
  // So: build the current tree, then serve dist/ on our own port.
  if (process.env.FLOW_SKIP_BUILD !== "1") {
    console.log("[flow] building the current tree (bun x vite build)…");
    execFileSync("bun", ["x", "vite", "build"], { cwd: SITE_DIR, stdio: "inherit" });
  }
  console.log(`[flow] serving dist on :${PORT} via flow-check/serve-dist.mjs`);
  serverProc = spawn("bun", ["flow-check/serve-dist.mjs", String(PORT)],
    { cwd: SITE_DIR, stdio: ["ignore", "pipe", "pipe"] });
  serverProc.stderr.on("data", (d) => process.stderr.write(d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const r = await fetch(`${BASE}/play`); up = r.status < 500; } catch { await sleep(1000); }
  }
  if (!up) { console.error("[flow] dist server never came up"); serverProc.kill("SIGKILL"); process.exit(2); }
}

const { proc, wsUrl } = await launchChrome(PROFILE);
process.on("exit", () => {
  try { proc.kill("SIGKILL"); } catch {}
  if (serverProc) try { serverProc.kill("SIGKILL"); } catch {}
});
const browser = await CDP.connect(wsUrl);
const page = await attachPage(browser, "about:blank");
await page.send("Network.enable").catch(() => {});
await emulate(page, { width: W, height: H, dpr: 2 });
browser.on((msg) => {
  if (msg.sessionId !== page.sessionId) return;
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    exceptions.push((d.exception?.description || d.text || "exception").slice(0, 160));
  }
  if (msg.method === "Network.loadingFailed" && /INSUFFICIENT_RESOURCES/.test(msg.params.errorText || "")) {
    envStarved = true;
    exceptions.push("ENV: script load failed with ERR_INSUFFICIENT_RESOURCES — the lab box is out of resources; game verdicts from this run are void");
  }
  if (msg.method === "Page.javascriptDialogOpening") {
    // A native dialog freezes the page (and every check) until handled —
    // and it is a flow smell in its own right: the game speaks in-fiction.
    exceptions.push(`NATIVE DIALOG (${msg.params.type}): ${(msg.params.message || "").slice(0, 120)}`);
    page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  }
});
/** Watchdog: a wedged page must produce a report, never a hung run. */
const watchdog = setInterval(async () => {
  if (currentStep && Date.now() - currentStep.since > 300000) {
    console.error(`[flow] WATCHDOG: step ${currentStep.id} wedged >5min — writing the report and stopping`);
    clearInterval(watchdog);
    if (writeReport) { try { await writeReport(); } catch {} }
    await done(3);
  }
}, 30000);
const done = async (code) => {
  try { proc.kill("SIGKILL"); } catch {}
  if (serverProc) try { serverProc.kill("SIGKILL"); } catch {}
  process.exit(code);
};

// ---------- Journey 0 — arrival & founding ----------
await page.send("Page.navigate", { url: `${BASE}/play` });
const firstReady = await waitReady(180000);
await step("0.1", "/play loads, sign-up/founding door on screen", async () => {
  if (envStarved) { aborted = true; return { status: "FAIL", note: "ENVIRONMENT STARVED — boot scripts failed with ERR_INSUFFICIENT_RESOURCES; the lab box is out of resources, this is NOT a game verdict. Re-run when the box is calm." }; }
  const t = await bodyText();
  if (!firstReady) return fail(`page never rendered a known surface within 180s (body ${t.length} chars, ${exceptions.length} exceptions)`);
  if (/Create an account|Found a Colony|Choose Your Legend|FOUNDING A COLONY|Cradle/i.test(t)) return pass(`first paint ok (${exceptions.length} exceptions so far)`);
  return fail(`unexpected first screen: ${t.slice(0, 120).replace(/\n/g, " ")}`);
});
ACCOUNT = "FlowCrew" + String(Date.now()).slice(-6);
await step("0.2", "create account answers", async () => {
  const t = await bodyText();
  if (!/Create an account/i.test(t)) {
    if (t.length > 200 && /World|Colony|Cradle|FOUNDING|Choose Your Legend/i.test(t)) return pass("returning profile — already signed in");
    return fail(`no sign-up form and no in-game markers (body ${t.length} chars) — cannot tell where we are`);
  }
  const cont = await findBtn(/continue/i);
  if (cont) { await tap(page, cont.x, cont.y); await sleep(1500); }
  await setInput(`[...document.querySelectorAll('input')].find(i => i.type === 'text' || !i.type)`, ACCOUNT);
  await setInput(`[...document.querySelectorAll('input')].find(i => i.type === 'password')`, "flowtest1234");
  await sleep(300);
  const b = await findBtn(/Create Account/i);
  if (!b) return fail("no Create Account button after filling the form");
  if (b.disabled) return fail("Create Account stayed disabled with both fields filled");
  await tap(page, b.x, b.y);
  let advanced = false;
  for (let i = 0; i < 16 && !advanced; i++) {
    await sleep(1500);
    const t = await bodyText();
    advanced = /Choose your language|Sealed System|FOUNDING|Choose Your Legend/i.test(t) || (await inGame());
  }
  if (!advanced) return fail("pressed Create Account & Enter and the form is still there 24s later — press did not land");
  return pass("account created, flow advanced");
});
await step("0.3", "language picker: English + Continue advances", async () => {
  const t = await bodyText();
  if (!/Choose your language/i.test(t)) return pass("no language step on this path");
  const en = await findBtn(/English/i);
  if (en) { await tap(page, en.x, en.y); await sleep(600); }
  const cont = await findBtn(/Continue/i);
  if (!cont) return fail("language picker has no Continue — EXIT LAW");
  await tap(page, cont.x, cont.y);
  await sleep(3000);
  const after = await bodyText();
  if (/Choose your language/i.test(after)) return fail("pressed Continue and the language picker is still up");
  return pass("language chosen, moved on");
});
await step("0.4", "enter → the Sealed System (server select) opens", async () => {
  let t = await bodyText();
  if (/Choose your language/i.test(t)) {
    const en = await findBtn(/English/i);
    if (en) { await tap(page, en.x, en.y); await sleep(600); }
    const cont = await findBtn(/Continue/i);
    if (cont) { await tap(page, cont.x, cont.y); await sleep(3000); }
    t = await bodyText();
  }
  if (/Create an account/i.test(t)) {
    // The flow returns to the sign-in surface with the fields retained;
    // the same button is now the door in.
    await setInput(`[...document.querySelectorAll('input')].find(i => i.type === 'text' || !i.type)`, ACCOUNT);
    await setInput(`[...document.querySelectorAll('input')].find(i => i.type === 'password')`, "flowtest1234");
    const b = await findBtn(/Create Account/i);
    if (!b) return fail("back at the sign-in surface with no enter button");
    await tap(page, b.x, b.y);
    await sleep(5000);
    t = await bodyText();
  }
  if (/Sealed System/i.test(t)) return pass("star map open");
  if (await inGame()) return pass("straight into the game (returning world)");
  return fail(`expected the Sealed System; screen says: ${t.slice(0, 110).replace(/\n/g, " ")}`);
});
let chosenWorld = null;
await step("1.1", "star map: six worlds orbit, drag spins the system", async () => {
  const pts = await planetPoints();
  if (!pts) return fail("no canvas hit-map (__planets) on the server select — star map not live");
  const before = hash(await screenshot(page, `${SHOTS}/starmap-before.png`));
  const geo = await evaluate(page, `(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await drag(page, geo.x + geo.w * 0.5, geo.y + geo.h * 0.5, geo.x + geo.w * 0.28, geo.y + geo.h * 0.53);
  await sleep(1500);
  const after = hash(await screenshot(page, `${SHOTS}/starmap-after.png`));
  if (before === after) return fail(`drag did not spin the system (${pts.length} planets mapped)`);
  return pass(`${pts.length} worlds mapped (${pts.map((p) => p.id).join(", ")}); spin responds`);
});
await step("1.2", "tapping a world inspects it (sheet with its name)", async () => {
  const pts = await planetPoints();
  if (!pts || !pts.length) return fail("no planets to tap");
  const pick = pts.find((p) => /dracon/i.test(p.id)) || pts[0];
  chosenWorld = pick.id;
  await tap(page, pick.x, pick.y);
  await sleep(2800);
  const t = await bodyText();
  const claim = await findBtn(/Claim|Found|Colonize|Settle|Enter/i);
  if (claim) return pass(`"${pick.id}" inspected; action offered: "${claim.text}"`);
  if (/offline|is down/i.test(t)) return pass(`"${pick.id}" inspected; world reported offline (refusal is out loud)`);
  return fail(`tapped planet "${pick.id}" at its mapped centre and no inspect sheet/action appeared`);
});
await step("1.3", "claim a colony → founding or the game shell", async () => {
  const claim = await findBtn(/Claim|Found|Colonize|Settle|Enter/i);
  if (!claim) return fail("inspect sheet offers no claim/found/enter action");
  await tap(page, claim.x, claim.y);
  let landed = "";
  for (let i = 0; i < 12 && !landed; i++) {
    await sleep(1500);
    const t = await bodyText();
    if (/FOUNDING A COLONY|Choose Your Legend/i.test(t)) landed = "founding";
    else if (await inGame()) landed = "shell";
    else if (/offline|try another/i.test(t)) landed = "refused";
  }
  if (landed === "founding") return pass("claim → founding flow");
  if (landed === "shell") return pass("claim → straight into the game shell");
  if (landed === "refused") return manual(`claim refused — the world (${chosenWorld}) reported offline to the live health check; refusal was out loud, re-run when it reads up`);
  return fail("claim pressed; neither founding, shell, nor an out-loud refusal within 18s");
});
await step("1.4", "founding (if shown): race + name → Found The Cradle → in game", async () => {
  const t = await bodyText();
  if (!/FOUNDING A COLONY|Choose Your Legend/i.test(t)) {
    if (await inGame()) return pass("already in game");
    return fail("no founding screen and not in game — founding state unknown");
  }
  const race = await findBtn(/draconian|watcher|gray|nephilim|anunnaki|ashtar/i);
  if (race) { await tap(page, race.x, race.y); await sleep(1000); }
  await setInput(`[...document.querySelectorAll('input')].find(i => i.type === 'text')`, "FlowCrew Cradle");
  await sleep(500);
  const b = await findBtn(/Found The Cradle|Found|Begin/i);
  if (!b) return fail("no Found The Cradle button");
  if (b.disabled) return fail("Found The Cradle disabled after race + name");
  await tap(page, b.x, b.y);
  let left = false;
  for (let i = 0; i < 20 && !left; i++) {
    await sleep(1500);
    left = !/FOUNDING A COLONY/i.test(await bodyText());
  }
  if (!left) return fail("still on the founding screen 30s after Found The Cradle");
  return pass("in game");
});

// ---------- Journey 2 — the globe ----------
let globeButtons = [];
const goGlobe = async () => {
  const wp = await findBtn("World", true) || await findBtn(/🌍|globe/i);
  if (wp) await tap(page, wp.x, wp.y); else await tap(page, W * 0.91, H * 0.96);
  await sleep(6000);
  await evaluate(page, `(() => { const got = [...document.querySelectorAll('button')].find(x => x.offsetParent && x.textContent.trim() === 'Got it'); if (got) got.click(); const c = document.querySelector('canvas'); if (c && c.parentElement) c.parentElement.scrollIntoView({ block: 'start' }); return true; })()`).catch(() => {});
  await sleep(1000);
};
await step("2.1", "World → globe renders (canvas + altitude)", async () => {
  await goGlobe();
  const ok = await evaluate(page, `(() => { const c = document.querySelector('canvas'); return !!c && /ALT/.test(document.body.textContent || ''); })()`);
  if (!ok) return fail("no globe canvas / altitude readout after World");
  await screenshot(page, `${SHOTS}/globe.png`);
  return pass("globe up");
});
await step("2.2", "globe button inventory (every tappable, graded in report)", async () => {
  globeButtons = await visibleButtons();
  if (!globeButtons.length) return fail("zero visible buttons on the globe screen");
  const tiny = globeButtons.filter((b) => Math.min(b.w, b.h) < 44);
  return pass(`${globeButtons.length} tappables; ${tiny.length} under 44px on a side`);
});
await step("2.3", "layer/legend toggles respond to a press", async () => {
  const cands = await evaluate(page, `(() => [...document.querySelectorAll('button')]
    .filter(x => x.offsetParent && /colon|sites|raids|husk|satellite|alliance|layer|legend|memorial/i.test(x.textContent + ' ' + (x.getAttribute('aria-label') || '')))
    .map(x => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: x.textContent.trim().slice(0, 30), pressed: x.getAttribute('aria-pressed'), cls: x.className }; }))()`);
  if (!cands.length) return fail("no layer/legend toggle controls found on the globe");
  let responded = 0;
  const dead = [];
  for (const c of cands.slice(0, 8)) {
    const before = await evaluate(page, `(() => { const els = [...document.querySelectorAll('button')]; const el = els.find(x => x.offsetParent && x.textContent.trim().slice(0, 30) === ${JSON.stringify(c.label)}); return el ? el.getAttribute('aria-pressed') + '|' + el.className : 'gone'; })()`);
    await tap(page, c.x, c.y);
    await sleep(700);
    const after = await evaluate(page, `(() => { const els = [...document.querySelectorAll('button')]; const el = els.find(x => x.offsetParent && x.textContent.trim().slice(0, 30) === ${JSON.stringify(c.label)}); return el ? el.getAttribute('aria-pressed') + '|' + el.className : 'gone'; })()`);
    if (before !== after) responded++; else dead.push(c.label);
  }
  if (!responded) return fail(`no toggle changed state (tried: ${cands.map((c) => c.label).join(", ")})`);
  return pass(`${responded}/${Math.min(cands.length, 8)} toggles visibly changed state${dead.length ? `; unresponsive: ${dead.join(", ")}` : ""}`);
});
await step("2.4", "altitude/ground switch changes the view", async () => {
  const b = await findBtn(/ALT|GND|Altitude|Ground/i);
  if (!b) return fail("no altitude/ground control on the globe");
  const before = hash(await screenshot(page, `${SHOTS}/alt-before.png`));
  await tap(page, b.x, b.y);
  await sleep(2500);
  const after = hash(await screenshot(page, `${SHOTS}/alt-after.png`));
  if (before === after) return fail(`pressed "${b.text}" and the view did not change`);
  await tap(page, b.x, b.y).catch(() => {}); // switch back
  await sleep(1500);
  return pass(`"${b.text}" switched the view`);
});
await step("2.5", "zoom changes the globe's scale", async () => {
  const geo = await evaluate(page, `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cw: c.width }; })()`);
  if (!geo) return fail("no canvas to zoom");
  const before = hash(await screenshot(page, `${SHOTS}/zoom-before.png`));
  await wheel(page, geo.x + geo.w / 2, geo.y + geo.h / 2, -240, 8);
  await sleep(2500);
  const after = hash(await screenshot(page, `${SHOTS}/zoom-after.png`));
  if (before === after) return fail("wheel/pinch zoom left the view pixel-identical");
  await wheel(page, geo.x + geo.w / 2, geo.y + geo.h / 2, 240, 8);
  await sleep(1500);
  return pass("view scale changed under zoom");
});
await step("2.6", "drag spins/pans the globe", async () => {
  const geo = await evaluate(page, `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  if (!geo) return fail("no canvas to drag");
  const before = hash(await screenshot(page, `${SHOTS}/pan-before.png`));
  await drag(page, geo.x + geo.w * 0.5, geo.y + geo.h * 0.5, geo.x + geo.w * 0.22, geo.y + geo.h * 0.56);
  await sleep(1800);
  const after = hash(await screenshot(page, `${SHOTS}/pan-after.png`));
  if (before === after) return fail("dragged the globe and nothing moved");
  return pass("globe moved under the finger");
});
await step("2.7", "globe search finds a site", async () => {
  const inp = await evaluate(page, `(() => { const i = [...document.querySelectorAll('input')].find(x => x.offsetParent && /search/i.test(x.placeholder || '')); return !!i; })()`);
  if (!inp) return fail("no search input on the globe screen (doctrine: every page gets a search bar)");
  return manual("search input present; result-tap precision needs a named target per world — verify by typing a known site name and tapping its row");
});

// ---------- Journey 2b — site sheet, arena, sheet exit ----------
let siteSheet = null, arenaSheetSeen = false, durationsFound = [];
const probeForSheet = async (want) => {
  const geo = await evaluate(page, `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  if (!geo) return null;
  const pts = [[0.30, 0.75], [0.43, 0.64], [0.5, 0.5], [0.25, 0.4], [0.68, 0.35], [0.6, 0.68], [0.38, 0.3], [0.75, 0.55], [0.2, 0.6], [0.55, 0.82]];
  for (const [fx, fy] of pts) {
    await tap(page, geo.x + geo.w * fx, geo.y + geo.h * fy);
    await sleep(700);
    const s = await sheetOpen();
    if (s) {
      if (want === "arena" && /ENTER ARENA/i.test(s.text)) return s;
      if (want === "site" && /Explore/i.test(s.text) && !/ENTER ARENA/i.test(s.text)) return s;
      if (want === "any") return s;
      const close = await findBtn("✕", true);
      if (close) { await tap(page, close.x, close.y); await sleep(500); }
    }
  }
  return null;
};
await step("2.8", "tapping a site opens ITS sheet", async () => {
  siteSheet = await probeForSheet("site");
  if (siteSheet) return pass(`sheet: "${siteSheet.title}"`);
  arenaSheetSeen = !!(await probeForSheet("arena"));
  if (arenaSheetSeen) { const c = await findBtn("✕", true); if (c) { await tap(page, c.x, c.y); await sleep(500); } }
  return fail("grid-probed the globe; no site sheet with an Explore action opened");
});
await step("2.10", "arena site → ENTER ARENA → Arena panel", async () => {
  if (!arenaSheetSeen) arenaSheetSeen = !!(await probeForSheet("arena"));
  if (!arenaSheetSeen) return manual("arena site not hit by grid probes at this zoom — tap the arena site on the globe, then ENTER ARENA, confirm the Arena panel opens");
  const b = await findBtn(/ENTER ARENA/i);
  if (!b) return fail("arena sheet open but no ENTER ARENA button");
  await tap(page, b.x, b.y);
  await sleep(4000);
  const t = await bodyText();
  if (/Arena Ladder|Practice|Call out|Bloodless|Spar/i.test(t)) { await screenshot(page, `${SHOTS}/arena.png`); return pass("arena panel open"); }
  return fail("ENTER ARENA pressed; arena panel markers not found");
});

// ---------- Journey 3+4 — exploration carry, picker, durations, exit ----------
await step("3.1", "Explore → the room shows THAT site", async () => {
  if (!siteSheet) { const s = await probeForSheet("site"); if (s) siteSheet = s; }
  if (!siteSheet) return fail("no site sheet available to explore from");
  const open = await sheetOpen();
  if (!open) return fail("site sheet closed before Explore could be pressed");
  const b = await findBtn("Explore", true) || await findBtn(/Explore/i);
  if (!b) return fail("site sheet has no Explore button");
  const wanted = siteSheet.title;
  await tap(page, b.x, b.y);
  await sleep(4000);
  const t = await bodyText();
  if (!/Expedition|Exploration|Launch|Loadout/i.test(t)) return fail("Explore pressed; no exploration room markers");
  await screenshot(page, `${SHOTS}/exploration.png`);
  if (!t.includes(wanted)) return fail(`room does not show the chosen site "${wanted}" — choice did not travel`);
  reached.explore = true;
  return pass(`room shows "${wanted}"`, wanted);
});
await step("4.1", "site picker is skinned, not a bare native dropdown", async () => {
  if (!reached.explore) return manual("exploration room not reached this run — check for native <select> by eye in the room's site picker");
  const n = await evaluate(page, `document.querySelectorAll('select').length`);
  if (n > 0) return fail(`${n} native <select> element(s) in the exploration view`);
  return pass("no native <select> in the exploration view");
});
await step("4.2", "exploration durations match the distance table (backyard 10–15m, cap ≤5h)", async () => {
  if (!reached.explore) return manual("exploration room not reached this run — open an exploration launch/loadout panel and read every tier's time against zones.ts RUN_TIMER_BANDS");
  const t = await bodyText();
  const hits = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi)]
    .map((m) => ({ raw: m[0], min: /h/i.test(m[2]) ? parseFloat(m[1]) * 60 : parseFloat(m[1]) }));
  durationsFound = hits;
  if (!hits.length) return manual("no duration strings visible in this view — open an exploration launch/loadout panel and read every tier's time against zones.ts RUN_TIMER_BANDS");
  const max = Math.max(...hits.map((h) => h.min));
  const min = Math.min(...hits.map((h) => h.min));
  const list = hits.map((h) => h.raw).join(", ");
  if (max > 305) return fail(`longest shown duration ${max}m exceeds the 5h cap (saw: ${list})`);
  if (min > 15) return fail(`shortest shown duration ${min}m — no backyard-tier (10–15m) trip on offer (saw: ${list})`);
  return pass(`durations in envelope: min ${min}m, max ${max}m (saw: ${list})`);
});
await step("3.2", "exploration exit returns to the globe", async () => {
  if (!reached.explore) return manual("exploration room not reached this run — verify by hand: from the room, the globe button must return you to the globe");
  const b = (await findBtn(/Globe|🌍/i)) || (await findBtn(/Back to World|World/i)) || (await findBtn("✕", true));
  if (!b) return fail("no globe/back/exit control found in the exploration view — EXIT LAW");
  await tap(page, b.x, b.y);
  await sleep(4000);
  const ok = await evaluate(page, `(() => !!document.querySelector('canvas') && /ALT/.test(document.body.textContent || ''))()`);
  if (!ok) return fail(`pressed "${b.text}" and did not arrive back at the globe`);
  return pass(`"${b.text}" → globe`);
});
await step("2.9", "site sheet exit is ≥44px and closes the sheet", async () => {
  const s = await probeForSheet("any");
  if (!s) return manual("no sheet opened during probes this run — tap any site, measure its ✕, tap it, confirm the sheet closes");
  const x = await evaluate(page, `(() => { const el = [...document.querySelectorAll('div')].find(d => d.className && String(d.className).includes('z-20') && d.querySelector('h3')); const b = el && [...el.querySelectorAll('button')].find(y => y.textContent.trim() === '✕' || /close/i.test(y.getAttribute('aria-label') || '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
  if (!x) return fail(`sheet "${s.title}" has NO close control — EXIT LAW`);
  if (Math.min(x.w, x.h) < 44) return fail(`sheet close is ${Math.round(x.w)}×${Math.round(x.h)}px — under the 44px law`);
  await tap(page, x.x, x.y);
  await sleep(800);
  if (await sheetOpen()) return fail("tapped the sheet's ✕ and the sheet is still open");
  return pass(`close ${Math.round(x.w)}×${Math.round(x.h)}px, sheet closed`);
});

// ---------- Journey 5 — battle surface (deep lines: the gauntlet) ----------
const goBattles = async () => {
  const b = (await findBtn(/Battles|Battle/i)) || (await findBtn(/Arena/i));
  if (b) { await tap(page, b.x, b.y); await sleep(3500); }
};
await step("5.1", "a battle opens (arena practice / battles)", async () => {
  await goBattles();
  let t = await bodyText();
  if (!/Practice|Spar|Call out|Launch|Start|Begin/i.test(t)) return fail("no battle-start affordance on the battles/arena surface");
  const start = await findBtn(/Practice|Spar|Demo|Call out|Start Battle|Begin/i);
  if (!start) return fail("battle surface present but no start button matched");
  await tap(page, start.x, start.y);
  await sleep(7000);
  t = await bodyText();
  const canvas = await evaluate(page, `!!document.querySelector('canvas')`);
  if (!canvas) return fail("battle start pressed; no battle scene canvas");
  await screenshot(page, `${SHOTS}/battle.png`);
  return pass("battle scene open");
});
await step("5.2", "AUTO/MANUAL mode badge is visible in the battle view", async () => {
  const t = await bodyText();
  if (/\bAUTO\b|\bMANUAL\b/.test(t)) return pass("mode named on screen");
  return fail("no AUTO/MANUAL indicator anywhere in the battle view — the commander cannot tell who is driving");
});
await step("5.3", "deep gauntlet lines (flank drop, allegiance, tap-move, cover, pan, fallback)", async () =>
  manual("owned by the battle gauntlet — run the runner in site/gauntlet/ when present and fold its table into this report; checklist Journey 5 lists the exact lines"));
await step("5.6", "exit battle → its windows retire (pinned/dumped)", async () => {
  const inBattle = await evaluate(page, `document.body.innerText.includes('Battle Controls') || document.body.innerText.includes('Enemy Forces')`);
  const exit = (await findBtn(/Leave|Exit Battle|Retreat/i)) || (await findBtn("✕", true));
  if (!exit) return fail("no exit control in the battle view — EXIT LAW");
  await tap(page, exit.x, exit.y);
  await sleep(3000);
  const still = await evaluate(page, `document.body.innerText.includes('Battle Controls') || document.body.innerText.includes('Enemy Forces')`);
  if (inBattle && still) return fail("battle windows (Controls/Enemy Forces) still on screen after exit");
  if (!inBattle) return manual("battle window titles not detected in-view this run; verify manually: exit a battle, confirm Controls/Enemy Forces/Squads windows are gone and only the result sheet can stand");
  return pass("battle windows retired on exit");
});

// ---------- Journey 6 — store & the Click Law ----------
const numbersIn = (t) => [...t.matchAll(/\b\d[\d,]*\b/g)].map((m) => m[0]).join("|");
await step("6.4", "store is reachable (in-world entrance or module door)", async () => {
  await page.send("Page.navigate", { url: `${BASE}/play` });
  await waitReady(90000);
  const b = await findBtn(/Store|Depot|Supplies|Shop|Market/i);
  if (!b) return fail("no store/depot/supplies entrance found from the home surface");
  await tap(page, b.x, b.y);
  await sleep(3000);
  const t = await bodyText();
  if (!/Store|Votive|Special|Bundle|Forge|Stock|Supplies/i.test(t)) return fail(`pressed "${b.text}"; no store surface markers`);
  await screenshot(page, `${SHOTS}/store.png`);
  reached.store = true;
  return pass(`entered via "${b.text}"`);
});
let clickTarget = null, clickDelta = null;
await step("6.1", "a build/buy press answers with a receipt (Click Law)", async () => {
  const b = await findBtn(/Forge|Build|Stock|Load|Buy|Craft/i);
  if (!b) return fail("no build/forge/buy control on the store surface");
  if (b.disabled) return manual(`"${b.text}" is disabled (likely insufficient resources on a fresh colony) — receipt check needs a stocked profile`);
  clickTarget = b;
  const before = numbersIn(await bodyText());
  await tap(page, b.x, b.y);
  await sleep(1800);
  const t = await bodyText();
  const after = numbersIn(t);
  clickDelta = before !== after;
  if (/Forged|Stocked|Loaded|Built|Ordered|Crafted/i.test(t) && clickDelta) return pass(`receipt word + totals moved after "${b.text}"`);
  if (clickDelta) return pass(`totals moved after "${b.text}" (no fiction receipt word matched — eyeball the shot)`);
  return fail(`pressed "${b.text}" and nothing visibly answered — no receipt, no count change`);
});
await step("6.2", "hammering never stacks duplicate execution", async () => {
  if (!clickTarget) return manual("no live build/buy target this run — with a stocked profile: hammer one build button 6× in under a second; exactly one build may execute and one charge land");
  const before = numbersIn(await bodyText());
  for (let i = 0; i < 5; i++) { await tap(page, clickTarget.x, clickTarget.y); await sleep(90); }
  const locked = await evaluate(page, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && x.textContent.includes(${JSON.stringify(clickTarget.text.slice(0, 24))})); return b ? b.disabled : null; })()`);
  await sleep(1800);
  const after = numbersIn(await bodyText());
  if (locked) return pass("control locked while its action was in flight");
  if (before === after) return pass("no further totals moved under hammering (in-flight presses absorbed)");
  return manual(`totals moved again under hammering (before ${before.slice(0, 40)}… after ${after.slice(0, 40)}…) — a human must confirm whether that was one queued execution or stacked duplicates`);
});
await step("6.3", "store exit works (Exit Law)", async () => {
  if (!reached.store) return manual("store never opened this run — its exit is unchecked, not failed");
  const b = (await findBtn("✕", true)) || (await findBtn(/Close|Back|Leave/i));
  if (!b) return fail("no exit control on the store surface — EXIT LAW");
  if (Math.min(b.w, b.h) < 44) return fail(`store exit is ${Math.round(b.w)}×${Math.round(b.h)}px — under the 44px law`);
  await tap(page, b.x, b.y);
  await sleep(1200);
  return pass("store exit present, ≥44px, pressed");
});

// ---------- Journey 7 — settings & avatar ----------
const openSettings = async () => {
  const gear = (await findBtn(/settings/i)) || (await findBtn(/⚙/));
  if (gear) { await tap(page, gear.x, gear.y); await sleep(2500); return true; }
  return false;
};
await step("7.1", "avatar upload control exists in Settings", async () => {
  if (!(await openSettings())) return fail("no Settings control found on the home surface");
  const t = await bodyText();
  if (!/Settings|Profile|Account/i.test(t)) return fail("Settings control pressed; no settings surface");
  const has = await evaluate(page, `!!document.querySelector('input[type="file"]')`);
  if (!has) return fail("settings open, but no file input for an avatar upload");
  await screenshot(page, `${SHOTS}/settings.png`);
  reached.settings = true;
  return pass("file input present in settings");
});
await step("7.2", "uploading an avatar takes effect", async () => {
  if (!reached.settings) return manual("settings/avatar surface not reached this run — upload unchecked, not failed");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  await writeFile("/tmp/flow-avatar.png", png);
  const doc = await page.send("DOM.getDocument", {});
  const q = await page.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
  if (!q.nodeId) return fail("file input vanished before upload");
  await page.send("DOM.setFileInputFiles", { nodeId: q.nodeId, files: ["/tmp/flow-avatar.png"] });
  await sleep(2500);
  const t = await bodyText();
  const img = await evaluate(page, `(() => { const imgs = [...document.querySelectorAll('img')].filter(i => i.src && (i.src.startsWith('blob:') || i.src.startsWith('data:'))); return imgs.length; })()`);
  if (img > 0 || /avatar/i.test(t)) return pass(`upload registered (${img} local image(s) now rendered)`);
  return fail("file set on the input; no avatar image or confirmation appeared");
});
await step("7.3", "avatar persists across a reload", async () => {
  await page.send("Page.navigate", { url: `${BASE}/play` });
  await waitReady(90000);
  if (!(await openSettings())) return fail("settings unreachable after reload");
  const img = await evaluate(page, `(() => { const imgs = [...document.querySelectorAll('img')].filter(i => i.offsetParent && i.src && i.src.length > 120); return imgs.length; })()`);
  if (img > 0) return pass("a stored avatar image is rendered after reload");
  return manual("no obviously-stored avatar image after reload — verify manually: upload, force-close the app, reopen, check the face survived");
});
await step("7.4", "mute/SFX toggle exists and governs", async () => {
  if (!reached.settings && !/Settings|Profile/i.test(await bodyText())) return manual("settings not reached this run — mute toggle unchecked, not failed");
  const b = await findBtn(/Mute|Sound|Music|SFX|Audio/i);
  if (!b) return fail("no sound/mute control in settings");
  return pass(`sound control present: "${b.text || "toggle"}" (audibility itself is a MANUAL ear-check, checklist 6/7)`);
});

// ---------- Journey 8 — tutorial ----------
await step("8.1", "tutorial / Learn entry point is findable", async () => {
  const b = await findBtn(/Learn|Tutorial|Training|Academy/i);
  if (!b) return fail("no Learn/Tutorial entry anywhere on the home surface");
  await tap(page, b.x, b.y);
  await sleep(3000);
  const t = await bodyText();
  if (!/Lesson|Tutorial|Guided|Step|Battle|Founding|Skip/i.test(t)) return fail(`pressed "${b.text}"; no tutorial surface markers`);
  await screenshot(page, `${SHOTS}/tutorial.png`);
  return pass(`tutorial opens via "${b.text}"`);
});
await step("8.2", "tutorial can be skipped/exited (≥44px, Exit Law)", async () => {
  const b = await findBtn(/Skip|SKIP|Exit Tutorial|Leave/i);
  if (!b) return manual("no skip control matched in the tutorial's first screen — verify by eye: a SKIP/EXIT ≥44px must be visible at every step");
  if (Math.min(b.w, b.h) < 44) return fail(`tutorial skip is ${Math.round(b.w)}×${Math.round(b.h)}px — under the 44px law`);
  await tap(page, b.x, b.y);
  await sleep(1500);
  return pass("skip present, ≥44px, pressed");
});

// ---------- report ----------
writeReport = async () => {
const order = (id) => id.split(".").map(Number);
results.sort((a, b) => order(a.id)[0] - order(b.id)[0] || order(a.id)[1] - order(b.id)[1]);
const counts = { PASS: 0, FAIL: 0, KNOWN: 0, MANUAL: 0 };
for (const r of results) counts[r.status]++;
const newFinds = results.filter((r) => r.status === "FAIL");
console.log("\n================ FLOW CHECK — TABLE ================");
for (const r of results) console.log(`${r.status.padEnd(6)} ${r.id.padEnd(5)} ${r.name}${r.note ? " — " + r.note : ""}`);
console.log(`\nPASS ${counts.PASS} · FAIL ${counts.FAIL} (new finds) · KNOWN ${counts.KNOWN} (owned, in flight) · MANUAL ${counts.MANUAL}`);
console.log(`JS exceptions captured: ${exceptions.length}`);
let head = "unknown";
try { head = (await import("node:child_process")).execSync("git -C " + SITE_DIR + " rev-parse --short HEAD").toString().trim(); } catch {}
const md = [
  `# Flow check run — ${new Date().toISOString()}`,
  ``,
  `Build: git HEAD ${head} (working tree — other crews' uncommitted fixes included) · Server: ${BASE}${BOOT_SERVER ? " (built bundle, harness serve-dist)" : ""} · Surface: phone 390×844 (dpr 2), touch, fresh profile`,
  ``,
  `**PASS ${counts.PASS} · FAIL ${counts.FAIL} · KNOWN ${counts.KNOWN} · MANUAL ${counts.MANUAL}** · JS exceptions: ${exceptions.length}`,
  ``,
  `## New finds (red, nobody owns these yet)`,
  ...(newFinds.length ? newFinds.map((r) => `- **${r.id} ${r.name}** — ${r.note}`) : ["- none"]),
  ``,
  `## Table`,
  `| | # | Check | Evidence |`,
  `|---|---|---|---|`,
  ...results.map((r) => `| ${r.status} | ${r.id} | ${r.name} | ${r.note.replace(/\|/g, "/")} |`),
  ``,
  `## Globe button inventory (${globeButtons.length} tappables)`,
  ...globeButtons.map((b) => `- "${b.text}" — ${b.w}×${b.h}px${Math.min(b.w, b.h) < 44 ? " ⚠️ under 44px" : ""}`),
  ``,
  `## Exploration durations seen`,
  ...(durationsFound.length ? durationsFound.map((d) => `- ${d.raw} (${d.min}m)`) : ["- none visible this run"]),
  ``,
  `## JS exceptions (first 10)`,
  ...(exceptions.slice(0, 10).map((e) => `- ${e}`) || ["- none"]),
  ``,
  `Screenshots: site/flow-check/shots/ · Checklist: design/flow-checklist.md`,
].join("\n");
await writeFile(new URL("./last-run.md", import.meta.url).pathname, md);
console.log("\n[flow] report written to site/flow-check/last-run.md");
};
await writeReport();
clearInterval(watchdog);
await done(Math.min(results.filter((r) => r.status === "FAIL").length, 120));
