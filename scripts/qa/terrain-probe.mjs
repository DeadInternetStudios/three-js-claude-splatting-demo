import { chromium } from "@playwright/test";

/**
 * Compares the GPU terrain with its CPU twin at random points and exits non-zero on a mismatch.
 *   node scripts/qa/terrain-probe.mjs [--count 4000] [--seed 7] [--extent 40000]
 */
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const count = Number(args.count ?? 4000);
const seed = Number(args.seed ?? 7);
const extent = Number(args.extent ?? 40000);
const base = args.base ?? "http://127.0.0.1:5173";

let state = 12345;
const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
const lods = [0.9, 2.7, 8.1, 24.3, 72.9, 218.7, 656];
const points = Array.from({ length: count }, () => [(rnd() * 2 - 1) * extent, (rnd() * 2 - 1) * extent, lods[Math.floor(rnd() * lods.length)]]);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("console error:", m.text().slice(0, 2000));
});
await page.goto(`${base}/lab.html`);
await page.waitForFunction(() => Boolean(window.lab));
await page.evaluate((o) => window.lab.init(o), { width: 320, height: 200, capture: true });
const { gpu, cpu } = await page.evaluate(([s, p]) => window.lab.probe(s, p), [seed, points]);
await browser.close();

let worst = 0;
let worstIndex = 0;
let realmMismatch = 0;
let nan = 0;
const errors = [];
for (let i = 0; i < count; i++) {
  if (!Number.isFinite(gpu[i].height)) nan++;
  if (gpu[i].a !== cpu[i].a || gpu[i].b !== cpu[i].b) {
    realmMismatch++;
    continue;
  }
  const e = Math.abs(gpu[i].height - cpu[i].height);
  errors.push(e);
  if (e > worst) {
    worst = e;
    worstIndex = i;
  }
}
errors.sort((a, b) => a - b);
const pct = (q) => errors[Math.min(errors.length - 1, Math.floor(q * errors.length))];
console.log(JSON.stringify({ count, seed, realmMismatch, nan, p50: pct(0.5), p99: pct(0.99), worst, worstPoint: points[worstIndex], gpu: gpu[worstIndex], cpu: cpu[worstIndex] }));
const ok = nan === 0 && realmMismatch <= count * 0.002 && pct(0.99) < 0.05 && worst < 3;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
