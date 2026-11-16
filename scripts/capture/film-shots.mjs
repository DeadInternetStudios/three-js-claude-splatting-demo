#!/usr/bin/env node
// Renders stills of the film at chosen times, for checking the choreography without a full render.
//
//   node scripts/capture/film-shots.mjs --out .work/shots/film --times 1,5,10 \
//     [--size 960,540] [--ss 1] [--samples 1] [--stats] [--base http://127.0.0.1:5173]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { openFilm, parseSize } from "./film-session.mjs";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    times: { type: "string" },
    size: { type: "string", default: "960,540" },
    ss: { type: "string", default: "1" },
    samples: { type: "string", default: "1" },
    fps: { type: "string", default: "24" },
    grade: { type: "string", description: "look development overrides, for example exposure=0.5,bloom=0" },
    blur: { type: "string" },
    stats: { type: "boolean", default: false },
    base: { type: "string", default: "http://127.0.0.1:5173" },
  },
});
if (!values.out || !values.times) {
  console.error("usage: film-shots.mjs --out <dir> --times 1,5,10 [--size w,h] [--ss n] [--samples n]");
  process.exit(2);
}
const [width, height] = parseSize(values.size);
const times = values.times.split(",").map(Number);
const grade = Object.fromEntries((values.grade ?? "").split(",").filter(Boolean).map((pair) => pair.split("=")).map(([k, v]) => [k, Number(v)]));
mkdirSync(values.out, { recursive: true });

const { browser, page, info } = await openFilm({
  base: values.base,
  width,
  height,
  supersample: Number(values.ss),
  blurAmount: values.blur ? Number(values.blur) : undefined,
  hdr: values.stats ? "float" : "half",
});
console.log("ready", JSON.stringify(info));
for (const t of times) {
  const fps = Number(values.fps);
  const timing = await page.evaluate(([i, time, samples, rate, override]) => window.film.renderFrame(i, time, { samples, fps: rate, grade: override }), [Math.round(t * fps), t, values.samples === "auto" ? "auto" : Number(values.samples), fps, grade]);
  if (values.stats) {
    const stats = await page.evaluate(() => window.film.luminanceStats());
    console.log(`t=${t} mean=${stats.mean.toFixed(3)} pct(5,25,50,75,95,99,max)=${stats.percentiles.map((v) => v.toFixed(3)).join(" ")} over1=${(stats.overOne * 100).toFixed(1)}%`);
  }
  const png = await page.evaluate(() => window.film.png());
  const file = join(values.out, `t${t.toFixed(2).padStart(6, "0")}.png`);
  writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
  console.log(file, JSON.stringify(timing));
}
await browser.close();
