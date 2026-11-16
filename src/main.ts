import "./play/play.css";
import { parseQuality } from "./play/quality.ts";
import { Game } from "./play/game.ts";
import { parseShare } from "./play/share.ts";

interface Boot {
  ok: boolean;
  set(pct: number, label: string): void;
  fail(message: string): void;
  done(): void;
}

declare global {
  interface Window {
    /** Present only with `?debug`, for tests and the console. */
    __origami?: Game;
    /** The inline boot box from index.html: progress bar and preflight failure reasons. */
    __boot?: Boot;
  }
}

function seedFrom(query: URLSearchParams): number {
  const raw = query.get("seed");
  if (raw === null) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : 1;
}

const PAINT_WAIT_MS = 300;

/**
 * Resolves once the browser has drawn what the page set up so far, which the first frame would otherwise hold back.
 * A page that gets no frame, such as one whose frame loop a script holds, waits at most `PAINT_WAIT_MS`.
 */
function painted(): Promise<void> {
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve));
    setTimeout(resolve, PAINT_WAIT_MS);
  });
}

async function start(): Promise<void> {
  const boot = window.__boot;
  if (boot && !boot.ok) return;
  boot?.set(45, "STEP 3/4 - GAME CODE READ. MAKING THE WORLD");
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const query = new URLSearchParams(location.search);
  try {
    const shared = parseShare(location.hash);
    const seed = shared?.ok ? shared.state.seed : seedFrom(query);
    const game = Game.create({
      canvas,
      seed,
      quality: parseQuality(query.get("quality")),
      share: shared?.ok ? shared.state : null,
      showStats: query.has("stats"),
      calm: query.has("calm") || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    if (shared && !shared.ok) console.warn(`Ignored the link: ${shared.reason}`);
    try {
      game.world.compileShaders();
    } catch (error) {
      console.warn("The shaders will build on the first frame instead.", error);
    }
    boot?.set(60, "STEP 3/4 - BUILDING SHADERS. SLOWER ON A FIRST VISIT");
    await painted();
    if (query.has("debug")) window.__origami = game;
    boot?.set(85, "STEP 4/4 - WORLD MADE. FIRST PICTURE COMING");
    game.start(() => boot?.done());
    game.begin();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error);
    if (boot) {
      boot.fail(`${message.toUpperCase()}. TRY CHROME OR EDGE ON A COMPUTER.`);
    } else {
      const box = document.getElementById("failure")!;
      box.hidden = false;
      box.querySelector(".note")!.textContent = `${message}. This needs a browser with WebGL 2.`;
    }
  }
}

void start();
