import * as THREE from "three";
import { emptySpec } from "../core/deform/stages.ts";
import { defaultGrade, type GradeParams } from "../core/render/grade.ts";
import { Score, type ScoreEvent, type ScoreFrame } from "../play/audio.ts";
import { foldSpec, noFolds, type FoldAmounts } from "../world/folds.ts";
import { ProcWorld, type WorldView } from "../world/procworld.ts";
import { lookAt } from "../world/realms.ts";
import { wonderGround, wonderPoint, type Wonder } from "../world/wonders.ts";
import { clamp, lerp, smootherstep, smoothstep } from "./animate.ts";
import { orientation, pitchTo, turnBetween, yawTo, type Pose } from "./rig.ts";
import { FILM_SEED, terrain, wonderAt } from "./shots.ts";

export const FLYBY_SECONDS = 120;

const ground = (x: number, z: number): number => terrain.facetHeight(x, z, 2.7);

interface Leg {
  seconds: number;
  pose: (start: Pose, u: number) => Pose;
}

export interface FoldEvent {
  t0: number;
  t1: number;
  kind: "planet" | "corkscrew" | "hinge";
  peak: number;
}

export interface RouteEvent {
  t: number;
  kind: ScoreEvent;
  strength: number;
}

interface Built {
  legs: Leg[];
  starts: Pose[];
  total: number;
}

class RouteBuilder {
  readonly legs: Leg[] = [];
  readonly folds: FoldEvent[] = [];
  readonly events: RouteEvent[] = [];
  private starts: Pose[] = [];
  private total = 0;

  constructor(start: Pose) {
    this.starts = [start];
  }

  private get here(): Pose {
    return this.starts[this.starts.length - 1]!;
  }

  private add(seconds: number, pose: (start: Pose, u: number) => Pose): this {
    const leg: Leg = { seconds, pose };
    this.legs.push(leg);
    this.starts.push(pose(this.here, seconds));
    this.total += seconds;
    return this;
  }

  /** Flies from where the last leg ended to a point, easing the heading onto the line of travel. */
  to(x: number, z: number, seconds: number, o: { agl: [number, number]; pitch?: [number, number]; fov?: [number, number]; sway?: number }): this {
    return this.add(seconds, (s, u) => {
      const k = smootherstep(0, seconds, u);
      const px = lerp(s.x, x, k);
      const pz = lerp(s.z, z, k);
      const travel = yawTo(s.x, s.z, x, z);
      const yaw = s.yaw + turnBetween(s.yaw, travel) * smootherstep(0, seconds * 0.45, u);
      const side = Math.sin((u / seconds) * Math.PI) * (o.sway ?? 0);
      const agl = lerp(o.agl[0], o.agl[1], k);
      return {
        x: px - Math.cos(yaw) * side * -1,
        y: ground(px, pz) + agl,
        z: pz + Math.sin(yaw) * side * -1,
        yaw,
        pitch: lerp(o.pitch?.[0] ?? s.pitch, o.pitch?.[1] ?? o.pitch?.[0] ?? s.pitch, k),
        roll: 0.05 * Math.sin(u * 1.3),
        fov: lerp(o.fov?.[0] ?? s.fov, o.fov?.[1] ?? o.fov?.[0] ?? s.fov, k),
      };
    });
  }

  /** Keeps flying on the current heading. Speed eases between the two ends, in metres per second. */
  glide(seconds: number, o: { speed: [number, number]; agl: [number, number]; turn?: number; pitch?: [number, number]; fov?: [number, number]; sway?: number }): this {
    return this.add(seconds, (s, u) => {
      const d = o.speed[0] * u + ((o.speed[1] - o.speed[0]) * u * u) / (2 * seconds);
      const yaw = s.yaw + (o.turn ?? 0) * (u / seconds);
      const ax = -Math.sin(s.yaw + ((o.turn ?? 0) * (u / seconds)) / 2);
      const az = -Math.cos(s.yaw + ((o.turn ?? 0) * (u / seconds)) / 2);
      const px = s.x + ax * d;
      const pz = s.z + az * d;
      const side = Math.sin(u * 0.8) * (o.sway ?? 0);
      const k = u / seconds;
      return {
        x: px - Math.cos(yaw) * side * -1,
        y: ground(px, pz) + lerp(o.agl[0], o.agl[1], smootherstep(0, seconds, u)),
        z: pz + Math.sin(yaw) * side * -1,
        yaw,
        pitch: lerp(o.pitch?.[0] ?? s.pitch, o.pitch?.[1] ?? o.pitch?.[0] ?? s.pitch, k),
        roll: 0.05 * Math.sin(u * 1.1) + (o.turn ?? 0) * -0.12,
        fov: lerp(o.fov?.[0] ?? s.fov, o.fov?.[1] ?? o.fov?.[0] ?? s.fov, k),
      };
    });
  }

