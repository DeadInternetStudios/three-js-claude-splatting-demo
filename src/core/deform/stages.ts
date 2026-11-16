import { sampleCurve, type CurveTable } from "./curve.ts";
import {
  add,
  apply,
  cross,
  det,
  dot,
  identity3,
  mul,
  normalize,
  outer,
  rotationAxisAngle,
  scale,
  singularValues,
  sub,
  addMat,
  scaleMat,
  transpose,
  type Mat3,
  type Vec3,
} from "./math.ts";

export interface GrabParams {
  center: Vec3;
  radius: number;
  displacement: Vec3;
}

export interface TwistParams {
  point: Vec3;
  axis: Vec3;
  /** Radians per unit length along the axis. */
  rate: number;
  /** Axial coordinate at which the twist angle is zero. */
  origin: number;
}

export interface CurveStageParams {
  table: CurveTable;
  /** Axis (0 = x, 1 = y) that is offset from the curve. The curve runs along z in the local frame. */
  offsetAxis: 0 | 1;
  /**
   * Coordinate on the offset axis where the curve runs. Points on either side stretch or compress
   * about it, like the outside and the inside of a bent sheet.
   */
  offsetOrigin?: number;
}

export interface SimilarityParams {
  scale: number;
  rotation: Mat3;
  translation: Vec3;
}

/** A rigid frame the stages run in: local = rotation^T (world - origin). Folds stay relative to whoever moves it. */
export interface FrameParams {
  rotation: Mat3;
  origin: Vec3;
}

/** Rolls the ground plane into a sphere of radius 1 / curvature touching the plane at the apex. */
export interface BowlParams {
  apex: Vec3;
  curvature: number;
  /** Roll angles (radians) where the world starts to fade and where it is gone. */
  fadeStart: number;
  fadeEnd: number;
}

/** A travelling ring of vertical displacement. A wavelength of 0 makes it a single pulse. */
export interface WaveParams {
  center: Vec3;
  amplitude: number;
  radius: number;
  width: number;
  wavelength: number;
}

export interface DeformSpec {
  grab: GrabParams | null;
  twist: TwistParams | null;
  curves: CurveStageParams[];
  similarity: SimilarityParams | null;
  frame?: FrameParams | null;
  bowl?: BowlParams | null;
  wave?: WaveParams | null;
}

export interface Mapped {
  p: Vec3;
  /** Jacobian of the full map at the input point, row-major. */
  j: Mat3;
  /** Visibility from the bowl's fade, 1 where the world is fully present. Only deformPoint sets it. */
  vis?: number;
}

export const emptySpec = (): DeformSpec => ({ grab: null, twist: null, curves: [], similarity: null, frame: null, bowl: null, wave: null });

