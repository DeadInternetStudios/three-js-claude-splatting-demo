import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

const sources = files(join(root, "src"));
const pages = ["index.html", "film.html", "lab.html"].map((p) => join(root, p));

describe("a world made only of code", () => {
  it("ships no model, texture, image, font or sound file in the source tree", () => {
    const allowed = new Set([".ts", ".glsl", ".css", ".json"]);
    const strays = sources.filter((f) => !allowed.has(extname(f))).map((f) => relative(root, f));
    expect(strays).toEqual([]);
  });

  it("has no folder of static assets for the build to copy", () => {
    expect(existsSync(join(root, "public"))).toBe(false);
    expect(existsSync(join(root, "assets"))).toBe(false);
  });

  it("loads nothing at run time: no fetch, loader, media element, font or address", () => {
    const forbidden: [RegExp, string][] = [
      [/\bfetch\s*\(/, "fetch"],
      [/\b\w*Loader\b/, "a loader"],
      [/new\s+Audio\s*\(/, "an audio element"],
      [/<(img|audio|video|source|iframe)\b|<link\b(?![^>]*href="data:,")/i, "a media or link element"],
      [/@font-face|@import/, "a font or style import"],
      [/\burl\s*\(/, "a css url()"],
      [/https?:\/\//, "a web address"],
      [/import\.meta\.url/, "a file next to the module"],
      [/new\s+XMLHttpRequest/, "XMLHttpRequest"],
    ];
    for (const file of [...sources.filter((f) => extname(f) !== ".json"), ...pages]) {
      const text = readFileSync(file, "utf8");
      for (const [pattern, what] of forbidden) {
        expect(pattern.test(text), `${relative(root, file)} uses ${what}`).toBe(false);
      }
    }
  });

  it("depends at run time on three and spark and nothing else", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@sparkjsdev/spark", "three"]);
  });

  it("keeps the track out of the repository", () => {
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toMatch(/\*\.mp3|assets\/audio\/\*\.mp3/);
    expect(ignore).toMatch(/^\.work\/$/m);
    expect(ignore).toMatch(/^out\/$/m);
  });
});