  /** Flies through a gate, arch or rib cage along its axis. Starts at the portal entry, so fly to it first. */
  through(w: Wonder, seconds: number, o: { dir: 1 | -1; lead: number; up: number; sway?: number; pitch?: number }): this {
    this.events.push({ t: this.total + seconds / 2, kind: "sing", strength: 0.9 });
    const g = wonderGround(terrain, w);
    return this.add(seconds, (s, u) => {
      const alongNow = o.dir * -o.lead + o.dir * 2 * o.lead * (u / seconds);
      const across = (o.sway ?? 0) * Math.sin((alongNow / (2 * o.lead)) * Math.PI * 2);
      const [x, z] = wonderPoint(w, across, alongNow);
      const [nx, nz] = wonderPoint(w, across, alongNow + o.dir * 40);
      return {
        x,
        y: Math.max(g + o.up, ground(x, z) + 2),
        z,
        yaw: yawTo(x, z, nx, nz),
        pitch: o.pitch ?? 0.04,
        roll: 0.04 * Math.sin(u * 1.4),
        fov: lerp(s.fov, 72, u / seconds),
      };
    });
  }

  /** Circles a point, starting at whatever angle the camera already sits at. */
  orbit(cx: number, cz: number, seconds: number, o: { agl: [number, number]; sweep: number; radius?: number; lookUp?: number }): this {
    return this.add(seconds, (s, u) => {
      const a0 = Math.atan2(s.x - cx, s.z - cz);
      const r0 = Math.hypot(s.x - cx, s.z - cz);
      const a = a0 + o.sweep * smootherstep(0, seconds, u);
      const r = lerp(r0, o.radius ?? r0, smootherstep(0, seconds, u));
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const y = ground(cx, cz) + lerp(o.agl[0], o.agl[1], smootherstep(0, seconds, u));
      return { x, y, z, yaw: yawTo(x, z, cx, cz), pitch: pitchTo(r, y, ground(cx, cz) + (o.lookUp ?? 10)), roll: 0.04 * Math.sin(u * 0.9), fov: s.fov };
    });
  }

  /** Climbs or sinks in place, tilting the camera as it goes. */
  rise(seconds: number, o: { lift: number; pitch: [number, number]; fov?: [number, number] }): this {
    return this.add(seconds, (s, u) => {
      const k = smootherstep(0, seconds, u);
      return { x: s.x, y: s.y + o.lift * k, z: s.z, yaw: s.yaw + 0.1 * k, pitch: lerp(o.pitch[0], o.pitch[1], k), roll: 0, fov: lerp(o.fov?.[0] ?? s.fov, o.fov?.[1] ?? o.fov?.[0] ?? s.fov, k) };
    });
  }

  /** Schedules a fold power over the next stretch of the route. Not a leg. */
  fold(kind: FoldEvent["kind"], seconds: number, peak = 1): this {
    this.folds.push({ t0: this.total, t1: this.total + seconds, kind, peak });
    this.events.push({ t: this.total + 0.5, kind, strength: 1 });
    return this;
  }

  /** Schedules a sound from the score. Not a leg. */
  event(kind: ScoreEvent, atSeconds: number, strength = 1): this {
    this.events.push({ t: atSeconds, kind, strength });
    return this;
  }

  build(): Built {
    return { legs: this.legs, starts: this.starts, total: this.total };
  }
}

export interface FlybyRoute {
  name: string;
  title: string;
  built: Built;
  folds: FoldEvent[];
  events: RouteEvent[];
  clockBase: number;
  clockRate: number;
}

function route(name: string, title: string, clockBase: number, clockRate: number, start: Pose, build: (r: RouteBuilder) => void): FlybyRoute {
  const r = new RouteBuilder(start);
  build(r);
  return { name, title, built: r.build(), folds: r.folds, events: r.events.sort((a, b) => a.t - b.t), clockBase, clockRate };
}

const pose = (x: number, z: number, agl: number, yaw: number, pitch = 0.06, fov = 62): Pose => ({ x, y: ground(x, z) + agl, z, yaw, pitch, roll: 0, fov });

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

