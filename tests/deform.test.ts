import { describe, expect, it } from "vitest";
import { arcStep, buildCurveTable, curvatureAt, sampleCurve, thetaAt, type Fold } from "../src/core/deform/curve.ts";
import { det, identity3, mul, rotationAxisAngle, singularValues, transportCovariance, transpose, type Mat3, type Vec3 } from "../src/core/deform/math.ts";
import {
  analyzeValidity,
  deformPoint,
  emptySpec,
  type DeformSpec,
} from "../src/core/deform/stages.ts";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const curlFolds: Fold[] = [{ center: 60, halfWidth: 40, angle: (130 * Math.PI) / 180 }];

function curlSpec(): DeformSpec {
  const spec = emptySpec();
  spec.curves.push({ table: buildCurveTable(curlFolds, 0, 140, 512), offsetAxis: 1 });
  return spec;
}

function fullSpec(): DeformSpec {
  const spec = curlSpec();
  spec.grab = { center: [0.5, 3, 40], radius: 9, displacement: [1.5, 2, -1] };
  spec.twist = { point: [0, 0, 0], axis: [0.1, 0.05, 1], rate: 0.01, origin: 0 };
  spec.curves.push({ table: buildCurveTable([{ center: 70, halfWidth: 20, angle: 0.5 }], 20, 120, 256), offsetAxis: 0 });
  spec.similarity = { scale: 0.8, rotation: rotationAxisAngle([0.3, 1, 0.2], 0.4), translation: [1, 2, 3] };
  return spec;
}

function numericJacobian(spec: DeformSpec, p: Vec3, h = 1e-6): Mat3 {
  const cols: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = [...p] as Vec3;
    const b = [...p] as Vec3;
    a[i] = a[i]! + h;
    b[i] = b[i]! - h;
    const pa = deformPoint(spec, a).p;
    const pb = deformPoint(spec, b).p;
    cols.push([(pa[0] - pb[0]) / (2 * h), (pa[1] - pb[1]) / (2 * h), (pa[2] - pb[2]) / (2 * h)]);
  }
  return [cols[0]![0], cols[1]![0], cols[2]![0], cols[0]![1], cols[1]![1], cols[2]![1], cols[0]![2], cols[1]![2], cols[2]![2]];
}

function maxAbsDiff(a: readonly number[], b: readonly number[]): number {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
}

describe("deformation Jacobians", () => {
  it("is the identity for an empty spec", () => {
    const m = deformPoint(emptySpec(), [1, 2, 3]);
    expect(m.p).toEqual([1, 2, 3]);
    expect(m.j).toEqual(identity3());
  });

  it("matches finite differences for the curl alone", () => {
    const spec = curlSpec();
    const r = rng(1);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(r() - 0.5) * 8, r() * 14 - 1, r() * 130 + 5];
      expect(maxAbsDiff(deformPoint(spec, p).j, numericJacobian(spec, p))).toBeLessThan(2e-6);
    }
  });

  it("matches finite differences for every stage composed", () => {
    const spec = fullSpec();
    const r = rng(2);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(r() - 0.5) * 8, r() * 12, r() * 120 + 10];
      expect(maxAbsDiff(deformPoint(spec, p).j, numericJacobian(spec, p))).toBeLessThan(5e-6);
    }
  });

  it("matches finite differences when the curve runs at mid-height", () => {
    const spec = curlSpec();
    spec.curves[0]!.offsetOrigin = 6.5;
    const r = rng(3);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(r() - 0.5) * 8, r() * 14 - 1, r() * 130 + 5];
      expect(maxAbsDiff(deformPoint(spec, p).j, numericJacobian(spec, p))).toBeLessThan(2e-6);
    }
  });

  it("moves the curve with the offset origin and leaves a flat curve untouched", () => {
    const flat = emptySpec();
    flat.curves.push({ table: buildCurveTable([], 0, 100, 64), offsetAxis: 1, offsetOrigin: 5 });
    deformPoint(flat, [1, 7, 40]).p.forEach((v, i) => expect(v).toBeCloseTo([1, 7, 40][i]!, 4));

    const bent = curlSpec();
    const base = bent.curves[0]!;
    const sameLine = (origin: number): Vec3 => deformPoint({ ...bent, curves: [{ ...base, offsetOrigin: origin }] }, [0, origin, 70]).p;
    const low = sameLine(0);
    const high = sameLine(6.5);
    expect(high[1]).toBeCloseTo(low[1] + 6.5, 9);
    expect(high[2]).toBeCloseTo(low[2], 9);
  });

  it("keeps grab compactly supported", () => {
    const spec = emptySpec();
    spec.grab = { center: [0, 0, 0], radius: 2, displacement: [1, 0, 0] };
    expect(deformPoint(spec, [2.5, 0, 0]).p).toEqual([2.5, 0, 0]);
    expect(deformPoint(spec, [0, 0, 0]).p[0]).toBeCloseTo(1, 12);
  });
});

