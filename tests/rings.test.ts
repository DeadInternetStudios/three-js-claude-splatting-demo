import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { landRing, RingPool, ringLevel, stepRing } from "../src/play/rings.ts";
import { lookAt } from "../src/world/realms.ts";
import { RING_SLOTS, WorldUniform, type LightRing, type WorldFrame } from "../src/world/uniforms.ts";

const step = (start: number): LightRing => stepRing(start, 0, start, 1);
const land = (start: number): LightRing => landRing(start, 0, start);
const blast = (start: number): LightRing => ({ x: 0, z: 0, start, amplitude: 1, speed: 110, life: 5.5, radius: 4, width: 8 });

describe("ring of light", () => {
  const ring: LightRing = { x: 0, z: 0, start: 10, amplitude: 0.7, life: 2 };

  it("shines at full strength for the first two fifths of its life, is half gone at the middle of the fade and out at the end", () => {
    expect(ringLevel(ring, 10)).toBe(0.7);
    expect(ringLevel(ring, 10.8)).toBeCloseTo(0.7, 12);
    expect(ringLevel(ring, 11.4)).toBeCloseTo(0.35, 12);
    expect(ringLevel(ring, 12)).toBe(0);
  });

  it("is dark before it starts and after its life", () => {
    expect(ringLevel(ring, 9.9)).toBe(0);
    expect(ringLevel(ring, 12.1)).toBe(0);
  });

  it("lasts five and a half seconds when it does not say", () => {
    const plain: LightRing = { x: 0, z: 0, start: 0, amplitude: 1 };
    expect(ringLevel(plain, 5.4)).toBeGreaterThan(0);
    expect(ringLevel(plain, 5.6)).toBe(0);
  });
});

describe("pool of rings", () => {
  it("always holds as many slots as the shaders draw", () => {
    const pool = new RingPool();
    expect(pool.rings).toHaveLength(RING_SLOTS);
    for (let i = 0; i < 3 * RING_SLOTS; i++) pool.add(step(i * 0.4));
    expect(pool.rings).toHaveLength(RING_SLOTS);
  });

  it("lets every footstep fade out before its slot is wanted again, at the pace of a stroll, a walk and a run", () => {
    // Seconds between steps: a stride of 2.1 m at 4.6 m/s and one of 3.1 m at 11 m/s, as `Player` takes them.
    for (const interval of [0.6, 2.1 / 4.6, 3.1 / 11]) {
      const pool = new RingPool();
      pool.add(land(0));
      for (let i = 1; i <= 40; i++) {
        const now = i * interval;
        const before = new Set(pool.rings);
        pool.add(step(now));
        const cut = [...before].filter((r) => r && !pool.rings.includes(r));
        for (const ring of cut) expect(ringLevel(ring!, now)).toBeLessThan(0.02);
      }
    }
  });

  it("gives up the ring with the least light left, not the oldest", () => {
    const pool = new RingPool();
    const big = blast(0);
    pool.add(big);
    const steps = Array.from({ length: RING_SLOTS - 1 }, (_, i) => step(0.1 * (i + 1)));
    for (const s of steps) pool.add(s);
    const next = step(0.1 * RING_SLOTS);
    pool.add(next);
    expect(pool.rings).toContain(big);
    expect(pool.rings).toContain(next);
    expect(pool.rings).not.toContain(steps[0]);
    for (const s of steps.slice(1)) expect(pool.rings).toContain(s);
  });
});

describe("rings in the world uniform", () => {
  const frame = (lightRings: readonly (LightRing | null)[]): WorldFrame => ({
    time: 3,
    seed: 1,
    eye: new THREE.Vector3(),
    feet: new THREE.Vector3(),
    heading: 0,
    atmosphere: lookAt(0, 0, 0).atmosphere,
    realmA: 0,
    realmB: 0,
    realmBlend: 0,
    variant: 0,
    lightRings,
  });

  it("packs each ring into its slot and leaves the others empty", () => {
    const a: LightRing = { x: 1, z: 2, start: 3, amplitude: 0.5, speed: 9, life: 1.5, radius: 0.25, width: 0.75 };
    const b: LightRing = { x: -4, z: 5, start: 2.5, amplitude: 0.25, speed: 26, life: 2.25, radius: 0.5, width: 1.5 };
    const uniform = new WorldUniform();
    uniform.set(frame([a, null, b]));
    const { ring, shape } = uniform.value;
    expect(ring).toHaveLength(RING_SLOTS);
    expect(ring[0]!.toArray()).toEqual([1, 2, 3, 0.5]);
    expect(shape[0]!.toArray()).toEqual([9, 1.5, 0.25, 0.75]);
    expect(ring[1]!.w).toBe(0);
    expect(ring[2]!.toArray()).toEqual([-4, 5, 2.5, 0.25]);
    expect(shape[2]!.toArray()).toEqual([26, 2.25, 0.5, 1.5]);
    for (let i = 3; i < RING_SLOTS; i++) expect(ring[i]!.w).toBe(0);
  });

  it("clears the slots of a frame that has no rings", () => {
    const uniform = new WorldUniform();
    uniform.set(frame([step(1), step(2)]));
    uniform.set({ ...frame([]), lightRings: undefined });
    for (const r of uniform.value.ring) expect(r.w).toBe(0);
  });

  it("refuses more rings than the shaders draw", () => {
    const uniform = new WorldUniform();
    expect(() => uniform.set(frame(Array.from({ length: RING_SLOTS + 1 }, (_, i) => step(i))))).toThrow(RangeError);
  });
});
