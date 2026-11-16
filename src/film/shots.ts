import type { GradeParams } from "../core/render/grade.ts";
import { beastPoint } from "../world/cpu/beasts.ts";
import { createTerrain, type Terrain } from "../world/cpu/terrain.ts";
import { noFolds, type FoldAmounts } from "../world/folds.ts";
import { wonderGround, wonderPoint, wondersNear, type Wonder } from "../world/wonders.ts";
import { keys, lerp, rampDistance, smootherstep, smoothstep } from "./animate.ts";
import { CUE } from "./cues.ts";
import { DEG, pitchTo, yawTo, type Pose } from "./rig.ts";

/** The film is one seed of the world. */
export const FILM_SEED = 1;
export const terrain: Terrain = createTerrain(FILM_SEED);

export interface Shot {
  name: string;
  start: number;
  end: number;
  /** World clock in seconds at `u` seconds into the shot. Animals, motes and light read it. */
  clock: (u: number) => number;
  camera: (u: number) => Pose;
  /** Where the world's detail and folds centre, when that is not the point under the camera. */
  player?: (u: number) => readonly [number, number];
  /** Distance held in focus, or 0 for a deep focus. */
  focus?: (u: number, pose: Pose) => number;
  /** Blur angle of the lens, 0 for none. */
  aperture?: (u: number) => number;
  fold?: (u: number, t: number) => FoldAmounts;
  grade?: (u: number, t: number) => Partial<GradeParams>;
  /** Flowers that open as the camera passes: ground points and the seconds into the shot they open. */
  blooms?: { x: number; z: number; u: number; scale?: number }[];
}

/** The wonder standing at about (x, z), checked against its name so a change to the placement fails loudly. */
export function wonderAt(x: number, z: number, name: string): Wonder {
  const w = wondersNear(terrain, x, z, 30)[0];
  if (!w || w.name !== name) throw new Error(`expected ${name} near (${x}, ${z}), found ${w ? w.name : "nothing"}`);
  return w;
}

const ground = (x: number, z: number): number => terrain.facetHeight(x, z, 2.7);
const steady = (rate = 1, from = 0) => (u: number): number => from + u * rate;
const SIDE = (yaw: number): [number, number] => [-Math.cos(yaw), Math.sin(yaw)];
const AHEAD = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)];

interface Run {
  from: readonly [number, number];
  /** Yaw of travel. */
  heading: number;
  /** Metres travelled after `u` seconds. */
  dist: (u: number) => number;
  /** Metres to the left of the line of travel. */
  side?: (u: number) => number;
  /** Camera height above the facets under it. */
  agl: (u: number) => number;
  /** Where the camera looks relative to travel: extra yaw and pitch in radians. */
  turn?: (u: number) => number;
  pitch?: (u: number) => number;
  roll?: (u: number) => number;
  fov: (u: number) => number;
}

/** A camera that follows the ground along a line. */
function run(r: Run): (u: number) => Pose {
  return (u) => {
    const [ax, az] = AHEAD(r.heading);
    const [sx, sz] = SIDE(r.heading);
    const d = r.dist(u);
    const s = r.side?.(u) ?? 0;
    const x = r.from[0] + ax * d + sx * s;
    const z = r.from[1] + az * d + sz * s;
    return { x, y: ground(x, z) + r.agl(u), z, yaw: r.heading + (r.turn?.(u) ?? 0), pitch: r.pitch?.(u) ?? 0, roll: r.roll?.(u) ?? 0, fov: r.fov(u) };
  };
}

/** A ground point `distance` metres from a wonder along a compass bearing in degrees, and the yaw that faces the wonder from there. */
function approach(w: Wonder, bearing: number, distance: number): { at: [number, number]; heading: number } {
  const b = bearing * DEG;
  return { at: [w.x + Math.sin(b) * distance, w.z + Math.cos(b) * distance], heading: b };
}

