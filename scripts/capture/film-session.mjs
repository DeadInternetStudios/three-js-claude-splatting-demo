import { chromium } from "@playwright/test";

/**
 * Opens the film page in headless Chrome on the Metal GPU backend and initialises the renderer.
 * The caller owns the returned browser and must close it.
 */
export async function openFilm({ base = "http://127.0.0.1:5173", width, height, supersample, blurAmount, hdr }) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.error(`console ${m.type()}:`, m.text());
  });
  await page.goto(`${base}/film.html`);
  await page.waitForFunction(() => Boolean(window.film));
  const info = await page.evaluate((o) => window.film.init(o), { width, height, supersample, blurAmount, hdr });
  return { browser, page, info };
}

export function parseSize(text) {
  const [w, h] = text.split(",").map(Number);
  if (!Number.isInteger(w) || !Number.isInteger(h)) throw new Error(`bad size: ${text}`);
  return [w, h];
}