const entry = (w: Wonder, dir: 1 | -1, lead: number): [number, number] => wonderPoint(w, 0, -dir * lead);
const toward = (from: readonly [number, number], w: Wonder): number => yawTo(from[0], from[1], w.x, w.z);

function makeRoutes(): FlybyRoute[] {
  const routes: FlybyRoute[] = [];

  routes.push(
    route("01-dawn-gates", "Dawn Gates. A slow sunrise glide through the Paper Bridge, then a hinge fold over the dunes.", 3852, 1, pose(4700, -2700, 6, toward([4700, -2700], paperBridge)), (r) => {
      const [ex, ez] = entry(paperBridge, 1, paperBridge.size * 1.5);
      r.to(ex, ez, 26, { agl: [6, 10], fov: [62, 58] });
      r.through(paperBridge, 16, { dir: 1, lead: paperBridge.size * 1.5, up: paperBridge.size * 0.3 });
      r.fold("hinge", 30, 0.85);
      r.glide(30, { speed: [16, 26], agl: [12, 30], sway: 10, fov: [62, 66] });
      r.orbit(pennants.x, pennants.z, 26, { agl: [36, 26], sweep: 2.4, radius: 190 });
      r.glide(22, { speed: [20, 9], agl: [26, 5], pitch: [0.02, 0.1], fov: [66, 56] });
    }),
  );

  routes.push(
    route("02-prism-rush", "Prism Rush. Fast and low through the glass forest, a gate dive, then a corkscrew twist.", 130, 1.4, pose(900, -1900, 4, toward([900, -1900], cathedral)), (r) => {
      r.glide(24, { speed: [38, 62], agl: [4, 7], sway: 8, fov: [66, 76] });
      const [ex, ez] = entry(prismGate, -1, prismGate.size * 1.7);
      r.to(ex, ez, 30, { agl: [7, 14], fov: [76, 70] });
      r.through(prismGate, 14, { dir: -1, lead: prismGate.size * 1.7, up: prismGate.size * 0.3, sway: 6 });
      r.fold("corkscrew", 26, 0.8);
      r.glide(26, { speed: [55, 78], agl: [10, 22], sway: 14, fov: [72, 82] });
      r.glide(26, { speed: [78, 24], agl: [22, 6], turn: 0.5, fov: [82, 60] });
    }),
  );

  routes.push(
    route("03-deep-ribs", "Deep Ribs. Down the Drowned Choir's rib cage, slow orbit, then the world rolls into a planet.", 260, 1, pose(1231, 4600, 14, toward([1231, 4600], choir)), (r) => {
      const [ex, ez] = entry(choir, -1, choir.size * 1.9);
      r.to(ex, ez, 24, { agl: [14, choir.size * 0.3] });
      r.through(choir, 26, { dir: -1, lead: choir.size * 1.9, up: choir.size * 0.3, sway: choir.size * 0.18 });
      r.orbit(choir.x, choir.z, 26, { agl: [30, 44], sweep: -2.8, radius: choir.size * 1.15, lookUp: choir.size * 0.4 });
      r.fold("planet", 30, 1);
      r.rise(20, { lift: 190, pitch: [-0.2, -1.15], fov: [62, 68] });
      r.orbit(choir.x, choir.z, 24, { agl: [240, 210], sweep: 1.8, radius: 120, lookUp: 0 });
    }),
  );

  routes.push(
    route("04-flats-serene", "Flats Serene. The slowest flight. Mirror water, the Waiting Gate, and a hinge fold like a closing book.", 400, 0.7, pose(3400, 1500, 3, toward([3400, 1500], waitingGate)), (r) => {
      const [ex, ez] = entry(waitingGate, 1, waitingGate.size * 1.8);
      r.to(ex, ez, 34, { agl: [3, 5], fov: [56, 54], pitch: [0.04, 0.05] });
      r.through(waitingGate, 20, { dir: 1, lead: waitingGate.size * 1.8, up: waitingGate.size * 0.34 });
      r.fold("hinge", 34, 1);
      r.glide(34, { speed: [9, 12], agl: [5, 9], sway: 5, fov: [54, 58] });
      r.orbit(waitingGate.x, waitingGate.z, 32, { agl: [14, 9], sweep: 2.0, radius: 150 });
    }),
  );

  routes.push(
    route("05-ember-run", "Ember Run. A fast canyon dive through the Red Doorway with thunder, twisting out the far side.", 520, 1.6, pose(-4600, 1100, 10, toward([-4600, 1100], redDoorway)), (r) => {
      const [ex, ez] = entry(redDoorway, 1, redDoorway.size * 1.8);
      r.to(ex, ez, 26, { agl: [10, 16], fov: [64, 74] });
      r.event("thunder", 30, 0.9);
      r.through(redDoorway, 15, { dir: 1, lead: redDoorway.size * 1.8, up: redDoorway.size * 0.3, sway: 5 });
      r.event("thunder", 52, 0.7);
      r.fold("corkscrew", 28, 0.9);
      r.glide(30, { speed: [60, 95], agl: [14, 30], sway: 16, fov: [74, 84] });
      r.glide(33, { speed: [95, 30], agl: [30, 8], turn: -0.6, fov: [84, 62] });
      r.event("thunder", 96, 0.8);
      r.orbit(redDoorway.x, redDoorway.z, 16, { agl: [22, 14], sweep: 1.6, radius: 170 });
    }),
  );

  routes.push(
    route("06-planet-tour", "Planet Tour. The world rolls up under you, a long orbit of the little planet, then unfolds into a descent.", 700, 1, pose(-1000, 300, 5, toward([-1000, 300], halo)), (r) => {
      const [ex, ez] = entry(halo, 1, halo.size * 1.6);
      r.to(ex, ez, 22, { agl: [5, 12] });
      r.through(halo, 16, { dir: 1, lead: halo.size * 1.6, up: halo.size * 0.3 });
      r.fold("planet", 52, 1);
      r.rise(24, { lift: 210, pitch: [-0.15, -1.2], fov: [62, 70] });
      r.orbit(halo.x, halo.z, 30, { agl: [250, 235], sweep: 2.6, radius: 110, lookUp: 0 });
      r.glide(28, { speed: [14, 22], agl: [120, 8], pitch: [-0.5, 0.08], fov: [70, 60] });
    }),
  );

  routes.push(
    route("07-grand-tour", "Grand Tour. Bridge, cathedral and choir in one long fast cross-country flight.", 1500, 1.8, pose(4400, -2600, 8, toward([4400, -2600], paperBridge)), (r) => {
      const [bx, bz] = entry(paperBridge, 1, paperBridge.size * 1.5);
      r.to(bx, bz, 16, { agl: [8, 12] });
      r.through(paperBridge, 12, { dir: 1, lead: paperBridge.size * 1.5, up: paperBridge.size * 0.3 });
      r.to(cathedral.x - 200, cathedral.z + 150, 22, { agl: [16, 26], fov: [68, 76] });
      r.orbit(cathedral.x, cathedral.z, 16, { agl: [30, 22], sweep: 2.6, radius: 210, lookUp: 26 });
      r.fold("corkscrew", 20, 0.55);
      r.to(choir.x + 300, choir.z - 700, 20, { agl: [24, 34], fov: [76, 72] });
      const [cx, cz] = entry(choir, -1, choir.size * 1.7);
      r.to(cx, cz, 8, { agl: [34, choir.size * 0.3] });
      r.through(choir, 14, { dir: -1, lead: choir.size * 1.7, up: choir.size * 0.3, sway: choir.size * 0.15 });
      r.glide(12, { speed: [40, 16], agl: [20, 7], fov: [72, 58] });
    }),
  );

  routes.push(
    route("08-choir-slow", "Choir Slow. Rising through the Silent Choir's ribs looking up, then a slow circle of the Pale Halo.", 900, 0.8, pose(-4300, 2100, 6, toward([-4300, 2100], silentChoir)), (r) => {
      const [ex, ez] = entry(silentChoir, -1, silentChoir.size * 1.4);
      r.to(ex, ez, 28, { agl: [6, 12], fov: [58, 66] });
      r.through(silentChoir, 30, { dir: -1, lead: silentChoir.size * 1.4, up: silentChoir.size * 0.22, pitch: 0.3, sway: silentChoir.size * 0.1 });
      r.to(halo.x - 260, halo.z + 200, 30, { agl: [14, 20], fov: [66, 58] });
      r.orbit(halo.x, halo.z, 32, { agl: [22, 15], sweep: -2.4, radius: 170, lookUp: 14 });
    }),
  );

  routes.push(
    route("09-isles-dive", "Isles Dive. Climbing past the floating isles, a planet moment at the top, then a long dive to the Waiting Gate.", 1100, 1.2, pose(-500, 2900, 4, toward([-500, 2900], mirroredDrift)), (r) => {
      r.to(mirroredDrift.x - 160, mirroredDrift.z - 160, 24, { agl: [4, 42], fov: [62, 70] });
      r.orbit(mirroredDrift.x, mirroredDrift.z, 24, { agl: [48, 70], sweep: 2.8, radius: 180, lookUp: 40 });
      r.fold("planet", 24, 0.9);
      r.rise(16, { lift: 150, pitch: [-0.1, -1.05], fov: [70, 68] });
      const [ex, ez] = entry(waitingGate, -1, waitingGate.size * 1.9);
      r.to(ex, ez, 36, { agl: [60, 16], fov: [68, 74] });
      r.through(waitingGate, 20, { dir: -1, lead: waitingGate.size * 1.9, up: waitingGate.size * 0.32 });
    }),
  );

  routes.push(
    route("10-twist-river", "Twist River. Two gates and two corkscrews at cruising speed, ending rolled into a planet over the halo.", 2000, 1.3, pose(3300, 1400, 7, toward([3300, 1400], waitingGate)), (r) => {
      const [wx, wz] = entry(waitingGate, 1, waitingGate.size * 1.7);
      r.to(wx, wz, 20, { agl: [7, 12] });
      r.through(waitingGate, 15, { dir: 1, lead: waitingGate.size * 1.7, up: waitingGate.size * 0.32 });
      r.fold("corkscrew", 24, 0.85);
      r.to(prismGate.x + 240, prismGate.z + 200, 25, { agl: [14, 20], fov: [70, 74] });
      const [px, pz] = entry(prismGate, -1, prismGate.size * 1.7);
      r.to(px, pz, 9, { agl: [20, prismGate.size * 0.3] });
      r.through(prismGate, 14, { dir: -1, lead: prismGate.size * 1.7, up: prismGate.size * 0.3, sway: 5 });
      r.fold("corkscrew", 20, 0.7);
      r.glide(17, { speed: [42, 20], agl: [18, 9], fov: [74, 62] });
      r.fold("planet", 20, 1);
      r.to(halo.x - 200, halo.z - 140, 12, { agl: [40, 90], pitch: [-0.2, -0.7] });
      r.orbit(halo.x, halo.z, 8, { agl: [130, 120], sweep: 1.2, radius: 100, lookUp: 0 });
    }),
  );

  for (const rt of routes) {
    if (Math.abs(rt.built.total - FLYBY_SECONDS) > 0.01) throw new Error(`${rt.name} runs ${rt.built.total}s, not ${FLYBY_SECONDS}s`);
  }
  return routes;
}

