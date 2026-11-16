#!/usr/bin/env node
// Tiles images into one contact sheet with ffmpeg and prints the file it wrote. The name gets a
// time suffix because viewers cache images by path, and a re-rendered sheet must look new.
//
//   node scripts/qa/sheet.mjs --out .work/sheet --cols 3 --width 1500 a.png b.png c.png d.png
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: { out: { type: "string" }, cols: { type: "string", default: "3" }, width: { type: "string", default: "1500" } },
  allowPositionals: true,
});
if (!values.out || positionals.length === 0) {
  console.error("usage: sheet.mjs --out <name without extension> [--cols 3] [--width 1500] image...");
  process.exit(2);
}
const cols = Number(values.cols);
const rows = Math.ceil(positionals.length / cols);
const inputs = positionals.flatMap((p) => ["-i", p]);
const row = (r) => {
  const items = Array.from({ length: cols }, (_, c) => r * cols + c).map((i) => Math.min(i, positionals.length - 1));
  return items.map((i) => `[${i}:v]`).join("") + `hstack=inputs=${cols}[r${r}]`;
};
const stack = rows === 1 ? `[r0]scale=${values.width}:-1` : Array.from({ length: rows }, (_, r) => `[r${r}]`).join("") + `vstack=inputs=${rows},scale=${values.width}:-1`;
const filter = [...Array.from({ length: rows }, (_, r) => row(r)), stack].join(";");
const out = `${values.out}-${new Date().toISOString().slice(11, 19).replaceAll(":", "")}.png`;
const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, out], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(out);
