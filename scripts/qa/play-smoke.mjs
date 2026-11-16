import { mkdir } from "node:fs/promises";
import { launchBrowser, isKnownNoise } from "./browsers.mjs";
import { serve } from "./serve.mjs";

/**
 * Plays the real page in Chrome with Metal (or in Firefox or WebKit): enters the world, walks, jumps,
 * glides, flies, switches the fold powers on, makes the window larger and smaller, and saves a
 * screenshot after each step along with frame-rate numbers. Any console error or warning fails the run.
 *
 *   node scripts/qa/play-smoke.mjs [--browser chrome|firefox|webkit] [--out .work/play] [--size 1280,720] [--dpr 1] [--seed 1] [--query "&stats"] [--base http://127.0.0.1:5173]
 *
 * It starts its own dev server on a free port unless `--base` names one that is running.
 */
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : [])),
);
const [width, height] = (args.size ?? "1280,720").split(",").map(Number);
const out = args.out ?? ".work/play";
const server = args.base ? null : await serve([]);
process.on("exit", () => server?.stop());
const base = args.base ?? server.base;
await mkdir(out, { recursive: true });

const browser = await launchBrowser(args.browser);
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(args.dpr ?? 1) });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if ((m.type() === "error" || m.type() === "warning") && !isKnownNoise(m.text())) errors.push(`console ${m.type()}: ${m.text().slice(0, 600)}`);
});
await page.goto(`${base}/?debug&seed=${args.seed ?? 1}${args.query ?? "&stats"}`);
await page.waitForFunction(() => window.__origami, null, { timeout: 60000 });

const shot = async (name) => {
  const stats = await page.evaluate(() => document.getElementById("stats")?.textContent ?? "");
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name.padEnd(14), stats.replace(/\n/g, "  |  "));
};
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

await page.waitForTimeout(1500);
await shot("01-intro-a");
await page.waitForTimeout(2500);
await shot("02-intro-b");
await page.waitForTimeout(4500);
await shot("03-standing");
await hold("w", 3500);
await shot("04-walk");
await page.keyboard.down("Shift");
await hold("w", 3000);
await page.keyboard.up("Shift");
await shot("05-run");
await page.keyboard.press("Space");
await page.waitForTimeout(250);
await page.keyboard.down("Space");
await hold("w", 1800);
await shot("06-glide");
await page.keyboard.up("Space");
await page.waitForTimeout(1500);
await page.keyboard.press("f");
await page.keyboard.down("Space");
await hold("w", 1500);
await page.keyboard.up("Space");
await shot("07-fly");
await page.keyboard.press("1");
await page.waitForTimeout(3500);
await shot("08-planet");
await page.keyboard.press("1");
await page.keyboard.press("2");
await page.waitForTimeout(3000);
await shot("09-twist");
await page.keyboard.press("2");
await page.keyboard.press("3");
await page.waitForTimeout(3000);
await shot("10-fold");
await page.keyboard.press("3");
await page.keyboard.press("4");
await page.waitForTimeout(2500);
await shot("11-ripple");
await page.keyboard.press("e");
await page.waitForTimeout(900);
await shot("12-sing");
await page.keyboard.press("h");
await page.waitForTimeout(700);
await shot("13-help");
await page.keyboard.press("h");
await page.keyboard.press("p");
await page.waitForTimeout(1200);
await shot("14-photo");
await page.setViewportSize({ width: Math.round(width * 1.5), height: Math.round(height * 1.5) });
await page.waitForTimeout(1500);
await shot("15-larger");
await page.setViewportSize({ width: Math.round(width * 0.75), height: Math.round(height * 0.75) });
await page.waitForTimeout(1500);
await shot("16-smaller");

console.log(errors.length ? `ERRORS (${errors.length}):\n${[...new Set(errors)].join("\n")}` : "no console errors");
await browser.close();
server?.stop();
if (errors.length) process.exitCode = 1;