export const ROUTES: readonly FlybyRoute[] = makeRoutes();

function poseAt(rt: FlybyRoute, t: number): Pose {
  const { legs, starts } = rt.built;
  let acc = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    if (t <= acc + leg.seconds || i === legs.length - 1) return leg.pose(starts[i]!, clamp(t - acc, 0, leg.seconds));
    acc += leg.seconds;
  }
  return starts[starts.length - 1]!;
}

function foldsAt(rt: FlybyRoute, t: number): FoldAmounts {
  const a = noFolds();
  for (const f of rt.folds) {
    if (t < f.t0 || t > f.t1) continue;
    const env = smootherstep(f.t0, f.t0 + Math.min(7, (f.t1 - f.t0) * 0.3), t) * (1 - smootherstep(f.t1 - Math.min(7, (f.t1 - f.t0) * 0.3), f.t1, t));
    a[f.kind] = Math.max(a[f.kind], f.peak * env);
  }
  return a;
}

export interface FlybyFrame {
  pose: Pose;
  speed: number;
  frame: ScoreFrame;
}

export function flybyFrame(rt: FlybyRoute, t: number): FlybyFrame {
  const poseNow = poseAt(rt, t);
  const ahead = poseAt(rt, Math.min(t + 0.5, FLYBY_SECONDS));
  const speed = Math.hypot(ahead.x - poseNow.x, ahead.z - poseNow.z) / 0.5;
  const mix = terrain.realmAt(poseNow.x, poseNow.z);
  const folds = foldsAt(rt, t);
  return {
    pose: poseNow,
    speed,
    frame: {
      dt: 0.05,
      realmA: mix.a,
      realmB: mix.b,
      realmBlend: mix.t,
      speed,
      flying: true,
      gliding: false,
      grounded: false,
      planet: folds.planet,
      altitude: Math.max(0, poseNow.y - ground(poseNow.x, poseNow.z)),
    },
  };
}

