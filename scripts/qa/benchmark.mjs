#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

/**
 * Plays the real page through scripted phases and records the gap between animation frames in each.
 *
 *   node scripts/qa/benchmark.mjs [--sizes 1280x720,1920x1080] [--seconds 6] [--runs 3] [--base http://127.0.0.1:4173] [--out .work/bench.json]
 *     [--phases stand,walk] [--layers '^motes$'] [--quality high] [--shots .work/bench-shots]
 *
 * `--shots` saves a screenshot at the end of every phase, named by size and phase, so what each phase looked like can be
 * checked. A later run overwrites the file of an earlier one.
 *
 * `--layers` keeps only the layers whose names match a pattern, which shows how much of the frame time follows the splat
 * work. Give several patterns separated by `;` to compare them in one interleaved run. `all` keeps every layer and `^$`
 * hides every layer. `--phases` runs a subset of the phases.
 *
 * By default the page is held at full render resolution (`?quality=high`), so the governor cannot trade pixels for speed.
 * `--quality auto` lets the governor work as it does for a visitor, and `render w` shows the width it left after each phase.
 * Headless Chrome ticks at the display rate, so 60 fps is the ceiling and every frame that fits in 16.7 ms reads the
 * same. A frame that misses waits for the next tick, so the numbers show whether frames fit and not how much room is
 * left. Turning vsync off does not fix that. The main thread then runs ahead of the GPU and the gaps stop measuring
 * frame cost. `fps` is the frame count of the median whole second, so one stall does not drag it down, and `low 1s` is
 * the worst second. Runs are interleaved across sizes so that a change in machine load lands on every size alike.
 * `cost` is the time the main thread spends in the frame callback. It is not capped by the display rate. Pipelined, it
 * is only the time to issue the GL commands. With `--drain` the callback ends in a 1x1 `readPixels`, which waits for
 * the GPU, so the cost is the issue time plus the GPU time of that frame and shows how much room a frame leaves. Frame
 * gaps and fps from a drained run are not comparable with an ordinary run, because the page can no longer work ahead.
 * A GPU timer query (`EXT_disjoint_timer_query_webgl2`) was tried first and dropped. Here it read 19 ms for an empty scene and
 * more for the ground alone than for every layer, so it did not measure the work.
 * Before each run an empty WebGL clear loop of the same size measures the noise floor of the harness on this machine.
 * Each phase also reports how far the walker moved and the mean luma of the canvas, so a phase that did nothing shows.
 * Every phase starts from the pose the walker had when the world finished loading, so every size and every run sees the
 * same view and a phase does not inherit where the one before it ended.
 */
const { values } = parseArgs({
  options: {
    sizes: { type: "string", default: "1920x1080" },
    seconds: { type: "string", default: "6" },
    runs: { type: "string", default: "1" },
    base: { type: "string", default: "http://127.0.0.1:4173" },
    out: { type: "string", default: ".work/bench.json" },
    phases: { type: "string" },
    layers: { type: "string" },
    quality: { type: "string", default: "high" },
    shots: { type: "string" },
    drain: { type: "boolean", default: false },
  },
});
const sizes = values.sizes.split(",").map((s) => s.split("x").map(Number));
const seconds = Number(values.seconds);
const runs = Number(values.runs);
const SLOW_MS = 25;

const hold = async (page, keys, s) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(s * 1000);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
};
const power = (key) => ({
  run: (page) => page.keyboard.press(key).then(() => page.waitForTimeout(seconds * 1000)),
  settle: (page) => page.keyboard.press(key).then(() => page.waitForTimeout(2500)),
});
const PHASES = [
  { name: "stand", run: (page) => page.waitForTimeout(seconds * 1000), settle: () => {} },
  { name: "walk", run: (page) => hold(page, ["w"], seconds), settle: () => {} },
  { name: "run", run: (page) => hold(page, ["Shift", "w"], seconds), settle: () => {} },
  {
    name: "fly",
    run: async (page) => {
      await page.keyboard.press("f");
      await hold(page, ["Space"], 1.2);
      await hold(page, ["Shift", "w"], seconds - 1.2);
    },
    settle: (page) => page.keyboard.press("f"),
  },
  { name: "planet", ...power("1") },
  { name: "twist", ...power("2") },
  { name: "fold", ...power("3") },
];

