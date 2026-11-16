import { smoothstep } from "./animate.ts";
import { CUE, DURATION } from "./cues.ts";

export interface TitleLine {
  text: string;
  /** Height of the capital letters as a fraction of frame height. */
  size: number;
  /** Vertical centre as a fraction of frame height from the top. */
  y: number;
  alpha: number;
  /** Extra letter spacing in em. */
  tracking: number;
  weight: number;
}

const FONT_STACK = '"SF Pro Display", "Helvetica Neue", "Inter", Helvetica, Arial, sans-serif';

/** The lines on screen at time t. Only the closing card has any. */
export function titlesAt(t: number): TitleLine[] {
  const out = 1 - smoothstep(DURATION - 1.2, DURATION - 0.25, t);
  const name = smoothstep(CUE.title, CUE.title + 1.6, t) * out;
  const tagline = smoothstep(CUE.title + 1.6, CUE.title + 2.8, t) * out;
  const credits = smoothstep(CUE.title + 2.2, CUE.title + 3.2, t) * out;
  const lines: TitleLine[] = [];
  if (name > 0) lines.push({ text: "REALITY ORIGAMI", size: 0.062, y: 0.64, alpha: name, tracking: 0.32 + 0.06 * (1 - name), weight: 300 });
  if (tagline > 0) lines.push({ text: "A WORLD THAT NEVER REPEATS. EVERY PIECE OF IT IS MATH.", size: 0.024, y: 0.72, alpha: tagline, tracking: 0.36, weight: 500 });
  if (credits > 0) lines.push({ text: "PLAY IT IN YOUR BROWSER   \u00b7   THREE.JS   \u00b7   SPARK   \u00b7   MUSIC  ALEXGROHL", size: 0.0135, y: 0.94, alpha: credits * 0.5, tracking: 0.3, weight: 400 });
  return lines;
}

/** Paints the title lines onto a transparent canvas. Returns false when there is nothing to show. */
export function drawTitles(canvas: HTMLCanvasElement, lines: readonly TitleLine[]): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (lines.length === 0) return false;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const line of lines) {
    const px = Math.max(8, Math.round(line.size * canvas.height));
    const spacing = line.tracking * px;
    ctx.font = `${line.weight} ${px}px ${FONT_STACK}`;
    ctx.letterSpacing = `${spacing}px`;
    const x = canvas.width / 2 + spacing / 2;
    const y = line.y * canvas.height;

    ctx.save();
    ctx.shadowColor = `rgba(34, 40, 104, ${0.6 * line.alpha})`;
    ctx.shadowBlur = px * 0.55;
    ctx.fillStyle = `rgba(236, 241, 250, ${line.alpha})`;
    ctx.fillText(line.text, x, y);
    ctx.restore();

    ctx.fillStyle = `rgba(244, 247, 252, ${line.alpha})`;
    ctx.fillText(line.text, x, y);
  }
  return true;
}
