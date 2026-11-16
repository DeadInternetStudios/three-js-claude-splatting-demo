import * as THREE from "three";
import { emptySpec, type DeformSpec } from "../core/deform/stages.ts";
import { defaultGrade, type GradeParams } from "../core/render/grade.ts";
import type { RingSpec } from "../world/layers/ground.ts";
import { beastPoint } from "../world/cpu/beasts.ts";
import { flockPoint } from "../world/cpu/flocks.ts";
import { foldSpec, noFolds, type FoldAmounts } from "../world/folds.ts";
import { createTerrain, type Terrain } from "../world/cpu/terrain.ts";
import { lookAt } from "../world/realms.ts";
import { ProcLayer } from "../world/layer.ts";
import { ProcWorld, type WorldView } from "../world/procworld.ts";
import { probeTerrain } from "./probe.ts";
import type { Atmosphere } from "../world/uniforms.ts";

/** A camera pose and a moment, in plain JSON so scripts can describe shots. */
export interface ShotSpec {
  time?: number;
  seed?: number;
  pos: [number, number, number];
  yaw?: number;
  pitch?: number;
  fov?: number;
  player?: [number, number, number];
  /** Take the look of this realm mix instead of the first realm. */
  realm?: { a: number; b: number; t: number };
  /** Aim the camera at a flock: stand `distance` metres to its side and `above` metres over it. Overrides pos and yaw. */
  flock?: { index: number; distance: number; above: number; side?: number };
  /** Aim the camera at a creature the same way. The player stands at pos. */
  beast?: { slot: number; distance: number; above: number; side?: number };
  /** Put the camera this many metres above the facets under it, ignoring pos[1]. */
  agl?: number;
  atmosphere?: Partial<Record<keyof Atmosphere, unknown>>;
  grade?: Partial<GradeParams>;
  spec?: DeformSpec;
  /** A flash over the world: [strength, secondsAgo]. */
  pulse?: [number, number];
  /** Rings of light that left the given ground points: [x, z, secondsAgo, amplitude]. */
  rings?: [number, number, number, number][];
  /** Flowers planted before the shot: [x, z, secondsAgo, realm, scale]. */
  blooms?: [number, number, number, number, number?][];
  /** Fold powers about the player, used when `spec` is absent. */
  fold?: Partial<FoldAmounts>;
  /** Layers to leave out of the shot, by name, for finding which one makes a shape. */
  hide?: string[];
}

export interface InitOptions {
  width: number;
  height: number;
  supersample?: number;
  capture: boolean;
  hdr?: "half" | "float";
  rings?: RingSpec[];
}

declare global {
  interface Window {
    lab: Lab;
  }
}

const terrains = new Map<number, Terrain>();
function terrainFor(seed: number): Terrain {
  let t = terrains.get(seed);
  if (!t) {
    t = createTerrain(seed);
    terrains.set(seed, t);
  }
  return t;
}

function ringAt(spec: ShotSpec, i: number): { x: number; z: number; start: number; amplitude: number } | null {
  const r = spec.rings?.[i];
  return r ? { x: r[0], z: r[1], start: (spec.time ?? 0) - r[2], amplitude: r[3] } : null;
}

function viewFrom(spec: ShotSpec): { view: WorldView; grade: GradeParams } {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(spec.pitch ?? 0), THREE.MathUtils.degToRad(spec.yaw ?? 0), 0, "YXZ"));
  const seed = spec.seed ?? 1;
  const realm = spec.realm ?? { a: 0, b: 0, t: 0 };
  const look = lookAt(realm.a, realm.b, realm.t);
  const atmosphere = { ...look.atmosphere, ...(spec.atmosphere as object) } as Atmosphere;
  if (Array.isArray((atmosphere as unknown as { sunDir: unknown }).sunDir)) {
    const a = (atmosphere as unknown as { sunDir: number[] }).sunDir;
    atmosphere.sunDir = new THREE.Vector3(a[0], a[1], a[2]);
  }
  const position = new THREE.Vector3(...spec.pos);
  if (spec.flock) {
    const f = flockPoint(terrainFor(seed), seed, spec.flock.index, spec.time ?? 0, position.x, position.z, 1800, 40);
    const side = spec.flock.side ?? 1;
    position.set(f.x - f.dz * spec.flock.distance * side, f.y + spec.flock.above, f.z + f.dx * spec.flock.distance * side);
    const look = new THREE.Vector3(f.x, f.y, f.z).sub(position).normalize();
    q.setFromRotationMatrix(new THREE.Matrix4().lookAt(position, new THREE.Vector3(f.x, f.y, f.z), new THREE.Vector3(0, 1, 0)));
    void look;
  }
  if (spec.beast) {
    const b = beastPoint(terrainFor(seed), seed, spec.beast.slot, spec.time ?? 0, position.x, position.z);
    const side = spec.beast.side ?? 1;
    position.set(b.x - b.dz * spec.beast.distance * side, b.y + spec.beast.above, b.z + b.dx * spec.beast.distance * side);
    q.setFromRotationMatrix(new THREE.Matrix4().lookAt(position, new THREE.Vector3(b.x, b.y, b.z), new THREE.Vector3(0, 1, 0)));
  }
  if (spec.agl !== undefined && !spec.flock && !spec.beast) position.y = terrainFor(seed).facetHeight(position.x, position.z, 2.7) + spec.agl;
  const heading = THREE.MathUtils.degToRad(spec.yaw ?? 0);
  const anchor = spec.player ?? [position.x, 0, position.z];
  const feet = new THREE.Vector3(anchor[0], terrainFor(seed).facetHeight(anchor[0], anchor[2], 0.9), anchor[2]);
  const view: WorldView = {
    time: spec.time ?? 0,
    seed,
    player: feet,
    heading,
    camera: { position, quaternion: q, fov: spec.fov ?? 55 },
    atmosphere,
    realm: { ...realm, variant: 0 },
    spec: spec.spec ?? (spec.fold ? foldSpec({ ...noFolds(), ...spec.fold }, feet, heading) : emptySpec()),
    dof: { focalDistance: 0, apertureAngle: 0 },
    lightRings: [ringAt(spec, 0), ringAt(spec, 1)],
    pulse: spec.pulse ? [spec.pulse[0], (spec.time ?? 0) - spec.pulse[1]] : undefined,
  };
  return { view, grade: { ...defaultGrade(), ...look.grade, ...spec.grade } };
}

