import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Compares a re-encode with its reference, frame by frame, and prints PSNR and SSIM.
 * Usage: node scripts/qa/compare-encodes.mjs <reference.mp4> <candidate.mp4> [--out file.json]
 * Both files need the same size and frame count. The figures are for the whole clip, "average" and "all" cover the three planes,
 * and the worst frame is the lowest per-frame value (frame numbers start at 0).
 */
const [reference, candidate, ...rest] = process.argv.slice(2);
if (!reference || !candidate) {
  console.error("usage: node scripts/qa/compare-encodes.mjs <reference.mp4> <candidate.mp4> [--out file.json]");
  process.exit(2);
}
const outIndex = rest.indexOf("--out");
const out = outIndex >= 0 ? rest[outIndex + 1] : null;

const dir = await mkdtemp(join(tmpdir(), "ro-compare-"));
const statsFile = join(dir, "ssim.log");

const log = await new Promise((resolve, reject) => {
  const child = spawn("ffmpeg", ["-hide_banner", "-i", candidate, "-i", reference, "-lavfi", `[0:v][1:v]ssim=stats_file=${statsFile};[0:v][1:v]psnr`, "-f", "null", "-"]);
  let text = "";
  child.stderr.on("data", (chunk) => (text += chunk));
  child.on("error", reject);
  child.on("exit", (code) => (code === 0 ? resolve(text) : reject(new Error(`ffmpeg exited with ${code}\n${text.slice(-600)}`))));
});

const pick = (pattern, what) => {
  const match = log.match(pattern);
  if (!match) throw new Error(`no ${what} line in the ffmpeg output`);
  return match;
};
const ssim = pick(/SSIM Y:([\d.]+) .*All:([\d.]+)/, "SSIM");
const psnr = pick(/PSNR y:([\d.]+) .*average:([\d.]+) min:([\d.]+)/, "PSNR");

const frames = (await readFile(statsFile, "utf8"))
  .split("\n")
  .map((line) => line.match(/^n:(\d+) .*All:([\d.]+)/))
  .filter(Boolean)
  .map((m) => ({ n: Number(m[1]) - 1, all: Number(m[2]) }));
const worst = frames.reduce((a, b) => (b.all < a.all ? b : a));

const result = {
  reference,
  candidate,
  bytes: { reference: (await stat(reference)).size, candidate: (await stat(candidate)).size },
  frames: frames.length,
  ssim: { luma: Number(ssim[1]), all: Number(ssim[2]), worstFrame: worst },
  psnr: { luma: Number(psnr[1]), average: Number(psnr[2]), worstFrameAverage: Number(psnr[3]) },
};
await rm(dir, { recursive: true });

const text = `${JSON.stringify(result, null, 2)}\n`;
if (out) await writeFile(out, text);
process.stdout.write(text);
