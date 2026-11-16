#!/usr/bin/env node
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

/**
 * Checks that a cell field holds what a fresh render would put there. `CellField.render` skips a refill when the
 * window, the seed and the sun are the same as last time, so a wrong cache key shows as ground that lags the walker.
 *
 *   node scripts/qa/field-cache.mjs [--base http://127.0.0.1:4173] [--size 1280x720]
 *
 * The page stands, walks, runs and flies, hops between worlds and teleports. Every 0.7 s the script reads every field,
 * invalidates all of them, lets the layers refill them from the same state and reads them again. Any texel that differs
 * fails the run. It also counts the refills that really ran, against the 12 a frame that always refills would make.
 */
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:4173" },
    size: { type: "string", default: "1280x720" },
  },
});
const [width, height] = values.size.split("x").map(Number);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.push(m.text().slice(0, 300)));
await page.goto(`${values.base}/?debug&quality=low&seed=1`);
await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
await page.waitForTimeout(6000);

const fieldCount = await page.evaluate(() => {
  const w = window.__origami.world;
  const fields = [...w.ground.fields, ...w.flora.fields, w.wonders.field];
  window.__refills = 0;
  window.__frames = 0;
  for (const f of fields) {
    const render = f.pass.render.bind(f.pass);
    f.pass.render = (...args) => {
      window.__refills++;
      return render(...args);
    };
  }
  const count = () => {
    window.__frames++;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  return fields.length;
});

const compare = () =>
  page.evaluate(() => {
    const w = window.__origami.world;
    const renderer = w.stage.renderer;
    const fields = [
      ...w.ground.fields.map((f, i) => [`ground${i}`, f]),
      ...w.flora.fields.map((f, i) => [`flora${i}`, f]),
      ["wonders", w.wonders.field],
    ];
    const read = (f) => {
      const out = new Float32Array(f.size * f.size * 4);
      renderer.readRenderTargetPixels(f.target, 0, 0, f.size, f.size, out);
      return out;
    };
    const cached = fields.map(([, f]) => read(f));
    for (const [, f] of fields) f.invalidate();
    const feet = window.__origami.player.feet;
    w.ground.update(feet, renderer);
    w.flora.update(feet, renderer);
    w.wonders.update(feet, renderer);
    return fields.map(([name, f], i) => {
      const fresh = read(f);
      let differing = 0;
      let nonzero = 0;
      for (let k = 0; k < fresh.length; k++) {
        if (cached[i][k] !== fresh[k]) differing++;
        if (fresh[k] !== 0) nonzero++;
      }
      return { name, texels: f.size * f.size, differing, nonzero };
    });
  });

let checks = 0;
let texelsChecked = 0;
let bad = 0;
const empty = new Set();
const check = async (label) => {
  const result = await compare();
  checks++;
  for (const r of result) {
    texelsChecked += r.texels;
    if (r.differing > 0) {
      bad++;
      console.log(`DIFFERS at ${label}: ${r.name} ${r.differing} of ${r.texels * 4} values`);
    }
    if (r.nonzero === 0) empty.add(r.name);
  }
};

const counts = async () => page.evaluate(() => ({ refills: window.__refills, frames: window.__frames }));
const phase = async (name, seconds, act) => {
  const start = await counts();
  const end = Date.now() + seconds * 1000;
  await act?.begin?.();
  while (Date.now() < end) {
    await page.waitForTimeout(700);
    const mid = await counts();
    await check(name);
    await page.evaluate((n) => (window.__refills = n), mid.refills);
  }
  await act?.end?.();
  const last = await counts();
  const frames = last.frames - start.frames;
  console.log(`${name.padEnd(10)} ${String(frames).padStart(5)} frames, ${String(last.refills - start.refills).padStart(4)} refills, ${((last.refills - start.refills) / Math.max(1, frames)).toFixed(2)} a frame (always refilling would make ${fieldCount})`);
};

const hold = (keys) => ({
  begin: async () => {
    for (const k of keys) await page.keyboard.down(k);
  },
  end: async () => {
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
  },
});

await phase("stand", 4);
await phase("walk", 8, hold(["w"]));
await phase("run", 8, hold(["Shift", "w"]));
await page.keyboard.press("f");
await phase("fly", 14, hold(["Shift", "w", "Space"]));
await page.keyboard.press("f");
await page.waitForTimeout(3000);
await phase("teleport", 6, {
  begin: () => page.evaluate(() => window.__origami.player.place(2400, -1800, 1.2)),
});
await phase("new world", 5, { begin: () => page.keyboard.press("n") });

console.log(`\n${checks} checks, ${texelsChecked} texels compared with a fresh render, ${bad} fields differed`);
if (empty.size > 0) console.log(`fields that were all zero at every check: ${[...empty].join(", ")}`);
console.log(problems.length ? `PROBLEMS:\n${[...new Set(problems)].join("\n")}` : "no console errors or warnings");
await browser.close();
if (bad > 0 || problems.length > 0) process.exit(1);
