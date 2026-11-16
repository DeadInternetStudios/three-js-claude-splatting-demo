import * as THREE from "three";
import { RING_SLOTS, RING_SPREAD, type LightRing } from "../world/uniforms.ts";

/** The ripple a footstep leaves. It fades out within a few steps, so a walker never leaves more than a few rings behind. */
export function stepRing(x: number, z: number, start: number, strength: number): LightRing {
  return { x, z, start, amplitude: 0.55 * strength + 0.15, speed: 9, life: 0.7, radius: 0.3, width: 0.7 };
}

/** The wave a landing sends out. */
export function landRing(x: number, z: number, start: number): LightRing {
  return { x, z, start, amplitude: 0.9, speed: 26, life: 2.2, radius: 0.5, width: 1.4 };
}

/** How bright a ring is at `time`, before its band is spread over the ground. This is the envelope of `ringGlow` in light.glsl. */
export function ringLevel(ring: LightRing, time: number): number {
  const life = ring.life ?? RING_SPREAD.life;
  const age = time - ring.start;
  if (age < 0 || age > life) return 0;
  return ring.amplitude * (1 - THREE.MathUtils.smoothstep(age, 0.4 * life, life));
}

/**
 * The rings of light the shaders draw. A new ring takes the slot of the one that has the least light left,
 * so a footstep never cuts off a ring that still shines. Each footstep fades out on its own, which is what
 * keeps the ground from flashing at every step.
 */
export class RingPool {
  private readonly slots: (LightRing | null)[] = Array.from({ length: RING_SLOTS }, () => null);

  /** Takes a ring that starts now. */
  add(ring: LightRing): void {
    let weakest = 0;
    let least = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const held = this.slots[i];
      const level = held ? ringLevel(held, ring.start) : 0;
      if (level < least) {
        least = level;
        weakest = i;
      }
    }
    this.slots[weakest] = ring;
  }

  get rings(): readonly (LightRing | null)[] {
    return this.slots;
  }
}
