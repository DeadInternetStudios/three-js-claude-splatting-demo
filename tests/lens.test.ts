import { describe, expect, it } from "vitest";
import { MAX_VERTICAL_FOV, lensFov } from "../src/play/lens";

const horizontal = (vertical: number, aspect: number) => (2 * Math.atan(Math.tan((vertical * Math.PI) / 360) * aspect) * 180) / Math.PI;

describe("lens", () => {
  it("leaves windows that are at least as wide as they are tall alone", () => {
    for (const aspect of [1, 1.33, 1.78, 2.4, 3.6]) expect(lensFov(68, aspect)).toBe(68);
  });

  it("holds the horizontal field at what a square window gets while the vertical field has room", () => {
    for (const aspect of [0.99, 0.9, 0.8, 0.7]) {
      const vertical = lensFov(68, aspect);
      expect(vertical).toBeLessThan(MAX_VERTICAL_FOV);
      expect(horizontal(vertical, aspect)).toBeCloseTo(68, 6);
    }
  });

  it("stops widening at the vertical limit", () => {
    for (const aspect of [0.55, 0.46, 0.3, 0.1]) expect(lensFov(68, aspect)).toBe(MAX_VERTICAL_FOV);
  });

  it("never goes below the field that was asked for, and never narrows as the window gets taller", () => {
    let last = 0;
    for (let aspect = 2; aspect > 0.1; aspect -= 0.05) {
      const fov = lensFov(90, aspect);
      expect(fov).toBeGreaterThanOrEqual(90);
      expect(fov).toBeGreaterThanOrEqual(last);
      last = fov;
    }
  });

  it("is continuous across a square window", () => {
    expect(lensFov(68, 0.999) - lensFov(68, 1)).toBeLessThan(0.1);
  });
});
