export interface GradeParams {
  /** Exposure in stops. */
  exposure: number;
  bloom: number;
  /** Brightest value, after exposure, that feeds the glow. Lamps far above it clip instead of flooding the frame. */
  bloomClamp: number;
  /** 0 keeps the glow tight, 1 spreads it wide. */
  bloomSpread: number;
  /** Warm red tint on the widest glow, like film halation. */
  halation: number;
  contrast: number;
  saturation: number;
  /** Multipliers applied to shadows and highlights; 1 leaves them alone. */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  split: number;
  vignette: number;
  grain: number;
  /** Chromatic aberration at the corners, as a fraction of the frame width. */
  aberration: number;
  /** Black lift in display units. */
  lift: number;
  /** 0 is black, 1 is untouched. */
  fade: number;
  /** A burst of light: 0 is off, 1 raises the exposure by 2.5 stops, flares the glow and lifts the blacks a little. */
  flash: number;
  /** Shafts of light streaming from the sun's glow through whatever stands in front of it. 0 is off. */
  shafts: number;
  /** Ghosts and a streak of the sun in the lens, when the sun is in view and not hidden. 0 is off. */
  flare: number;
  frame: number;
}

export function defaultGrade(): GradeParams {
  return {
    exposure: 0,
    bloom: 0.5,
    bloomClamp: 8,
    bloomSpread: 0.5,
    halation: 0.4,
    contrast: 1.08,
    saturation: 0.92,
    shadowTint: [0.9, 1.0, 1.1],
    highlightTint: [1.08, 1.0, 0.9],
    split: 0.7,
    vignette: 0.35,
    grain: 0.014,
    aberration: 0.0015,
    lift: 0.006,
    fade: 1,
    flash: 0,
    shafts: 0,
    flare: 0,
    frame: 0,
  };
}
