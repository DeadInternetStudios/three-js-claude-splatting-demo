import { chromium, firefox, webkit } from "@playwright/test";

/** The engines the QA scripts can drive. Chrome runs on the machine's GPU through Metal. Firefox and WebKit are the builds Playwright ships. */
export const BROWSERS = ["chrome", "firefox", "webkit"];

const LAUNCH = {
  chrome: () =>
    chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
    }),
  firefox: () => firefox.launch({ headless: true }),
  webkit: () => webkit.launch({ headless: true }),
};

export function launchBrowser(name = "chrome") {
  const launch = LAUNCH[name];
  if (!launch) throw new Error(`--browser takes ${BROWSERS.join(", ")}`);
  return launch();
}

const BOUNCE_TRACKER = /classified as a bounce tracker/;
const SPARK_UNREAD_OUTPUTS =
  /^THREE\.WebGLProgram: Program Info Log: WARNING: Output of vertex shader '\w+' not read by fragment shader\nWARNING: Output of vertex shader '\w+' not read by fragment shader\s*$/;
const REORDERED_MICROTASKS =
  /^\[JavaScript Warning: "The execution of microtasks on this page was reordered to avoid unsafe execution\." \{file: "[^"]*" line: 0\}\]$/;

/**
 * True for the three console warnings Firefox prints that no change of ours can remove. It reports its own
 * tracking policy for any local address it has not seen a click on. Spark's splat shader declares two
 * outputs its fragment shader never reads, and one unread output in a program of ours would print one line,
 * so only the two-line form passes. And Firefox says it reordered microtasks on every read of a
 * DecompressionStream. The production build unpacks Spark's WebAssembly through one as the bundle starts,
 * and a page of six lines with no code of ours prints it too.
 */
export function isKnownNoise(text) {
  return BOUNCE_TRACKER.test(text) || SPARK_UNREAD_OUTPUTS.test(text) || REORDERED_MICROTASKS.test(text);
}
