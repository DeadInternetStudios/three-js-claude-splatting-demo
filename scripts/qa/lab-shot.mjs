import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

/**
 * Renders camera poses from the procedural world lab to PNG files and prints timings.
 *
 *   node scripts/qa/lab-shot.mjs --shots .work/shots.json --out .work/shots --size 1280,720 [--ss 1]
 *   node scripts/qa/lab-shot.mjs --live '{"pos":[0,130,0]}' --seconds 8 --size 1280,720
 *
 * The shots file is an array of ShotSpec objects (see src/lab/world-lab.ts). Add "name" to choose a file name.
 */
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : [])),
);
const [width, height] = (args.size ?? "1280,720").split(",").map(Number);
const supersample = Number(args.ss ?? 1);
const base = args.base ?? "http://127.0.0.1:5173";
const live = args.live !== undefined;
const rings = args.rings ? JSON.parse(args.rings) : undefined;
const idle = args.idle ? Number(args.idle) : 0;

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", ...(process.env.UNCAP ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"] : [])],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.error(`console ${m.type()}:`, m.text().slice(0, 3000));
});
await page.goto(`${base}/lab.html`);
await page.waitForFunction(() => Boolean(window.lab));
const info = await page.evaluate((o) => window.lab.init(o), { width, height, supersample, capture: !live, rings });
console.log("init", JSON.stringify(info));
if (idle > 0) await page.evaluate((n) => window.lab.addIdleLayer(n), idle);

if (live) {
  const spec = JSON.parse(args.live === "true" ? '{"pos":[0,130,0]}' : args.live);
  const stats = await page.evaluate(([s, seconds]) => window.lab.live(s, seconds), [spec, Number(args.seconds ?? 8)]);
  console.log("live", JSON.stringify(stats));
} else {
  const out = args.out ?? ".work/shots";
  await mkdir(out, { recursive: true });
  const shots = JSON.parse(await readFile(args.shots, "utf8"));
  for (const [i, spec] of shots.entries()) {
    const name = spec.name ?? `shot${String(i).padStart(2, "0")}`;
    const started = Date.now();
    const result = await page.evaluate((s) => window.lab.shot(s), spec);
    await writeFile(`${out}/${name}.png`, Buffer.from(result.png.slice(result.png.indexOf(",") + 1), "base64"));
    console.log(name, `settle ${result.settleMs.toFixed(0)} ms, render ${result.renderMs.toFixed(0)} ms, wall ${Date.now() - started} ms`);
  }
}
await browser.close();
