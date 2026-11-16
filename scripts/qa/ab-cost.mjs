#!/usr/bin/env node
import { loadavg } from "node:os";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { serve } from "./serve.mjs";
import { findSpawn } from "../../src/play/spawn.ts";
import { createTerrain } from "../../src/world/cpu/terrain.ts";

/**
 * Compares the drained frame cost of two builds on a machine that is not idle. Build each tree into its own folder
 * first, for example `npx vite build --outDir .work/distA` on a stash of the old code and again on the new code.
 *
 *   node scripts/qa/ab-cost.mjs --a .work/distA --b .work/distB [--rounds 5] [--seconds 4] [--size 1920x1080]
 *     [--realm 3] [--control]
 *
 * Each measurement opens a fresh page, waits for the world, stands still (at the spawn of realm 0 to 4 with `--realm`) and times the frame callback with the same
 * 1x1 `readPixels` drain as `stage-cost.mjs`, so the cost is issue time plus GPU time. Sides take turns inside every
 * round (A, B, then A again with `--control`) so a change in machine load lands on all of them. The control measures
 * the same build twice. The gap between its two numbers is the noise floor, and a difference between A and B smaller
 * than that is no measurable difference. The script also prints the splat count of each build and any console errors,
 * so a number from a build that did less work, or broke, does not pass for a speedup.
 */
const { values } = parseArgs({
  options: {
    a: { type: "string" },
    b: { type: "string" },
    rounds: { type: "string", default: "5" },
    seconds: { type: "string", default: "4" },
    size: { type: "string", default: "1920x1080" },
    realm: { type: "string" },
    control: { type: "boolean", default: false },
  },
});
if (!values.a || !values.b) {
  console.error("usage: ab-cost.mjs --a <dist folder> --b <dist folder> [--rounds 5] [--seconds 4] [--size 1920x1080] [--realm 0..4] [--control]");
  process.exit(2);
}
const [width, height] = values.size.split("x").map(Number);
const rounds = Number(values.rounds);
const seconds = Number(values.seconds);
const spawnAt = values.realm === undefined ? null : findSpawn(createTerrain(1), Number(values.realm));

const servers = [await serve(["preview", "--outDir", values.a]), await serve(["preview", "--outDir", values.b])];
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});
const problems = new Set();
const splats = {};

const measure = async (side, base) => {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => problems.add(`${side}: ${e}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.add(`${side}: ${m.text().slice(0, 160)}`));
  await page.addInitScript(() => {
    window.__cost = [];
    const pixel = new Uint8Array(4);
    const raf = window.requestAnimationFrame.bind(window);
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
  await page.goto(`${base}/?debug&quality=high&seed=1`);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
  await page.waitForTimeout(8000);
  if (spawnAt) {
    await page.evaluate((s) => window.__origami.player.place(s.x, s.z, s.yaw, 0.04), spawnAt);
    await page.waitForTimeout(3000);
  }
  splats[side] = await page.evaluate(() => window.__origami.world.splatCount);
  await page.waitForTimeout(1500);
  const from = await page.evaluate(() => window.__cost.length);
  await page.waitForTimeout(seconds * 1000);
  const costs = (await page.evaluate((n) => window.__cost.slice(n), from)).sort((x, y) => x - y);
  await page.close();
  const at = (q) => costs[Math.min(costs.length - 1, Math.floor(q * costs.length))];
  return { p50: at(0.5), p95: at(0.95), frames: costs.length };
};

const sides = [
  ["A", servers[0].base],
  ["B", servers[1].base],
  ...(values.control ? [["A2", servers[0].base]] : []),
];
const results = Object.fromEntries(sides.map(([name]) => [name, []]));
console.log(`load average at start ${loadavg().map((x) => x.toFixed(1)).join(" ")}, ${width}x${height}, ${rounds} rounds of ${seconds} s`);
try {
  for (let r = 0; r < rounds; r++) {
    const line = [];
    for (const [name, base] of sides) {
      const m = await measure(name, base);
      results[name].push(m);
      line.push(`${name} p50 ${m.p50.toFixed(1)} p95 ${m.p95.toFixed(1)} (${m.frames} frames)`);
    }
    console.log(`round ${r + 1}: ${line.join("   ")}`);
  }
} finally {
  await browser.close();
  for (const s of servers) s.stop();
}

const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
for (const [name] of sides) {
  const p50s = results[name].map((m) => m.p50);
  console.log(`${name.padEnd(3)} p50 median ${median(p50s).toFixed(1)} ms  range ${Math.min(...p50s).toFixed(1)} to ${Math.max(...p50s).toFixed(1)}   p95 median ${median(results[name].map((m) => m.p95)).toFixed(1)} ms`);
}
console.log(`splats  A ${splats.A}  B ${splats.B}`);
console.log(problems.size ? `PROBLEMS\n${[...problems].join("\n")}` : "no console errors or warnings");
process.exit(problems.size ? 1 : 0);
