export const QUALITIES = ["auto", "high", "medium", "low"] as const;
export type Quality = (typeof QUALITIES)[number];

/** The resolution scale each manual setting holds. `auto` is absent because the governor picks it. */
export const QUALITY_SCALE: Record<Exclude<Quality, "auto">, number> = { high: 1, medium: 0.7, low: 0.5 };

/**
 * The level of ground detail that goes with a render scale. Generating the splats costs more than painting
 * the pixels, so a scale that goes down has to take splats away or a slow machine gains little.
 */
export function groundDetailFor(scale: number): number {
  return scale >= 0.8 ? 0 : scale >= 0.7 ? 1 : scale >= 0.6 ? 2 : 3;
}

/** Reads a `?quality=` value. Anything unknown means `auto`. */
export function parseQuality(text: string | null): Quality {
  return QUALITIES.find((q) => q === text) ?? "auto";
}

export function nextQuality(quality: Quality): Quality {
  return QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]!;
}
