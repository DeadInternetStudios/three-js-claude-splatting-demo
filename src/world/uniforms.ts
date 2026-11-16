import { dyno } from "@sparkjsdev/spark";
import * as THREE from "three";
import { normalize } from "../core/deform/math.ts";
import { CURVE_TEXTURE_WIDTH } from "../core/deform/curve.ts";
import type { CurveStageParams, DeformSpec } from "../core/deform/stages.ts";
import commonGlsl from "./glsl/common.glsl?raw";
import deformGlsl from "./glsl/deform.glsl?raw";
import layerGlsl from "./glsl/layer.glsl?raw";
import worldGlsl from "./glsl/world.glsl?raw";
import { DISTANCE_REACH, type ViewCull } from "./cull.ts";

export const WorldParamsType = { type: "WorldParams" } as { type: "WorldParams" };
export const DeformParamsType = { type: "DeformParams" } as { type: "DeformParams" };
export const LayerParamsType = { type: "LayerParams" } as { type: "LayerParams" };

/** Rings of light the shaders draw at once. A new ring takes the slot with the least light left, so six let a footstep fade out before its slot is wanted again. */
export const RING_SLOTS = 6;

/** How a ring spreads when it does not say. */
export const RING_SPREAD = { speed: 120, life: 5.5, radius: 6, width: 8 } as const;

export const WORLD_GLSL = `#define RING_SLOTS ${RING_SLOTS}\n${worldGlsl}`;
export const COMMON_GLSL = commonGlsl;
export const DEFORM_GLSL = deformGlsl;
export const LAYER_GLSL = layerGlsl;

/** Colours and light that make up one look of the sky, in linear units. */
export interface Atmosphere {
  sunDir: THREE.Vector3;
  sunColor: [number, number, number];
  sunIntensity: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
  bounce: [number, number, number];
  /** Extinction per metre at sea level. */
  fogDensity: number;
  /** How quickly the haze thins with height, per metre. */
  fogFalloff: number;
  /** Scales how strongly the sun's glow tints the haze around it. */
  sunGlow: number;
  sky: SkyLook;
}

/** Which sky features show, each from 0 (absent) to 1 (full). */
export interface SkyLook {
  stars: number;
  aurora: number;
  clouds: number;
  planet: number;
  milky: number;
  /** Looking up shows a lit water surface. */
  water: number;
  /** 1 swaps the sun for a black disc with a corona. */
  eclipse: number;
  /** 1 swaps the sun for a cratered moon. */
  moon: number;
  /** How often the sky holds lightning. The game draws it from the world clock, and the film draws it on two chosen beats. */
  storm: number;
}

/** A flash of lightning as the shaders see it. */
export interface StormFlash {
  /** Brightness now, from 0 to 1. */
  level: number;
  /** Azimuth of the bolt in radians. */
  azimuth: number;
  /** Random number in 0 to 1 that shapes the bolt. */
  shape: number;
}

/** A ring of light that spreads from a point on the ground. */
export interface LightRing {
  x: number;
  z: number;
  /** World time at which it left the centre. */
  start: number;
  amplitude: number;
  /** How fast the front travels, in metres per second. Defaults to a ring that crosses the whole view. */
  speed?: number;
  /** Seconds until it has faded out. */
  life?: number;
  /** Radius at birth and width of the band in metres. */
  radius?: number;
  width?: number;
}

export interface WorldFrame {
  time: number;
  seed: number;
  eye: THREE.Vector3;
  feet: THREE.Vector3;
  heading: number;
  atmosphere: Atmosphere;
  realmA: number;
  realmB: number;
  realmBlend: number;
  variant: number;
  /** A flash over the whole world: strength, and the time it started. */
  pulse?: [number, number];
  storm?: StormFlash;
  /** At most `RING_SLOTS` of them. */
  lightRings?: readonly (LightRing | null)[];
  /** What the camera sees. Without it every splat is shaded, wherever it lies. */
  cull?: ViewCull;
  /** True when no fold bends the world, so a splat's rest position is where it stands. */
  foldIsIdentity?: boolean;
}

export interface WorldValue {
  time: THREE.Vector4;
  eye: THREE.Vector4;
  feet: THREE.Vector4;
  sun: THREE.Vector4;
  sunColor: THREE.Vector4;
  zenith: THREE.Vector4;
  horizon: THREE.Vector4;
  bounce: THREE.Vector4;
  realm: THREE.Vector4;
  pulse: THREE.Vector4;
  ring: THREE.Vector4[];
  shape: THREE.Vector4[];
  skyA: THREE.Vector4;
  skyB: THREE.Vector4;
  skyC: THREE.Vector4;
  viewL: THREE.Vector4;
  viewR: THREE.Vector4;
  viewD: THREE.Vector4;
  viewU: THREE.Vector4;
  cull: THREE.Vector4;
}

