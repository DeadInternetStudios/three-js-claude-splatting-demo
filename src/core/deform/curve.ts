/**
 * Planar curve that hinges the ground ahead of the walker. The forward axis is parametrised by arclength s.
 * The tangent angle theta(s) is the sum of smooth folds; positions follow from it.
 *
 * The table stores exact knots. Between knots theta is linear, so the curve is a circular arc
 * and the position map and its Jacobian are exactly consistent (no numeric differentiation).
 */

export interface Fold {
  /** Rest-space coordinate along the forward axis where the fold is centred. */
  center: number;
  /** The fold acts on [center - halfWidth, center + halfWidth]. */
  halfWidth: number;
  /** Total tangent turn in radians. Positive turns the forward axis toward the offset axis. */
  angle: number;
  /**
   * Fraction of the span spent easing in and out, in (0, 1]. 1 gives a pure cosine bump with the
   * highest peak curvature; smaller values flatten the curvature into a plateau.
   */
  ease?: number;
}

export interface CurveTable {
  s0: number;
  ds: number;
  count: number;
  /** RGBA32F texels: along position, offset position, theta, unused. */
  texels: Float32Array;
}

export interface CurveSample {
  /** Position of the curve along the original forward direction. */
  along: number;
  /** Position of the curve along the offset direction. */
  offset: number;
  theta: number;
  kappa: number;
}

export const DEFAULT_EASE = 0.35;

/** Knots a curve table may hold. The GPU reads the table from a texture of this width. */
export const CURVE_TEXTURE_WIDTH = 1024;

/** Curvature shape on x in [0, 1] with unit integral: raised-cosine ramps around a plateau. */
function shape(x: number, rho: number): number {
  if (x <= 0 || x >= 1) return 0;
  const peak = 1 / (1 - rho);
  if (x < rho) return (peak * (1 - Math.cos((Math.PI * x) / rho))) / 2;
  if (x > 1 - rho) return (peak * (1 - Math.cos((Math.PI * (1 - x)) / rho))) / 2;
  return peak;
}

/** Integral of `shape` from 0 to x. */
function shapeIntegral(x: number, rho: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const peak = 1 / (1 - rho);
  const rampArea = (t: number): number => t / 2 - (rho / (2 * Math.PI)) * Math.sin((Math.PI * t) / rho);
  if (x < rho) return peak * rampArea(x);
  if (x <= 1 - rho) return peak * (rho / 2 + (x - rho));
  return 1 - peak * rampArea(1 - x);
}

const rhoOf = (f: Fold): number => Math.min(1, Math.max(1e-3, f.ease ?? DEFAULT_EASE)) / 2;
const unitSpan = (f: Fold, s: number): number => (s - (f.center - f.halfWidth)) / (2 * f.halfWidth);

export function thetaAt(folds: readonly Fold[], s: number): number {
  let t = 0;
  for (const f of folds) t += f.angle * shapeIntegral(unitSpan(f, s), rhoOf(f));
  return t;
}

export function curvatureAt(folds: readonly Fold[], s: number): number {
  let k = 0;
  for (const f of folds) k += ((f.angle / (2 * f.halfWidth)) * shape(unitSpan(f, s), rhoOf(f)));
  return k;
}

export function sinc(x: number): number {
  return Math.abs(x) < 1e-3 ? 1 - (x * x) / 6 + (x * x * x * x) / 120 : Math.sin(x) / x;
}

/** Exact displacement along an arc of length `d` that turns by `phi`, starting at tangent angle `a`. */
export function arcStep(a: number, phi: number, d: number): [number, number] {
  const m = d * sinc(phi / 2);
  return [m * Math.cos(a + phi / 2), m * Math.sin(a + phi / 2)];
}

export function buildCurveTable(folds: readonly Fold[], s0: number, s1: number, count = 512): CurveTable {
  const ds = (s1 - s0) / (count - 1);
  const texels = new Float32Array(count * 4);
  let u = s0;
  let v = 0;
  let thetaPrev = thetaAt(folds, s0);
  texels[0] = u;
  texels[1] = v;
  texels[2] = thetaPrev;
  for (let k = 1; k < count; k++) {
    const theta = thetaAt(folds, s0 + k * ds);
    const [du, dv] = arcStep(thetaPrev, theta - thetaPrev, ds);
    u += du;
    v += dv;
    thetaPrev = theta;
    texels[4 * k] = u;
    texels[4 * k + 1] = v;
    texels[4 * k + 2] = theta;
  }
  return { s0, ds, count, texels };
}

/** Mirrors the GLSL lookup exactly: knots in float32, arc evaluation in the caller's precision. */
export function sampleCurve(table: CurveTable, s: number): CurveSample {
  const { s0, ds, count, texels } = table;
  const last = count - 1;
  const x = (s - s0) / ds;
  if (x <= 0 || x >= last) {
    const k = x <= 0 ? 0 : last;
    const theta = texels[4 * k + 2]!;
    const dist = s - (s0 + k * ds);
    return {
      along: texels[4 * k]! + dist * Math.cos(theta),
      offset: texels[4 * k + 1]! + dist * Math.sin(theta),
      theta,
      kappa: 0,
    };
  }
  const k = Math.floor(x);
  const delta = (x - k) * ds;
  const t0 = texels[4 * k + 2]!;
  const t1 = texels[4 * (k + 1) + 2]!;
  const kappa = (t1 - t0) / ds;
  const phi = kappa * delta;
  const [du, dv] = arcStep(t0, phi, delta);
  return {
    along: texels[4 * k]! + du,
    offset: texels[4 * k + 1]! + dv,
    theta: t0 + phi,
    kappa,
  };
}
