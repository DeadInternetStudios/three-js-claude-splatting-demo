/** Tallest vertical field of view a tall window may be given, in degrees. Beyond this the edges stretch too much. */
export const MAX_VERTICAL_FOV = 100;

/**
 * The vertical field of view to render with. A window taller than it is wide would otherwise look through a
 * straw, so below an aspect of 1 the horizontal field holds at what a square window gets, until the vertical
 * field reaches MAX_VERTICAL_FOV. Wide windows keep the field they asked for.
 */
export function lensFov(vertical: number, aspect: number): number {
  if (aspect >= 1) return vertical;
  const widened = (2 * Math.atan(Math.tan((vertical * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return Math.max(vertical, Math.min(MAX_VERTICAL_FOV, widened));
}
