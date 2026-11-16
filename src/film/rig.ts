import * as THREE from "three";
import { clamp, lerp, smootherstep, smoothstep } from "./animate.ts";

/**
 * A camera pose in world units. Yaw 0 looks down -z and turns left as it grows, pitch above 0
 * looks up, and roll tilts the horizon clockwise.
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}

export type Vec3 = readonly [number, number, number];

export function orientation(pose: Pose, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromEuler(new THREE.Euler(pose.pitch, pose.yaw, pose.roll, "YXZ"));
}

/** Yaw that faces (tx, tz) from (x, z). */
export function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

/** Pitch that tilts from height `y` at ground distance `d` to height `ty`. */
export function pitchTo(d: number, y: number, ty: number): number {
  return Math.atan2(ty - y, Math.max(d, 1e-3));
}

/** Smallest signed turn from angle a to angle b. */
export function turnBetween(a: number, b: number): number {
  const d = (b - a) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
}

/** Eases from 0 to 1 over `seconds`, slow at both ends. */
export function ease(u: number, seconds: number): number {
  return smootherstep(0, seconds, u);
}

/** Sum of a few slow sines in [-1, 1], so a hand-held camera never repeats. */
export function drift(t: number, seed: number): number {
  return (
    0.5 * Math.sin(t * 0.61 + seed * 12.9898) +
    0.3 * Math.sin(t * 1.37 + seed * 78.233 + 1.3) +
    0.2 * Math.sin(t * 2.71 + seed * 37.719 + 2.1)
  );
}

export const DEG = Math.PI / 180;

export { clamp, lerp, smoothstep };
