import { access, mkdir, writeFile } from "node:fs/promises";
import { openFilm, parseSize } from "./film-session.mjs";

/**
 * Renders the film to numbered PNG frames. Existing frames are skipped, so a run can be stopped and resumed.
 *
 *   node scripts/capture/render-frames.mjs --out .work/frames/1080 --size 1920,1080 --ss 2 --samples auto
 *
 * Options: --from N --to N (inclusive frame range), --shard K/N (only frames whose number leaves K when divided
 * by N, so N processes can share one GPU and finish together), --fps 24, --shutter 0.5 (fraction of the frame the
 * shutter is open), --samples auto|N (sub-frames per frame; auto sizes them from the motion, up to
 * --max-samples 12 with copies at most --spacing 3.5 output pixels apart), --blur 0.3 (splat softening
 * in HDR pixels), --base http://127.0.0.1:5173,
 * --restart-every 240 (frames between browser restarts), --stats (print timing for every frame).
 */
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : [])),
);
const need = (name) => {
  if (!args[name]) throw new Error(`missing --${name}`);
  return args[name];
};

const out = need("out");
const [width, height] = parseSize(args.size ?? "1920,1080");
const supersample = Number(args.ss ?? 2);
const samples = args.samples === undefined || args.samples === "auto" ? "auto" : Number(args.samples);
const auto = { max: Number(args["max-samples"] ?? 12), spacing: Number(args.spacing ?? 3.5) };
const shutter = Number(args.shutter ?? 0.5);
const fps = Number(args.fps ?? 24);
const blurAmount = args.blur ? Number(args.blur) : undefined;
const restartEvery = Number(args["restart-every"] ?? 240);
const [shard, shards] = (args.shard ?? "0/1").split("/").map(Number);
if (!Number.isInteger(shard) || !Number.isInteger(shards) || shards < 1 || shard < 0 || shard >= shards) throw new Error(`bad --shard ${args.shard}`);
const base = args.base ?? "http://127.0.0.1:5173";

await mkdir(out, { recursive: true });

const exists = (path) => access(path).then(() => true, () => false);
const frameName = (i) => `${out}/f${String(i).padStart(5, "0")}.png`;

async function open() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await openFilm({ base, width, height, supersample, blurAmount });
    } catch (error) {
      console.error(`opening the film page failed (attempt ${attempt}): ${error.message.split("\n")[0]}`);
      if (attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15_000 * attempt));
    }
  }
}

let session = await open();
console.log("ready", JSON.stringify(session.info));
const total = Math.round(session.info.duration * fps);
const first = Number(args.from ?? 0);
const last = Math.min(Number(args.to ?? total - 1), total - 1);
console.log(`frames ${first}..${last} of ${total} at ${width}x${height}, ss ${supersample}, samples ${samples}, shutter ${shutter}`);

const started = Date.now();
let done = 0;
let sinceRestart = 0;

for (let i = first; i <= last; i++) {
  if (i % shards !== shard) continue;
  const name = frameName(i);
  if (await exists(name)) continue;

  let timing;
  for (let attempt = 1; ; attempt++) {
    try {
      timing = await session.page.evaluate(([index, t, opts]) => window.film.renderFrame(index, t, opts), [i, i / fps, { samples, shutter, fps, auto }]);
      const dataUrl = await session.page.evaluate(() => window.film.png());
      await writeFile(name, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
      break;
    } catch (error) {
      console.error(`frame ${i} attempt ${attempt} failed: ${error.message}`);
      if (attempt >= 3) throw error;
      await session.browser.close().catch(() => undefined);
      session = await open();
      sinceRestart = 0;
    }
  }

  done++;
  sinceRestart++;
  if (args.stats) console.log(i, JSON.stringify(timing));
  if (done % 10 === 0 || i === last) {
    const perFrame = (Date.now() - started) / done / 1000;
    const remaining = (((last - i) / shards) * perFrame) / 60;
    console.log(`frame ${i}/${last}  ${perFrame.toFixed(2)} s/frame  ${remaining.toFixed(1)} min left`);
  }
  if (sinceRestart >= restartEvery && i < last) {
    await session.browser.close();
    session = await open();
    sinceRestart = 0;
  }
}

await session.browser.close();
console.log(`done: ${done} new frames in ${((Date.now() - started) / 60000).toFixed(1)} min`);
