// Flow Crew CDP driver — vendored from the globe-qa / gauntlet harness
// pattern (Oct 13–14 2026). Own debugging port + own profile so a flow run
// never collides with another crew's servers or browsers.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFile } from "node:fs/promises";

const CHROME = "/home/hatch/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome";
const PORT = Number(process.env.FLOW_CDP_PORT || 9555);

export async function launchChrome(profileDir = "/home/hatch/workspace/.flow-profile") {
  const proc = spawn(CHROME, [
    "--headless=new",
    "--no-sandbox",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--window-size=420,900",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      wsUrl = j.webSocketDebuggerUrl;
      break;
    } catch { await sleep(500); }
  }
  if (!wsUrl) throw new Error("chrome devtools did not come up");
  return { proc, wsUrl };
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.handlers) fn(msg);
      }
    });
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    return new CDP(ws);
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}, sessionId, timeoutMs = 25000) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method} (page wedged? dialog open? renderer stuck?)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

export async function attachPage(browser, url = "about:blank") {
  const { targetId } = await browser.send("Target.createTarget", { url });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = {
    sessionId,
    send: (m, p = {}) => browser.send(m, p, sessionId),
  };
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("DOM.enable");
  return page;
}

export async function evaluate(page, expr, awaitPromise = false) {
  const r = await page.send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) {
    throw new Error("evaluate failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text || "unknown"));
  }
  return r.result?.value;
}

export async function screenshot(page, path) {
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path, Buffer.from(r.data, "base64"));
  return r.data; // base64, handy for change-detection hashes
}

export async function emulate(page, { width, height, dpr = 3, mobile = true }) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: dpr, mobile,
    screenWidth: width, screenHeight: height,
  });
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
}

export async function tap(page, x, y) {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

export async function click(page, x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(50);
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

/** Touch drag from (x1,y1) to (x2,y2) in steps — pan/spin gesture. */
export async function drag(page, x1, y1, x2, y2, steps = 12) {
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await sleep(30);
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

export async function wheel(page, x, y, deltaY, times = 4) {
  for (let i = 0; i < times; i++) {
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
    await sleep(110);
  }
}

export { sleep };
