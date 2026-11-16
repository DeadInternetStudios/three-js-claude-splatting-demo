import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { deformPoint } from "../src/core/deform/stages.ts";
import { det, singularValues, type Vec3 } from "../src/core/deform/math.ts";
import { foldSpec, noFolds, type FoldAmounts } from "../src/world/folds.ts";

const feet = new THREE.Vector3(120, 30, -80);
const heading = 0.7;

/** Points on rings around the walker, `directions` to a ring, at each height above the walker. */
function around(radius: number, heights: number[], step: number, directions = 32): Vec3[] {
  const out: Vec3[] = [];
  for (let r = 0; r <= radius; r += step) {
    for (let i = 0; i < directions; i++) {
      const a = (i / directions) * Math.PI * 2;
      for (const h of heights) out.push([feet.x + Math.cos(a) * r, feet.y + h, feet.z + Math.sin(a) * r]);
    }
  }
  return out;
}

const specFor = (amounts: Partial<FoldAmounts>) => foldSpec({ ...noFolds(), ...amounts }, feet, heading);

/** The smallest and largest singular value and the smallest determinant over the points the fold keeps in view. */
function extremes(amounts: Partial<FoldAmounts>, points: Vec3[], minVisible = 0) {
  const spec = specFor(amounts);
  let minDet = Infinity;
  let maxDet = -Infinity;
  let minSv = Infinity;
  let maxSv = 0;
  for (const p of points) {
    const m = deformPoint(spec, p);
    if ((m.vis ?? 1) < minVisible) continue;
    const d = det(m.j);
    const sv = singularValues(m.j);
    minDet = Math.min(minDet, d);
    maxDet = Math.max(maxDet, d);
    minSv = Math.min(minSv, ...sv);
    maxSv = Math.max(maxSv, ...sv);
  }
  return { minDet, maxDet, minSv, maxSv };
}

const ground = around(3000, [-5, 0, 3], 60);
const aloft = around(1000, [60, 200], 100);

describe("the fold powers", () => {
  it("leave the world alone when none is on", () => {
    const spec = specFor({});
    for (const p of around(500, [0, 40], 50)) {
      const m = deformPoint(spec, p);
      expect(m.p).toEqual(p);
      expect(det(m.j)).toBeCloseTo(1, 12);
    }
  });

  it("stay finite in every combination and at every strength, far away and high above", () => {
    const far = [...around(2000, [-5, 20, 300], 100), ...around(40000, [0, 300], 4000)];
    let broken = 0;
    for (const k of [0.25, 0.5, 1]) {
      for (let mask = 0; mask < 8; mask++) {
        const spec = specFor({ planet: mask & 1 ? k : 0, corkscrew: mask & 2 ? k : 0, hinge: mask & 4 ? k : 0, rippleAge: mask === 7 ? 1.5 : null });
        for (const p of far) {
          const m = deformPoint(spec, p);
          if (![...m.p, ...m.j].every(Number.isFinite)) broken++;
        }
      }
    }
    expect(broken).toBe(0);
  });

  it("roll the ground into a planet that shrinks it and never turns it inside out", () => {
    const e = extremes({ planet: 1 }, ground, 0.5);
    expect(e.minDet).toBeGreaterThan(0.1);
    expect(e.maxSv).toBeLessThan(1.1);
  });

  it("bend the ground ahead without stretching it", () => {
    const e = extremes({ hinge: 1 }, ground);
    expect(e.minSv).toBeGreaterThan(0.95);
    expect(e.maxSv).toBeLessThan(1.05);
  });

  it("twist and ripple the world without changing any volume", () => {
    for (const amounts of [{ corkscrew: 1 }, { corkscrew: 0.4 }, { rippleAge: 0.5 }, { rippleAge: 4 }]) {
      const e = extremes(amounts, [...ground, ...aloft]);
      expect(e.minDet, JSON.stringify(amounts)).toBeCloseTo(1, 9);
      expect(e.maxDet, JSON.stringify(amounts)).toBeCloseTo(1, 9);
    }
  });
});
