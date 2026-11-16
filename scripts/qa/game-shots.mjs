#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser, isKnownNoise } from "./browsers.mjs";
import { serve } from "./serve.mjs";
import { findSpawn } from "../../src/play/spawn.ts";
import { createTerrain } from "../../src/world/cpu/terrain.ts";
import { REALM_LOOKS } from "../../src/world/realms.ts";
import { wondersNear } from "../../src/world/wonders.ts";

/**
 * Photographs the live game, which is what a player sees. The lab bench skips the governor, the camera feel and the
 * fold powers, so a lab still can look right while the game does not.
 *
 *   node scripts/qa/game-shots.mjs [--out .work/shots] [--only dunes-walk,ember-high] [--size 1280x720] [--seed 1]
 *     [--time 40] [--url http://127.0.0.1:4173] [--browser chrome|firefox|webkit] [--list]
 *
 * Without `--url` the script serves the source with Vite on a spare port and stops it when it ends. With `--url` it
 * photographs a build that is already served. Every pose has a fixed place, heading and clock, with the HUD hidden and
 * the render scale held at full, so two runs of the same code give the same frames. `index.json` in the output folder
 * lists a short hash per frame, which tells at a glance which poses a change touched.
 */
const { values } = parseArgs({
  options: {
    out: { type: "string", default: ".work/shots" },
    only: { type: "string" },
    size: { type: "string", default: "1280x720" },
    seed: { type: "string", default: "1" },
    time: { type: "string", default: "40" },
    url: { type: "string" },
    browser: { type: "string", default: "chrome" },
    list: { type: "boolean", default: false },
  },
});
const seed = Number(values.seed);
const [width, height] = values.size.split("x").map(Number);
const REALMS = ["dunes", "prism", "deep", "flats", "ember"];

/** Where the camera stands for each photograph. Angles are radians, `agl` lifts the flyer above the ground. */
function poses() {
  const terrain = createTerrain(seed);
  const out = [];
  const spawns = REALMS.map((_, r) => findSpawn(terrain, r));
  REALMS.forEach((name, r) => {
    const s = spawns[r];
    out.push({ name: `${name}-walk`, x: s.x, z: s.z, yaw: s.yaw, pitch: 0.04 });
    out.push({ name: `${name}-high`, x: s.x, z: s.z, yaw: s.yaw + 0.8, pitch: -0.22, agl: 70 });
    const sun = REALM_LOOKS[r].atmosphere.sunDir;
    out.push({ name: `${name}-sun`, x: s.x, z: s.z, yaw: Math.atan2(-sun.x, -sun.z), pitch: Math.max(Math.asin(sun.y) * 0.6, 0.02) });
  });
  for (const r of [0, 2]) {
    const s = spawns[r];
    const w = wondersNear(terrain, s.x, s.z, 6000).find((o) => terrain.realmAt(o.x, o.z).a === r);
    if (!w) continue;
    const d = 1.3 * w.size;
    const x = w.x + Math.sin(0.6) * d;
    const z = w.z + Math.cos(0.6) * d;
    const yaw = Math.atan2(w.x - x, w.z - z) + Math.PI;
    const pitch = Math.atan2(0.45 * w.size - 10, d);
    out.push({ name: `${REALMS[r]}-wonder-${w.kind}`, x, z, yaw, pitch, agl: 10 });
  }
  out.push({ name: "dunes-planet", x: spawns[0].x, z: spawns[0].z, yaw: spawns[0].yaw, pitch: -0.1, agl: 40, powers: ["planet"], settle: 6000 });
  out.push({ name: "ember-twist", x: spawns[4].x, z: spawns[4].z, yaw: spawns[4].yaw, pitch: 0.05, powers: ["corkscrew", "hinge"], settle: 6000 });
  return out;
}

const all = poses();
if (values.list) {
  for (const p of all) console.log(p.name.padEnd(24), `x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} yaw ${p.yaw.toFixed(2)} pitch ${p.pitch.toFixed(2)} agl ${p.agl ?? 0}`);
  process.exit(0);
}
const wanted = values.only?.split(",");
const chosen = wanted ? all.filter((p) => wanted.includes(p.name)) : all;
if (chosen.length === 0) {
  console.error(`no pose matches ${values.only}. Names: ${all.map((p) => p.name).join(", ")}`);
  process.exit(2);
}

let server = null;
let base = values.url;
if (!base) {
  server = await serve([]);
  base = server.base;
}

const browser = await launchBrowser(values.browser);
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !isKnownNoise(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/?debug&quality=high&seed=${seed}`);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
  await page.waitForTimeout(9000);
  await page.addStyleTag({ content: "#hud { display: none !important; }" });
  await mkdir(values.out, { recursive: true });
  const index = {};
  for (const pose of chosen) {
    await page.evaluate(
      ({ pose, time }) => {
        const g = window.__origami;
        g.frozen = true;
        g.time = time;
        g.powers.reset();
        g.player.place(pose.x, pose.z, pose.yaw, pose.pitch);
        if (pose.agl) {
          g.player.toggleFly();
          g.player.feet.y += pose.agl;
        }
        for (const p of pose.powers ?? []) g.powers.toggle(p);
      },
      { pose, time: Number(values.time) },
    );
    await page.waitForTimeout(pose.settle ?? 3000);
    const file = join(values.out, `${pose.name}.png`);
    const png = await page.screenshot({ path: file });
    index[pose.name] = createHash("sha256").update(png).digest("hex").slice(0, 10);
    console.log(pose.name.padEnd(24), index[pose.name], file);
  }
  const previous = await readFile(join(values.out, "index.json"), "utf8").then(JSON.parse, () => ({}));
  await writeFile(join(values.out, "index.json"), JSON.stringify({ ...previous, ...index }, null, 2));
} finally {
  await browser.close();
  server?.stop();
}
console.log(problems.length === 0 ? "no console errors or warnings" : problems.join("\n"));
process.exit(problems.length === 0 ? 0 : 1);