const layerSets = values.layers === undefined ? [undefined] : values.layers.split(";");
const wanted = values.phases?.split(",");
const ACTIVE = PHASES.filter((p) => !wanted || wanted.includes(p.name));

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Frames that finished in each whole second of the phase. A single long stall costs one second, not the whole figure. */
function framesPerSecond(gaps) {
  const counts = [];
  let t = 0;
  for (const gap of gaps) {
    t += gap;
    const second = Math.floor(t / 1000);
    counts[second] = (counts[second] ?? 0) + 1;
  }
  counts.pop();
  return Array.from(counts, (c) => c ?? 0);
}

function summarise(gaps) {
  if (gaps.length === 0) throw new Error("a phase recorded no frames");
  const perSecond = framesPerSecond(gaps);
  if (perSecond.length === 0) throw new Error("a phase lasted less than one second");
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    frames: gaps.length,
    fps: median(perSecond),
    worstSecond: Math.min(...perSecond),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1],
    slowPct: (100 * gaps.filter((g) => g >= SLOW_MS).length) / gaps.length,
  };
}

async function noiseFloor(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent('<canvas id="c"></canvas>');
  const { gaps, cost } = await page.evaluate(
    ([w, h, s, drain]) =>
      new Promise((resolve) => {
        const canvas = document.getElementById("c");
        canvas.width = w;
        canvas.height = h;
        canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%";
        const gl = canvas.getContext("webgl2");
        const pixel = new Uint8Array(4);
        const gaps = [];
        const cost = [];
        let last = 0;
        let hue = 0;
        const tick = (t) => {
          if (last) gaps.push(t - last);
          last = t;
          const start = performance.now();
          hue = (hue + 0.01) % 1;
          gl.clearColor(hue, 0.3, 0.5, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          if (drain) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          cost.push(performance.now() - start);
          if (t < s * 1000) requestAnimationFrame(tick);
          else resolve({ gaps, cost });
        };
        requestAnimationFrame(tick);
      }),
    [width, height, 4, values.drain],
  );
  await page.close();
  const sorted = cost.slice(5).sort((a, b) => a - b);
  return { ...summarise(gaps.slice(5)), costP50: percentile(sorted, 0.5), costP95: percentile(sorted, 0.95) };
}

async function oneRun(browser, [width, height], layers) {
  const floor = await noiseFloor(browser, width, height);
  const page = await browser.newPage({ viewport: { width, height } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && problems.push(m.text().slice(0, 300)));
  await page.addInitScript((drain) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__gaps = [];
    window.__cost = [];
    let last = 0;
    const tick = (t) => {
      if (last) window.__gaps.push(t - last);
      last = t;
      raf(tick);
    };
    raf(tick);

    const pixel = new Uint8Array(4);
    window.requestAnimationFrame = (callback) =>
      raf((t) => {
        const gl = window.__origami?.world.stage.renderer.getContext();
        if (!gl) return callback(t);
        const start = performance.now();
        try {
          return callback(t);
        } finally {
          if (drain) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          window.__cost.push(performance.now() - start);
        }
      });
  }, values.drain);
  await page.goto(`${values.base}/?debug&quality=${values.quality}&seed=1`);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
  await page.waitForTimeout(8000);

  const facts = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const g = window.__origami;
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown", splats: g.world.splatCount, render: [g.world.post.width, g.world.post.height] };
  });

  if (layers !== undefined && layers !== "all") {
    await page.evaluate((pattern) => {
      const re = new RegExp(pattern);
      for (const layer of window.__origami.world.layers) layer.visible = re.test(layer.name);
    }, layers);
    await page.waitForTimeout(1500);
  }

  const pose = await page.evaluate(() => {
    const p = window.__origami.player;
    return { x: p.feet.x, z: p.feet.z, yaw: p.yaw, pitch: p.pitch };
  });

  const result = { ...facts, floor, phases: {} };
  for (const phase of ACTIVE) {
    await page.evaluate((p) => window.__origami.player.place(p.x, p.z, p.yaw, p.pitch), pose);
    await page.waitForTimeout(2000);
    const before = await page.evaluate(() => ({
      n: window.__gaps.length,
      c: window.__cost.length,
      x: window.__origami.player.feet.x,
      z: window.__origami.player.feet.z,
    }));
    await phase.run(page);
    const after = await page.evaluate(() => {
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 36;
      const ctx = small.getContext("2d");
      ctx.drawImage(document.getElementById("stage"), 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const f = window.__origami.player.feet;
      return {
        gaps: window.__gaps.slice(),
        cost: window.__cost.slice(),
        luma: sum / (64 * 36 * 255),
        x: f.x,
        z: f.z,
        renderWidth: window.__origami.world.post.width,
      };
    });
    const cost = after.cost.slice(before.c).sort((a, b) => a - b);
    result.phases[phase.name] = {
      ...summarise(after.gaps.slice(before.n)),
      costP50: percentile(cost, 0.5),
      costP95: percentile(cost, 0.95),
      movedM: Math.hypot(after.x - before.x, after.z - before.z),
      luma: after.luma,
      renderWidth: after.renderWidth,
    };
    if (values.shots) await page.screenshot({ path: join(values.shots, `${width}x${height}-${phase.name}.png`) });
    await phase.settle(page);
  }
  result.problems = [...new Set(problems)];
  await page.close();
  return result;
}