function wavBase64(buffer: AudioBuffer): string {
  const n = buffer.length;
  const bytes = new ArrayBuffer(44 + n * 4);
  const v = new DataView(bytes);
  const text = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 4, true);
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i]!)) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i]!)) * 32767, true);
  }
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode(...u8.subarray(i, i + 32768));
  return btoa(bin);
}

class Flyby {
  private world!: ProcWorld;

  async init(o: { width: number; height: number; supersample: number }): Promise<Record<string, unknown>> {
    this.world = ProcWorld.create({
      canvas: document.getElementById("c") as HTMLCanvasElement,
      width: o.width,
      height: o.height,
      supersample: o.supersample,
      hdr: "half",
      capture: true,
    });
    return { splats: this.world.splatCount, routes: ROUTES.map((r) => ({ name: r.name, title: r.title, seconds: r.built.total })) };
  }

  async renderFrame(routeIndex: number, t: number): Promise<{ settleMs: number; renderMs: number }> {
    const rt = ROUTES[routeIndex]!;
    const { pose: p, frame } = flybyFrame(rt, t);
    const world = this.world;
    const position = new THREE.Vector3(p.x, p.y, p.z);
    const feet = new THREE.Vector3(p.x, ground(p.x, p.z), p.z);
    const mix = terrain.realmAt(p.x, p.z);
    const look = lookAt(mix.a, mix.b, mix.t);
    const folds = foldsAt(rt, t);
    const clock = rt.clockBase + t * rt.clockRate;
    const rings = rt.events
      .filter((e) => t - e.t >= 0 && t - e.t < 4.2 && (e.kind === "sing" || e.kind === "planet" || e.kind === "corkscrew" || e.kind === "hinge"))
      .slice(-2)
      .map((e) => ({ x: p.x, z: p.z, start: rt.clockBase + e.t * rt.clockRate, amplitude: 0.7, speed: 90, life: 4.2, radius: 3, width: 8 }));
    const view: WorldView = {
      time: clock,
      seed: FILM_SEED,
      player: feet,
      heading: p.yaw,
      camera: { position, quaternion: orientation(p), fov: p.fov },
      atmosphere: look.atmosphere,
      realm: { a: mix.a, b: mix.b, t: mix.t, variant: 0 },
      spec: folds.planet > 1e-4 || folds.corkscrew > 1e-4 || folds.hinge > 1e-4 ? foldSpec(folds, feet, p.yaw) : emptySpec(),
      dof: { focalDistance: 0, apertureAngle: 0 },
      lightRings: [rings[0] ?? null, rings[1] ?? null],
    };
    world.setView(view);
    const t0 = performance.now();
    await world.settle();
    const t1 = performance.now();
    world.drawHdr();
    const grade: GradeParams = { ...defaultGrade(), ...look.grade };
    grade.fade = Math.min(1, smoothstep(0, 1.4, t)) * (1 - smoothstep(FLYBY_SECONDS - 1.6, FLYBY_SECONDS, t));
    world.post.render(world.hdrTexture, { ...grade, frame: Math.round(t * 24) }, 0);
    void frame;
    return { settleMs: t1 - t0, renderMs: performance.now() - t1 };
  }

  png(): string {
    const { post } = this.world;
    const canvas = document.createElement("canvas");
    canvas.width = post.width;
    canvas.height = post.height;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(post.width, post.height);
    image.data.set(post.read());
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  /** Renders the world's own score for a route offline, following the flight the camera took. */
  async renderAudio(routeIndex: number): Promise<string> {
    const rt = ROUTES[routeIndex]!;
    const sampleRate = 44100;
    const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * FLYBY_SECONDS), sampleRate);
    const score = new Score();
    score.attach(ctx);
    const events = [...rt.events].sort((a, b) => a.t - b.t);
    let next = 0;
    const step = 0.05;
    for (let t = step; t < FLYBY_SECONDS; t += step) {
      const at = t;
      ctx.suspend(at).then(() => {
        while (next < events.length && events[next]!.t <= at) {
          const e = events[next++]!;
          score.event(e.kind, e.strength, true);
        }
        score.update(flybyFrame(rt, at).frame);
        void ctx.resume();
      });
    }
    const buffer = await ctx.startRendering();
    return wavBase64(buffer);
  }
}

declare global {
  interface Window {
    flyby: Flyby;
  }
}

window.flyby = new Flyby();
