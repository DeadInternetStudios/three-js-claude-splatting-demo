export const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * Smooth interpolation through (time, value) keys. Each segment eases in and out, so values hold
 * still at every key.
 */
export function keys(t: number, points: readonly (readonly [number, number])[]): number {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (t <= b[0]) {
      const a = points[i - 1]!;
      return lerp(a[1], b[1], smoothstep(a[0], b[0], t));
    }
  }
  return last[1];
}

/**
 * Distance covered by something that moves at `v0` and speeds up to `v1` between times `t0` and `t1`,
 * with the speed easing in like a smootherstep. Time before `t0` is spent at `v0`.
 */
export function rampDistance(u: number, t0: number, t1: number, v0: number, v1: number): number {
  if (u <= t0) return v0 * u;
  const x = (u - t0) / (t1 - t0);
  const area = x < 1 ? x ** 6 - 3 * x ** 5 + 2.5 * x ** 4 : 0.5 + (x - 1);
  return v0 * u + (v1 - v0) * (t1 - t0) * area;
}
