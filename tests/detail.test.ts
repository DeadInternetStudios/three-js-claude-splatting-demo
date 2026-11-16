import { describe, expect, it } from "vitest";
import { QUALITY_SCALE, groundDetailFor } from "../src/play/quality.ts";
import { GROUND_DETAIL_LEVELS, defaultRings, ringSubdivision } from "../src/world/layers/ground.ts";

const levels = Array.from({ length: GROUND_DETAIL_LEVELS }, (_, level) => level);

describe("ground detail", () => {
  it("keeps every splat at level 0", () => {
    for (const ring of defaultRings()) expect(ringSubdivision(ring.sub, 0)).toBe(ring.sub);
  });

  it("draws fewer splats at each level and never fewer than one per facet", () => {
    for (const ring of defaultRings()) {
      const subs = levels.map((level) => ringSubdivision(ring.sub, level));
      for (let i = 1; i < subs.length; i++) expect(subs[i]!).toBeLessThanOrEqual(subs[i - 1]!);
      expect(Math.min(...subs)).toBeGreaterThanOrEqual(1);
    }
  });

  it("takes a good share of the splats away at the coarsest level", () => {
    const count = (level: number) => defaultRings().reduce((sum, r) => sum + r.cells * r.cells * 2 * ringSubdivision(r.sub, level) ** 2, 0);
    expect(count(GROUND_DETAIL_LEVELS - 1) / count(0)).toBeLessThan(0.5);
  });

  it("follows the render scale, so a machine that drops resolution also drops splats", () => {
    const scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
    const detail = scales.map(groundDetailFor);
    for (let i = 1; i < detail.length; i++) expect(detail[i]!).toBeGreaterThanOrEqual(detail[i - 1]!);
    expect(groundDetailFor(QUALITY_SCALE.high)).toBe(0);
    expect(groundDetailFor(QUALITY_SCALE.low)).toBe(GROUND_DETAIL_LEVELS - 1);
    for (const d of detail) expect(d).toBeLessThan(GROUND_DETAIL_LEVELS);
  });
});
