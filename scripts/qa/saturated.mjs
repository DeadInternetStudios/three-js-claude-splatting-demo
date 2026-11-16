#!/usr/bin/env node
import { loadavg } from "node:os";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { serve } from "./serve.mjs";
import { findSpawn } from "../../src/play/spawn.ts";
import { createTerrain } from "../../src/world/cpu/terrain.ts";

/**
 * What one part of the pipeline costs, measured with the GPU saturated and the states flipped inside a single run.
 *
 *   node scripts/qa/saturated.mjs layers|cull|detail|idle [--size 1920x1080] [--realm 0] [--yaw 0] [--pitch 0.04]
 *     [--agl 0] [--level 0] [--rounds 5] [--per 40] [--skip 14] [--boot 9000] [--paced] [--url http://127.0.0.1:4173]
 *
 *   layers  hides each splat layer in turn and prints what the frame saves, at ground detail `--level`
 *   cull    turns the view cull off and prints what the frame loses
 *   detail  sets each level of ground detail in turn and prints what the frame saves against level 0
 *   idle    adds a layer of 1, 2 and 4 million slots that all decline, and prints what the frame loses
 *
 * Chrome runs with vsync and the frame limit off, and every frame callback ends with a 1x1 `readPixels` that waits for
 * the GPU. On a display-paced run this machine's GPU seems to clock itself to the load, so a frame costs about the
 * same whatever it holds and a part that is removed seems to save little (`docs/BENCHMARKS.md`). With the pacing gone
 * the GPU never idles and the costs add up. `--paced` keeps vsync and the frame limit on, to show the difference.
 *
 * The run alternates a control state with each test state, `per` frames each, and drops the first `skip` frames of
 * every window while the state settles. A saving is the median of the window minus the mean of the two control
 * windows around it, and the table gives the median over rounds with their range. Slow drift in the machine's load
 * lands on the control and the test alike. Without `--url` the script serves the source with Vite on a spare port.
 * It prints the one minute load average before and after, and any console errors. A negative pitch needs an equals
 * sign, as in `--pitch=-0.22`.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: "string", default: "1920x1080" },
    realm: { type: "string", default: "0" },
    yaw: { type: "string", default: "0" },
    pitch: { type: "string", default: "0.04" },
    agl: { type: "string", default: "0" },
    level: { type: "string", default: "0" },
    rounds: { type: "string", default: "5" },
    per: { type: "string", default: "40" },
    skip: { type: "string", default: "14" },
    boot: { type: "string", default: "9000" },
    paced: { type: "boolean", default: false },
    url: { type: "string" },
  },
});
const mode = positionals[0];
if (!["layers", "cull", "detail", "idle"].includes(mode)) {
  console.error("usage: saturated.mjs layers|cull|detail [--size 1920x1080] [--realm 0] [--yaw 0] [--pitch 0.04] [--agl 0] [--level 0] [--rounds 5]");
  process.exit(2);
}
const [width, height] = values.size.split("x").map(Number);
const spawnAt = findSpawn(createTerrain(1), Number(values.realm));

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

/** Runs in the page before anything else. Times each frame and flips the state by frame count. */
const ababInit = () => {
  window.__abab = null;
  const pixel = new Uint8Array(4);
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((t) => {
      const gl = window.__origami?.world.stage.renderer.getContext();
      if (!gl) return callback(t);
      const run = window.__abab;
      let slot = -1;
      if (run && !run.done) {
        const frame = run.frame++;
        const index = Math.floor(frame / run.per);
        if (index >= run.order.length) run.done = true;
        else {
          if (frame % run.per === 0) run.apply(run.order[index]);
          if (frame % run.per >= run.skip) slot = index;
        }
      }
      const start = performance.now();
      try {
        return callback(t);
      } finally {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (slot >= 0) run.samples[slot].push(performance.now() - start);
      }
    });
};

/**
 * `states` maps a name to the code that sets it and `control` is the code for the reference. Returns the median frame
 * cost of the control and, per state, the saving against the control windows on either side of each test window.
 */
async function alternate(page, { control, states }) {
  const names = Object.keys(states);
  const order = [];
  for (let round = 0; round < Number(values.rounds); round++) {
    for (const name of names) order.push("control", name);
    order.push("control");
  }
  await page.evaluate(
    ({ order, per, skip, control, states }) => {
      const run = (code) => (0, eval)(`(() => { ${code} })()`);
      window.__abab = { order, per, skip, frame: 0, done: false, samples: order.map(() => []), apply: (name) => run(name === "control" ? control : states[name]) };
    },
    { order, per: Number(values.per), skip: Number(values.skip), control, states },
  );
  await page.waitForFunction(() => window.__abab.done, null, { timeout: 900_000, polling: 500 });
  const costs = (await page.evaluate(() => window.__abab.samples)).map(median);
  const saving = Object.fromEntries(names.map((name) => [name, []]));
  const controls = [];
  order.forEach((name, i) => {
    if (name === "control") controls.push(costs[i]);
    else saving[name].push((costs[i - 1] + costs[i + 1]) / 2 - costs[i]);
  });
  await page.evaluate((code) => (0, eval)(`(() => { ${code} })()`), control);
  return { control: median(controls), saving };
}

