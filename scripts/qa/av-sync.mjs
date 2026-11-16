#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Measures how the picture lines up with the sound in an encoded film. For every impact in the cue sheet
 * it finds the moment the bass attacks, and the frame where the picture gets suddenly brighter, and
 * prints the gap in frames. A hit that the picture answers with no flash shows "none".
 *
 *   node scripts/qa/av-sync.mjs out/reality-origami-1080p.mp4 [--fps 24] [--window 0.25]
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
if (!file) {
  console.error("usage: av-sync.mjs <film.mp4> [--fps 24] [--window 0.25]");
  process.exit(2);
}
const fps = option("fps", 24);
const window = option("window", 0.25);
const cues = JSON.parse(readFileSync(new URL("../../src/film/audio-cues.json", import.meta.url), "utf8"));

const RATE = 22050;
const HOP = 110;

function soundLevels() {
  const run = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-af", "lowpass=f=250,lowpass=f=250", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(`ffmpeg could not decode the sound: ${run.stderr}`);
  const pcm = new Float32Array(run.stdout.buffer, run.stdout.byteOffset, Math.floor(run.stdout.byteLength / 4));
  const levels = new Float64Array(Math.floor(pcm.length / HOP));
  for (let i = 0; i < levels.length; i++) {
    let sum = 0;
    for (let k = 0; k < 2 * HOP; k++) sum += (pcm[i * HOP + k] ?? 0) ** 2;
    levels[i] = 10 * Math.log10(sum / (2 * HOP) + 1e-12);
  }
  return levels;
}

function frameBrightness() {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]);
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error("ffmpeg could not read the picture"));
      resolve([...text.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1])));
    });
  });
}

const sound = soundLevels();
const picture = await frameBrightness();
const hopSeconds = HOP / RATE;

/** The first moment in the window where the level climbs at 60% of the window's steepest climb. */
function soundAttack(t) {
  const lo = Math.max(4, Math.floor((t - window) / hopSeconds));
  const hi = Math.min(sound.length - 1, Math.ceil((t + window) / hopSeconds));
  const rise = (i) => sound[i] - sound[i - 4];
  let steepest = -Infinity;
  for (let i = lo; i <= hi; i++) steepest = Math.max(steepest, rise(i));
  for (let i = lo; i <= hi; i++) if (rise(i) >= 0.6 * steepest) return { t: i * hopSeconds, gain: steepest };
  return { t, gain: steepest };
}

function flashFrame(t) {
  const lo = Math.max(1, Math.floor((t - window) * fps));
  const hi = Math.min(picture.length - 1, Math.ceil((t + window) * fps));
  let best = -1;
  let gain = 0;
  for (let f = lo; f <= hi; f++) {
    const rise = picture[f] - picture[f - 1];
    if (rise > gain) {
      gain = rise;
      best = f;
    }
  }
  return { frame: best, gain };
}

console.log(`${file}: ${picture.length} frames, ${(sound.length * hopSeconds).toFixed(2)} s of sound`);
console.log("cue s    sound s   flash frame   frames from sound to flash   flash (luma steps)");
for (const impact of cues.impacts) {
  const s = soundAttack(impact.t);
  const p = flashFrame(impact.t);
  const gap = p.frame < 0 || p.gain < 3 ? "none" : ((p.frame / fps - s.t) * fps).toFixed(1);
  console.log(`${impact.t.toFixed(3).padStart(6)}   ${s.t.toFixed(3).padStart(7)}   ${String(p.frame).padStart(11)}   ${gap.padStart(26)}   ${p.gain.toFixed(1).padStart(18)}`);
}
