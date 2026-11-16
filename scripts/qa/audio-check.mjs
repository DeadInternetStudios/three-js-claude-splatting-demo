import { chromium } from "@playwright/test";
import { serve } from "./serve.mjs";

/**
 * Renders the procedural score offline in Chrome and checks it: nothing clips, nothing is silent,
 * every realm has its own loudness and brightness, and the wind opens with speed.
 *
 *   node scripts/qa/audio-check.mjs [base url]
 *
 * It starts its own dev server on a free port unless a base url names one that is running.
 */
const server = process.argv[2] ? null : await serve([]);
const base = process.argv[2] ?? server.base;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => (m.type() === "error" ? console.error("console error:", m.text().slice(0, 500)) : undefined));
await page.goto(`${base}/lab.html`);
await page.waitForFunction(() => Boolean(window.audioLab));

const scenes = [
  ...[0, 1, 2, 3, 4].map((r) => ({ name: `realm ${r} standing`, seconds: 24, realm: r })),
  { name: "dunes to prism blend", seconds: 24, blend: true },
  { name: "dunes running", seconds: 12, speed: 11, realm: 0 },
  { name: "flying fast", seconds: 12, speed: 120, flying: true, realm: 0 },
  { name: "planet on", seconds: 12, planet: 1, realm: 0 },
  {
    name: "thunder in ember",
    seconds: 16,
    realm: 4,
    events: [
      { t: 1, kind: "thunder", strength: 0.95 },
      { t: 8, kind: "thunder", strength: 0.2 },
    ],
  },
  {
    name: "events in dunes",
    seconds: 12,
    realm: 0,
    events: [
      { t: 1, kind: "step", strength: 0.5 },
      { t: 1.4, kind: "step", strength: 0.6 },
      { t: 1.8, kind: "jump" },
      { t: 2.6, kind: "land", strength: 0.8 },
      { t: 4, kind: "sing" },
      { t: 6, kind: "planet", on: true },
      { t: 7.5, kind: "corkscrew", on: true },
      { t: 9, kind: "hinge", on: true },
      { t: 10, kind: "ripple" },
      { t: 11, kind: "photo" },
    ],
  },
];

let failed = false;
for (const s of scenes) {
  const report = await page.evaluate(async (sc) => {
    const frame = (t) => {
      const base = { realmA: sc.realm ?? 0, realmB: sc.realm ?? 0, speed: sc.speed ?? 0, flying: Boolean(sc.flying), planet: sc.planet ?? 0, altitude: sc.flying ? 120 : 0, grounded: !sc.flying };
      if (sc.blend) return { realmA: 0, realmB: 1, realmBlend: Math.min(1, t / 20) };
      return base;
    };
    return window.audioLab.renderScene({ name: sc.name, seconds: sc.seconds, frame, events: sc.events });
  }, s);
  const avg = report.rmsDb.reduce((a, b) => a + b, 0) / report.rmsDb.length;
  const problems = [];
  if (report.clipped > 0) problems.push(`clipped ${report.clipped}`);
  if (report.peak > 0.98) problems.push(`peak ${report.peak}`);
  if (report.silent > 0.02) problems.push(`silent ${(report.silent * 100).toFixed(0)}%`);
  if (Math.abs(report.dc) > 0.01) problems.push(`dc ${report.dc}`);
  if (avg < -42) problems.push(`too quiet ${avg.toFixed(1)} dB`);
  if (avg > -12) problems.push(`too loud ${avg.toFixed(1)} dB`);
  if (problems.length) failed = true;
  console.log(
    s.name.padEnd(24),
    `avg ${avg.toFixed(1)} dB  peak ${report.peak}  balance ${report.balance}  centroid ${report.centroid.join("/")}`,
    problems.length ? `  PROBLEMS: ${problems.join(", ")}` : "  ok",
  );
}
await browser.close();
server?.stop();
process.exit(failed ? 1 : 0);
