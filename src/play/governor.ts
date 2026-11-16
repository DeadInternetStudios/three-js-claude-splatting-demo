export interface GovernorOptions {
  min: number;
  max: number;
  /** Change in resolution scale per adjustment. */
  step: number;
  start: number;
}

/** A gap this long is a pause, such as a hidden tab or a window drag, and not the pace of the frames. */
const STALL_MS = 250;

/**
 * Keeps the frame rate near the display's rate by trading resolution. It drops quickly when frames
 * run slow and probes upward only after a long clean stretch, and it remembers the scale that just
 * failed so it does not bounce between two scales.
 */
export class ResolutionGovernor {
  scale: number;
  private ema: number;
  private floorMs = Infinity;
  private slowFor = 0;
  private fastFor = 0;
  private cooldown = 0;
  private clock = 0;
  private failedScale = Infinity;
  private failedUntil = 0;

  private locked = false;

  constructor(private readonly options: GovernorOptions) {
    this.scale = options.start;
    this.ema = 1000 / 60;
  }

  /** Holds the resolution at `scale` and stops adapting, or hands control back with `null`. */
  lock(scale: number | null): void {
    this.locked = scale !== null;
    if (scale !== null) this.scale = Math.min(this.options.max, Math.max(this.options.min, scale));
    this.slowFor = 0;
    this.fastFor = 0;
    this.cooldown = 1.5;
    this.failedScale = Infinity;
  }

  /** Feed the time between frames. Returns the new scale when it changes. */
  observe(frameMs: number): number | null {
    const ms = Math.min(frameMs, STALL_MS);
    const dt = ms / 1000;
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.ema += (ms - this.ema) * 0.08;
    this.floorMs = Math.min(this.floorMs, this.ema);

    this.slowFor = this.ema > this.floorMs * 1.5 ? this.slowFor + dt : 0;
    this.fastFor = this.ema < this.floorMs * 1.12 ? this.fastFor + dt : 0;
    if (this.locked || this.cooldown > 0) return null;

    const { min, max, step } = this.options;
    if (this.slowFor > 0.7 && this.scale > min) {
      this.failedScale = this.scale;
      this.failedUntil = this.clock + 20;
      return this.change(Math.max(min, this.scale - step), 1);
    }
    const probing = this.clock > this.failedUntil || this.scale + step < this.failedScale;
    if (this.fastFor > 4 && this.scale < max && probing) return this.change(Math.min(max, this.scale + step), 1.5);
    return null;
  }

  private change(scale: number, cooldown: number): number {
    this.scale = Math.round(scale * 100) / 100;
    this.cooldown = cooldown;
    this.slowFor = 0;
    this.fastFor = 0;
    return this.scale;
  }
}
