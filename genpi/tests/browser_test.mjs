// Browser test for the web version: drives web/ in headless Chromium and
// checks it against the Python version.
//
// - each deterministic algorithm's final readout equals the Python
//   command-line program's output, character for character
// - Buffon's needle is sane, a million Leibniz terms run in under 3 s
// - nothing on screen moves during a run
// - pause/resume/reset, the number field, the dial (keys, wheel, click)
// - the Learn panel: F1, Escape, following the dropdown, every topic
//   rendered with no leftover Markdown, docking on wide screens
// - phone-sized screen: no sideways scrolling
//
// Setup, once:   cd tests && npm install
//                npx playwright install chromium   (if you have no Chromium yet)
// Run:           node tests/browser_test.mjs [screenshot folder]
//
// It runs build-site.py and serves site/pi itself. Screenshots go to the
// folder given, or a new temporary folder. Set CHROME to use a particular
// Chrome or Chromium executable.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GENPI = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHOTS = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "genpi-shots-"));
mkdirSync(SHOTS, { recursive: true });

// Chromium: $CHROME, else the newest one Playwright has downloaded, else Playwright's default.
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome",
                       "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
                       "chrome-win/chrome.exe", "chrome-win64/chrome.exe"]) {
      if (existsSync(join(cache, d, sub))) return join(cache, d, sub);
    }
  }
  return undefined;
}
const launchOptions = { executablePath: findChrome() };

