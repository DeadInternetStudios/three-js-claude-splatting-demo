// Lightning is a pure function of the clock. Time is cut into slots, each slot may hold one flash of
// one to three strokes, and the sky, the light on the ground and the thunder all read the same
// answer, so no state has to be shared or saved.

/** Seconds per slot. A flash and its strokes always end inside the slot they start in. */
export const STORM_SLOT = 6;

/** Share of slots that hold a flash when the storm is at full strength. */
const FLASH_RATE = 0.62;
/** How fast one stroke fades, per second. */
const FADE = 13;

export interface Flash {
  /** Names the flash, so thunder can follow it once. */
  id: number;
  /** World time of the first stroke. */
  start: number;
  /** Direction of the bolt as an azimuth in radians, 0 looking down -z like the sun. */
  azimuth: number;
  /** 0 far away, 1 overhead. */
  closeness: number;
  /** Random number in 0 to 1 that shapes the bolt. */
  shape: number;
  /** Seconds after `start` at which each stroke lights up, and how bright it is. */
  strokes: readonly (readonly [number, number])[];
}

export interface Lightning {
  /** How bright the flash is now, from 0 to 1. */
  level: number;
  /** The flash of the current slot, or null when the slot holds none. */
  flash: Flash | null;
}

export const NO_LIGHTNING: Lightning = { level: 0, flash: null };

function unit(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The flash of one slot, or null. `strength` from 0 to 1 scales how often slots hold one. */
export function flashInSlot(slot: number, seed: number, strength: number): Flash | null {
  if (unit(slot, seed, 1) >= FLASH_RATE * strength) return null;
  const start = slot * STORM_SLOT + 0.3 + unit(slot, seed, 2) * (STORM_SLOT - 1.8);
  const strokes: [number, number][] = [[0, 1]];
  strokes.push([0.07 + 0.1 * unit(slot, seed, 5), 0.45 + 0.35 * unit(slot, seed, 6)]);
  if (unit(slot, seed, 7) > 0.45) strokes.push([0.26 + 0.2 * unit(slot, seed, 8), 0.65 + 0.35 * unit(slot, seed, 9)]);
  return {
    id: slot,
    start,
    azimuth: unit(slot, seed, 3) * Math.PI * 2,
    closeness: Math.pow(unit(slot, seed, 4), 0.8),
    shape: unit(slot, seed, 10),
    strokes,
  };
}

function stroke(age: number): number {
  return age < 0 ? 0 : ((1 - Math.exp(-age * 120)) * Math.exp(-age * FADE)) / 0.78;
}

/** How bright a given flash is at `time`. */
export function lightningFrom(flash: Flash, time: number): Lightning {
  let level = 0;
  for (const [offset, power] of flash.strokes) level = Math.max(level, power * stroke(time - flash.start - offset));
  return { level: Math.min(level, 1), flash };
}

/** The lightning at `time` in a storm of the given strength. */
export function lightningAt(time: number, seed: number, strength: number): Lightning {
  const flash = flashInSlot(Math.floor(time / STORM_SLOT), seed, strength);
  return flash ? lightningFrom(flash, time) : NO_LIGHTNING;
}