describe("world stages", () => {
  const rotation = rotationAxisAngle([0.2, 1, -0.1], 0.9);

  function bowlSpec(): DeformSpec {
    const spec = emptySpec();
    spec.bowl = { apex: [1, 0.5, -2], curvature: 1 / 30, fadeStart: 2.6, fadeEnd: 3.05 };
    return spec;
  }

  it("matches finite differences for the bowl, including points above and below the plane", () => {
    const spec = bowlSpec();
    const r = rng(11);
    for (let i = 0; i < 600; i++) {
      const p: Vec3 = [(r() - 0.5) * 120, (r() - 0.3) * 40, (r() - 0.5) * 120];
      expect(maxAbsDiff(deformPoint(spec, p).j, numericJacobian(spec, p))).toBeLessThan(2e-6);
    }
  });

  it("is regular on the axis and close to the identity for a flat bowl", () => {
    const axis = deformPoint(bowlSpec(), [1, 0.5, -2]);
    expect(axis.p).toEqual([1, 0.5, -2]);
    expect(maxAbsDiff(axis.j, identity3())).toBeLessThan(1e-12);
    const flat = emptySpec();
    flat.bowl = { apex: [0, 0, 0], curvature: 0, fadeStart: 2, fadeEnd: 3 };
    expect(deformPoint(flat, [5, 2, 7]).p).toEqual([5, 2, 7]);
  });

  it("wraps the ground onto a sphere and lifts points by their height", () => {
    const spec = emptySpec();
    spec.bowl = { apex: [0, 0, 0], curvature: 0.05, fadeStart: 3, fadeEnd: 3.1 };
    const radius = 20;
    const quarter = (Math.PI / 2) * radius;
    const onGround = deformPoint(spec, [quarter, 0, 0]).p;
    expect(onGround[0]).toBeCloseTo(radius, 9);
    expect(onGround[1]).toBeCloseTo(-radius, 9);
    const above = deformPoint(spec, [quarter, 5, 0]).p;
    expect(above[0]).toBeCloseTo(radius + 5, 9);
  });

  it("fades the far side of the bowl out", () => {
    const spec = bowlSpec();
    const near = deformPoint(spec, [1, 0.5, 20]);
    const far = deformPoint(spec, [1, 0.5, 30 * 3.2 - 2]);
    expect(near.vis).toBe(1);
    expect(far.vis).toBe(0);
  });

  it("matches finite differences for the wave", () => {
    const spec = emptySpec();
    spec.wave = { center: [2, 0, 3], amplitude: 4, radius: 18, width: 7, wavelength: 11 };
    const r = rng(12);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(r() - 0.5) * 80, (r() - 0.5) * 6, (r() - 0.5) * 80];
      expect(maxAbsDiff(deformPoint(spec, p).j, numericJacobian(spec, p))).toBeLessThan(2e-6);
    }
  });

  it("conjugates the stages with a rigid frame and keeps the Jacobian exact", () => {
    const spec = fullSpec();
    spec.frame = { rotation, origin: [4, -1, 9] };
    spec.bowl = { apex: [0, 0, 0], curvature: 1 / 90, fadeStart: 2.8, fadeEnd: 3.1 };
    spec.wave = { center: [1, 0, 20], amplitude: 2, radius: 25, width: 9, wavelength: 0 };
    const r = rng(13);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(r() - 0.5) * 30, r() * 12, r() * 100];
      expect(maxAbsDiff(deformPoint(spec, p).j, numericJacobian(spec, p, 1e-5))).toBeLessThan(5e-5);
    }
  });

  it("leaves the frame itself fixed when no stage is active", () => {
    const spec = emptySpec();
    spec.frame = { rotation, origin: [4, -1, 9] };
    const p: Vec3 = [3, 7, -2];
    const out = deformPoint(spec, p);
    out.p.forEach((v, i) => expect(v).toBeCloseTo(p[i]!, 12));
    expect(maxAbsDiff(out.j, identity3())).toBeLessThan(1e-12);
  });
});

