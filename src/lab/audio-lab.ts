import { Score, type ScoreEvent, type ScoreFrame } from "../play/audio.ts";

export interface AudioScene {
  name: string;
  seconds: number;
  /** Frame state at time t, merged over a standing walker in realm 0. */
  frame?: (t: number) => Partial<ScoreFrame>;
  events?: { t: number; kind: ScoreEvent; strength?: number; on?: boolean }[];
}

export interface AudioReport {
  name: string;
  seconds: number;
  /** Loudness of each half second in dBFS. */
  rmsDb: number[];
  peak: number;
  clipped: number;
  /** Mean of left minus right over the mean of both, as a rough balance check. */
  balance: number;
  dc: number;
  /** Spectral centroid in Hz of a few windows. */
  centroid: number[];
  /** Share of the frames that are quieter than -60 dBFS. */
  silent: number;
}

const BASE: ScoreFrame = { dt: 0.05, realmA: 0, realmB: 0, realmBlend: 0, speed: 0, flying: false, gliding: false, grounded: true, planet: 0, altitude: 0 };

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function centroidAt(data: Float32Array, start: number, sampleRate: number): number {
  const n = 4096;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = (data[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k++) {
    const m = Math.hypot(re[k]!, im[k]!);
    num += m * ((k * sampleRate) / n);
    den += m;
  }
  return den > 0 ? num / den : 0;
}

/** Renders a scene of the score offline and measures it. */
export async function renderScene(scene: AudioScene): Promise<AudioReport> {
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * scene.seconds), sampleRate);
  const score = new Score();
  score.attach(ctx);
  const events = [...(scene.events ?? [])].sort((a, b) => a.t - b.t);
  let next = 0;
  const step = 0.05;
  for (let t = step; t < scene.seconds; t += step) {
    ctx.suspend(t).then(() => {
      while (next < events.length && events[next]!.t <= t) {
        const e = events[next++]!;
        score.event(e.kind, e.strength ?? 1, e.on ?? true);
      }
      score.update({ ...BASE, ...(scene.frame?.(t) ?? {}) });
      void ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  const half = Math.floor(sampleRate / 2);
  const rmsDb: number[] = [];
  let peak = 0;
  let clipped = 0;
  let sumL = 0;
  let sumR = 0;
  let dc = 0;
  for (let w = 0; w * half < l.length; w++) {
    let acc = 0;
    let count = 0;
    for (let i = w * half; i < Math.min(l.length, (w + 1) * half); i++) {
      const a = l[i]!;
      const b = r[i]!;
      acc += (a * a + b * b) / 2;
      count++;
      peak = Math.max(peak, Math.abs(a), Math.abs(b));
      if (Math.abs(a) >= 0.999 || Math.abs(b) >= 0.999) clipped++;
      sumL += Math.abs(a);
      sumR += Math.abs(b);
      dc += (a + b) / 2;
    }
    rmsDb.push(Math.round(20 * Math.log10(Math.sqrt(acc / Math.max(1, count)) + 1e-9) * 10) / 10);
  }
  const centroid: number[] = [];
  for (let s = 2; s < scene.seconds - 1; s += Math.max(2, scene.seconds / 6)) centroid.push(Math.round(centroidAt(l, Math.floor(s * sampleRate), sampleRate)));
  return {
    name: scene.name,
    seconds: scene.seconds,
    rmsDb,
    peak: Math.round(peak * 1000) / 1000,
    clipped,
    balance: Math.round(((sumL - sumR) / Math.max(1e-9, sumL + sumR)) * 1000) / 1000,
    dc: Math.round((dc / l.length) * 1e6) / 1e6,
    centroid,
    silent: rmsDb.filter((d) => d < -60).length / rmsDb.length,
  };
}

declare global {
  interface Window {
    audioLab: { renderScene: typeof renderScene };
  }
}
window.audioLab = { renderScene };