interface Portal {
  w: Wonder;
  /** +1 travels toward the wonder's local +z, -1 the other way. */
  dir: 1 | -1;
  /** Metres from the wonder's centre where the shot starts. */
  lead: number;
  dist: (u: number) => number;
  across?: (along: number) => number;
  /** Height above the wonder's ground. */
  up: (along: number) => number;
  pitch?: (u: number) => number;
  roll?: (u: number) => number;
  fov: (u: number) => number;
  /** Metres ahead along the line that the camera faces. */
  lookAhead?: number;
}

/** A camera that flies straight through a gate, arch or rib cage. */
function portal(p: Portal): (u: number) => Pose {
  const g = wonderGround(terrain, p.w);
  const place = (along: number): [number, number] => wonderPoint(p.w, p.across?.(along) ?? 0, along);
  return (u) => {
    const along = p.dir * (-p.lead + p.dist(u));
    const [x, z] = place(along);
    const [nx, nz] = place(along + p.dir * (p.lookAhead ?? 40));
    return { x, y: Math.max(g + p.up(along), ground(x, z) + 2), z, yaw: yawTo(x, z, nx, nz), pitch: p.pitch?.(u) ?? 0, roll: p.roll?.(u) ?? 0, fov: p.fov(u) };
  };
}

// Places. Each is checked by name, so the film fails at load if the world's placement changes.
const pennants = wonderAt(5055, -3931, "The Paper Pennants");
const cathedral = wonderAt(1300, -2375, "The Mirrored Cathedral");
const choir = wonderAt(1231, 5873, "The Drowned Choir");
const waitingGate = wonderAt(3968, 2058, "The Waiting Gate");
const prismGate = wonderAt(3810, 3461, "The Prismatic Gate");
const silentChoir = wonderAt(-3731, 1603, "The Silent Choir");
const redDoorway = wonderAt(-4024, 574, "The Red Doorway");
const mirroredDrift = wonderAt(-124, 3335, "The Mirrored Drift");
const halo = wonderAt(-588, 687, "The Pale Halo");
const paperBridge = wonderAt(4848, -3146, "The Paper Bridge");

const PLANET_LIFT = 250;
const FIRST_HIT = CUE.hit1;

/** Dunes at first light: a paper whale hangs over the pennants while the camera creeps forward, then lunges at the first hit. */
function dunesDawn(): Shot {
  const { at, heading } = approach(pennants, 355, 350);
  return {
    name: "dunes-dawn",
    start: 0,
    end: CUE.hit2,
    clock: steady(1, 3852),
    camera: run({
      from: at,
      heading,
      dist: (u) => rampDistance(u, FIRST_HIT - 0.1, FIRST_HIT + 2.4, 3, 16),
      agl: (u) => 1.8 + 1.2 * smoothstep(0, FIRST_HIT, u) + 9 * smoothstep(FIRST_HIT, CUE.hit2, u),
      pitch: (u) => 0.11 + 0.16 * smootherstep(0.3, FIRST_HIT + 0.6, u) - 0.1 * smoothstep(5.5, 8.75, u),
      roll: (u) => 0.015 * Math.sin(u * 0.5),
      fov: (u) => keys(u, [[0, 62], [FIRST_HIT, 58], [CUE.hit2, 50]]),
    }),
    focus: (u) => keys(u, [[0, 120], [FIRST_HIT - 0.3, 120], [FIRST_HIT + 1, 300]]),
    aperture: () => 0.006,
    grade: (_u, t) => ({ fade: smoothstep(0, 1.8, t) }),
  };
}

/** Prism Forest at night: a low glide along the glass toward the cathedral. */
function prismGlide(): Shot {
  const { at, heading } = approach(cathedral, 240, 330);
  return {
    name: "prism-glide",
    start: CUE.hit2,
    end: CUE.hit3,
    clock: steady(1, 130),
    camera: run({
      from: at,
      heading,
      dist: (u) => 11 * u + 1.2 * u * u,
      side: (u) => 7 * Math.sin(u * 0.45),
      agl: (u) => 1.4 + 0.6 * u,
      pitch: (u) => 0.05 + 0.05 * (u / 4.35),
      roll: (u) => -0.03 * Math.sin(u * 0.7),
      fov: (u) => lerp(64, 56, u / 4.35),
    }),
    focus: () => 90,
    aperture: () => 0.003,
  };
}

