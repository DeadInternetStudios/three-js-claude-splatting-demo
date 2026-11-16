import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

/**
 * Renders the ten 2-minute flyby routes to MP4s with the game's own procedural score.
 *
 *   node scripts/capture/flyby-videos.mjs [--only 1,4] [--size 1280,720] [--fps 24] [--keep-frames]
 *
 * Starts its own vite server on port 4417 and stops it at the end. Frames land in
 * out/flybys/<route>/frames and are deleted after a successful encode unless --keep-frames.
 * Finished videos are skipped, and existing frames are kept, so a stopped run resumes.
 */
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : [])),
);
const [width, height] = (args.size ?? "1280,720").split(",").map(Number);
const fps = Number(args.fps ?? 24);
const only = args.only ? new Set(args.only.split(",").map(Number)) : null;
const port = 4417;
const base = `http://127.0.0.1:${port}`;

const exists = (p) => access(p).then(() => true, () => false);

// One render at a time. Two renders sharing a route's frames, or writing the same MP4, corrupt both.
import { openSync, closeSync, readFileSync, rmSync } from "node:fs";
await mkdir("out/flybys", { recursive: true });
const lockPath = "out/flybys/.render.lock";
if (await exists(lockPath)) {
  const pid = Number(readFileSync(lockPath, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive) {
    console.error(`another flyby render is running (pid ${pid}). Wait for it, or remove ${lockPath} if it is stale.`);
    process.exit(2);
  }
  rmSync(lockPath);
}
closeSync(openSync(lockPath, "w"));
await writeFile(lockPath, String(process.pid));
process.on("exit", () => {
  try {
    rmSync(lockPath);
  } catch {}
});
const run = (cmd, argv) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { stdio: "ignore" });
process.on("exit", () => vite.kill());
for (let i = 0; ; i++) {
  try {
    await fetch(`${base}/flyby.html`);
    break;
  } catch {
    if (i > 60) throw new Error("vite did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("console error:", m.text().slice(0, 300));
});
await page.goto(`${base}/flyby.html`);
await page.waitForFunction(() => Boolean(window.flyby));
const info = await page.evaluate((o) => window.flyby.init(o), { width, height, supersample: 1 });
console.log("routes:", JSON.stringify(info.routes));

const totalFrames = 120 * fps;
for (let routeIndex = 0; routeIndex < info.routes.length; routeIndex++) {
  const route = info.routes[routeIndex];
  if (only && !only.has(routeIndex + 1)) continue;
  const dir = `out/flybys/${route.name}`;
  const mp4 = `${dir}.mp4`;
  if (await exists(mp4)) {
    console.log(`${route.name}: already done, skipping`);
    continue;
  }
  const framesDir = `${dir}/frames`;
  await mkdir(framesDir, { recursive: true });
  const started = Date.now();
  let done = 0;
  for (let i = 0; i < totalFrames; i++) {
    const name = `${framesDir}/f${String(i).padStart(5, "0")}.png`;
    if (await exists(name)) continue;
    await page.evaluate(([r, t]) => window.flyby.renderFrame(r, t), [routeIndex, i / fps]);
    const dataUrl = await page.evaluate(() => window.flyby.png());
    await writeFile(name, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    done++;
    if (done % 240 === 0) {
      const per = (Date.now() - started) / done / 1000;
      console.log(`${route.name}: frame ${i}/${totalFrames}  ${per.toFixed(2)} s/frame  ${(((totalFrames - i) * per) / 60).toFixed(1)} min left`);
    }
  }
  console.log(`${route.name}: frames done in ${((Date.now() - started) / 60000).toFixed(1)} min, rendering audio`);
  const wav64 = await page.evaluate((r) => window.flyby.renderAudio(r), routeIndex);
  const wav = `${dir}/score.wav`;
  await writeFile(wav, Buffer.from(wav64, "base64"));
  await run("ffmpeg", [
    "-y", "-framerate", String(fps), "-i", `${framesDir}/f%05d.png`, "-i", wav,
    "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-profile:v", "high",
    "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", "120", `${mp4}.part.mp4`,
  ]);
  await run("mv", [`${mp4}.part.mp4`, mp4]);
  if (!args["keep-frames"]) await run("rm", ["-rf", framesDir]);
  console.log(`${route.name}: wrote ${mp4}`);
}

await browser.close();
vite.kill();
console.log("all flybys done");
