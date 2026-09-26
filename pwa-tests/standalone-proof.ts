// standalone-proof.ts — ITEM 1: the install affordance in an INSTALLED app.
//
// WHY THIS FILE EXISTS. `installPath()`/`showsInstall()` are pure and `pwa-verify`
// gates them, but the one behaviour a player would notice as broken — an installed
// home-screen app showing them an "Install the game" card — has to be seen in a
// real browser, or the claim is not proven. A previous attempt failed: a SECOND
// CDP client attached to the agent-browser daemon's page did not get its
// `Emulation.setEmulatedMedia` override applied (matches stayed false, the path
// stayed `prompt`). Two things are different here, and they are the fix:
//
//   • this driver talks to a Chromium IT LAUNCHED ITSELF, over a known CDP port
//     (9333) — not the shared agent-browser daemon whose page already existed;
//   • the emulation is set on a fresh `about:blank` target BEFORE `Page.navigate`,
//     so the very first `matchMedia` the app evaluates already answers standalone.
//
// (The browser is started separately — `tools/standalone-proof-up.sh` — because a
// Chromium spawned as a child of this script proved unreliable on this box: it
// opened its CDP port, logged `DevTools listening on ws://127.0.0.1:9333/…`, and
// then died a few seconds later, leaving the client waiting. Detached, it stays.)
//
// Three states are recorded, each probed from the DOM the app itself produced:
//   01 — control, no emulation: the browser fires `beforeinstallprompt` → the
//        real button + "Not now" are on screen (`data-install-path="prompt"`).
//   02 — standalone, emulation set BEFORE navigation: `data-install-path
//        ="standalone"` and the card, the CTA and the dismiss button are ABSENT.
//   03 — the app's own `appinstalled` signal, dispatched in-page from state 01:
//        a second, independent path to suppression that does not rely on
//        display-mode emulation at all.
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

/** A fresh about:blank page target, and a CDP client attached to it alone. */
async function newTarget(): Promise<Cdp> {
  const t = await json("/json/new?about:blank", { method: "PUT" });
  if (!t?.webSocketDebuggerUrl) throw new Error(`no target from /json/new: ${JSON.stringify(t).slice(0, 200)}`);
  const cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return cdp;
}

/** Everything the app itself published about the install affordance. */
const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const vis = (s) => { const e = q(s); if (!e) return null;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return {
    standaloneQuery: matchMedia('(display-mode: standalone)').matches,
    browserQuery: matchMedia('(display-mode: browser)').matches,
    fullscreenQuery: matchMedia('(display-mode: fullscreen)').matches,
    installPath: document.documentElement.dataset.installPath ?? null,
    installCardPresent: !!q('[data-testid="install-card"]'),
    installCardVisible: vis('[data-testid="install-card"]'),
    installCtaPresent: !!q('[data-testid="install-cta"]'),
    installDismissPresent: !!q('[data-testid="install-dismiss"]'),
    installIosPresent: !!q('[data-testid="install-ios"]'),
    installTitleInText: document.body.innerText.includes('Install the game'),
    rendersInstallStrings: /Install the game|Add it to your home screen/.test(document.body.innerHTML),
    swController: navigator.serviceWorker?.controller?.state ?? null,
    title: document.title,
    url: location.href,
  };
})()`;

async function shot(cdp: Cdp, name: string): Promise<{ file: string; md5: string; bytes: number }> {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const buf = Buffer.from(String(r.data), "base64");
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, buf);
  return { file, md5: createHash("md5").update(buf).digest("hex"), bytes: buf.length };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const report: Record<string, unknown> = { app: APP, states: {} };
  const version = await json("/json/version");
  report.browser = `${String(version.Browser)} via CDP :${String(CDP_PORT)}`;

  // ------------------------------------------------- 01 · control (prompt)
  const ctl = await newTarget();
  await ctl.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await ctl.send("Page.navigate", { url: APP });
  await sleep(7000); // hydration, worker registration, beforeinstallprompt
  const control = await ctl.evaluate(PROBE);
  const shot1 = await shot(ctl, "01-install-card-prompt-390x844");

  // ------------------------------------------------ 03 · in-page appinstalled
  // Dispatched on the SAME page as 01, from the real `prompt` state: this is the
  // app's own signal (register.ts listens for it and drops the offer), with no
  // display-mode emulation involved.
  await ctl.evaluate(`(() => { window.dispatchEvent(new Event('appinstalled')); return true; })()`);
  await sleep(1500);
  const installed = await ctl.evaluate(PROBE);
  const shot3 = await shot(ctl, "03-after-appinstalled-event-390x844");

  // ------------------------------------ 02 · standalone, emulated BEFORE load
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
  const shot2 = await shot(stand, "02-standalone-emulated-before-load-390x844");

  report.states = {
    "01-control-prompt": { probe: control, shot: shot1 },
    "02-standalone": { probe: standalone, shot: shot2 },
    "03-appinstalled-in-page": { probe: installed, shot: shot3 },
  };
  report.verdict = {
    standaloneEmulationTook: standalone?.standaloneQuery === true && standalone?.browserQuery === false,
    controlShowsCard: control?.installPath === "prompt" && control?.installCardPresent === true,
    standaloneRendersNothing:
      standalone?.installPath === "standalone" &&
      standalone?.installCardPresent === false &&
      standalone?.installCtaPresent === false &&
      standalone?.installDismissPresent === false &&
      standalone?.installTitleInText === false &&
      standalone?.rendersInstallStrings === false,
    appinstalledRendersNothing:
      installed?.installCardPresent === false &&
      installed?.installCtaPresent === false &&
      installed?.installTitleInText === false,
    appinstalledPath: installed?.installPath ?? null,
  };
  ctl.close();
  stand.close();
  writeFileSync(`${OUT}/standalone-proof.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.verdict, null, 2));
}

await main();