if (values.shots) await mkdir(values.shots, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});
const report = { when: new Date().toISOString(), chrome: browser.version(), cores: cpus().length, loadBefore: loadavg(), seconds, runs, drain: values.drain, layers: layerSets, bySize: {} };
for (let i = 0; i < runs; i++) {
  for (const size of sizes) {
    for (const layers of layerSets) {
      const key = size.join("x") + (layers === undefined ? "" : ` layers ${layers}`);
      (report.bySize[key] ??= []).push(await oneRun(browser, size, layers));
      console.log(`run ${i + 1}/${runs} at ${key} done, load ${loadavg().map((x) => x.toFixed(0)).join(" ")}`);
    }
  }
}
report.loadAfter = loadavg();
await browser.close();
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(report, null, 1));

const first = Object.values(report.bySize)[0][0];
console.log(`\n${first.gpu}, Chrome ${report.chrome}, ${first.splats} splats`);
console.log(`load average ${report.loadBefore.map((x) => x.toFixed(0)).join(" ")} before, ${report.loadAfter.map((x) => x.toFixed(0)).join(" ")} after, ${report.cores} cores, ${runs} run(s) per size, ${seconds} s per phase`);
if (values.drain) console.log("drained: every frame waits for the GPU, so fps and frame gaps below are not comparable with an ordinary run");
const cell = (n, w = 6) => n.toFixed(1).padStart(w);
const LEAD = 38;
const HEADER =
  "phase     fps med (min-max)".padEnd(LEAD) +
  ["low 1s", "p50", "p95", "p99", "max"].map((h) => h.padStart(6)).join(" ") +
  "  slow %" +
  "  cost p50  cost p95" +
  "  moved m  luma  render w";

/**
 * One table line for a phase, from the summaries of every run. fps is frames in a typical second, low 1s the worst second.
 * The cost columns are the median over runs of each run's 50th and 95th percentile callback time in ms.
 */
function row(label, runs) {
  const med = (pick) => median(runs.map(pick));
  const fps = runs.map((r) => r.fps);
  const lead = `${label.padEnd(8)}  ${cell(med((r) => r.fps))} (${Math.min(...fps).toFixed(1)}-${Math.max(...fps).toFixed(1)})`.padEnd(LEAD);
  const stats = [(r) => r.worstSecond, (r) => r.p50, (r) => r.p95, (r) => r.p99, (r) => r.maxMs].map((pick) => cell(med(pick))).join(" ");
  const slow = `  ${cell(med((r) => r.slowPct))}`;
  const costs = `  ${cell(med((r) => r.costP50), 8)}  ${cell(med((r) => r.costP95), 8)}`;
  if (runs[0].luma === undefined) return lead + stats + slow + costs;
  const played = `  ${cell(med((r) => r.movedM), 7)}  ${med((r) => r.luma).toFixed(2)}  ${med((r) => r.renderWidth).toFixed(0).padStart(8)}`;
  return lead + stats + slow + costs + played;
}

for (const [key, rows] of Object.entries(report.bySize)) {
  console.log(`\n${key} (render ${rows[0].render.join("x")})`);
  console.log(HEADER);
  console.log(row("floor", rows.map((r) => r.floor)));
  for (const { name } of ACTIVE) console.log(row(name, rows.map((r) => r.phases[name])));
}
const problems = [...new Set(Object.values(report.bySize).flat().flatMap((r) => r.problems))];
console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n${problems.join("\n")}` : "\nno console errors or warnings");
console.log(`wrote ${values.out}`);
if (problems.length) process.exit(1);
