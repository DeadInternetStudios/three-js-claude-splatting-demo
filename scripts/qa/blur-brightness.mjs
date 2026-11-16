#!/usr/bin/env node
import { parseArgs } from "node:util";
import { openFilm, parseSize } from "../capture/film-session.mjs";

/**
 * Renders the same film frames from one sub-frame and from several, and compares the mean brightness of the finished
 * picture. Motion blur only spreads light around, so the two must agree. A frame averaged from N sub-frames once came
 * out N times too dark, because the accumulator cleared its target on every add. Exits non-zero on a mismatch.
 *
 *   node scripts/qa/blur-brightness.mjs [--times 3,10.5,30] [--samples 4] [--tolerance 0.05] [--size 640,360]
 *     [--base http://127.0.0.1:5173]
 */
const { values } = parseArgs({
  options: {
    times: { type: "string", default: "3,10.5,30" },
    samples: { type: "string", default: "4" },
    tolerance: { type: "string", default: "0.05" },
    size: { type: "string", default: "640,360" },
    base: { type: "string", default: "http://127.0.0.1:5173" },
  },
});
const times = values.times.split(",").map(Number);
const samples = Number(values.samples);
const tolerance = Number(values.tolerance);
const [width, height] = parseSize(values.size);
const FPS = 24;

const { browser, page } = await openFilm({ base: values.base, width, height, supersample: 1, hdr: "half" });

async function meanLuma(t, count) {
  await page.evaluate(([i, time, n]) => window.film.renderFrame(i, time, { samples: n, fps: 24 }), [Math.round(t * FPS), t, count]);
  const rgba = Buffer.from(await page.evaluate(() => window.film.frameBase64()), "base64");
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  return sum / (rgba.length / 4) / 255;
}

let failed = false;
for (const t of times) {
  const one = await meanLuma(t, 1);
  const many = await meanLuma(t, samples);
  const ratio = many / one;
  const ok = Math.abs(ratio - 1) <= tolerance;
  failed ||= !ok;
  console.log(`t=${t} 1 sample ${one.toFixed(3)}, ${samples} samples ${many.toFixed(3)}, ratio ${ratio.toFixed(3)} ${ok ? "ok" : "MISMATCH"}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
