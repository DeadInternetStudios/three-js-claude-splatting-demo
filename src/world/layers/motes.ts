import * as THREE from "three";
import motesGlsl from "../glsl/motes.glsl?raw";
import terrainGlsl from "../glsl/terrain.glsl?raw";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

/** A cloud of small drifting lights and specks that surrounds the player. */
export class MoteCloud {
  readonly layer: ProcLayer;
  readonly count: number;

  constructor(shared: SharedUniforms, count = 200_000, readonly box = new THREE.Vector3(110, 60, 110)) {
    this.count = count;
    this.layer = new ProcLayer({ name: "motes", count, libs: [terrainGlsl], glsl: motesGlsl }, shared);
  }

  update(): void {
    this.layer.params.p0.set(this.box.x, this.box.y, this.box.z, 0);
    this.layer.updateVersion();
  }
}