/** Lantern Deep: down the rib cage, faster and faster, into the drop. */
function cageRun(): Shot {
  const H = choir.size;
  const lateral = (along: number): number => 0.3 * H * Math.sin((along / (2.7 * H) + 0.5) * 3 + choir.r[0] * 6);
  const total = CUE.drop - CUE.hit3;
  return {
    name: "cage-run",
    start: CUE.hit3,
    end: CUE.drop,
    clock: steady(1, 260),
    camera: portal({
      w: choir,
      dir: -1,
      lead: 1.9 * H,
      dist: (u) => 22 * u + 0.5 * (80 / total) * u * u,
      across: lateral,
      up: () => 0.3 * H,
      pitch: (u) => 0.05 + 0.06 * Math.sin(u * 0.6),
      roll: (u) => 0.04 * Math.sin(u * 0.8),
      fov: (u) => lerp(60, 84, smoothstep(0, total, u)),
    }),
  };
}

/** The world rolls up into a planet and the camera climbs away from it. */
function planet(): Shot {
  const { at } = approach(pennants, 200, 420);
  const total = CUE.accent - CUE.drop;
  return {
    name: "planet",
    start: CUE.drop,
    end: CUE.accent,
    clock: steady(1, 300),
    camera: (u) => {
      const p = smootherstep(0, 1.1, u);
      const lift = PLANET_LIFT * Math.pow(p, 1.4);
      return { x: at[0], y: ground(at[0], at[1]) + 1.7 + lift, z: at[1], yaw: yawTo(at[0], at[1], pennants.x, pennants.z) + 0.25 * u, pitch: -1.32 * p, roll: 0, fov: 60 + 8 * p };
    },
    fold: (u) => ({ ...noFolds(), planet: smootherstep(0, 1.1, u) * (1 - smoothstep(total - 0.35, total, u) * 0.5) }),
  };
}

/** Pushes in on a gate or arch along its axis, ending short of the ring so it fills the frame at the cut. */
function pushIn(name: string, start: number, end: number, w: Wonder, dir: 1 | -1, o: { clock: number; from: number; to: number; sway?: number; fold?: Shot["fold"] }): Shot {
  const length = end - start;
  const R = 0.5 * w.size;
  return {
    name,
    start,
    end,
    clock: steady(1, o.clock),
    camera: portal({
      w,
      dir,
      lead: o.from * w.size,
      dist: (u) => (o.from - o.to) * w.size * smoothstep(-0.2, length, u),
      across: (along) => (o.sway ?? 0) * R * Math.sin(along * 0.012),
      up: () => 0.44 * w.size - 0.25 * R,
      pitch: (u) => 0.06 + 0.04 * (u / length),
      roll: (u) => 0.05 * Math.sin(u * 2.4),
      fov: (u) => lerp(56, 70, smoothstep(0, length, u)),
      lookAhead: 80,
    }),
    fold: o.fold,
  };
}

/** A low camera under a passing whale, turning to keep it in the sky. */
function whaleFlyover(start: number, end: number, from: readonly [number, number], slot: number, clock: number): Shot {
  const length = end - start;
  const aim = (u: number): { x: number; y: number; z: number } => {
    const b = beastPoint(terrain, FILM_SEED, slot, clock + u + 0.25, from[0], from[1]);
    return { x: b.x, y: b.y, z: b.z };
  };
  return {
    name: "whale-flyover",
    start,
    end,
    clock: steady(1, clock),
    camera: (u) => {
      const [dx, dz] = AHEAD(yawTo(from[0], from[1], aim(0).x, aim(0).z));
      const x = from[0] + dx * 7 * u;
      const z = from[1] + dz * 7 * u;
      const y = ground(x, z) + 1.6;
      const b = aim(u);
      const d = Math.hypot(b.x - x, b.z - z);
      return { x, y, z, yaw: yawTo(x, z, b.x, b.z), pitch: pitchTo(d, y, b.y - 6), roll: 0.03 * Math.sin(u * 1.3), fov: lerp(66, 58, u / length) };
    },
    focus: (u, pose) => {
      const b = aim(u);
      return Math.hypot(b.x - pose.x, b.y - pose.y, b.z - pose.z);
    },
    aperture: () => 0.004,
  };
}

