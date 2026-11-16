import * as THREE from "three";
import { Accumulator } from "../core/render/accumulate.ts";
import type { GradeParams } from "../core/render/grade.ts";
import { ProcWorld } from "../world/procworld.ts";
import { samplesNeeded } from "./blur.ts";
import { DURATION } from "./cues.ts";
import { evaluate, evaluateWithin, type FrameState } from "./director.ts";
import { terrain } from "./shots.ts";
import { drawTitles } from "./titles.ts";

export interface FilmOptions {
  width: number;
  height: number;
  /** HDR renders are this many times larger than the output in each direction. */
  supersample: number;
  /** Splat edge softening in square pixels of the HDR render. */
  blurAmount?: number;
  /** `float` costs memory but lets `luminanceStats` read the HDR image back. */
  hdr?: "half" | "float";
}

export interface LuminanceStats {
  mean: number;
  /** Luminance at the 5th, 25th, 50th, 75th, 95th and 99th percentile, then the maximum. */
  percentiles: number[];
  /** Fraction of pixels brighter than 1 (the filmic curve starts to compress). */
  overOne: number;
}

export interface FrameOptions {
  /** Sub-frames averaged into one frame, or `auto` to size them from the motion in the shot. */
  samples?: number | "auto";
  /** Limits for `auto`: the fewest and most sub-frames, and the widest gap in output pixels between copies. */
  auto?: { min?: number; max?: number; spacing?: number };
  /** Fraction of the frame interval the shutter stays open, 0.5 is a 180 degree shutter. */
  shutter?: number;
  fps?: number;
  /** Replaces single grade values, for look development. The finished film never sets it. */
  grade?: Partial<GradeParams>;
}

export interface FrameTiming {
  settleMs: number;
  renderMs: number;
  postMs: number;
  samples: number;
}

class Film {
  private world!: ProcWorld;
  private accumulator!: Accumulator;

  async init(o: FilmOptions): Promise<Record<string, unknown>> {
    const t0 = performance.now();
    this.world = ProcWorld.create({
      canvas: document.getElementById("c") as HTMLCanvasElement,
      width: o.width,
      height: o.height,
      supersample: o.supersample,
      hdr: o.hdr ?? "half",
      capture: true,
      blurAmount: o.blurAmount,
    });
    const { hdrTarget, renderer } = this.world.stage;
    this.accumulator = new Accumulator(renderer, hdrTarget.width, hdrTarget.height);

    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
      splats: this.world.splatCount,
      duration: DURATION,
      loadMs: performance.now() - t0,
      hdr: [hdrTarget.width, hdrTarget.height],
    };
  }

  private async renderHdr(state: FrameState): Promise<{ settleMs: number; renderMs: number }> {
    const { world } = this;
    world.blooms.clear();
    for (const b of state.blooms) world.blooms.plant(b.x, terrain.facetHeight(b.x, b.z, 0.9), b.z, b.clock, b.realm, b.scale);
    world.setView(state.view);
    const t0 = performance.now();
    await world.settle();
    const t1 = performance.now();
    world.drawHdr();
    return { settleMs: t1 - t0, renderMs: performance.now() - t1 };
  }

  /** Renders frame `index` at time `t`. Read the result with `frameBase64` or `png`. */
  async renderFrame(index: number, t: number, options: FrameOptions = {}): Promise<FrameTiming> {
    const fps = options.fps ?? 24;
    const shutter = options.shutter ?? 0.5;
    const samples =
      options.samples === "auto"
        ? samplesNeeded(t, { fps, shutter, height: this.world.post.height, spacing: options.auto?.spacing ?? 3.5, min: options.auto?.min ?? 2, max: options.auto?.max ?? 12 })
        : Math.max(1, options.samples ?? 1);
    const centre = evaluate(t);
    let settleMs = 0;
    let renderMs = 0;

    let hdr: THREE.Texture;
    if (samples === 1) {
      const r = await this.renderHdr(centre);
      settleMs = r.settleMs;
      renderMs = r.renderMs;
      hdr = this.world.hdrTexture;
    } else {
      this.accumulator.clear();
      for (let k = 0; k < samples; k++) {
        const offset = ((k + 0.5) / samples - 0.5) * (shutter / fps);
        const r = await this.renderHdr(evaluateWithin(t, offset));
        settleMs += r.settleMs;
        renderMs += r.renderMs;
        this.accumulator.add(this.world.hdrTexture, 1 / samples);
      }
      hdr = this.accumulator.target.texture;
    }

    const { post } = this.world;
    const tp = performance.now();
    const showTitle = drawTitles(post.titleCanvas, centre.titles);
    if (showTitle) post.titleChanged();
    post.render(hdr, { ...centre.grade, ...options.grade, frame: index }, showTitle ? 1 : 0);
    return { settleMs, renderMs, postMs: performance.now() - tp, samples };
  }

  /** Luminance of the last HDR render before grading. Needs the `float` HDR option. */
  luminanceStats(): LuminanceStats {
    const hdr = this.world.stage.readHdr();
    const n = hdr.length / 4;
    const lum = new Float32Array(n);
    let sum = 0;
    let over = 0;
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * hdr[4 * i]! + 0.7152 * hdr[4 * i + 1]! + 0.0722 * hdr[4 * i + 2]!;
      lum[i] = l;
      sum += l;
      if (l > 1) over++;
    }
    lum.sort();
    const at = (q: number): number => lum[Math.min(n - 1, Math.floor(q * n))]!;
    return { mean: sum / n, percentiles: [0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map(at).concat(lum[n - 1]!), overOne: over / n };
  }

  /** The last frame as raw RGBA bytes, top row first, base64 encoded. */
  async frameBase64(): Promise<string> {
    const bytes = this.world.post.read();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([bytes as BlobPart]));
    });
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }

  png(): string {
    const { post } = this.world;
    const canvas = document.createElement("canvas");
    canvas.width = post.width;
    canvas.height = post.height;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(post.width, post.height);
    image.data.set(post.read());
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  }
}

declare global {
  interface Window {
    film: Film;
  }
}

window.film = new Film();
