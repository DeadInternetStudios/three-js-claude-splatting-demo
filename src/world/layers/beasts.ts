import beastsGlsl from "../glsl/beasts.glsl?raw";
import terrainGlsl from "../glsl/terrain.glsl?raw";
import { DEFAULT_BEASTS, type BeastSpec } from "../cpu/beasts.ts";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

/** Splats per creature: the largest has 120 triangles of up to four splats each, and a whale adds one for its shadow. */
const SLOTS = 120 * 4 + 1;

/** Paper whales in the sky of the dry realms, manta rays and jellyfish in the Deep. */
export class Beasts {
  readonly layer: ProcLayer;

  constructor(shared: SharedUniforms, private readonly spec: BeastSpec = DEFAULT_BEASTS) {
    this.layer = new ProcLayer({ name: "beasts", count: (spec.whales + spec.deep) * SLOTS, libs: [terrainGlsl], glsl: beastsGlsl }, shared);
  }

  update(): void {
    const { spec, layer } = this;
    layer.params.p0.set(spec.whales, spec.deep, SLOTS, 0);
    layer.params.p1.set(spec.whaleBox, spec.deepBox, 1.6, 0);
    layer.updateVersion();
  }
}