// Build the site and serve site/pi on a free local port.
execFileSync("python3", [join(GENPI, "build-site.py")], { stdio: "ignore" });
const ROOT = join(GENPI, "site", "pi");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".md": "text/markdown; charset=utf-8" };
const server = createServer((req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  const file = path.endsWith("/") ? join(path, "index.html") : path;
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures++; };

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(URL_);
await page.waitForFunction(() => window.piApp);

const readout = () => page.evaluate(() => ({
  est: document.getElementById("est-good").textContent + document.getElementById("est-bad").textContent,
  good: document.getElementById("est-good").textContent,
  err: document.getElementById("err").textContent,
  digits: document.getElementById("digits").textContent,
  count: document.getElementById("count").textContent,
  state: window.piApp.state,
}));

async function run(name, n, frac = 1) {
  await page.selectOption("#algo", { label: name });
  await page.fill("#n", String(n));
  await page.evaluate((f) => window.piApp.dial.setFrac(f), frac);
  const t0 = Date.now();
  await page.click("#start");
  await page.waitForFunction(() => window.piApp.state === "done", null, { timeout: 120000 });
  return { ...(await readout()), secs: (Date.now() - t0) / 1000 };
}

// 1. Deterministic algorithms: the readout must equal the Python CLI's output.
const cases = [["Leibniz series", "leibniz", 100000], ["Euler prime product", "euler", 20000],
               ["Pascal's triangle", "pascal", 500], ["Archimedes' polygons", "archimedes", 30],
               ["Circumference crawl", "crawl", 300], ["Ramanujan's series", "ramanujan", 5],
               ["Chudnovsky formula", "chudnovsky", 1]];
for (const [name, cli, n] of cases) {
  const out = execFileSync("python3", [`${GENPI}/genpi-${cli}.py`, String(n)], { encoding: "utf8" });
  const pyEst = out.match(/pi ~=\s+(\S+)/)[1];
  const pyErr = out.match(/error:\s+(\S+)/)[1];
  const r = await run(name, n);
  check(r.est === pyEst && r.err === `error   ${pyErr}`,
        `${name} N=${n}: browser ${r.est} / ${r.err.trim()}  python ${pyEst} / ${pyErr}  (${r.secs.toFixed(1)} s)`);
  check(r.count.startsWith(`${n.toLocaleString("en-US")} of`), `  count text: "${r.count}"`);
}
await page.screenshot({ path: `${SHOTS}/web-crawl-done.png` });

// 2. Buffon: random, so just sane.
let r = await run("Buffon's needle", 200000);
check(Math.abs(Number(r.est) - Math.PI) < 0.03, `Buffon N=200000: ${r.est}, ${r.err} (${r.secs.toFixed(1)} s)`);
await page.screenshot({ path: `${SHOTS}/web-buffon.png` });

// 3. Speed: a million Leibniz terms at full speed (dial max is 1,000,000/s).
r = await run("Leibniz series", 1000000);
check(r.secs < 3, `Leibniz 1,000,000 at full speed finished in ${r.secs.toFixed(1)} s: ${r.est}`);
await page.screenshot({ path: `${SHOTS}/web-leibniz-1m.png` });

// 4. Layout must not move while a run starts and progresses.
await page.click("#reset");
await page.selectOption("#algo", { label: "Euler prime product" });
await page.fill("#n", "5000000");
await page.evaluate(() => window.piApp.dial.setFrac(0.3));
const boxes = () => page.evaluate(() =>
  ["est-plot", "err-plot", "dial", "count", "est-good", "err", "digits", "zoom", "start", "pause", "reset", "learn", "status", "formula"]
    .map((id) => { const b = document.getElementById(id).getBoundingClientRect();
                   return id === "est-good" ? [b.x, b.y] : [b.x, b.y, b.width, b.height]; }));
const before = JSON.stringify(await boxes());
await page.click("#start");
let moved = 0;
for (let i = 0; i < 25; i++) {
  if (i === 12) await page.evaluate(() => window.piApp.dial.setFrac(0.9));
  await page.waitForTimeout(120);
  if (JSON.stringify(await boxes()) !== before) moved++;
}
check(moved === 0, `layout stable during run (${moved} of 25 samples moved)`);

// 5. Pause / resume / reset via keys and buttons.
await page.keyboard.press("Escape");
const nPaused = (await readout()).count;
await page.waitForTimeout(300);
check((await readout()).state === "paused" && (await readout()).count === nPaused, "Escape pauses, count frozen");
check(await page.isDisabled("#algo") && await page.isDisabled("#n"), "controls locked while paused");
check(await page.textContent("#pause") === "Resume", "pause button says Resume");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check((await readout()).state === "running" && (await readout()).count !== nPaused, "Escape resumes");
await page.click("#reset");
r = await readout();
check(r.state === "idle" && r.est === "–" && r.count.startsWith("0 of"), `reset clears: "${r.count}"`);

// 6. Number field: digits only, at most 10; empty is refused.
await page.fill("#n", "");
await page.type("#n", "12a3.4-5");
check(await page.inputValue("#n") === "12345", `typing "12a3.4-5" gives "${await page.inputValue("#n")}"`);
await page.fill("#n", "");
await page.type("#n", "123456789012");
check(await page.inputValue("#n") === "1234567890", "limited to 10 digits");
await page.fill("#n", "0");
await page.click("#start");
check((await page.textContent("#status")).includes("at least 1") && (await readout()).state === "idle",
      "0 is refused with a message");
await page.fill("#n", "");
await page.press("#n", "Enter");
check((await readout()).state === "idle", "empty is refused");

// 7. Dial: keyboard and wheel.
await page.evaluate(() => window.piApp.dial.setFrac(0));
await page.focus("#dial");
for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowUp");
check(await page.textContent("#rate") === "10 primes / second", `10 notches up: "${await page.textContent("#rate")}"`);
await page.hover("#dial");
for (let i = 0; i < 70; i++) await page.mouse.wheel(0, -100);
await page.waitForTimeout(200);
check(await page.textContent("#rate") === "1,000,000 primes / second", `wheel to max: "${await page.textContent("#rate")}"`);
// drag to the 12 o'clock position = halfway = 1,000/s
const d = await page.locator("#dial").boundingBox();
await page.mouse.move(d.x + d.width / 2, d.y + 20);
await page.mouse.down();
await page.mouse.up();
check(await page.textContent("#rate") === "1,000 primes / second", `click at top: "${await page.textContent("#rate")}"`);

// 8. Help panel.
await page.selectOption("#algo", { label: "Pascal's triangle" });
await page.keyboard.press("F1");
await page.waitForFunction(() => document.querySelector(".help-body h1"));
const h1 = () => page.textContent(".help-body h1");
check(await page.isVisible("#help") && await h1() === "Pascal's triangle", `F1 opens at current algorithm: "${await h1()}"`);
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/web-help-pascal.png` });
// close via Escape (focus is in the panel)
await page.keyboard.press("Escape");
check(!(await page.isVisible("#help")) && (await readout()).state === "idle", "Escape closes help without starting anything");
await page.click("#learn");
await page.selectOption("#algo", { label: "Buffon's needle" });
await page.waitForFunction(() => document.querySelector(".help-body h1")?.textContent === "Buffon's needle");
check(true, "help follows the algorithm dropdown");
const topics = await page.$$eval(".help-topics button", (bs) => bs.map((b) => b.textContent));
for (let i = 0; i < topics.length; i++) {
  await page.click(`.help-topics button >> nth=${i}`);
  await page.waitForFunction((t) => document.querySelector(".help-body h1")?.textContent === t,
                             i === 0 ? "Reading the plots" : topics[i]);
  const txt = await page.textContent(".help-body");
  const leftovers = (txt.match(/\*\*|```|(^|\s)\*\S|`|^#|^> |\]\(/gm) || []);
  const html = await page.innerHTML(".help-body");
  check(leftovers.length === 0, `topic "${topics[i]}": ${txt.length} chars, ${(html.match(/<pre>/g)||[]).length} formula blocks, ${(html.match(/<li>/g)||[]).length} list items, ${(html.match(/<a /g)||[]).length} links, markup left: ${JSON.stringify(leftovers)}`);
  for (const a of await page.$$eval(".help-body a", (as) => as.map((x) => [x.href, x.target, x.rel])))
    check(/^https:\/\//.test(a[0]) && a[1] === "_blank" && a[2].includes("noopener"), `  link ${a[0]} opens in a new tab`);
}
await page.click(".help-topics button >> nth=0");
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOTS}/web-help-overview.png` });
await page.click(".help-close");