const row = (name, list) => `${name.padEnd(14)} ${median(list).toFixed(2).padStart(6)} ms   range ${Math.min(...list).toFixed(2)} to ${Math.max(...list).toFixed(2)}`;

const problems = new Set();
const server = values.url ? null : await serve([]);
const base = values.url ?? server.base;
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", ...(values.paced ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"])],
});
console.log(`load average before ${loadavg()[0].toFixed(0)}`);
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => problems.add(`pageerror: ${e.message}`));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.add(`${m.type()}: ${m.text().slice(0, 200)}`));
  await page.addInitScript(ababInit);
  await page.goto(`${base}/?debug&quality=high&seed=1`);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
  await page.waitForTimeout(Number(values.boot));
  await page.addStyleTag({ content: "#hud { display: none !important; }" });
  await page.evaluate(
    ({ x, z, yaw, pitch, agl }) => {
      const game = window.__origami;
      game.frozen = true;
      game.time = 40;
      game.powers.reset();
      game.player.place(x, z, yaw, pitch);
      if (agl) {
        game.player.toggleFly();
        game.player.feet.y += agl;
      }
    },
    { x: spawnAt.x, z: spawnAt.z, yaw: spawnAt.yaw + Number(values.yaw), pitch: Number(values.pitch), agl: Number(values.agl) },
  );
  await page.evaluate((level) => window.__origami.world.ground.setDetail(level), Number(values.level));
  await page.waitForTimeout(2500);
  const drawn = await page.evaluate(() => window.__origami.world.stage.spark.activeSplats);
  const where = `${values.size} realm ${values.realm} yaw ${values.yaw} pitch ${values.pitch} agl ${values.agl} level ${values.level}`;

  if (mode === "layers") {
    const names = await page.evaluate(() => window.__origami.world.layers.filter((l) => l.visible).map((l) => l.name));
    await page.evaluate((list) => (window.__visible = list), names);
    const setVisible = (except) => `for (const l of window.__origami.world.layers) l.visible = window.__visible.includes(l.name) && l.name !== ${JSON.stringify(except)};`;
    const { control, saving } = await alternate(page, { control: setVisible(""), states: Object.fromEntries(names.map((n) => [n, setVisible(n)])) });
    console.log(`${where}: ${drawn.toLocaleString("en")} splats drawn, every layer costs ${control.toFixed(2)} ms. Hiding a layer saves`);
    const rows = Object.entries(saving).sort((a, b) => median(b[1]) - median(a[1]));
    for (const [name, list] of rows) console.log(row(name, list));
    console.log(`sum            ${rows.reduce((sum, [, list]) => sum + median(list), 0).toFixed(2).padStart(6)} ms`);
  } else if (mode === "cull") {
    const { control, saving } = await alternate(page, { control: "window.__origami.world.cullEnabled = true;", states: { off: "window.__origami.world.cullEnabled = false;" } });
    console.log(`${where}: with the cull on the frame costs ${control.toFixed(2)} ms. Turning it off adds`);
    console.log(row("cull off", saving.off.map((s) => -s)));
  } else if (mode === "idle") {
    await page.evaluate(() => {
      const world = window.__origami.world;
      const model = world.layers.find((l) => l.name === "beasts");
      window.__idle = {};
      for (const millions of [1, 2, 4]) {
        const glsl = "bool layerGen(int index, sampler2D field, out Surfel s) { return false; }";
        const layer = new model.constructor({ name: `idle${millions}`, count: millions * 1_000_000, glsl }, world.uniforms);
        layer.visible = false;
        world.stage.scene.add(layer);
        window.__idle[millions] = layer;
      }
    });
    await page.waitForTimeout(1000);
    const only = (millions) => `for (const k of [1, 2, 4]) window.__idle[k].visible = k === ${millions};`;
    const { control, saving } = await alternate(page, { control: only(0), states: { "1 M slots": only(1), "2 M slots": only(2), "4 M slots": only(4) } });
    console.log(`${where}: the frame costs ${control.toFixed(2)} ms. Layers whose slots all decline add`);
    for (const [name, list] of Object.entries(saving)) console.log(row(name, list.map((s) => -s)));
  } else {
    const levels = [1, 2, 3];
    const { control, saving } = await alternate(page, {
      control: "window.__origami.world.ground.setDetail(0);",
      states: Object.fromEntries(levels.map((l) => [`level ${l}`, `window.__origami.world.ground.setDetail(${l});`])),
    });
    console.log(`${where}: at level 0 the frame costs ${control.toFixed(2)} ms. A coarser level saves`);
    for (const [name, list] of Object.entries(saving)) console.log(row(name, list));
  }
} finally {
  await browser.close();
  server?.stop();
  console.log(`load average after ${loadavg()[0].toFixed(0)}`);
  console.log(problems.size ? `PROBLEMS\n${[...problems].join("\n")}` : "no console errors or warnings");
}
