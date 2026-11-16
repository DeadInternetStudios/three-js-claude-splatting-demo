import data from "./audio-cues.json" with { type: "json" };

export interface Onset {
  t: number;
  strength: number;
}

export const DURATION: number = data.duration;
export const GRID = data.grid as { t0: number; bar: number; beat: number };
export const IMPACTS = data.impacts as Onset[];
export const ONSETS = data.onsets as Onset[];
export const RISERS = data.risers as { start: number; end: number; gainDb: number }[];

/** Named moments in the track. A test checks each one against the analysed impacts and onsets. */
export const CUE = {
  open: 0.02,
  hit1: 4.389,
  hit2: 8.754,
  hit3: 13.108,
  drop: 17.485,
  accent: 19.691,
  riser1: { start: RISERS[0]!.start, end: RISERS[0]!.end },
  riser2: { start: RISERS[1]!.start, end: RISERS[1]!.end },
  stop: 37.071,
  snap: 39.311,
  title: 43.665,
  end: DURATION,
} as const;

/**
 * Sum of decaying kicks, one per onset: 1 on the hit, falling to 1/e after `tau` seconds.
 * Strength is compressed with a square root so a loud hit is bigger but not overwhelming.
 */
export function pulse(t: number, onsets: readonly Onset[], tau: number, minStrength = 0): number {
  let sum = 0;
  for (const o of onsets) {
    if (o.t > t || o.strength < minStrength) continue;
    const dt = t - o.t;
    if (dt > tau * 6) continue;
    sum += Math.sqrt(Math.min(o.strength, 25) / 25) * Math.exp(-dt / tau);
  }
  return sum;
}

const envelopeHz = data.envelope.hz;

/** Normalised loudness (0..1) of one band at time t, linearly interpolated. */
export function envelope(band: "rms" | "bass" | "high", t: number): number {
  const arr = data.envelope[band];
  const x = Math.min(Math.max(t * envelopeHz, 0), arr.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = arr[i]!;
  const b = arr[Math.min(i + 1, arr.length - 1)]!;
  return a + (b - a) * f;
}

