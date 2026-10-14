// Battle Gauntlet CDP driver — vendored from the globe-qa harness (Oct 13 2026 pattern).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFile } from "node:fs/promises";

const CHROME = "/home/hatch/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome";
const PORT = 9333;

export async function launchChrome(profileDir = "/home/hatch/workspace/globe-qa/profile") {
  const proc = spawn(CHROME, [
    "--headless=new",
    "--no-sandbox",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--window-size=1300,900",
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
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
}

export async function emulate(page, { width, height, dpr = 2, mobile = true }) {
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

export async function typeText(page, text) {
  await page.send("Input.insertText", { text });
}

export { sleep };

/** Touch drag from (x1,y1) to (x2,y2) in steps — the map-pan gesture. */
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

/** Mouse drag — pointer events on canvas surfaces respond to either. */
export async function mouseDrag(page, x1, y1, x2, y2, steps = 12) {
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left" });
    await sleep(30);
  }
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
}