describe("curve table", () => {
  it("hits the exact total turn and stays rest-like before the first fold", () => {
    const table = buildCurveTable(curlFolds, 0, 140, 512);
    const end = sampleCurve(table, 140);
    expect(end.theta).toBeCloseTo(curlFolds[0]!.angle, 5);
    const early = sampleCurve(table, 10);
    expect(early.along).toBeCloseTo(10, 5);
    expect(early.offset).toBeCloseTo(0, 5);
  });

  it("reproduces knot angles from the profile", () => {
    const table = buildCurveTable(curlFolds, 0, 140, 512);
    for (const k of [0, 100, 255, 400, 511]) {
      expect(table.texels[4 * k + 2]).toBeCloseTo(thetaAt(curlFolds, k * table.ds), 5);
    }
  });

  it("integrates positions consistently with its piecewise-linear angle", () => {
    const table = buildCurveTable(curlFolds, 0, 140, 512);
    let u = 0;
    let v = 0;
    const sub = 40;
    for (let k = 0; k < 400; k++) {
      const t0 = table.texels[4 * k + 2]!;
      const t1 = table.texels[4 * (k + 1) + 2]!;
      for (let i = 0; i < sub; i++) {
        const a = t0 + ((t1 - t0) * (i + 0.5)) / sub;
        u += (table.ds / sub) * Math.cos(a);
        v += (table.ds / sub) * Math.sin(a);
      }
    }
    expect(Math.abs(sampleCurve(table, 400 * table.ds).along - u)).toBeLessThan(2e-4);
    expect(Math.abs(sampleCurve(table, 400 * table.ds).offset - v)).toBeLessThan(2e-4);
  });

  it("has a curvature profile that integrates to the fold angle", () => {
    const folds: Fold[] = [{ center: 50, halfWidth: 30, angle: 1.7, ease: 0.4 }];
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += curvatureAt(folds, 20 + ((i + 0.5) * 60) / n) * (60 / n);
    expect(sum).toBeCloseTo(1.7, 4);
    expect(thetaAt(folds, 80)).toBeCloseTo(1.7, 12);
    expect(thetaAt(folds, 50)).toBeCloseTo(0.85, 12);
  });

  it("agrees with a closed-form circle for constant curvature", () => {
    const radius = 25;
    const [du, dv] = arcStep(0, 1.2, radius * 1.2);
    expect(du).toBeCloseTo(radius * Math.sin(1.2), 12);
    expect(dv).toBeCloseTo(radius * (1 - Math.cos(1.2)), 12);
    const [tu, tv] = arcStep(0.3, 1e-12, 2);
    expect(tu).toBeCloseTo(2 * Math.cos(0.3), 9);
    expect(tv).toBeCloseTo(2 * Math.sin(0.3), 9);
  });
});

describe("covariance transport", () => {
  it("keeps symmetry and rotates the spectrum rigidly", () => {
    const sigma: Mat3 = [0.04, 0.01, 0, 0.01, 0.09, 0.02, 0, 0.02, 0.0004];
    const rot = rotationAxisAngle([1, 2, 3], 0.7);
    const out = transportCovariance(rot, sigma);
    expect(maxAbsDiff(out, transpose(out))).toBeLessThan(1e-15);
    expect(singularValues(out).map((v) => +v.toFixed(9))).toEqual(singularValues(sigma).map((v) => +v.toFixed(9)));
  });

  it("scales the covariance of a stretched axis quadratically", () => {
    const sigma: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const j: Mat3 = [2, 0, 0, 0, 1, 0, 0, 0, 0.5];
    const out = transportCovariance(j, sigma);
    expect(out[0]).toBeCloseTo(4, 12);
    expect(out[8]).toBeCloseTo(0.25, 12);
    expect(det(mul(j, transpose(j)))).toBeCloseTo(det(j) ** 2, 12);
  });

  it("recovers singular values of a diagonal matrix", () => {
    const sv = singularValues([3, 0, 0, 0, 1, 0, 0, 0, 0.5]);
    expect(sv[0]).toBeCloseTo(3, 9);
    expect(sv[1]).toBeCloseTo(1, 9);
    expect(sv[2]).toBeCloseTo(0.5, 9);
  });
});

describe("validity", () => {
  it("accepts a wide curl over tall objects", () => {
    const v = analyzeValidity(curlSpec(), [-3, 0, 0], [3, 13, 140]);
    expect(v.ok).toBe(true);
    expect(v.minDet).toBeGreaterThan(0.5);
  });

  it("rejects a tight curl that would invert tall objects", () => {
    const spec = emptySpec();
    spec.curves.push({ table: buildCurveTable([{ center: 10, halfWidth: 6, angle: 2.5 }], 0, 20, 256), offsetAxis: 1 });
    expect(analyzeValidity(spec, [-3, 0, 0], [3, 13, 20]).ok).toBe(false);
  });
});
