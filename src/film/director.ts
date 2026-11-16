import * as THREE from "three";
import { emptySpec } from "../core/deform/stages.ts";
import { defaultGrade, type GradeParams } from "../core/render/grade.ts";
import { foldSpec, noFolds } from "../world/folds.ts";
import { lookAt } from "../world/realms.ts";
import { lightningFrom, type Flash } from "../world/storm.ts";
import type { LightRing, StormFlash } from "../world/uniforms.ts";
import type { WorldView } from "../world/procworld.ts";
import { keys } from "./animate.ts";
import { CUE, DURATION, ONSETS, pulse } from "./cues.ts";
import { orientation, type Pose } from "./rig.ts";
import { FILM_SEED, SHOTS, shotAt, terrain, type Shot } from "./shots.ts";
import { titlesAt, type TitleLine } from "./titles.ts";

export interface BloomPlan {
  x: number;
  z: number;
  /** World clock at which the flower starts to open. */
  clock: number;
  realm: number;
  scale: number;
}

export interface FrameState {
  t: number;
  shot: Shot;
  pose: Pose;
  view: WorldView;
  grade: GradeParams;
  blooms: BloomPlan[];
  titles: TitleLine[];
}

/** Moments the world answers with a ring of light: the track's hits, then its strongest onsets. */
const HITS = [CUE.hit1, CUE.hit2, CUE.hit3, CUE.drop, CUE.accent, CUE.snap, CUE.title] as const;
const BEATS = ONSETS.filter((o) => o.t > CUE.accent && o.t < CUE.stop && o.strength >= 14).map((o) => ({ t: o.t, strength: o.strength }));
const EVENTS = [...HITS.map((t) => ({ t, strength: 25 })), ...BEATS].sort((a, b) => a.t - b.t);

const RING_LIFE = 4.2;
/** How strongly each realm takes a ring of light: bright places wash out, dark ones glow. */
const RING_GAIN = [0.55, 1, 0.8, 0.9, 0.5] as const;

function ringFor(shot: Shot, t: number, e: { t: number; strength: number }): LightRing | null {
  if (e.t < shot.start || e.t > t || t - e.t > RING_LIFE) return null;
  const u = e.t - shot.start;
  const pose = shot.camera(u);
  const next = shot.camera(u + 0.1);
  const travel = Math.hypot(next.x - pose.x, next.z - pose.z) / 0.1;
  const realm = terrain.realmAt(pose.x, pose.z);
  const gain = RING_GAIN[realm.a]! + (RING_GAIN[realm.b]! - RING_GAIN[realm.a]!) * realm.t;
  const big = e.strength >= 25;
  return {
    x: pose.x,
    z: pose.z,
    start: shot.clock(u),
    amplitude: gain * (big ? 1 : 0.2 + 0.3 * Math.min(1, e.strength / 25)),
    // A wave that only keeps pace with the camera would stay on top of it and wash the view out.
    speed: (big ? 120 : 60) + 3.5 * travel,
    life: RING_LIFE,
    radius: 3,
    width: big ? 10 : 6,
  };
}

/** The strokes of lightning that answer two beats of the track in the Ember shot, and how far right of the view each one falls. */
const BOLTS: readonly { t: number; right: number; shape: number; strokes: Flash["strokes"] }[] = [
  { t: 26.75, right: 0.3, shape: 0.31, strokes: [[0, 1], [0.11, 0.55]] },
  { t: 27.7, right: -0.32, shape: 0.74, strokes: [[0, 1], [0.09, 0.6], [0.3, 0.85]] },
];
const BOLT_LIFE = 0.8;

