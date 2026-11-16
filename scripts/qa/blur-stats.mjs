#!/usr/bin/env node
/**
 * Prints how many motion-blur sub-frames the film asks for, second by second and overall.
 * Usage: node scripts/qa/blur-stats.mjs [--fps 24] [--shutter 0.5] [--height 1080] [--spacing 3.5] [--min 2] [--max 12]
 */
import { parseArgs } from "node:util";
import { samplesNeeded } from "../../src/film/blur.ts";
import { DURATION } from "../../src/film/cues.ts";

const { values } = parseArgs({
  options: Object.fromEntries(["fps", "shutter", "height", "spacing", "min", "max"].map((k) => [k, { type: "string" }])),
});
const settings = {
  fps: Number(values.fps ?? 24),
  shutter: Number(values.shutter ?? 0.5),
  height: Number(values.height ?? 1080),
  spacing: Number(values.spacing ?? 3.5),
  min: Number(values.min ?? 2),
  max: Number(values.max ?? 12),
};

const frames = Math.round(DURATION * settings.fps);
const counts = Array.from({ length: frames }, (_, i) => samplesNeeded(i / settings.fps, settings));
const total = counts.reduce((a, b) => a + b, 0);
const perSecond = [];
for (let s = 0; s < Math.floor(DURATION); s++) {
  const slice = counts.slice(Math.round(s * settings.fps), Math.round((s + 1) * settings.fps));
  perSecond.push(`${s}s:${(slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1)}`);
}
console.log(`frames ${frames}, sub-frames ${total}, mean ${(total / frames).toFixed(2)}, min ${Math.min(...counts)}, max ${Math.max(...counts)}`);
console.log(perSecond.join(" "));
