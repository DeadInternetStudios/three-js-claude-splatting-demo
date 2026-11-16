#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { launchBrowser } from "./browsers.mjs";
import { serve } from "./serve.mjs";

/**
 * Plays the page the way a phone does. Chrome is set up as a touch device and every gesture arrives as a real
 * touch event through the DevTools protocol, so the page sees pointer events of type touch. The script runs a
 * portrait and a landscape phone in turn. In each it checks that the controls fit on the screen and clear one
 * another, that the left half of the screen walks, that the right half turns, that the jump button leaves the
 * ground, and that tapping a power in the dock switches it on and off. It saves a screenshot after each step.
 *
 *   node scripts/qa/touch-smoke.mjs [--out .work/touch] [--seed 1] [--ratio 3]
 *
 * The script serves the source with Vite on a spare port. It tests the interface, not the speed of a phone.
 */
const { values } = parseArgs({
  options: {
    out: { type: "string", default: ".work/touch" },
    seed: { type: "string", default: "1" },
    ratio: { type: "string", default: "3" },
  },
});
const PHONES = [
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
];
const USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

await mkdir(values.out, { recursive: true });
const server = await serve([]);
const browser = await launchBrowser("chrome");
const failures = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

try {
  for (const phone of PHONES) {
    console.log(`\n${phone.name} ${phone.width}x${phone.height} at ratio ${values.ratio}`);
    const context = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      deviceScaleFactor: Number(values.ratio),
      isMobile: true,
      hasTouch: true,
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") problems.push(`console ${m.type()}: ${m.text().slice(0, 300)}`);
    });
    await page.goto(`${server.base}/?debug&stats&seed=${values.seed}`);
    await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
    await page.waitForTimeout(6000);
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const shot = (name) => page.screenshot({ path: `${values.out}/${phone.name}-${name}.png` });
    const state = () =>
      page.evaluate(() => {
        const g = window.__origami;
        return { x: g.player.feet.x, y: g.player.feet.y, z: g.player.feet.z, yaw: g.player.yaw, grounded: g.player.grounded, stats: document.getElementById("stats")?.textContent ?? "" };
      });
    const centre = (selector) =>
      page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, selector);

    await shot("01-start");
    const start = await state();

    // First touch turns the touch interface on.
    await touch("touchStart", [{ x: phone.width * 0.25, y: phone.height * 0.7, id: 1 }]);
    await touch("touchEnd", []);
    await page.waitForTimeout(400);
    const touchClass = await page.evaluate(() => document.documentElement.classList.contains("touch"));
    check("a touch turns the touch controls on", touchClass);
    await shot("02-touch-controls");

    // Controls inside the screen and clear of one another.
    const boxes = await page.evaluate(() => {
      const box = (id) => {
        const e = document.getElementById(id);
        const r = e.getBoundingClientRect();
        const shown = getComputedStyle(e).display !== "none" && r.width > 0;
        return { id, shown, x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return ["dock", "touch-jump", "touch-down", "stats"].map(box);
    });
    for (const b of boxes) {
      if (!b.shown) {
        check(`#${b.id} is shown`, b.id === "touch-down" || b.id === "stats", "hidden");
        continue;
      }
      const inside = b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= phone.width + 0.5 && b.y + b.h <= phone.height + 0.5;
      check(`#${b.id} fits the screen`, inside, `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`);
    }
    const overlap = (a, b) => a.shown && b.shown && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    for (const [a, b] of [["dock", "touch-jump"], ["dock", "touch-down"], ["touch-jump", "touch-down"]]) check(`#${a} clears #${b}`, !overlap(byId[a], byId[b]));

    // The left half walks. A finger that goes up the screen moves the walker forward.
    const before = await state();
    const from = [phone.width * 0.22, phone.height * 0.72];
    await touch("touchStart", [{ x: from[0], y: from[1], id: 2 }]);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", [{ x: from[0], y: from[1] - i * 8, id: 2 }]);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(1800);
    const walking = await state();
    await shot("03-stick");
    await touch("touchEnd", []);
    const moved = Math.hypot(walking.x - before.x, walking.z - before.z);
    check("the left half walks", moved > 4, `${moved.toFixed(1)} m in 2 s`);

    // The right half turns.
    const yawBefore = (await state()).yaw;
    const turnFrom = [phone.width * 0.7, phone.height * 0.4];
    await touch("touchStart", [{ x: turnFrom[0], y: turnFrom[1], id: 3 }]);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", [{ x: turnFrom[0] + i * 12, y: turnFrom[1], id: 3 }]);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    await page.waitForTimeout(300);
    const turned = Math.abs((await state()).yaw - yawBefore);
    check("the right half turns", turned > 0.1, `${turned.toFixed(2)} rad for a 120 px drag`);

    // The jump button leaves the ground.
    await page.waitForTimeout(800);
    const jumpAt = await centre("#touch-jump");
    const ground = await state();
    await touch("touchStart", [{ x: jumpAt.x, y: jumpAt.y, id: 4 }]);
    let airborne = false;
    for (let i = 0; i < 20 && !airborne; i++) {
      await page.waitForTimeout(40);
      airborne = !(await state()).grounded;
    }
    await touch("touchEnd", []);
    check("the jump button leaves the ground", airborne, `from y ${ground.y.toFixed(2)}`);
    await shot("04-jump");
    await page.waitForTimeout(1500);

    // A tap on a power in the dock switches it on, a second tap switches it off.
    const power = await centre('#dock button[data-action="planet"]');
    await page.touchscreen.tap(power.x, power.y);
    await page.waitForTimeout(2500);
    const pressed = await page.evaluate(() => document.querySelector('#dock button[data-action="planet"]').getAttribute("aria-pressed"));
    const amount = await page.evaluate(() => window.__origami.powers.amounts.planet);
    check("a tap on the planet button switches it on", pressed === "true" && amount > 0.5, `aria-pressed ${pressed}, amount ${amount.toFixed(2)}`);
    await shot("05-planet");
    await page.touchscreen.tap(power.x, power.y);
    await page.waitForTimeout(2500);
    const off = await page.evaluate(() => window.__origami.powers.amounts.planet);
    check("a second tap switches it off", off < 0.1, `amount ${off.toFixed(2)}`);

    const end = await state();
    console.log(`     ${end.stats.replace(/\n/g, "  |  ")}`);
    check("the page logged no error or warning", problems.length === 0, problems[0] ?? "");
    for (const p of problems.slice(0, 5)) console.log(`     ${p}`);
    void start;
    await context.close();
  }
} finally {
  await browser.close();
  server.stop();
}
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
