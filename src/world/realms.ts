import * as THREE from "three";
import type { GradeParams } from "../core/render/grade.ts";
import type { Atmosphere, SkyLook } from "./uniforms.ts";

/** Unit vector toward the sun from an azimuth and elevation in degrees. Azimuth 0 looks down -z. */
export function sunFrom(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

type Rgb = [number, number, number];

export interface RealmLook {
  name: string;
  atmosphere: Atmosphere;
  /** Grade tweaks that suit the place, blended like the atmosphere. */
  grade: Pick<GradeParams, "exposure" | "bloom" | "contrast" | "saturation" | "halation" | "vignette" | "shafts" | "flare">;
}

const sky = (s: Partial<SkyLook>): SkyLook => ({ stars: 0, aurora: 0, clouds: 0, planet: 0, milky: 0, water: 0, eclipse: 0, moon: 0, storm: 0, ...s });

/** One look per realm, in the order of the realm cycle. Colours are linear. */
export const REALM_LOOKS: RealmLook[] = [
  {
    name: "Paper Dunes",
    atmosphere: {
      sunDir: sunFrom(38, 9),
      sunColor: [1.0, 0.56, 0.28],
      sunIntensity: 5.5,
      zenith: [0.09, 0.15, 0.38],
      horizon: [0.32, 0.29, 0.52],
      bounce: [0.28, 0.16, 0.14],
      fogDensity: 0.00032,
      fogFalloff: 0.0042,
      sunGlow: 1,
      sky: sky({ stars: 0.12, clouds: 0.7, planet: 1, milky: 0.15 }),
    },
    grade: { exposure: -0.5, bloom: 0.28, contrast: 1.16, saturation: 1.0, halation: 0.3, vignette: 0.35, shafts: 0.6, flare: 0.5 },
  },
  {
    name: "Prism Forest",
    atmosphere: {
      sunDir: sunFrom(205, 38),
      sunColor: [0.42, 0.58, 1.0],
      sunIntensity: 1.5,
      zenith: [0.004, 0.006, 0.035],
      horizon: [0.035, 0.025, 0.11],
      bounce: [0.012, 0.012, 0.05],
      fogDensity: 0.0006,
      fogFalloff: 0.005,
      sunGlow: 0.6,
      sky: sky({ stars: 1, aurora: 1, clouds: 0.05, milky: 1, moon: 1 }),
    },
    grade: { exposure: -0.05, bloom: 0.5, contrast: 1.14, saturation: 1.1, halation: 0.4, vignette: 0.4, shafts: 0.15, flare: 0.2 },
  },
  {
    name: "Lantern Deep",
    atmosphere: {
      sunDir: sunFrom(15, 72),
      sunColor: [0.55, 1.0, 0.9],
      sunIntensity: 1.3,
      zenith: [0.015, 0.16, 0.24],
      horizon: [0.006, 0.09, 0.14],
      bounce: [0.01, 0.07, 0.1],
      fogDensity: 0.0042,
      fogFalloff: 0.0022,
      sunGlow: 0.8,
      sky: sky({ water: 1 }),
    },
    grade: { exposure: -0.2, bloom: 0.45, contrast: 1.14, saturation: 1.05, halation: 0.3, vignette: 0.45, shafts: 0.7, flare: 0.1 },
  },
  {
    name: "Mirror Flats",
    atmosphere: {
      sunDir: sunFrom(250, -1.5),
      sunColor: [1.0, 0.5, 0.35],
      sunIntensity: 1.6,
      zenith: [0.01, 0.02, 0.09],
      horizon: [0.06, 0.08, 0.2],
      bounce: [0.03, 0.04, 0.1],
      fogDensity: 0.00018,
      fogFalloff: 0.004,
      sunGlow: 5,
      sky: sky({ stars: 1, aurora: 0.5, clouds: 0.2, planet: 1, milky: 1 }),
    },
    grade: { exposure: 0.0, bloom: 0.38, contrast: 1.14, saturation: 1.05, halation: 0.35, vignette: 0.35, shafts: 0.8, flare: 0.6 },
  },
  {
    name: "Ember Canyons",
    atmosphere: {
      sunDir: sunFrom(120, 20),
      sunColor: [1.0, 0.36, 0.12],
      sunIntensity: 2.4,
      zenith: [0.02, 0.006, 0.018],
      horizon: [0.14, 0.03, 0.02],
      bounce: [0.22, 0.06, 0.03],
      fogDensity: 0.0009,
      fogFalloff: 0.0045,
      sunGlow: 0.8,
      sky: sky({ stars: 0.1, clouds: 0.7, eclipse: 1, storm: 1 }),
    },
    grade: { exposure: -0.1, bloom: 0.55, contrast: 1.14, saturation: 1.05, halation: 0.5, vignette: 0.4, shafts: 0.3, flare: 0.15 },
  },
];

const mixN = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];

function mixSky(a: SkyLook, b: SkyLook, t: number): SkyLook {
  const out = {} as Record<keyof SkyLook, number>;
  for (const k of Object.keys(a) as (keyof SkyLook)[]) out[k] = mixN(a[k], b[k], t);
  return out;
}

export function mixAtmosphere(a: Atmosphere, b: Atmosphere, t: number): Atmosphere {
  const dir = a.sunDir.clone().lerp(b.sunDir, t);
  if (dir.lengthSq() < 1e-6) dir.copy(a.sunDir);
  return {
    sunDir: dir.normalize(),
    sunColor: mixRgb(a.sunColor, b.sunColor, t),
    sunIntensity: mixN(a.sunIntensity, b.sunIntensity, t),
    zenith: mixRgb(a.zenith, b.zenith, t),
    horizon: mixRgb(a.horizon, b.horizon, t),
    bounce: mixRgb(a.bounce, b.bounce, t),
    fogDensity: mixN(a.fogDensity, b.fogDensity, t),
    fogFalloff: mixN(a.fogFalloff, b.fogFalloff, t),
    sunGlow: mixN(a.sunGlow, b.sunGlow, t),
    sky: mixSky(a.sky, b.sky, t),
  };
}

/** The look of a place that is `t` of the way from realm a to realm b. */
export function lookAt(a: number, b: number, t: number): { atmosphere: Atmosphere; grade: RealmLook["grade"] } {
  const la = REALM_LOOKS[a]!;
  const lb = REALM_LOOKS[b]!;
  const grade = {} as RealmLook["grade"];
  for (const k of Object.keys(la.grade) as (keyof RealmLook["grade"])[]) grade[k] = mixN(la.grade[k], lb.grade[k], t);
  return { atmosphere: mixAtmosphere(la.atmosphere, lb.atmosphere, t), grade };
}