class Lab {
  world!: ProcWorld;
  canvas!: HTMLCanvasElement;

  init(o: InitOptions): Record<string, unknown> {
    this.canvas = document.getElementById("c") as HTMLCanvasElement;
    this.world = ProcWorld.create({ canvas: this.canvas, width: o.width, height: o.height, supersample: o.supersample, hdr: o.hdr ?? "half", capture: o.capture, rings: o.rings });
    const gl = this.world.stage.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown", splats: this.world.splatCount, layers: Object.fromEntries(this.world.layers.map((l) => [l.name, l.numSplats])) };
  }

  /** Adds layers whose slots are all inactive, to measure what idle indices cost. */
  addIdleLayer(count: number): void {
    const layer = new ProcLayer({ name: "idle", count, glsl: "bool layerGen(int index, sampler2D field, out Surfel s) { return false; }" }, this.world.uniforms);
    this.world.layers.push(layer);
    this.world.stage.scene.add(layer);
  }

  /** Evaluates the terrain on the GPU and on the CPU at the same points. */
  probe(seed: number, points: [number, number, number][]): { gpu: ReturnType<typeof probeTerrain>; cpu: { height: number; a: number; b: number; t: number }[] } {
    const terrain = createTerrain(seed);
    const gpu = probeTerrain(this.world.stage.renderer, seed, points);
    const cpu = points.map(([x, z, lod]) => {
      const r = terrain.realmAt(x, z);
      return { height: r.t <= 0.001 ? terrain.heightRealm(r.a, x, z, lod) : terrain.height(x, z, lod), a: r.a, b: r.b, t: r.t };
    });
    return { gpu, cpu };
  }

  /** Renders one frame and returns it as a PNG data URL along with timings in milliseconds. */
  async shot(spec: ShotSpec): Promise<{ png: string; settleMs: number; renderMs: number }> {
    const { world } = this;
    const { view, grade } = viewFrom(spec);
    for (const layer of world.layers) layer.visible = !spec.hide?.some((h) => layer.name.startsWith(h));
    world.blooms.clear();
    for (const [x, z, ago, realm, scale] of spec.blooms ?? []) world.blooms.plant(x, terrainFor(spec.seed ?? 1).facetHeight(x, z, 0.9), z, (spec.time ?? 0) - ago, realm, scale ?? 1);
    world.setView(view);
    const t0 = performance.now();
    await world.settle();
    const t1 = performance.now();
    world.drawHdr();
    world.post.render(world.hdrTexture, grade, 0, true);
    world.stage.renderer.getContext().finish();
    const t2 = performance.now();
    return { png: this.canvas.toDataURL("image/png"), settleMs: t1 - t0, renderMs: t2 - t1 };
  }

  /** Live loop for `seconds`, flying the camera forward. Returns frame statistics. */
  live(spec: ShotSpec, seconds: number, speed = 8): Promise<{ frames: number; fps: number; p50: number; p95: number; max: number }> {
    const { world } = this;
    return new Promise((resolve) => {
      const times: number[] = [];
      let last = performance.now();
      const start = last;
      const base = viewFrom(spec).view;
      const tick = (now: number): void => {
        times.push(now - last);
        last = now;
        const t = (now - start) / 1000;
        const { view, grade } = viewFrom({ ...spec, time: (spec.time ?? 0) + t, pos: [spec.pos[0], spec.pos[1], spec.pos[2] - speed * t] });
        view.camera.fov = base.camera.fov;
        world.setView(view);
        world.drawHdr();
        world.post.render(world.hdrTexture, grade, 0, true);
        if (t < seconds) requestAnimationFrame(tick);
        else {
          const sorted = [...times.slice(5)].sort((a, b) => a - b);
          const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
          resolve({ frames: sorted.length, fps: 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length), p50: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1]! });
        }
      };
      requestAnimationFrame(tick);
    });
  }
}

window.lab = new Lab();
