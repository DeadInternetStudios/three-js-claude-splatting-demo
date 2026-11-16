#!/usr/bin/env node
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser, isKnownNoise } from "./browsers.mjs";

/**
 * Times the start of a build, from the request to the first splats on screen, with a cold shader cache and with a warm
 * one. A browser and the operating system keep each shader they have compiled, keyed by its source. A visitor who comes
 * for the first time has none, and every run of a test on one machine has them all, so a plain run says nothing about
 * that first visit. Each cold run therefore serves a copy of the build with one constant of the shared lighting code
 * changed (the line after `shadeSurfel` in `entry.glsl` multiplies the colour by 1 plus a number of the run), a
 * source nobody on this machine has compiled. The warm run loads the same copy again.
 *
 *   node scripts/qa/cold-start.mjs [--dist dist] [--runs 3] [--size 1280x720] [--browser chrome]
 *
 * The page clock starts at the request. `first splats` is when Spark reports more than 50,000 drawn splats and `boot box
 * gone` when the loading box hides. `blocked` is the longest task that held the main thread for more than 50 ms, and
 * reads n/a in an engine that does not report long tasks (Firefox and WebKit). Run it on a build from `npm run build`.
 * Compare two builds by running the script on each in turn.
 */
const { values } = parseArgs({
  options: {
    dist: { type: "string", default: "dist" },
    runs: { type: "string", default: "3" },
    size: { type: "string", default: "1280x720" },
    browser: { type: "string", default: "chrome" },
  },
});
const [width, height] = values.size.split("x").map(Number);
const runs = Number(values.runs);
const ANCHOR = "vec3 col = shadeSurfel(s, n, p);";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

async function copyWithNonce(nonce) {
  const dir = await mkdtemp(join(tmpdir(), "cold-start-"));
  await cp(values.dist, dir, { recursive: true });
  const assets = join(dir, "assets");
  let patched = 0;
  for (const name of await readdir(assets)) {
    if (extname(name) !== ".js") continue;
    const text = await readFile(join(assets, name), "utf8");
    if (!text.includes(ANCHOR)) continue;
    await writeFile(join(assets, name), text.replace(ANCHOR, `${ANCHOR} col *= 1.0 + float(${nonce}) * 1.2e-7;`));
    patched++;
  }
  if (patched !== 1) throw new Error(`expected the lighting code in one script of ${values.dist}, found it in ${patched}`);
  return dir;
}

function serveFolder(dir) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
      const file = path === "/" ? "index.html" : path.slice(1);
      const body = await readFile(join(dir, file));
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() })));
}

/** Runs in the page before it starts. */
function watch() {
  const seen = { blocked: null, splatsAt: null, bootGoneAt: null };
  window.__seen = seen;
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    seen.blocked = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) seen.blocked = Math.max(seen.blocked, e.duration);
    }).observe({ type: "longtask", buffered: true });
  }
  setInterval(() => {
    const now = performance.now();
    if (seen.splatsAt === null && (window.__origami?.world.stage.spark.activeSplats ?? 0) > 50000) seen.splatsAt = now;
    if (seen.bootGoneAt === null && document.getElementById("boot")?.style.display === "none") seen.bootGoneAt = now;
  }, 10);
}

async function load(browser, base) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const problems = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !isKnownNoise(m.text())) problems.push(m.text().slice(0, 160));
  });
  await page.addInitScript(watch);
  await page.goto(`${base}/?debug&calm`, { waitUntil: "commit" });
  await page.waitForFunction(() => window.__seen.splatsAt !== null && window.__seen.bootGoneAt !== null, null, { timeout: 180_000, polling: 50 });
  const seen = await page.evaluate(() => window.__seen);
  await page.close();
  return { ...seen, problems };
}

const cell = (ms) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(2)} s`);
const rows = [];
const browser = await launchBrowser(values.browser);
try {
  for (let run = 0; run < runs; run++) {
    const dir = await copyWithNonce(1000 + Math.floor(Math.random() * 99000));
    const server = await serveFolder(dir);
    try {
      const cold = await load(browser, server.base);
      const warm = await load(browser, server.base);
      rows.push({ cold, warm });
      console.log(
        `run ${run + 1}  cold: first splats ${cell(cold.splatsAt)}, boot box gone ${cell(cold.bootGoneAt)}, blocked ${cell(cold.blocked)}   warm: first splats ${cell(warm.splatsAt)}, boot box gone ${cell(warm.bootGoneAt)}, blocked ${cell(warm.blocked)}`,
      );
    } finally {
      server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
const range = (list) => `${cell(Math.min(...list))} to ${cell(Math.max(...list))}`;
console.log(`first splats, cold ${range(rows.map((r) => r.cold.splatsAt))}, warm ${range(rows.map((r) => r.warm.splatsAt))} over ${runs} runs`);
const problems = [...new Set(rows.flatMap((r) => [...r.cold.problems, ...r.warm.problems]))];
console.log(problems.length ? `console: ${problems.join(" | ")}` : "no console errors or warnings");
process.exit(problems.length === 0 ? 0 : 1);
