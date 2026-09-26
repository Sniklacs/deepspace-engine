// standalone-proof.ts — the install affordance, SEEING IT, state by state.
//
// WHY THIS FILE EXISTS. `installPath()`/`showsInstall()` are pure and `pwa-verify`
// gates them, but the one behaviour a player would notice as broken — an installed
// home-screen app showing them an "Install the game" card — has to be seen in a
// real browser, or the claim is not proven.
//
// THREE THINGS THIS DRIVER GOT WRONG ONCE, AND HOW IT NOW AVOIDS THEM
// (each was a mislabelled frame, not a broken app):
//
//  1. THE FIRST-RUN LANGUAGE PICKER COVERED THE FRAME. The app shows a full-screen
//     picker on a device that has never chosen a language. The old probe called the
//     card "visible" because it measured a non-zero bounding box — an element behind
//     a modal still has one — so three different "states" produced byte-identical
//     screenshots of the picker. The device record is now seeded before the first
//     document (so the picker never opens), visibility is a real occlusion test
//     (the element's centre point must hit the element), and every state scrolls the
//     card into view before it is captured.
//  2. THE CARD WAS BELOW THE FOLD. On the landing page it sits under the hero, so a
//     top-of-page frame shows no card even when one is rendered. `scrollIntoView`
//     fixes it, and the probe now reports whether the card is IN THE VIEWPORT rather
//     than merely in the DOM.
//  3. A FAILED EMULATION WAS NAMED AS IF IT WERE A STATE. The file name is now
//     derived from the measurement: if display-mode emulation does not take, the
//     frame is written with a `-NOT-EMULATED` suffix and the JSON verdict says so.
//
// The evidence is the JSON: each state carries the DOM facts the app itself
// published (`data-install-path`, whether the card/CTA/dismiss are present) next to
// the pixels. Where a frame cannot differ from another (an offline reload of the same
// cached document paints the same page), the frame says so in its own name and the
// claim rests on the DOM, not on the picture.
//
// RUN (a built app served on :3000, and Chromium on :9333):
//   bash /home/engine/dse/tools/standalone-proof-up.sh
//   cd /home/team/shared/pwa-tests && bun run standalone-proof.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const APP = process.env.PWA_APP_URL ?? "http://127.0.0.1:3000/";
const OUT = process.env.PWA_SHOT_DIR ?? "/home/team/shared/pwa-verify-shots";
const CDP_PORT = Number(process.env.PWA_CDP_PORT ?? 9333);
const W = 390;
const H = 844;
/** iPhone Safari — the platform whose install has no event at all. */
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

mkdirSync(OUT, { recursive: true });

// --------------------------------------------------------------- CDP plumbing
interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  evaluate(expression: string): Promise<any>;
  close(): void;
}

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => { rej(new Error(`ws open timed out: ${wsUrl}`)); }, 8000);
    ws.addEventListener("open", () => { clearTimeout(t); res(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(t); rej(new Error(`ws error: ${wsUrl}`)); }, { once: true });
  });
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
  ws.addEventListener("message", (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id === undefined) return;
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.rej(new Error(String(msg.error.message)));
    else slot.res(msg.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.delete(mid)) rej(new Error(`timeout ${method}`));
      }, 20_000);
    });
  const evaluate = async (expression: string) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(`eval threw: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
    return r?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function json(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`, {
    ...init,
    signal: AbortSignal.timeout(3000),
  });
  return res.json();
}

/**
 * A fresh about:blank page target, with the device's language already chosen and
 * (optionally) the install offer suppressed before the app can see it.
 *
 * Both scripts run BEFORE any document of the app loads, which is the only way to
 * control what the first render — and the first `matchMedia` — already answers.
 */
async function newTarget(opts: { device?: boolean; ios?: boolean; suppressOffer?: boolean } = {}): Promise<Cdp> {
  const t = await json("/json/new?about:blank", { method: "PUT" });
  if (!t?.webSocketDebuggerUrl) throw new Error(`no target from /json/new: ${JSON.stringify(t).slice(0, 200)}`);
  const cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // The device record: language chosen, so the first-run picker never opens over
  // the thing being photographed. Same record the app writes in Settings.
  if (opts.device !== false) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try{localStorage.setItem("dse.device.v1",JSON.stringify({lang:"en",chosen:true}))}catch(e){}`,
    });
  }
  // iOS never fires `beforeinstallprompt` at all. Chrome does, whatever user agent
  // it is given, so the offer is stopped before the app's own listener sees it —
  // the same input the app would have on an iPhone.
  if (opts.suppressOffer) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();e.stopImmediatePropagation();},true);`,
    });
  }
  return cdp;
}

