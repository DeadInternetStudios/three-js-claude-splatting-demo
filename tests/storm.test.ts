import { describe, expect, it } from "vitest";
import { flashInSlot, lightningAt, NO_LIGHTNING, STORM_SLOT } from "../src/world/storm.ts";

const SLOTS = 400;

describe("lightning", () => {
  it("is the same for the same clock and seed", () => {
    for (let slot = 0; slot < 50; slot++) expect(flashInSlot(slot, 7, 1)).toEqual(flashInSlot(slot, 7, 1));
    expect(lightningAt(33.37, 7, 1)).toEqual(lightningAt(33.37, 7, 1));
  });

  it("changes with the seed", () => {
    const a = Array.from({ length: 60 }, (_, i) => flashInSlot(i, 1, 1)?.start);
    const b = Array.from({ length: 60 }, (_, i) => flashInSlot(i, 2, 1)?.start);
    expect(a).not.toEqual(b);
  });

  it("is absent without a storm and rarer in a weak one", () => {
    let weak = 0;
    let strong = 0;
    for (let slot = 0; slot < SLOTS; slot++) {
      expect(flashInSlot(slot, 3, 0)).toBeNull();
      if (flashInSlot(slot, 3, 0.3)) weak++;
      if (flashInSlot(slot, 3, 1)) strong++;
    }
    expect(strong / SLOTS).toBeGreaterThan(0.5);
    expect(strong / SLOTS).toBeLessThan(0.75);
    expect(weak).toBeLessThan(strong * 0.6);
  });

  it("keeps every flash and its strokes inside its own slot, so the answer for a time needs one slot only", () => {
    for (let slot = 0; slot < SLOTS; slot++) {
      const flash = flashInSlot(slot, 5, 1);
      if (!flash) continue;
      const last = Math.max(...flash.strokes.map(([offset]) => offset));
      expect(flash.start).toBeGreaterThanOrEqual(slot * STORM_SLOT);
      expect(flash.start + last + 0.6).toBeLessThan((slot + 1) * STORM_SLOT);
      expect(flash.strokes[0]![0]).toBe(0);
      expect(flash.strokes.length).toBeGreaterThanOrEqual(2);
      expect(flash.strokes.length).toBeLessThanOrEqual(3);
      expect(flash.closeness).toBeGreaterThanOrEqual(0);
      expect(flash.closeness).toBeLessThanOrEqual(1);
    }
  });

  it("flares at the first stroke, dies away and never leaves 0 to 1", () => {
    for (let slot = 0; slot < SLOTS; slot++) {
      const flash = flashInSlot(slot, 9, 1);
      if (!flash) continue;
      expect(lightningAt(flash.start - 0.01, 9, 1).level).toBe(0);
      expect(lightningAt(flash.start + 0.03, 9, 1).level).toBeGreaterThan(0.5);
      expect(lightningAt(flash.start + 1.5, 9, 1).level).toBeLessThan(0.01);
      for (let t = 0; t < 0.8; t += 0.02) {
        const { level } = lightningAt(flash.start + t, 9, 1);
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });

  it("flickers: the light dips between strokes and returns", () => {
    let flickered = 0;
    for (let slot = 0; slot < SLOTS; slot++) {
      const flash = flashInSlot(slot, 11, 1);
      if (!flash) continue;
      const second = flash.strokes[1]![0];
      const before = lightningAt(flash.start + second - 0.01, 11, 1).level;
      const during = lightningAt(flash.start + second + 0.03, 11, 1).level;
      if (during > before) flickered++;
    }
    expect(flickered).toBeGreaterThan(40);
  });

  it("reports no flash for a slot that has none", () => {
    for (let slot = 0; slot < SLOTS; slot++) {
      if (flashInSlot(slot, 13, 0.5)) continue;
      expect(lightningAt(slot * STORM_SLOT + 1, 13, 0.5)).toBe(NO_LIGHTNING);
    }
  });
});
