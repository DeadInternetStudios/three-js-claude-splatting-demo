#!/usr/bin/env node
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { serve } from "./serve.mjs";
import { findSpawn } from "../../src/play/spawn.ts";
import { createTerrain, REALM_NAMES } from "../../src/world/cpu/terrain.ts";

/**
 * Counts the splats a frame really draws. A layer owns a fixed number of splat slots and declines the
 * ones that are out of range, so the slot count is an upper bound. Spark reports how many splats
 * survive as `activeSplats`, the instance count of the draw call.
 *
 *   node scripts/qa/splat-census.mjs [--base http://127.0.0.1:4173] [--seed 1] [--size 1280x720]
 *
 * Without `--base` the script serves the source with Vite on a spare port and stops it when it ends.
 *
 * For each realm the walker stands at that realm's spawn and the script reads the total. It then hides
 * every layer family but one, in turn, to see where the drawn splats come from.
 */
const { values } = parseArgs({
  options: {
    base: { type: "string" },
    seed: { type: "string", default: "1" },
    size: { type: "string", default: "1280x720" },
  },
});
const seed = Number(values.seed);
const [width, height] = values.size.split("x").map(Number);
const terrain = createTerrain(seed);

const server = values.base ? null : await serve([]);
const base = values.base ?? server.base;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
page.on("console", (m) => m.type() === "error" && problems.push(m.text().slice(0, 300)));
await page.goto(`${base}/?debug&quality=high&seed=${seed}`);
await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
await page.waitForTimeout(9000);

const FAMILIES = {
  ground: /^ground/,
  flora: /^flora/,
  wonders: /^wonders$/,
  motes: /^motes$/,
  flocks: /^flocks$/,
  beasts: /^beasts$/,
  blooms: /^blooms$/,
};

const read = () =>
  page.evaluate(() => {
    const g = window.__origami;
    return { active: g.world.stage.spark.activeSplats };
  });
const settle = async () => {
  await page.waitForTimeout(1800);
  const a = await read();
  await page.waitForTimeout(400);
  const b = await read();
  return Math.round((a.active + b.active) / 2);
};
const only = (family) =>
  page.evaluate(
    ([name, pattern]) => {
      const re = new RegExp(pattern);
      for (const layer of window.__origami.world.layers) layer.visible = name === null || re.test(layer.name);
    },
    [family, family === null ? "" : FAMILIES[family].source],
  );

const slots = await page.evaluate(() => {
  const out = {};
  for (const l of window.__origami.world.layers) out[l.name] = l.numSplats;
  return out;
});
const slotTotal = Object.values(slots).reduce((a, b) => a + b, 0);
const slotsOf = (family) => Object.entries(slots).filter(([n]) => FAMILIES[family].test(n)).reduce((a, [, v]) => a + v, 0);

const rows = [];
for (const [realm, name] of REALM_NAMES.entries()) {
  const spawn = findSpawn(terrain, realm);
  await only(null);
  await page.evaluate(([x, z, yaw]) => window.__origami.player.place(x, z, yaw), [spawn.x, spawn.z, spawn.yaw]);
  await page.waitForTimeout(2500);
  const row = { realm: name, total: await settle(), family: {} };
  for (const family of Object.keys(FAMILIES)) {
    await only(family);
    row.family[family] = await settle();
  }
  await only(null);
  rows.push(row);
  console.log(`${name.padEnd(14)} total ${String(row.total).padStart(8)}  ` + Object.entries(row.family).map(([k, v]) => `${k} ${v}`).join("  "));
}
await browser.close();
server?.stop();

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (n, d) => ((100 * n) / d).toFixed(0).padStart(3);
console.log(`\nslots ${slotTotal}, drawn at the five spawns: ${rows.map((r) => r.total).join(", ")} (median ${median(rows.map((r) => r.total))}, ${pct(median(rows.map((r) => r.total)), slotTotal)} % of slots)`);
console.log("family     slots     drawn (median over realms)   share of its slots");
for (const family of Object.keys(FAMILIES)) {
  const drawn = median(rows.map((r) => r.family[family]));
  console.log(`${family.padEnd(9)} ${String(slotsOf(family)).padStart(8)} ${String(drawn).padStart(10)}                      ${pct(drawn, slotsOf(family))} %`);
}
console.log(problems.length ? `\nPROBLEMS:\n${[...new Set(problems)].join("\n")}` : "\nno console errors");
if (problems.length) process.exit(1);
