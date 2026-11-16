import cloudsGlsl from "../glsl/clouds.glsl?raw";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

/** Drifting cloud sheets high over the player. One splat per sheet, so the layer is small. */
export class CloudLayer {
  readonly layer: ProcLayer;

  constructor(shared: SharedUniforms, count = 4096) {
    this.layer = new ProcLayer({ name: "clouds", count, glsl: cloudsGlsl }, shared);
  }

  update(): void {
    this.layer.updateVersion();
  }
}
