#!/usr/bin/env node
import { parseArgs } from "node:util";
import { launchBrowser, isKnownNoise } from "./browsers.mjs";
import { serve } from "./serve.mjs";
import { findSpawn } from "../../src/play/spawn.ts";
import { createTerrain } from "../../src/world/cpu/terrain.ts";

/**
 * Plays the world one frame at a time and checks that the picture does not jump. In each realm the walker holds the keys
 * for `--frames` frames on a clock that moves 1/60 s per frame. After every frame the script reads the framebuffer and
 * keeps its mean brightness. The largest change from one frame to the next is what a player sees as a flash, and the
 * run fails when it passes `--limit`.
 *
 *   node scripts/qa/steady.mjs [--keys KeyW] [--frames 240] [--limit 0.04] [--only dunes,deep] [--browser chrome]
 *     [--size 1280x720] [--seed 1] [--url http://127.0.0.1:4173]
 *
 * Brightness runs from 0 to 1 in the coded values of the screen. Walking should stay under 0.04. Running makes bigger
 * steps wherever a glowing mote passes the camera, with or without footstep rings, so give it a higher `--limit`.
 * The page opens with `calm`, which turns the lightning off. A bolt is a flash on purpose and would pass for a jump.
 * A frame waits 12 ms of real time first, because Spark sorts the splats on a worker that needs turns of the event loop.
 * A loop that never yielded would draw one frame over and over. The script also fails when the walker moved less than
 * half the way the keys should carry it, so a run in which nothing happened cannot pass for a steady one.
 */
const { values } = parseArgs({
  options: {
    keys: { type: "string", default: "KeyW" },
    frames: { type: "string", default: "240" },
    limit: { type: "string", default: "0.04" },
    only: { type: "string" },
    browser: { type: "string", default: "chrome" },
    size: { type: "string", default: "1280x720" },
    seed: { type: "string", default: "1" },
    url: { type: "string" },
  },
});
const seed = Number(values.seed);
const frames = Number(values.frames);
const limit = Number(values.limit);
const [width, height] = values.size.split("x").map(Number);
const keys = values.keys.split(",").filter(Boolean);
const REALMS = ["dunes", "prism", "deep", "flats", "ember"];
const WALK = 4.6;
const RUN = 11;
const speed = keys.includes("ShiftLeft") ? RUN : WALK;
const FRAME_WAIT_MS = 12;
const SETTLE_FRAMES = 150;

const chosen = values.only ? values.only.split(",") : REALMS;
const unknown = chosen.filter((name) => !REALMS.includes(name));
if (unknown.length > 0) {
  console.error(`no realm called ${unknown.join(", ")}. Names: ${REALMS.join(", ")}`);
  process.exit(2);
}

/**
 * Runs in the page. Replaces the frame loop with one that only moves when `window.__step` says so. Playwright polls
 * through the frame loop unless told otherwise, so a wait on this page has to name `polling`.
 */
function installClock(waitMs) {
  const pending = [];
  let clock = 1000;
  window.requestAnimationFrame = (callback) => pending.push(callback);
  window.__step = async (count, sample) => {
    const gl = window.__origami.world.stage.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    const groundRows = Math.ceil(h * 0.4);
    const out = [];
    for (let i = 0; i < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      clock += 1000 / 60;
      for (const callback of pending.splice(0)) callback(clock);
      if (!sample) continue;
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let all = 0;
      let ground = 0;
      let allN = 0;
      let groundN = 0;
      for (let y = 0; y < h; y += 4) {
        const onGround = y < groundRows;
        for (let x = 0; x < w; x += 4) {
          const p = (y * w + x) * 4;
          const luma = 0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2];
          all += luma;
          allN++;
          if (onGround) {
            ground += luma;
            groundN++;
          }
        }
      }
      out.push({ all: all / allN / 255, ground: ground / groundN / 255 });
    }
    return out;
  };
}

/** Runs in the page. Holds the keys for `count` frames and says how far the walker went. */
async function walk([count, held]) {
  const g = window.__origami;
  const press = (type, code) =>
    window.dispatchEvent(new KeyboardEvent(type, { code, key: code === "ShiftLeft" ? "Shift" : code === "Space" ? " " : code.replace("Key", "").toLowerCase(), bubbles: true }));
  const start = [g.player.feet.x, g.player.feet.z];
  for (const code of held) press("keydown", code);
  const samples = await window.__step(count, true);
  for (const code of held) press("keyup", code);
  return { samples, moved: Math.hypot(g.player.feet.x - start[0], g.player.feet.z - start[1]) };
}

function judge(samples) {
  const steps = samples.slice(1).map((s, i) => Math.abs(s.all - samples[i].all));
  const worst = steps.reduce((best, step, i) => (step > steps[best] ? i : best), 0);
  const lumas = samples.map((s) => s.all);
  const ground = samples.map((s) => s.ground);
  return { worst: steps[worst], at: worst, low: Math.min(...lumas), high: Math.max(...lumas), ground: ground.reduce((a, b) => a + b, 0) / ground.length };
}

const terrain = createTerrain(seed);
let server = null;
let base = values.url;
if (!base) {
  server = await serve([]);
  base = server.base;
}
const browser = await launchBrowser(values.browser);
const problems = [];
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !isKnownNoise(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(installClock, FRAME_WAIT_MS);
  await page.goto(`${base}/?debug&calm&quality=high&seed=${seed}`);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000, polling: 100 });
  await page.evaluate((n) => window.__step(n, false), 240);
  console.log(`keys ${keys.join("+")}, ${frames} frames, limit ${limit}`);
  console.log("realm   moved     brightness      ground   largest step  at frame");
  for (const name of chosen) {
    const spawn = findSpawn(terrain, REALMS.indexOf(name));
    await page.evaluate(
      async ([x, z, yaw, settle]) => {
        const g = window.__origami;
        g.player.place(x, z, yaw, 0.05);
        g.powers.reset();
        await window.__step(settle, false);
      },
      [spawn.x, spawn.z, spawn.yaw, SETTLE_FRAMES],
    );
    const { samples, moved } = await page.evaluate(walk, [frames, keys]);
    const r = judge(samples);
    const wanted = (speed * frames) / 60;
    const verdict = moved < wanted * 0.5 ? `moved too little, wanted ${wanted.toFixed(0)} m` : r.worst > limit ? "JUMPS" : "ok";
    if (verdict !== "ok") failures.push(`${name}: ${verdict}`);
    console.log(
      `${name.padEnd(7)} ${(moved.toFixed(1) + " m").padStart(7)}   ${r.low.toFixed(3)}..${r.high.toFixed(3)}   ${r.ground.toFixed(3)}    ${r.worst.toFixed(4)}        ${String(r.at).padStart(3)}      ${verdict}`,
    );
  }
} finally {
  await browser.close();
  server?.stop();
}
if (problems.length > 0) console.log(problems.join("\n"));
else console.log("no console errors or warnings");
if (failures.length > 0) console.log(`failed: ${failures.join("; ")}`);
process.exit(problems.length === 0 && failures.length === 0 ? 0 : 1);
