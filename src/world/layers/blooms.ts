import * as THREE from "three";
import bloomsGlsl from "../glsl/blooms.glsl?raw";
import terrainGlsl from "../glsl/terrain.glsl?raw";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

/** Footsteps remembered at once. The oldest is overwritten first. */
const SLOTS = 128;
/** Seconds a flower lasts. */
const LIFE = 30;
/** Eighteen petal triangles and six in the core, up to four splats each. */
const SLOTS_PER_BLOOM = 24 * 4;
const NEVER = -1e6;

/** Flowers that open where the walker stepped, so the path behind them stays lit for a while. */
export class Blooms {
  readonly layer: ProcLayer;
  private readonly data = new Float32Array(SLOTS * 2 * 4);
  private readonly texture: THREE.DataTexture;
  private next = 0;
  private dirty = true;

  constructor(shared: SharedUniforms) {
    this.clear();
    this.texture = new THREE.DataTexture(this.data, SLOTS, 2, THREE.RGBAFormat, THREE.FloatType);
    this.texture.internalFormat = "RGBA32F";
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.layer = new ProcLayer({ name: "blooms", count: SLOTS * SLOTS_PER_BLOOM, libs: [terrainGlsl], glsl: bloomsGlsl }, shared, this.texture);
  }

  /** Opens a flower at a spot on the ground. `scale` is 1 for a step and larger for a landing. */
  plant(x: number, y: number, z: number, time: number, realm: number, scale = 1): void {
    const o = this.next * 4;
    const row = SLOTS * 4;
    this.data.set([x, y, z, time], o);
    this.data.set([realm * 2 + Math.random() * 0.999, scale, 0, 0], row + o);
    this.next = (this.next + 1) % SLOTS;
    this.dirty = true;
  }

  clear(): void {
    for (let i = 0; i < SLOTS; i++) this.data[i * 4 + 3] = NEVER;
    this.dirty = true;
  }

  update(): void {
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
    this.layer.params.p0.set(SLOTS, SLOTS_PER_BLOOM, LIFE, 1.6);
    this.layer.updateVersion();
  }
}
