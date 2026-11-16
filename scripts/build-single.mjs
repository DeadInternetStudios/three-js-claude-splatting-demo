import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const outFile = join(dist, "reality-origami.html");

let html = readFileSync(join(dist, "index.html"), "utf8");

const scriptTag = /<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>\s*/;
const styleTag = /<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>\s*/;

const script = html.match(scriptTag);
const style = html.match(styleTag);
if (!script || !style) {
  throw new Error("dist/index.html has no bundled script or stylesheet. Run `npm run build` first.");
}

const js = readFileSync(join(dist, script[1]), "utf8").replaceAll("</script", "<\\/script");
const css = readFileSync(join(dist, style[1]), "utf8").replaceAll("</style", "<\\/style");

html = html.replace(scriptTag, "").replace(styleTag, "");
html = html.replace("</head>", () => `<style>${css}</style>\n<script type="module">${js}</script>\n</head>`);

writeFileSync(outFile, html);
const mb = (statSync(outFile).size / 1048576).toFixed(2);
console.log(`wrote ${outFile} (${mb} MB)`);
