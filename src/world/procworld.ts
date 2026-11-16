import * as THREE from "three";
import { isIdentitySpec, type DeformSpec } from "../core/deform/stages.ts";
import { CinematicPost } from "../core/render/post.ts";
import { createStage, type Stage } from "../core/render/stage.ts";
import { emptyCull, viewCull } from "./cull.ts";
import { Beasts } from "./layers/beasts.ts";
import { CloudLayer } from "./layers/clouds.ts";
import { Blooms } from "./layers/blooms.ts";
import { FloraLayers } from "./layers/flora.ts";
import { Flocks } from "./layers/fliers.ts";
import { GroundRings, type RingSpec } from "./layers/ground.ts";
import { WaterMirror } from "./layers/mirror.ts";
import { MoteCloud } from "./layers/motes.ts";
import { Wonders } from "./layers/wonders.ts";
import type { ProcLayer } from "./layer.ts";
import { SkyPass } from "./sky.ts";
import { DeformUniform, WorldUniform, type Atmosphere, type LightRing, type StormFlash } from "./uniforms.ts";

export const FAR_PLANE = 60000;

/** Everything that decides what the world looks like from one camera at one moment. */
export interface WorldView {
  time: number;
  seed: number;
  /** Where the player stands. Layers centre their detail here. */
  player: THREE.Vector3;
  heading: number;
  camera: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number };
  atmosphere: Atmosphere;
  realm: { a: number; b: number; t: number; variant: number };
  spec: DeformSpec;
  dof: { focalDistance: number; apertureAngle: number };
  /** Rotation the sky is looked up with. Defaults to the camera's. */
  skyOrientation?: THREE.Quaternion;
  pulse?: [number, number];
  storm?: StormFlash;
  lightRings?: readonly (LightRing | null)[];
}

export interface ProcWorldOptions {
  canvas?: HTMLCanvasElement;
  width: number;
  height: number;
  supersample?: number;
  hdr?: "half" | "float";
  /** Capture renders on demand and waits for the sort. Live mode lets Spark update on its own. */
  capture: boolean;
  blurAmount?: number;
  rings?: RingSpec[];
}

/** The procedural world as a drawable: generator layers, the sky behind them and the cinematic resolve. */
export class ProcWorld {
  readonly stage: Stage;
  readonly post: CinematicPost;
  readonly uniforms = { world: new WorldUniform(), deform: new DeformUniform() };
  readonly ground: GroundRings;
  readonly flora: FloraLayers;
  readonly motes: MoteCloud;
  readonly flocks: Flocks;
  readonly wonders: Wonders;
  readonly beasts: Beasts;
  readonly blooms: Blooms;
  readonly clouds: CloudLayer;
  readonly mirror: WaterMirror;
  readonly layers: ProcLayer[] = [];
  /** Layers skip the shading of splats outside the view while this is on. */
  cullEnabled = true;
  private readonly cull = emptyCull();
  private readonly sky: SkyPass;

  private constructor(stage: Stage, post: CinematicPost, rings?: RingSpec[]) {
    this.stage = stage;
    this.post = post;
    this.sky = new SkyPass(this.uniforms.world);
    this.ground = new GroundRings(this.uniforms, rings);
    this.flora = new FloraLayers(this.uniforms);
    this.motes = new MoteCloud(this.uniforms);
    this.flocks = new Flocks(this.uniforms);
    this.wonders = new Wonders(this.uniforms);
    this.beasts = new Beasts(this.uniforms);
    this.blooms = new Blooms(this.uniforms);
    this.clouds = new CloudLayer(this.uniforms);
    this.mirror = new WaterMirror(this.uniforms, [this.flora.layers[2]!, this.flora.layers[3]!, this.wonders.layer]);
    this.layers.push(...this.ground.layers, ...this.flora.layers, this.motes.layer, this.flocks.layer, this.wonders.layer, this.beasts.layer, this.blooms.layer, this.clouds.layer, ...this.mirror.layers);
    for (const layer of this.layers) stage.scene.add(layer);
  }

  static create(o: ProcWorldOptions): ProcWorld {
    const stage = createStage({
      canvas: o.canvas,
      width: o.width,
      height: o.height,
      supersample: o.supersample,
      hdr: o.hdr ?? "half",
      capture: o.capture,
      spark: { blurAmount: o.blurAmount ?? 0.3 },
    });
    stage.camera.far = FAR_PLANE;
    stage.camera.updateProjectionMatrix();
    const post = new CinematicPost(stage.renderer, { width: o.width, height: o.height, supersample: o.supersample });
    return new ProcWorld(stage, post, o.rings);
  }