/** Skims low over the ground toward a wonder at speed. */
function skim(name: string, start: number, end: number, w: Wonder, bearing: number, o: { clock: number; from: number; to: number; agl: number; fov?: [number, number]; pitch?: number; fold?: Shot["fold"] }): Shot {
  const { at, heading } = approach(w, bearing, o.from);
  const length = end - start;
  return {
    name,
    start,
    end,
    clock: steady(1, o.clock),
    camera: run({
      from: at,
      heading,
      dist: (u) => (o.from - o.to) * smoothstep(-0.3, length, u),
      side: (u) => 12 * Math.sin(u * 1.1),
      agl: () => o.agl,
      pitch: () => o.pitch ?? 0.06,
      roll: (u) => 0.07 * Math.sin(u * 1.7),
      fov: (u) => lerp(o.fov?.[0] ?? 62, o.fov?.[1] ?? 74, u / length),
    }),
    fold: o.fold,
  };
}

/** Rises through a rib cage, looking up along the bones. */
function ribRise(start: number, end: number): Shot {
  const length = end - start;
  return {
    name: "rib-rise",
    start,
    end,
    clock: steady(1, 700),
    camera: portal({
      w: silentChoir,
      dir: -1,
      lead: 0.9 * silentChoir.size,
      dist: (u) => 0.9 * silentChoir.size * smoothstep(0, length, u) * 0.9,
      across: (along) => 0.12 * silentChoir.size * Math.sin(along * 0.05),
      up: (along) => 4 + 0.5 * (0.9 * silentChoir.size - Math.abs(along)),
      pitch: (u) => 0.25 + 0.5 * smoothstep(0, length, u),
      roll: (u) => 0.12 * Math.sin(u * 1.5),
      fov: () => 74,
      lookAhead: 30,
    }),
  };
}

/** Climbs toward floating isles while the ground ahead closes over like a book. */
function islesClimb(start: number, end: number, w: Wonder, bearing: number): Shot {
  const length = end - start;
  const { at, heading } = approach(w, bearing, 400);
  return {
    name: "isles-climb",
    start,
    end,
    clock: steady(1, 900),
    camera: run({
      from: at,
      heading,
      dist: (u) => 40 * u + 6 * u * u,
      agl: (u) => 3 + 70 * smoothstep(0, length, u),
      pitch: (u) => 0.1 + 0.25 * smoothstep(0, length, u),
      roll: (u) => 0.06 * Math.sin(u * 1.1),
      fov: (u) => lerp(62, 76, u / length),
    }),
    fold: (u) => ({ ...noFolds(), hinge: 0.7 * smootherstep(0, length, u) }),
  };
}

/** The camera circles a small planet that the world has rolled itself into. */
function planetOrbit(start: number, end: number, at: readonly [number, number], clock: number): Shot {
  const length = end - start;
  return {
    name: "planet-orbit",
    start,
    end,
    clock: steady(1, clock),
    player: () => at,
    camera: (u) => {
      const a = (-0.4 + 1.1 * (u / length)) * Math.PI;
      const r = 70;
      const x = at[0] + Math.sin(a) * r;
      const z = at[1] + Math.cos(a) * r;
      const y = ground(at[0], at[1]) + 190;
      return { x, y, z, yaw: yawTo(x, z, at[0], at[1]), pitch: pitchTo(r, y, ground(at[0], at[1]) + 10), roll: 0.05 * Math.sin(u * 1.4), fov: 66 };
    },
    fold: () => ({ ...noFolds(), planet: 1 }),
  };
}

/**
 * The dunes fold up like a page as the riser peaks, then hang folded in the silence after the music stops.
 * Both shots share one camera path so the stop does not cut.
 */
