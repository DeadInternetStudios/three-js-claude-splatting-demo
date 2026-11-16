/** Where the walker stands and what they have switched on, as a link anyone can open. */
export interface ShareState {
  seed: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Height above the ground in metres, so a flight is restored in the air. */
  agl: number;
}

const RANGES = {
  seed: [0, 0xffffffff],
  x: [-2e6, 2e6],
  z: [-2e6, 2e6],
  yaw: [-100, 100],
  pitch: [-1.6, 1.6],
  agl: [0, 5000],
} as const satisfies Record<keyof ShareState, readonly [number, number]>;

const round = (v: number, digits: number): string => String(Number(v.toFixed(digits)));

export function formatShare(s: ShareState): string {
  return `s=${s.seed}&x=${round(s.x, 1)}&z=${round(s.z, 1)}&yaw=${round(s.yaw, 3)}&pitch=${round(s.pitch, 3)}&agl=${round(s.agl, 1)}`;
}

export type ParseResult = { ok: true; state: ShareState } | { ok: false; reason: string };

/** Reads a `#...` link. An empty hash is not an error. Anything out of range rejects the whole link. */
export function parseShare(hash: string): ParseResult | null {
  const text = hash.replace(/^#/, "");
  if (text === "") return null;
  const params = new URLSearchParams(text);
  const out: Partial<ShareState> = {};
  for (const key of Object.keys(RANGES) as (keyof ShareState)[]) {
    const raw = params.get(key === "seed" ? "s" : key);
    if (raw === null) {
      if (key === "pitch" || key === "agl") {
        out[key] = 0;
        continue;
      }
      return { ok: false, reason: `missing ${key}` };
    }
    const value = Number(raw);
    const [lo, hi] = RANGES[key];
    if (!Number.isFinite(value) || value < lo || value > hi) return { ok: false, reason: `${key} is out of range` };
    out[key] = value;
  }
  if (!Number.isInteger(out.seed)) return { ok: false, reason: "seed must be a whole number" };
  return { ok: true, state: out as ShareState };
}