function boltAt(shot: Shot, time: number): StormFlash | undefined {
  const bolt = BOLTS.find((b) => b.t >= shot.start && time >= b.t && time < b.t + BOLT_LIFE);
  if (!bolt) return undefined;
  const flash: Flash = { id: Math.round(bolt.t * 100), start: bolt.t, azimuth: -shot.camera(bolt.t - shot.start).yaw + bolt.right, closeness: 0.7, shape: bolt.shape, strokes: bolt.strokes };
  const { level } = lightningFrom(flash, time);
  return level > 0.03 ? { level, azimuth: flash.azimuth, shape: flash.shape } : undefined;
}

/** Everything needed to draw the film at time t, as a pure function of t. */
export function evaluate(t: number): FrameState {
  const time = Math.min(Math.max(t, 0), DURATION);
  const shot = shotAt(time);
  const u = time - shot.start;
  const pose = shot.camera(u);
  const clock = shot.clock(u);

  const [px, pz] = shot.player?.(u) ?? [pose.x, pose.z];
  const position = new THREE.Vector3(pose.x, pose.y, pose.z);
  const feet = new THREE.Vector3(px, terrain.facetHeight(px, pz, 0.9), pz);
  const mix = terrain.realmAt(px, pz);
  const look = lookAt(mix.a, mix.b, mix.t);

  const amounts = shot.fold?.(u, time) ?? noFolds();
  const recent = EVENTS.filter((e) => e.t <= time && time - e.t < RING_LIFE);
  const rings = recent.slice(-2).map((e) => ringFor(shot, time, e));
  const lastBig = [...EVENTS].reverse().find((e) => e.t <= time && e.strength >= 25 && e.t >= shot.start);

  const view: WorldView = {
    time: clock,
    seed: FILM_SEED,
    player: feet,
    heading: pose.yaw,
    camera: { position, quaternion: orientation(pose), fov: pose.fov },
    atmosphere: look.atmosphere,
    realm: { a: mix.a, b: mix.b, t: mix.t, variant: 0 },
    spec: amounts.planet > 1e-4 || amounts.corkscrew > 1e-4 || amounts.hinge > 1e-4 || amounts.rippleAge !== null ? foldSpec(amounts, feet, pose.yaw) : emptySpec(),
    dof: { focalDistance: shot.focus?.(u, pose) ?? 0, apertureAngle: shot.aperture?.(u) ?? 0 },
    lightRings: [rings[0] ?? null, rings[1] ?? null],
    pulse: lastBig && time - lastBig.t < 1.2 ? [0.45, shot.clock(lastBig.t - shot.start)] : undefined,
    storm: boltAt(shot, time),
  };

  const grade: GradeParams = { ...defaultGrade(), ...look.grade, ...shot.grade?.(u, time) };
  const hit = pulse(time, EVENTS, 0.3);
  grade.bloom = (grade.bloom ?? 0.5) * (1 + 0.5 * Math.min(1, hit));
  grade.aberration = (grade.aberration ?? 0.0015) + 0.004 * Math.min(1, hit);
  grade.fade = Math.min(grade.fade, keys(time, [[DURATION - 1.0, 1], [DURATION - 0.05, 0]]));
  if (shot !== SHOTS[0]) grade.flash = Math.max(grade.flash, 0.5 * Math.exp(-u / 0.12));

  const blooms: BloomPlan[] = (shot.blooms ?? [])
    .filter((b) => b.u <= u)
    .map((b) => {
      const m = terrain.realmAt(b.x, b.z);
      return { x: b.x, z: b.z, clock: shot.clock(b.u), realm: m.t < 0.5 ? m.a : m.b, scale: b.scale ?? 1 };
    });

  return { t: time, shot, pose, view, grade, blooms, titles: titlesAt(time) };
}

/** The frame `offset` seconds from `t`, held inside the shot that `t` belongs to so a cut stays a hard cut. */
export function evaluateWithin(t: number, offset: number): FrameState {
  const shot = shotAt(Math.min(Math.max(t, 0), DURATION));
  return evaluate(Math.min(Math.max(t + offset, shot.start), shot.end - 1e-4));
}

export { SHOTS };
