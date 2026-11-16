#!/usr/bin/env node
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

/**
 * Shows what a frame spends its time on by switching parts of the pipeline off one after another and timing the frame
 * after each step.
 *
 *   node scripts/qa/stage-cost.mjs [--size 1920x1080] [--base http://127.0.0.1:4173] [--seconds 4]
 *
 * Every frame callback ends in a 1x1 `readPixels`, which waits for the GPU, so the cost of a frame is the time to issue
 * its commands plus its GPU time (the same drain as `benchmark.mjs --drain`). The steps are cumulative. Each one keeps
 * the earlier ones off, in this order: every splat layer, the sky pass, the cell field passes, the resolve, the HDR draw.
 * The script reaches them through `window.__origami`, which the page exposes with `?debug`.
 *
 * What a step saves depends on what else the GPU still runs, so one step is not the cost of that part. `docs/BENCHMARKS.md`
 * has an example.
 */
const { values } = parseArgs({
  options: {
    size: { type: "string", default: "1920x1080" },
    base: { type: "string", default: "http://127.0.0.1:4173" },
    seconds: { type: "string", default: "4" },
  },
});
const [width, height] = values.size.split("x").map(Number);
const seconds = Number(values.seconds);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.push(m.text().slice(0, 200)));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__cost = [];
  const pixel = new Uint8Array(4);
  window.requestAnimationFrame = (callback) =>
    raf((t) => {
      const gl = window.__origami?.world.stage.renderer.getContext();
      if (!gl) return callback(t);
      const start = performance.now();
      try {
        return callback(t);
      } finally {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        window.__cost.push(performance.now() - start);
      }
    });
});
await page.goto(`${values.base}/?debug&quality=high&seed=1`);
await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
await page.waitForTimeout(8000);

const measure = async (label) => {
  await page.waitForTimeout(1500);
  const from = await page.evaluate(() => window.__cost.length);
  await page.waitForTimeout(seconds * 1000);
  const costs = (await page.evaluate((n) => window.__cost.slice(n), from)).sort((a, b) => a - b);
  const at = (q) => costs[Math.min(costs.length - 1, Math.floor(q * costs.length))];
  console.log(`${label.padEnd(30)} p50 ${at(0.5).toFixed(1).padStart(5)}  p95 ${at(0.95).toFixed(1).padStart(5)}  frames ${costs.length}`);
};

console.log(`${values.base} at ${width}x${height}, drained cost in ms`);
await measure("every layer");
await page.evaluate(() => {
  for (const layer of window.__origami.world.layers) layer.visible = false;
});
await measure("no layer");
const steps = [
  ["and no sky pass", () => (window.__origami.world.sky.render = () => {})],
  [
    "and no cell field passes",
    () => {
      const { ground, flora, wonders } = window.__origami.world;
      for (const layer of [ground, flora, wonders]) layer.update = () => {};
    },
  ],
  ["and no resolve", () => (window.__origami.world.post.render = () => {})],
  ["and no HDR draw", () => (window.__origami.world.drawHdr = () => {})],
];
for (const [label, patch] of steps) {
  await page.evaluate(patch);
  await measure(label);
}
console.log(problems.length ? `PROBLEMS\n${[...new Set(problems)].join("\n")}` : "no console errors or warnings");
await browser.close();
if (problems.length) process.exitCode = 1;
