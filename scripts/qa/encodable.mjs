#!/usr/bin/env node
import { parseArgs } from "node:util";
import { launchBrowser } from "./browsers.mjs";
import { serve } from "./serve.mjs";
import { findSpawn } from "../../src/play/spawn.ts";
import { createTerrain } from "../../src/world/cpu/terrain.ts";

/**
 * Checks the shape of every splat the layers hand to Spark. Spark packs each splat's covariance with the
 * correlation of every pair of axes stored as the log of its magnitude in a half float. A correlation within
 * 6e-5 of 1 needs a subnormal half, and a GPU that flushes those (Firefox on a Mac does) reads it back as 0,
 * which turns a long thin splat into a fat blob. `keepEncodable` in `entry.glsl` keeps every splat clear of
 * that limit. This script runs each layer's generator for every splat slot, with the view cull off, and fails
 * when a live splat is closer than 1e-4 to a correlation of 1, or has no finite shape.
 *
 *   node scripts/qa/encodable.mjs [--browser chrome|firefox|webkit] [--seed 1] [--only ember-fold]
 *
 * The script serves the source with Vite on a spare port, because it loads modules from it. It stands at each
 * realm's spawn, then at the Ember spawn under every combination of the three fold powers.
 */
const { values } = parseArgs({
  options: {
    browser: { type: "string", default: "chrome" },
    seed: { type: "string", default: "1" },
    only: { type: "string" },
  },
});
const seed = Number(values.seed);
/** The smallest 1 - |correlation| a splat may leave with. The half-float limit is 6.1e-5 and the floor aims for 2e-4. */
const LIMIT = 1e-4;
const REALMS = ["dunes", "prism", "deep", "flats", "ember"];
const POWERS = ["planet", "corkscrew", "hinge"];

const terrain = createTerrain(seed);
const scenarios = REALMS.map((name, realm) => ({ name, realm, powers: [] }));
for (let mask = 1; mask < 8; mask++) {
  const powers = POWERS.filter((_, i) => mask & (1 << i));
  scenarios.push({ name: `ember-${powers.join("+")}`, realm: 4, powers });
}
const chosen = values.only ? scenarios.filter((s) => values.only.split(",").includes(s.name)) : scenarios;
if (chosen.length === 0) {
  console.error(`no scenario matches ${values.only}. Names: ${scenarios.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const server = await serve([]);
const browser = await launchBrowser(values.browser);
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => {
    console.error("page error:", e.message);
    failed = true;
  });
  await page.goto(`${server.base}/?debug&quality=high&seed=${seed}`);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
  await page.waitForTimeout(9000);
  console.log(`browser ${values.browser}, limit 1 - |correlation| >= ${LIMIT}`);
  for (const scenario of chosen) {
    const spawn = findSpawn(terrain, scenario.realm);
    await page.evaluate(
      ([spawn, powers]) => {
        const g = window.__origami;
        g.frozen = true;
        g.time = 40;
        g.world.cullEnabled = false;
        g.powers.reset();
        g.player.place(spawn.x, spawn.z, spawn.yaw, 0.05);
        for (const power of powers) g.powers.toggle(power);
      },
      [spawn, scenario.powers],
    );
    await page.waitForTimeout(scenario.powers.length > 0 ? 6500 : 3500);
    const layers = await page.evaluate(runEveryLayer, LIMIT);
    const live = layers.reduce((a, l) => a + l.live, 0);
    const thin = layers.reduce((a, l) => a + l.thin, 0);
    const broken = layers.reduce((a, l) => a + l.broken, 0);
    const worst = layers.reduce((a, l) => Math.min(a, l.gap), 1);
    const bad = thin + broken > 0;
    failed ||= bad;
    console.log(`${bad ? "FAIL" : "ok  "} ${scenario.name.padEnd(26)} live ${String(live).padStart(8)}  too thin ${thin}  not finite ${broken}  smallest gap ${worst.toExponential(2)}`);
    if (bad) for (const l of layers) if (l.thin + l.broken > 0) console.log(`       ${l.name}: ${l.thin} too thin, ${l.broken} not finite`);
  }
} finally {
  await browser.close();
  server.stop();
}
process.exit(failed ? 1 : 0);

/** Runs in the page. Renders `runLayer` for every slot of every layer into a float texture and counts what it finds. */
async function runEveryLayer(limit) {
  const g = window.__origami;
  const { FullscreenPass } = await import("/src/core/render/fullscreen.ts");
  const { COMMON_GLSL, DEFORM_GLSL, LAYER_GLSL, WORLD_GLSL } = await import("/src/world/uniforms.ts");
  const entry = (await import("/src/world/glsl/entry.glsl?raw")).default;
  const light = (await import("/src/world/glsl/light.glsl?raw")).default;
  const surfel = (await import("/src/world/glsl/surfel.glsl?raw")).default;
  const renderer = g.world.stage.renderer;
  const world = g.world.uniforms.world.value;
  const deform = g.world.uniforms.deform.value;
  const Target = g.world.ground.fields[0].target.constructor;
  const WIDTH = 2048;
  const FLOAT = 1015;
  const RGBA = 1023;
  const NEAREST = 1003;
  const out = [];
  for (const layer of g.world.layers) {
    const count = layer.source.count;
    const rows = Math.ceil(count / WIDTH);
    const frag = `
precision highp float;
precision highp int;
precision highp sampler2D;
struct CovSplat { vec3 center; uint flags; vec4 rgba; vec3 xxyyzz; int index; vec3 xyxzyz; };
const uint GSPLAT_FLAG_ACTIVE = 1u << 0u;
${WORLD_GLSL}
${COMMON_GLSL}
${DEFORM_GLSL}
${surfel}
${light}
${LAYER_GLSL}
${(layer.source.libs ?? []).join("\n")}
${layer.source.glsl}
${entry}
uniform WorldParams world;
uniform DeformParams deform;
uniform LayerParams layer;
uniform sampler2D field;
out vec4 fragColor;
void main() {
  int index = int(gl_FragCoord.y) * ${WIDTH} + int(gl_FragCoord.x);
  fragColor = vec4(0.0);
  if (index >= ${count}) return;
  CovSplat o = runLayer(index, world, deform, layer, field);
  if ((o.flags & GSPLAT_FLAG_ACTIVE) == 0u || o.rgba.a <= 0.002) return;
  vec3 v = o.xxyyzz;
  vec3 c = vec3(o.xyxzyz.x * inversesqrt(v.x * v.y), o.xyxzyz.y * inversesqrt(v.x * v.z), o.xyxzyz.z * inversesqrt(v.y * v.z));
  fragColor = vec4(1.0, 1.0 - max(abs(c.x), max(abs(c.y), abs(c.z))), 0.0, 0.0);
}`;
    const pass = new FullscreenPass(frag, {
      world: { value: world },
      deform: { value: deform },
      layer: { value: layer.params },
      field: { value: layer.field ?? deform.curveTexA },
    });
    const target = new Target(WIDTH, rows, { type: FLOAT, format: RGBA, minFilter: NEAREST, magFilter: NEAREST, depthBuffer: false });
    pass.render(renderer, target);
    const px = new Float32Array(WIDTH * rows * 4);
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, rows, px);
    let live = 0;
    let thin = 0;
    let broken = 0;
    let gap = 1;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === 0) continue;
      live++;
      const d = px[i + 1];
      if (!Number.isFinite(d)) broken++;
      else {
        if (d < limit) thin++;
        if (d < gap) gap = d;
      }
    }
    out.push({ name: layer.name, live, thin, broken, gap });
    target.dispose();
    pass.dispose();
  }
  return out;
}