/** The per-frame state every layer reads. One instance feeds every layer's shader program. */
export class WorldUniform {
  readonly uniform;
  readonly value: WorldValue = {
    time: new THREE.Vector4(),
    eye: new THREE.Vector4(),
    feet: new THREE.Vector4(),
    sun: new THREE.Vector4(0, 1, 0, 1),
    sunColor: new THREE.Vector4(1, 1, 1, 0),
    zenith: new THREE.Vector4(),
    horizon: new THREE.Vector4(),
    bounce: new THREE.Vector4(),
    realm: new THREE.Vector4(),
    pulse: new THREE.Vector4(),
    ring: Array.from({ length: RING_SLOTS }, () => new THREE.Vector4()),
    shape: Array.from({ length: RING_SLOTS }, () => new THREE.Vector4(RING_SPREAD.speed, RING_SPREAD.life, RING_SPREAD.radius, RING_SPREAD.width)),
    skyA: new THREE.Vector4(),
    skyB: new THREE.Vector4(),
    skyC: new THREE.Vector4(1, 0, 0, 0),
    viewL: new THREE.Vector4(),
    viewR: new THREE.Vector4(),
    viewD: new THREE.Vector4(),
    viewU: new THREE.Vector4(),
    cull: new THREE.Vector4(),
  };

  constructor() {
    this.uniform = new dyno.DynoUniform({
      key: "world",
      type: WorldParamsType,
      globals: () => [WORLD_GLSL],
      value: this.value as never,
    });
  }

  set(f: WorldFrame): void {
    const v = this.value;
    const seed = f.seed >>> 0;
    v.time.set(f.time, seed & 0xffff, seed >>> 16, 1);
    v.eye.set(f.eye.x, f.eye.y, f.eye.z, 0);
    v.feet.set(f.feet.x, f.feet.y, f.feet.z, f.heading);
    const a = f.atmosphere;
    const sun = a.sunDir.clone().normalize();
    v.sun.set(sun.x, sun.y, sun.z, a.sunIntensity);
    v.sunColor.set(a.sunColor[0], a.sunColor[1], a.sunColor[2], 0);
    v.zenith.set(a.zenith[0], a.zenith[1], a.zenith[2], 0);
    v.horizon.set(a.horizon[0], a.horizon[1], a.horizon[2], a.fogDensity);
    v.bounce.set(a.bounce[0], a.bounce[1], a.bounce[2], a.fogFalloff);
    v.realm.set(f.realmA, f.realmB, f.realmBlend, f.variant);
    v.pulse.set(f.pulse?.[0] ?? 0, f.pulse?.[1] ?? 0, 0, 0);
    const rings = f.lightRings ?? [];
    if (rings.length > RING_SLOTS) throw new RangeError(`${rings.length} rings of light, and the shaders draw ${RING_SLOTS}`);
    for (let i = 0; i < RING_SLOTS; i++) {
      const r = rings[i];
      v.ring[i]!.set(r?.x ?? 0, r?.z ?? 0, r?.start ?? 0, r?.amplitude ?? 0);
      v.shape[i]!.set(r?.speed ?? RING_SPREAD.speed, r?.life ?? RING_SPREAD.life, r?.radius ?? RING_SPREAD.radius, r?.width ?? RING_SPREAD.width);
    }
    v.skyA.set(a.sky.stars, a.sky.aurora, a.sky.clouds, a.sky.planet);
    v.skyB.set(a.sky.milky, a.sky.water, a.sky.eclipse, a.sky.moon);
    v.skyC.set(a.sunGlow, f.storm?.level ?? 0, f.storm?.azimuth ?? 0, f.storm?.shape ?? 0);
    const c = f.cull;
    if (c) {
      const [l, r, d, u] = c.planes;
      v.viewL.set(l.x, l.y, l.z, 0);
      v.viewR.set(r.x, r.y, r.z, 0);
      v.viewD.set(d.x, d.y, d.z, 0);
      v.viewU.set(u.x, u.y, u.z, 0);
    }
    v.cull.set(c?.slack ?? 0, c ? 1 : 0, f.foldIsIdentity ? 1 : 0, DISTANCE_REACH);
  }
}

interface DeformValue {
  grabA: THREE.Vector4;
  grabB: THREE.Vector4;
  twistA: THREE.Vector4;
  twistB: THREE.Vector4;
  curveA: THREE.Vector4;
  curveB: THREE.Vector4;
  curveOrigin: THREE.Vector4;
  sim0: THREE.Vector4;
  sim1: THREE.Vector4;
  sim2: THREE.Vector4;
  simFlag: THREE.Vector4;
  frame0: THREE.Vector4;
  frame1: THREE.Vector4;
  frame2: THREE.Vector4;
  frameFlag: THREE.Vector4;
  bowlA: THREE.Vector4;
  bowlB: THREE.Vector4;
  waveA: THREE.Vector4;
  waveB: THREE.Vector4;
  curveTexA: THREE.DataTexture;
  curveTexB: THREE.DataTexture;
}

function makeCurveTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(CURVE_TEXTURE_WIDTH * 4), CURVE_TEXTURE_WIDTH, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.internalFormat = "RGBA32F";
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function writeCurve(cfg: THREE.Vector4, tex: THREE.DataTexture, curve: CurveStageParams | undefined): void {
  if (!curve) {
    cfg.set(0, 0, 1, 0);
    return;
  }
  const { table } = curve;
  if (table.count > CURVE_TEXTURE_WIDTH) throw new Error(`curve table has ${table.count} knots, limit is ${CURVE_TEXTURE_WIDTH}`);
  (tex.image.data as Float32Array).set(table.texels);
  tex.needsUpdate = true;
  cfg.set(curve.offsetAxis, table.s0, table.ds, table.count);
}

/** The fold, as a uniform block read by every layer's shader program. */
export class DeformUniform {
  readonly uniform;
  private readonly value: DeformValue = {
    grabA: new THREE.Vector4(),
    grabB: new THREE.Vector4(),
    twistA: new THREE.Vector4(),
    twistB: new THREE.Vector4(0, 0, 1, 0),
    curveA: new THREE.Vector4(0, 0, 1, 0),
    curveB: new THREE.Vector4(0, 0, 1, 0),
    curveOrigin: new THREE.Vector4(),
    sim0: new THREE.Vector4(1, 0, 0, 0),
    sim1: new THREE.Vector4(0, 1, 0, 0),
    sim2: new THREE.Vector4(0, 0, 1, 0),
    simFlag: new THREE.Vector4(),
    frame0: new THREE.Vector4(1, 0, 0, 0),
    frame1: new THREE.Vector4(0, 1, 0, 0),
    frame2: new THREE.Vector4(0, 0, 1, 0),
    frameFlag: new THREE.Vector4(),
    bowlA: new THREE.Vector4(),
    bowlB: new THREE.Vector4(3, 3.1, 0, 0),
    waveA: new THREE.Vector4(),
    waveB: new THREE.Vector4(0, 1, 0, 0),
    curveTexA: makeCurveTexture(),
    curveTexB: makeCurveTexture(),
  };

  constructor() {
    this.uniform = new dyno.DynoUniform({
      key: "deform",
      type: DeformParamsType,
      globals: () => [COMMON_GLSL, DEFORM_GLSL],
      value: this.value as never,
    });
  }

  /** Copies a spec into the block. Layers pick it up on their next regeneration. */
  set(spec: DeformSpec): void {
    const v = this.value;
    const g = spec.grab;
    if (g && g.radius > 0) {
      v.grabA.set(g.center[0], g.center[1], g.center[2], g.radius);
      v.grabB.set(g.displacement[0], g.displacement[1], g.displacement[2], 0);
    } else {
      v.grabA.set(0, 0, 0, 0);
      v.grabB.set(0, 0, 0, 0);
    }
    const t = spec.twist;
    if (t && t.rate !== 0) {
      const n = normalize(t.axis);
      v.twistA.set(t.point[0], t.point[1], t.point[2], t.rate);
      v.twistB.set(n[0], n[1], n[2], t.origin);
    } else {
      v.twistA.set(0, 0, 0, 0);
      v.twistB.set(0, 0, 1, 0);
    }
    writeCurve(v.curveA, v.curveTexA, spec.curves[0]);
    writeCurve(v.curveB, v.curveTexB, spec.curves[1]);
    v.curveOrigin.set(spec.curves[0]?.offsetOrigin ?? 0, spec.curves[1]?.offsetOrigin ?? 0, 0, 0);
    const s = spec.similarity;
    if (s) {
      const m = s.rotation.map((e) => e * s.scale);
      v.sim0.set(m[0]!, m[1]!, m[2]!, s.translation[0]);
      v.sim1.set(m[3]!, m[4]!, m[5]!, s.translation[1]);
      v.sim2.set(m[6]!, m[7]!, m[8]!, s.translation[2]);
      v.simFlag.set(1, 0, 0, 0);
    } else {
      v.simFlag.set(0, 0, 0, 0);
    }
    const f = spec.frame;
    if (f) {
      const r = f.rotation;
      v.frame0.set(r[0], r[1], r[2], f.origin[0]);
      v.frame1.set(r[3], r[4], r[5], f.origin[1]);
      v.frame2.set(r[6], r[7], r[8], f.origin[2]);
      v.frameFlag.set(1, 0, 0, 0);
    } else {
      v.frameFlag.set(0, 0, 0, 0);
    }
    const b = spec.bowl;
    if (b && b.curvature > 0) {
      v.bowlA.set(b.apex[0], b.apex[1], b.apex[2], b.curvature);
      v.bowlB.set(b.fadeStart, b.fadeEnd, 0, 0);
    } else {
      v.bowlA.set(0, 0, 0, 0);
      v.bowlB.set(3, 3.1, 0, 0);
    }
    const w = spec.wave;
    if (w && w.amplitude !== 0) {
      v.waveA.set(w.center[0], w.center[1], w.center[2], w.amplitude);
      v.waveB.set(w.radius, w.width, w.wavelength, 0);
    } else {
      v.waveA.set(0, 0, 0, 0);
      v.waveB.set(0, 1, 0, 0);
    }
  }
}