// 9. Wide screen: help docks beside the app.
await page.setViewportSize({ width: 1600, height: 900 });
await page.selectOption("#algo", { label: "Archimedes' polygons" });
await page.fill("#n", "30");
await page.evaluate(() => window.piApp.dial.setFrac(0.25));
await page.click("#start");
await page.click("#learn");
await page.waitForTimeout(2500);
const est = await page.locator("#est-plot").boundingBox();
const help = await page.locator("#help").boundingBox();
check(est.x + est.width <= help.x + 1, `wide: plots (right edge ${Math.round(est.x + est.width)}) end before help (${Math.round(help.x)})`);
await page.screenshot({ path: `${SHOTS}/web-wide-help.png` });

check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();

// 10. Phone.
const b2 = await chromium.launch(launchOptions);
const phone = await b2.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
await phone.goto(URL_);
await phone.waitForFunction(() => window.piApp);
await phone.fill("#n", "2000");
await phone.evaluate(() => window.piApp.dial.setFrac(1));
await phone.tap("#start");
await phone.waitForFunction(() => window.piApp.state === "done");
const sw = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
check(sw[0] <= sw[1], `phone: no sideways scrolling (page ${sw[0]} px, screen ${sw[1]} px)`);
await phone.screenshot({ path: `${SHOTS}/web-phone.png`, fullPage: true });
await phone.tap("#learn");
await phone.waitForTimeout(400);
await phone.screenshot({ path: `${SHOTS}/web-phone-help.png` });
await b2.close();

server.close();
console.log(`(screenshots in ${SHOTS})`);
console.log(failures ? `${failures} FAILED` : "ALL BROWSER CHECKS OK");
process.exit(failures ? 1 : 0);
