import * as THREE from "three";
import { buildCurveTable } from "../core/deform/curve.ts";
import { rotationAxisAngle } from "../core/deform/math.ts";
import { emptySpec, type DeformSpec } from "../core/deform/stages.ts";

/**
 * How far each fold power is applied. Powers are relative to the walker, so the world folds around
 * whoever moves it, wherever they stand.
 */
export interface FoldAmounts {
  /** Rolls the ground into a ball you stand on top of. 0 is flat, 1 is a small planet. */
  planet: number;
  /** Turns the world about your line of sight, more the farther away it is. */
  corkscrew: number;
  /** Bends the ground ahead up into a wall and over your head, like closing a book. */
  hinge: number;
  /** Seconds since a ripple left the walker, or null when none is travelling. */
  rippleAge: number | null;
}

export const noFolds = (): FoldAmounts => ({ planet: 0, corkscrew: 0, hinge: 0, rippleAge: null });

/** Radius in metres of the planet at full strength. */
export const PLANET_RADIUS = 150;
/** Radians of roll at which the planet starts to fade out and is gone. */
const PLANET_FADE: [number, number] = [2.5, 3.05];
/** Largest corkscrew rate in radians per metre of distance along the line of sight. */
const CORKSCREW_RATE = 0.0045;
/** Hinge angle in radians at full strength, spread over `HINGE_SPAN` metres. */
const HINGE_ANGLE = 2.5;
const HINGE_START = 30;
const HINGE_SPAN = 640;
export const RIPPLE_SPEED = 85;
export const RIPPLE_LIFE = 9;

const smooth = (x: number): number => x * x * (3 - 2 * x);

/** The deform for the given powers, about a walker at `feet` who faces `heading` (radians, 0 looks down -z). */
export function foldSpec(amounts: FoldAmounts, feet: THREE.Vector3, heading: number): DeformSpec {
  const spec = emptySpec();
  const planet = Math.min(1, Math.max(0, amounts.planet));
  const corkscrew = Math.min(1, Math.max(0, amounts.corkscrew));
  const hinge = Math.min(1, Math.max(0, amounts.hinge));
  const rippling = amounts.rippleAge !== null && amounts.rippleAge >= 0 && amounts.rippleAge < RIPPLE_LIFE;
  if (planet <= 1e-4 && corkscrew <= 1e-4 && hinge <= 1e-4 && !rippling) return spec;

  // Local +z points where the walker faces, +y is up and +x is to the walker's left.
  spec.frame = { rotation: rotationAxisAngle([0, 1, 0], heading + Math.PI), origin: [feet.x, feet.y, feet.z] };

  if (corkscrew > 1e-4) spec.twist = { point: [0, 0, 0], axis: [0, 0, 1], rate: CORKSCREW_RATE * smooth(corkscrew), origin: 0 };
  if (hinge > 1e-4) {
    const angle = HINGE_ANGLE * smooth(hinge);
    const table = buildCurveTable(
      [{ center: HINGE_START + HINGE_SPAN / 2, halfWidth: HINGE_SPAN / 2, angle, ease: 0.6 }],
      -60,
      HINGE_START + HINGE_SPAN + 1400,
      1000,
    );
    spec.curves = [{ table, offsetAxis: 1, offsetOrigin: 0 }];
  }
  if (planet > 1e-4) {
    // Curvature grows with the square of the amount so the first part of the gesture is gentle.
    const k = (planet * planet) / PLANET_RADIUS;
    spec.bowl = { apex: [0, 0, 0], curvature: k, fadeStart: PLANET_FADE[0], fadeEnd: PLANET_FADE[1] };
  }
  if (rippling) {
    const age = amounts.rippleAge as number;
    const fadeIn = Math.min(1, age / 0.6);
    const fadeOut = 1 - smooth(Math.min(1, age / RIPPLE_LIFE));
    spec.wave = { center: [0, 0, 0], amplitude: 6 * fadeIn * fadeOut, radius: 20 + age * RIPPLE_SPEED, width: 70 + age * 12, wavelength: 52 };
  }
  return spec;
}