/** True when no stage is present, so every point maps to itself. */
export function isIdentitySpec(spec: DeformSpec): boolean {
  return !spec.grab && !spec.twist && spec.curves.length === 0 && !spec.similarity && !spec.frame && !spec.bowl && !spec.wave;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function sinc(x: number): number {
  const x2 = x * x;
  return x2 < 1e-6 ? 1 - x2 / 6 + (x2 * x2) / 120 : Math.sin(x) / x;
}

export function grabStage(g: GrabParams, p: Vec3): Mapped {
  const d = sub(p, g.center);
  const r = Math.hypot(d[0], d[1], d[2]);
  const u = r / g.radius;
  if (g.radius <= 0 || u >= 1) return { p, j: identity3() };
  const w = (1 - u) ** 4 * (1 + 4 * u);
  const dw = -20 * u * (1 - u) ** 3;
  const grad: Vec3 = r > 1e-12 ? scale(d, dw / (g.radius * r)) : [0, 0, 0];
  return { p: add(p, scale(g.displacement, w)), j: addMat(identity3(), outer(g.displacement, grad)) };
}

export function twistStage(t: TwistParams, p: Vec3): Mapped {
  const n = normalize(t.axis);
  const q = sub(p, t.point);
  const axial = dot(n, q);
  const radial = sub(q, scale(n, axial));
  const phi = t.rate * (axial - t.origin);
  const rot = rotationAxisAngle(n, phi);
  const rotated = apply(rot, radial);
  const nn = outer(n, n);
  const perp = addMat(identity3(), scaleMat(nn, -1));
  const dPhi = outer(cross(n, rotated), n);
  const j = addMat(addMat(nn, mul(rot, perp)), scaleMat(dPhi, t.rate));
  return { p: add(add(t.point, scale(n, axial)), rotated), j };
}

export function curveStage(c: CurveStageParams, p: Vec3): Mapped {
  const a = c.offsetAxis;
  const origin = c.offsetOrigin ?? 0;
  const v = p[a] - origin;
  const s = sampleCurve(c.table, p[2]);
  const sinT = Math.sin(s.theta);
  const cosT = Math.cos(s.theta);
  const f = 1 - s.kappa * v;
  const out: Vec3 = [p[0], p[1], 0];
  out[a] = origin + s.offset + v * cosT;
  out[2] = s.along - v * sinT;
  const j = identity3();
  j[3 * a + a] = cosT;
  j[3 * a + 2] = sinT * f;
  j[6 + a] = -sinT;
  j[8] = cosT * f;
  return { p: out, j };
}

export function similarityStage(s: SimilarityParams, p: Vec3): Mapped {
  const j = scaleMat(s.rotation, s.scale);
  return { p: add(apply(j, p), s.translation), j };
}

/**
 * A point at height y over the plane lands at radius R + y from the sphere centre, which sits R
 * below the apex. In the basis (outward, tangent, up) the Jacobian is closed form, and it stays
 * regular up to a roll of pi where the map closes on itself.
 */
export function bowlStage(b: BowlParams, p: Vec3): Mapped {
  const k = b.curvature;
  if (k < 1e-7) return { p, j: identity3(), vis: 1 };
  const q = sub(p, b.apex);
  const radius = 1 / k;
  const rho = Math.hypot(q[0], q[2]);
  const phi = rho * k;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const y = q[1];
  const scaleY = 1 + y * k;
  const e: Vec3 = rho > 1e-5 ? [q[0] / rho, 0, q[2] / rho] : [1, 0, 0];
  const t: Vec3 = [-e[2], 0, e[0]];
  const radial = scaleY * c;
  const tangential = scaleY * sinc(phi);
  const coupling = scaleY * s;
  const out: Vec3 = [(radius + y) * s * e[0], -radius + (radius + y) * c, (radius + y) * s * e[2]];
  // Columns of the local Jacobian are d/drho, d/dtangent, d/dy; rows are the outward, tangent and up components.
  const local: Mat3 = [radial, 0, s, 0, tangential, 0, -coupling, 0, c];
  const basis: Mat3 = [e[0], t[0], 0, e[1], t[1], 1, e[2], t[2], 0];
  return { p: add(b.apex, out), j: mul(mul(basis, local), transpose(basis)), vis: 1 - smoothstep(b.fadeStart, b.fadeEnd, phi) };
}

export function waveStage(w: WaveParams, p: Vec3): Mapped {
  if (w.amplitude === 0) return { p, j: identity3() };
  const qx = p[0] - w.center[0];
  const qz = p[2] - w.center[2];
  const rho = Math.hypot(qx, qz);
  const x = (rho - w.radius) / w.width;
  const env = Math.exp(-x * x);
  const denv = (-2 * x * env) / w.width;
  let osc = 1;
  let dosc = 0;
  if (w.wavelength > 0) {
    const arg = (2 * Math.PI * (rho - w.radius)) / w.wavelength;
    osc = Math.cos(arg);
    dosc = (-2 * Math.PI * Math.sin(arg)) / w.wavelength;
  }
  const dy = w.amplitude * env * osc;
  const g = w.amplitude * (denv * osc + env * dosc);
  const dir: [number, number] = rho > 1e-6 ? [qx / rho, qz / rho] : [0, 0];
  const j = identity3();
  j[3] = g * dir[0];
  j[5] = g * dir[1];
  return { p: [p[0], p[1] + dy, p[2]], j };
}

export function deformPoint(spec: DeformSpec, input: Vec3): Mapped {
  let p = input;
  let j = identity3();
  let vis = 1;
  const step = (m: Mapped): void => {
    p = m.p;
    j = mul(m.j, j);
    if (m.vis !== undefined) vis *= m.vis;
  };
  const frame = spec.frame ?? null;
  if (frame) {
    const inverse = transpose(frame.rotation);
    p = apply(inverse, sub(p, frame.origin));
    j = inverse;
  }
  if (spec.grab) step(grabStage(spec.grab, p));
  if (spec.twist) step(twistStage(spec.twist, p));
  for (const c of spec.curves) step(curveStage(c, p));
  if (spec.bowl) step(bowlStage(spec.bowl, p));
  if (spec.wave) step(waveStage(spec.wave, p));
  if (spec.similarity) step(similarityStage(spec.similarity, p));
  if (frame) {
    p = add(apply(frame.rotation, p), frame.origin);
    j = mul(frame.rotation, j);
  }
  return { p, j, vis };
}

export interface Validity {
  minDet: number;
  minSingular: number;
  maxSingular: number;
  ok: boolean;
}

export const VALIDITY_LIMITS = { minDet: 0.35, minSingular: 0.35, maxSingular: 3 } as const;

function forEachGridPoint(min: Vec3, max: Vec3, steps: Vec3, visit: (p: Vec3) => void): void {
  for (let i = 0; i < steps[0]; i++) {
    for (let j = 0; j < steps[1]; j++) {
      for (let k = 0; k < steps[2]; k++) {
        visit([
          min[0] + ((max[0] - min[0]) * i) / (steps[0] - 1),
          min[1] + ((max[1] - min[1]) * j) / (steps[1] - 1),
          min[2] + ((max[2] - min[2]) * k) / (steps[2] - 1),
        ]);
      }
    }
  }
}

/** Samples the Jacobian over a box and reports whether covariance transport stays well conditioned. */
export function analyzeValidity(spec: DeformSpec, min: Vec3, max: Vec3, steps: Vec3 = [5, 9, 65]): Validity {
  let minDet = Infinity;
  let minS = Infinity;
  let maxS = 0;
  forEachGridPoint(min, max, steps, (p) => {
    const jac = deformPoint(spec, p).j;
    const sv = singularValues(jac);
    minDet = Math.min(minDet, det(jac));
    minS = Math.min(minS, sv[2]);
    maxS = Math.max(maxS, sv[0]);
  });
  return {
    minDet,
    minSingular: minS,
    maxSingular: maxS,
    ok: minDet >= VALIDITY_LIMITS.minDet && minS >= VALIDITY_LIMITS.minSingular && maxS <= VALIDITY_LIMITS.maxSingular,
  };
}
