import { launchChrome, CDP, attachPage, evaluate, screenshot, emulate, sleep } from "./lib.mjs";
const BASE = process.env.BASE || "http://127.0.0.1:4521";
const { proc, wsUrl } = await launchChrome(process.env.PROFILE || "/home/hatch/workspace/globe-qa/profile-phone");
const browser = await CDP.connect(wsUrl);
const page = await attachPage(browser, "about:blank");
await emulate(page, { width: 412, height: 915, dpr: 2, mobile: true });
await page.send("Page.navigate", { url: `${BASE}/play` });
await sleep(14000);
const info = await evaluate(page, `(() => ({
  url: location.href,
  navBtns: [...document.querySelectorAll('[id^="nav-tab-"]')].map(e => e.id),
  btnTexts: [...document.querySelectorAll('button')].filter(b => b.offsetParent).slice(0, 30).map(b => b.textContent.trim().slice(0, 28)),
  bodyStart: document.body.innerText.slice(0, 400),
}))()`);
console.log(JSON.stringify(info, null, 1));
await screenshot(page, `${process.env.SHOTS || "./gauntlet/shots/"}probe-play.png`);
try { proc.kill("SIGKILL"); } catch {}
process.exit(0);
