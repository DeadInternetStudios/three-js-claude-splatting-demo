import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser, isKnownNoise } from "./browsers.mjs";

/**
 * Opens the production build, enters the world and looks at it for a few seconds.
 *
 *   npm run build && node scripts/qa/smoke-dist.mjs [--prefix /reality-origami/] [--dist dist] [--seed 1] [--browser chrome|firefox|webkit]
 *   npm run build:single && node scripts/qa/smoke-dist.mjs --file dist/reality-origami.html [--browser ...]
 *
 * By default it serves `dist/` under a sub-path, the way GitHub Pages serves a project site. With `--file` it
 * opens that one file straight from disk with no server, the way a friend would open it from an e-mail, and
 * fails if the page asks for anything over the network.
 *
 * Checks that the page loads, the game starts on its own, the canvas draws something, the splat count is
 * reported and nothing logs an error or warning or answers with a 4xx or 5xx.
 */
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])));
const prefix = args.prefix ?? "/reality-origami/";
const dist = resolve(args.dist ?? "dist");
const seed = args.seed ?? "1";
const query = `?debug&stats&seed=${seed}`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

async function serveDist() {
  if (!existsSync(join(dist, "index.html"))) {
    console.error(`no build in ${dist}. Run "npm run build" first.`);
    process.exit(2);
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end("outside the prefix");
      return;
    }
    let file = normalize(join(dist, decodeURIComponent(url.pathname.slice(prefix.length))));
    if (!file.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}${prefix}${query}`, label: `prefix ${prefix}`, close: () => server.close() };
}

function openFile(path) {
  if (!existsSync(path)) {
    console.error(`no file at ${path}. Run "npm run build:single" first.`);
    process.exit(2);
  }
  return { url: `${pathToFileURL(path).href}${query}`, label: `file ${path}`, close: () => {} };
}

const site = args.file ? openFile(resolve(args.file)) : await serveDist();
const browser = await launchBrowser(args.browser);
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !isKnownNoise(m.text()) && problems.push(`console ${m.type()}: ${m.text()}`));
page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
if (args.file) {
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push(`network request ${r.url()}`);
  });
}

try {
  await page.goto(site.url);
  await page.waitForFunction(() => window.__origami, null, { timeout: 120_000 });
  await page.waitForTimeout(5000);
  const stats = await page.locator("#stats").innerText();
  const picture = await page.locator("#stage").screenshot({ type: "png" });
  const luma = await page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const small = document.createElement("canvas");
    small.width = 64;
    small.height = 36;
    const ctx = small.getContext("2d");
    ctx.drawImage(img, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (64 * 36 * 255);
  }, picture.toString("base64"));
  console.log(`${site.label}: stats "${stats.replace(/\n/g, " | ")}", mean luma ${luma.toFixed(3)}`);
  if (!/M splats/.test(stats)) problems.push("no splat count in the stats");
  if (luma < 0.03) problems.push(`the canvas is nearly black (${luma.toFixed(3)})`);
} finally {
  await browser.close();
  site.close();
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("ok");