/**
 * Everything the app itself published about the install affordance.
 *
 * `visible` is an OCCLUSION test, not a bounding box: the element's own centre point
 * must resolve to the element (or a child of it). An element behind a full-screen
 * modal, or scrolled out of the viewport, is reported `false` — which is exactly the
 * distinction the previous version of this probe could not make.
 */
const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const hasBox = (s) => { const e = q(s); if (!e) return null;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const visible = (s) => {
    const e = q(s); if (!e) return null;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    return !!top && (e.contains(top) || top.contains(e));
  };
  return {
    standaloneQuery: matchMedia('(display-mode: standalone)').matches,
    browserQuery: matchMedia('(display-mode: browser)').matches,
    fullscreenQuery: matchMedia('(display-mode: fullscreen)').matches,
    installPath: document.documentElement.dataset.installPath ?? null,
    installCardPresent: !!q('[data-testid="install-card"]'),
    installCardHasBox: hasBox('[data-testid="install-card"]'),
    installCardVisible: visible('[data-testid="install-card"]'),
    installCardScrollY: q('[data-testid="install-card"]')
      ? Math.round(q('[data-testid="install-card"]').getBoundingClientRect().top) : null,
    installCtaPresent: !!q('[data-testid="install-cta"]'),
    installDismissPresent: !!q('[data-testid="install-dismiss"]'),
    installIosPresent: !!q('[data-testid="install-ios"]'),
    installTitleInText: document.body.innerText.includes('Install the game'),
    rendersInstallStrings: /Install the game|Add it to your home screen/.test(document.body.innerHTML),
    langPickerPresent: !!document.querySelector('[data-testid="lang-picker"], [role="dialog"]'),
    onLine: navigator.onLine,
    swController: navigator.serviceWorker?.controller?.state ?? null,
    title: document.title,
    url: location.href,
  };
})()`;

/** Scroll the install card to the middle of the viewport, so the frame can show it. */
const SCROLL_TO_CARD = `(() => {
  const el = document.querySelector('[data-testid="install-card"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  return Math.round(el.getBoundingClientRect().top);
})()`;

/** What each frame claims — written into the JSON beside the bytes. */
const SHOWS: Record<string, string> = {
  "first-run-language-picker-NOT-INSTALL-EVIDENCE":
    "the first-run language picker at 390x844 — NOT install evidence, and reproduced deliberately: it is the screen the earlier pass photographed three times and named as three different install states, because a card behind a modal still has a bounding box",
  "install-card-prompt":
    "the install card ON SCREEN at 390x844, with the real CTA button and its dismiss control; data-install-path=prompt",
  "after-appinstalled-event":
    "the SAME page, one `appinstalled` signal later: the card has left the DOM and nothing is rendered in its place",
  "standalone-emulated-before-load":
    "a display-mode:standalone launch — or, when the emulation does not take, a FAILED ATTEMPT named as one",
  "install-ios-instruction":
    "iPhone user agent and no install offer: the Share-sheet instruction, and NO button",
  "offline-reload":
    "the shell served with the network taken away (onLine=false, worker controlling, shell from the cache)",
};

/**
 * Wait for the app to settle on the install path under test.
 *
 * This matters because Chrome's installability check takes TIME on a cold profile:
 * it completes after the worker is active, so the very first load can sit at
 * `unavailable` for a while and then receive `beforeinstallprompt`. The first run of
 * this driver treated that as "no card" and produced three byte-identical hero frames
 * — the exact mistake it exists to catch. One reload is allowed mid-wait for the same
 * reason; where the offer genuinely never comes, the caller names the frame honestly
 * instead of pretending it shows a state.
 */
async function waitForInstallPath(cdp: Cdp, want: string, budgetMs: number): Promise<any> {
  const started = Date.now();
  let probe = await cdp.evaluate(PROBE);
  let reloaded = false;
  while (Date.now() - started < budgetMs) {
    if (probe?.installPath === want) return probe;
    if (!reloaded && Date.now() - started > budgetMs / 3) {
      await cdp.send("Page.reload");
      reloaded = true;
      await sleep(3000);
    }
    await sleep(1000);
    probe = await cdp.evaluate(PROBE);
  }
  return probe;
}

async function shot(cdp: Cdp, name: string): Promise<{ file: string; name: string; md5: string; bytes: number }> {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const buf = Buffer.from(String(r.data), "base64");
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, buf);
  return { file, name, md5: createHash("md5").update(buf).digest("hex"), bytes: buf.length };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const report: Record<string, unknown> = { app: APP, states: {} };
  const version = await json("/json/version");
  report.browser = `${String(version.Browser)} via CDP :${String(CDP_PORT)}`;
  // Which build these frames show — the server stamps the id on the worker it serves.
  try {
    const sw = await fetch(`${APP}sw.js`, { signal: AbortSignal.timeout(4000) });
    report.build = sw.headers.get("x-deepspace-build");
  } catch {
    report.build = null;
  }
  const frames: { name: string; md5: string; bytes: number; shows: string }[] = [];

  // ---------------------- 00 · the trap this driver exists to not fall into
  // A device that has never chosen a language gets a full-screen picker over the
  // whole landing page. Captured DELIBERATELY, and named as what it is: the earlier
  // pass produced this frame three times and labelled it as three different install
  // states, because a card behind a modal still reports a non-zero bounding box.
  const fresh = await newTarget({ device: false });
  await fresh.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await fresh.send("Page.navigate", { url: APP });
  await sleep(9000);
  const picker = await fresh.evaluate(PROBE);
  const pickerIsUp = picker?.langPickerPresent === true;
  // Named by what it MEASURED, like every other frame here: a warmed profile has
  // already chosen a language (the record lives in the profile), so on a second run
  // this state is the plain landing page instead.
  const shot0 = await shot(
    fresh,
    pickerIsUp
      ? "00-first-run-language-picker-NOT-INSTALL-EVIDENCE-390x844"
      : "00-fresh-device-no-picker-NOT-INSTALL-EVIDENCE-390x844",
  );
  fresh.close();

  // ---------------------------------------------- 00b · warm the profile
  // Chrome only offers an install once its installability check has settled, which
  // happens after the worker is active — so a cold profile's very first load can sit
  // at `unavailable`. One ordinary visit first, exactly as a returning player's
  // browser has already had, so the control target is testing the AFFORDANCE and not
  // Chrome's cold-start timing. Nothing is photographed here.
  const warm = await newTarget();
  await warm.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await warm.send("Page.navigate", { url: APP });
  await sleep(8000);
  warm.close();

  // ------------------------------------------------- 01 · control (prompt)
  const ctl = await newTarget();
  await ctl.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await ctl.send("Page.navigate", { url: APP });
  await sleep(4000);
  // Wait for the REAL offer. If it never arrives the frame is named `NO-INSTALL-OFFER`
  // — this driver does not photograph a hero image and call it an install card.
  let control = await waitForInstallPath(ctl, "prompt", 24_000);
  const gotOffer = control?.installPath === "prompt" && control?.installCardPresent === true;
  await ctl.evaluate(SCROLL_TO_CARD); // the card sits ~970px down: frame it or show nothing
  await sleep(400);
  control = await ctl.evaluate(PROBE);
  const shot1 = await shot(
    ctl,
    `01-install-card-${gotOffer ? "prompt" : "NO-INSTALL-OFFER"}-390x844`,
  );

  // ------------------------------------------------ 02 · in-page appinstalled
  // Dispatched on the SAME page as 01, from the real `prompt` state: this is the
  // app's own signal (register.ts listens for it and drops the offer), with no
  // display-mode emulation involved. It is only evidence if the card was really
  // there a moment ago — `controlShowsCard` in the verdict says whether it was.
  await ctl.evaluate(`(() => { window.dispatchEvent(new Event('appinstalled')); return true; })()`);
  await sleep(1500);
  await ctl.evaluate(SCROLL_TO_CARD); // no card now — this returns null and is a no-op
  await sleep(300);
  const installed = await ctl.evaluate(PROBE);
  const shot2 = await shot(ctl, "02-after-appinstalled-event-390x844");

  // ------------------------------------ 03 · standalone, emulated BEFORE load
  const stand = await newTarget();
  // The whole point of the ordering: metrics + media emulation land on an
  // about:blank target, so the first matchMedia the app runs already answers
  // standalone. No reload, no second client, no override to lose.
  await stand.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await stand.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "display-mode", value: "standalone" }],
  });
  await stand.send("Page.navigate", { url: APP });
  await sleep(7000);
  const standalone = await stand.evaluate(PROBE);
  const emulationTook = standalone?.standaloneQuery === true && standalone?.browserQuery === false;
  // The suppression is what would be photographed — there is nothing else to see, and
  // that is the point. When the emulation FAILS the frame is scrolled to the card, so
  // it looks exactly like the control: the failed attempt is the finding, stated in the
  // file name rather than left for the reader to infer from a hero image.
  if (!emulationTook) {
    await stand.evaluate(SCROLL_TO_CARD);
    await sleep(400);
  }
  const shot3 = await shot(
    stand,
    `03-standalone-emulated-before-load-390x844${emulationTook ? "" : "-NOT-EMULATED"}`,
  );

  // ------------------------------------------- 04 · iPhone: the instruction
  const ios = await newTarget({ ios: true, suppressOffer: true });
  await ios.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await ios.send("Emulation.setUserAgentOverride", { userAgent: IOS_UA });
  await ios.send("Page.navigate", { url: APP });
  await sleep(6000);
  await ios.evaluate(SCROLL_TO_CARD);
  await sleep(400);
  const iosState = await ios.evaluate(PROBE);
  const shot4 = await shot(ios, "04-install-ios-instruction-390x844");

  // ------------------------------------ 05 · the network taken away, reloaded
  // The shell has to come up with no network at all. The pixels of this frame are
  // the SAME document the online visit cached, so they are expected to match the
  // control; what this state adds is the DOM/network facts beside them.
  const off = await newTarget();
  await off.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await off.send("Page.navigate", { url: APP });
  await sleep(7000); // let the worker register and finish precaching first
  await off.send("Network.enable");
  await off.send("Network.emulateNetworkConditions", {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await off.send("Page.reload");
  await sleep(4000);
  await off.evaluate(SCROLL_TO_CARD);
  await sleep(400);
  const offline = await off.evaluate(PROBE);
  const shot5 = await shot(off, "05-offline-reload-390x844");

  const states: Record<string, unknown> = {
    "00-first-run-language-picker": { probe: picker, shot: shot0 },
    "01-control-prompt": { probe: control, shot: shot1 },
    "02-appinstalled-in-page": { probe: installed, shot: shot2 },
    "03-standalone-emulated": { probe: standalone, shot: shot3 },
    "04-ios-instruction": { probe: iosState, shot: shot4 },
    "05-offline-reload": { probe: offline, shot: shot5 },
  };
  report.states = states;

  for (const val of Object.values(states)) {
    const s = (val as { shot: { name: string; md5: string; bytes: number } }).shot;
    const base = s.name
      .replace(/^\d\d-/, "")
      .replace("-390x844", "")
      .replace(/-NOT-EMULATED$/, "")
      .replace(/-NO-INSTALL-OFFER$/, "");
    frames.push({ name: s.name, md5: s.md5, bytes: s.bytes, shows: SHOWS[base] ?? "(no claim recorded)" });
  }
  // Two frames with the same bytes are stated, never implied.
  const byMd5 = new Map<string, string[]>();
  for (const f of frames) byMd5.set(f.md5, [...(byMd5.get(f.md5) ?? []), f.name]);
  report.frames = frames;
  report.byteIdenticalFrames = [...byMd5.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([md5, names]) => ({ md5, names, note: "byte-identical: these frames are ONE state, not several" }));

  report.verdict = {
    // The trap, measured: the picker is up, and the card is NOT visible even if its
    // box exists — which is the difference the previous probe could not tell.
    pickerIsUp: pickerIsUp,
    pickerDoesNotShowTheCard: picker?.installCardVisible !== true,
    standaloneEmulationTook: emulationTook,
    controlShowsCard:
      control?.installPath === "prompt" && control?.installCardPresent === true &&
      control?.installCardVisible === true && control?.installCtaPresent === true,
    // 02 only means anything if 01 really had a card to lose.
    appinstalledEvidenceIsMeaningful: gotOffer && installed?.installCardPresent === false,
    appinstalledRendersNothing:
      installed?.installCardPresent === false &&
      installed?.installCtaPresent === false &&
      installed?.installTitleInText === false,
    appinstalledPath: installed?.installPath ?? null,
    iosShowsInstruction:
      iosState?.installPath === "ios" && iosState?.installIosPresent === true &&
      iosState?.installCtaPresent === false && iosState?.installCardVisible === true,
    iosPath: iosState?.installPath ?? null,
    offlineServesShell:
      offline?.onLine === false && offline?.installCardPresent === true &&
      offline?.swController === "activated",
    langPickerNeverCoveredTheFrame: control?.langPickerPresent === false,
  };
  ctl.close();
  stand.close();
  ios.close();
  off.close();
  writeFileSync(`${OUT}/standalone-proof.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.verdict, null, 2));
}

await main();