  get splatCount(): number {
    return this.layers.reduce((sum, l) => sum + (l.visible ? l.numSplats : 0), 0);
  }

  /**
   * Starts every layer's shader compiling at once. Left to the first frame, the layers compile one after another, and
   * each one stops the page until the GPU has built it.
   */
  compileShaders(): void {
    const { renderer, camera, spark } = this.stage;
    const geometry = new THREE.BufferGeometry();
    const scene = new THREE.Scene();
    for (const layer of this.layers) {
      const { material } = spark.display.prepareProgramMaterial(layer.generator, layer.covGenerator);
      scene.add(new THREE.Mesh(geometry, material));
    }
    renderer.compile(scene, camera);
    geometry.dispose();
  }

  get hdrTexture(): THREE.Texture {
    return this.stage.hdrTarget.texture;
  }

  /** Applies a view to the uniforms, the layers, the camera and the lens, and marks every layer for regeneration. */
  setView(view: WorldView): void {
    const { stage } = this;
    stage.camera.position.copy(view.camera.position);
    stage.camera.quaternion.copy(view.camera.quaternion);
    stage.camera.fov = view.camera.fov;
    stage.camera.updateProjectionMatrix();
    stage.camera.updateMatrixWorld(true);
    stage.spark.focalDistance = view.dof.focalDistance;
    stage.spark.apertureAngle = view.dof.apertureAngle;
    this.uniforms.world.set({
      time: view.time,
      seed: view.seed,
      eye: view.camera.position,
      feet: view.player,
      heading: view.heading,
      atmosphere: view.atmosphere,
      realmA: view.realm.a,
      realmB: view.realm.b,
      realmBlend: view.realm.t,
      variant: view.realm.variant,
      pulse: view.pulse,
      storm: view.storm,
      lightRings: view.lightRings,
      cull: this.cullEnabled && view.dof.apertureAngle <= 0 ? viewCull(stage.camera, this.cull) : undefined,
      foldIsIdentity: isIdentitySpec(view.spec),
    });
    this.uniforms.deform.set(view.spec);
    this.ground.update(view.player, stage.renderer);
    this.flora.update(view.player, stage.renderer);
    this.wonders.update(view.player, stage.renderer);
    this.motes.update();
    this.flocks.update();
    this.beasts.update();
    this.blooms.update();
    this.clouds.update();
    this.mirror.update(view.realm);
    for (const layer of this.layers) layer.updateVersion();
    this.skyOrientation = view.skyOrientation ?? view.camera.quaternion;
    this.trackSun(view);
  }

  private readonly sunInCamera = new THREE.Vector3();
  private readonly cameraInverse = new THREE.Quaternion();

  /** Tells the post pass where the sun is on screen and how far in front of the camera it is. */
  private trackSun(view: WorldView): void {
    const v = this.sunInCamera.copy(view.atmosphere.sunDir).applyQuaternion(this.cameraInverse.copy(view.camera.quaternion).invert());
    const depth = Math.max(-v.z, 1e-3);
    const half = Math.tan(THREE.MathUtils.degToRad(view.camera.fov) / 2);
    this.post.sun.set(0.5 + (0.5 * v.x) / depth / (half * this.stage.camera.aspect), 0.5 + (0.5 * v.y) / depth / half, THREE.MathUtils.smoothstep(-v.z, 0, 0.3));
    const [r, g, b] = view.atmosphere.sunColor;
    const peak = Math.max(r, g, b, 1e-3);
    this.post.sunTint.set(r / peak, g / peak, b / peak);
  }

  private skyOrientation = new THREE.Quaternion();

  /** Draws the sky and the splats into the HDR target. In capture mode, call `settle` first. */
  drawHdr(): void {
    const { stage } = this;
    stage.renderHdr((hdr) => this.sky.render(stage.renderer, hdr, stage.camera, this.skyOrientation));
  }

  settle(): Promise<void> {
    return this.stage.settle();
  }

  resize(width: number, height: number): void {
    this.stage.resize(width, height);
    this.post.resize(width, height);
  }

  dispose(): void {
    for (const layer of this.layers) this.stage.scene.remove(layer);
    this.sky.dispose();
    this.post.dispose();
    this.stage.dispose();
  }
}
