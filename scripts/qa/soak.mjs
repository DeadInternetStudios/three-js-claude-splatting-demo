#!/usr/bin/env node
import { parseArgs } from "node:util";
import { launchBrowser, isKnownNoise } from "./browsers.mjs";
import { serve } from "./serve.mjs";

/**
 * Plays the page for minutes and watches what it keeps. A script presses the keys a player would. It runs, flies and
 * warps, switches on each power, sings a ring, takes a photo and jumps to a new world, round after round. Every
 * `--every` seconds it forces a garbage collection, reads the JavaScript heap and counts the textures, geometries and
 * shader programs that three.js holds.
 *
 *   node scripts/qa/soak.mjs [--minutes 5] [--every 20] [--limit 0.25] [--size 960x540] [--seed 1]
 *     [--url http://127.0.0.1:4173]
 *
 * The run fails when
 *   - a least-squares line through the heap samples after the first minute climbs by more than `--limit` MB a minute,
 *   - any three.js count after the first minute is higher than it was at the first sample after that minute (a feature
 *     may compile its program on first use, so the first minute is left out),
 *   - the console prints an error or a warning, or
 *   - the run did too little to mean anything: the walker covered less than 100 m or the page never left its first world.
 *
 * Chrome only, because the heap comes from the DevTools protocol. The HUD is hidden, so the DOM is not watched, and
 * neither is the memory of the GPU.
 */
const { values } = parseArgs({
  options: {
    minutes: { type: "string", default: "5" },
    every: { type: "string", default: "20" },
    limit: { type: "string", default: "0.25" },
    size: { type: "string", default: "960x540" },
    seed: { type: "string", default: "1" },
    url: { type: "string" },
  },
});
const minutes = Number(values.minutes);
const every = Number(values.every);
const limit = Number(values.limit);
const [width, height] = values.size.split("x").map(Number);
const FIRST_MINUTE = 60;
const MIN_SAMPLES = 6;
const MIN_WALKED = 100;
const COUNTS = ["textures", "geometries", "programs"];

if (minutes * 60 - FIRST_MINUTE < every * MIN_SAMPLES) {
  console.error(`the run needs ${MIN_SAMPLES} samples after its first minute, so --minutes must exceed ${1 + (every * MIN_SAMPLES) / 60}`);
  process.exit(2);
}

/** Runs in the page before it starts. Adds up the ground the walker covers, ignoring the jump a new world makes. */
function trackDistance() {
  window.__walked = 0;
  let last = null;
  const tick = () => {
    const feet = window.__origami?.player.feet;
    if (feet) {
      if (last) {
        const step = Math.hypot(feet.x - last[0], feet.z - last[1]);
        if (step < 40) window.__walked += step;
      }
      last = [feet.x, feet.z];
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The line through `(t, value)` that fits best, as the change of the value per minute. */
function slopePerMinute(rows, key) {
  const n = rows.length;
  const meanT = rows.reduce((sum, r) => sum + r.t, 0) / n;
  const meanY = rows.reduce((sum, r) => sum + r[key], 0) / n;
  const along = rows.reduce((sum, r) => sum + (r.t - meanT) * (r[key] - meanY), 0);
  return (60 * along) / rows.reduce((sum, r) => sum + (r.t - meanT) ** 2, 0);
}

let server = null;
let base = values.url;
if (!base) {
  server = await serve([]);
  base = server.base;
}
const browser = await launchBrowser("chrome");
const problems = [];
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const cdp = await page.context().newCDPSession(page);
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !isKnownNoise(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(trackDistance);
  await page.goto(`${base}/?debug&calm&quality=high&seed=${values.seed}`);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
  await page.waitForTimeout(8000);
  await page.addStyleTag({ content: "#hud { display: none !important; }" });

  const sample = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    const held = await page.evaluate(() => {
      const g = window.__origami;
      const memory = g.world.stage.renderer.info.memory;
      return { textures: memory.textures, geometries: memory.geometries, programs: g.world.stage.renderer.info.programs.length, seed: g.snapshot().seed, walked: window.__walked };
    });
    return { heapMB: heap.usedSize / 1048576, ...held };
  };

  const hold = async (keys, ms) => {
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
  };
  const tap = (key, ms = 60) => hold([key], ms);
  const round = [
    () => hold(["Shift", "w"], 8000),
    async () => {
      await tap("f");
      await page.keyboard.down("Space");
      await page.waitForTimeout(1500);
      await page.keyboard.up("Space");
      await hold(["Shift", "w", "b"], 7000);
      await tap("f");
    },
    async () => {
      for (const key of ["1", "2", "3", "4"]) {
        await tap(key);
        await page.waitForTimeout(1800);
        await tap(key);
      }
      await tap("e");
      await page.waitForTimeout(800);
    },
    async () => {
      await tap("p");
      await page.waitForTimeout(1500);
      await tap("p");
      await page.waitForTimeout(500);
      await hold(["w"], 5000);
    },
    async () => {
      await tap("n");
      await page.waitForTimeout(6000);
    },
  ];

  const start = Date.now();
  const end = start + minutes * 60_000;
  const rows = [{ t: 0, ...(await sample()) }];
  let step = 0;
  console.log(`${minutes} min at ${width}x${height}, a sample every ${every} s`);
  while (Date.now() < end) {
    const stop = Math.min(end, Date.now() + every * 1000);
    while (Date.now() < stop) await round[step++ % round.length]();
    rows.push({ t: Math.round((Date.now() - start) / 1000), ...(await sample()) });
    const r = rows.at(-1);
    console.log(`${String(r.t).padStart(4)} s  heap ${r.heapMB.toFixed(1)} MB  textures ${r.textures}  geometries ${r.geometries}  programs ${r.programs}`);
  }

  const after = rows.filter((r) => r.t >= FIRST_MINUTE);
  const climb = slopePerMinute(after, "heapMB");
  console.log(`after the first minute: heap ${climb.toFixed(2)} MB a minute (limit ${limit})`);
  if (climb > limit) failures.push(`the heap climbs ${climb.toFixed(2)} MB a minute`);
  for (const key of COUNTS) {
    const top = Math.max(...after.map((r) => r[key]));
    console.log(`${key.padEnd(10)} ${rows[0][key]} at the start, ${after[0][key]} to ${top} after the first minute`);
    if (top > after[0][key]) failures.push(`${key} rose from ${after[0][key]} to ${top}`);
  }
  const worlds = new Set(rows.map((r) => r.seed)).size;
  const walked = rows.at(-1).walked;
  console.log(`the walker covered ${walked.toFixed(0)} m and the page showed ${worlds} worlds`);
  if (walked < MIN_WALKED) failures.push(`the walker covered only ${walked.toFixed(0)} m`);
  if (worlds < 2) failures.push("the page never left its first world");
} finally {
  await browser.close();
  server?.stop();
}
if (problems.length > 0) console.log([...new Set(problems)].join("\n"));
else console.log("no console errors or warnings");
if (failures.length > 0) console.log(`failed: ${failures.join("; ")}`);
process.exit(problems.length === 0 && failures.length === 0 ? 0 : 1);