function foldedDunes(start: number, stop: number, snap: number): [Shot, Shot] {
  const { at, heading } = approach(pennants, 355, 330);
  const rise = stop - start;
  const clock0 = 3900;
  const camera = run({
    from: at,
    heading,
    dist: (g) => 2.6 * g,
    agl: () => 1.7,
    pitch: (g) => 0.1 + 0.012 * g,
    roll: (g) => 0.02 * Math.sin(g * 0.9),
    fov: (g) => 66 - 0.8 * g,
  });
  return [
    {
      name: "fold-rise",
      start,
      end: stop,
      clock: steady(1, clock0),
      camera,
      focus: () => 260,
      aperture: () => 0.003,
      fold: (u) => ({ ...noFolds(), hinge: smootherstep(0.25, rise - 0.1, u) }),
    },
    {
      name: "hold",
      start: stop,
      end: snap,
      clock: (u) => clock0 + rise + (0.08 * (1 - Math.exp(-u * 3))) / 3,
      camera: (u) => camera(u + rise),
      focus: () => 260,
      aperture: () => 0.003,
      fold: () => ({ ...noFolds(), hinge: 1 }),
      grade: (u) => ({ saturation: 0.7, vignette: 0.5, exposure: -0.2 * smoothstep(0, 1.5, u) }),
    },
  ];
}

/** After the snap: a calm glide toward a paper arch while the dunes breathe. */
function afterSnap(start: number, end: number): Shot {
  const length = end - start;
  const { at, heading } = approach(paperBridge, 18, 420);
  return {
    name: "after-snap",
    start,
    end,
    clock: steady(1, 2300),
    camera: run({
      from: at,
      heading,
      dist: (u) => 11 * u,
      agl: (u) => 2.5 + 12 * smootherstep(0, length, u),
      pitch: (u) => 0.1 + 0.04 * (u / length),
      roll: () => 0,
      fov: () => 56,
    }),
    focus: () => 420,
    aperture: () => 0.003,
  };
}

/** The last shot, backing away from a ring in a still, blue place while the title appears. */
function closing(start: number, end: number): Shot {
  const { at, heading } = approach(halo, 150, 470);
  const length = end - start;
  return {
    name: "closing",
    start,
    end,
    clock: steady(1, 2600),
    camera: run({
      from: at,
      heading,
      dist: (u) => -12 * u,
      agl: (u) => 4 + 16 * smootherstep(0, length, u),
      pitch: (u) => -0.02 + 0.03 * (u / length),
      roll: () => 0,
      fov: () => 52,
    }),
    focus: () => 450,
    aperture: () => 0.003,
    grade: () => ({ exposure: -0.35 }),
  };
}

export const SHOTS: readonly Shot[] = [
  dunesDawn(),
  prismGlide(),
  cageRun(),
  planet(),
  pushIn("flats-gate", CUE.accent, 21.84, waitingGate, 1, { clock: 400, from: 2.3, to: 1.2, fold: (u) => ({ ...noFolds(), corkscrew: 0.25 * smoothstep(0, 2.1, u) }) }),
  pushIn("prism-gate", 21.84, 24.02, prismGate, -1, { clock: 440, from: 2.4, to: 1.25, sway: 0.5 }),
  whaleFlyover(24.02, 26.2, [5025, -3582], 0, 3871),
  skim("ember-doorway", 26.2, 28.39, redDoorway, 30, { clock: 520, from: 345, to: 215, agl: 3 }),
  ribRise(28.39, 30.57),
  islesClimb(30.57, 32.75, mirroredDrift, 0),
  planetOrbit(32.75, 34.93, approach(halo, 150, 420).at, 640),
  ...foldedDunes(34.93, CUE.stop, CUE.snap),
  afterSnap(CUE.snap, CUE.title),
  closing(CUE.title, CUE.end + 1),
];

export function shotAt(t: number): Shot {
  for (const s of SHOTS) if (t < s.end) return s;
  return SHOTS[SHOTS.length - 1]!;
}
