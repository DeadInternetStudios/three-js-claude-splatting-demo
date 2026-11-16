import fliersGlsl from "../glsl/fliers.glsl?raw";
import terrainGlsl from "../glsl/terrain.glsl?raw";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

export interface FlockSpec {
  flocks: number;
  maxMembers: number;
  /** Wrap box in metres. A flock that leaves one side comes back in on the other. */
  box: number;
}

/** Flocks of paper cranes, or fish under water, that cross the player's sky. */
export class Flocks {
  readonly layer: ProcLayer;
  /** Splat slots per bird: 15 triangles, up to 4 splats each, and one for the shadow. */
  static readonly SLOTS = 15 * 4 + 1;

  constructor(shared: SharedUniforms, private readonly spec: FlockSpec = { flocks: 18, maxMembers: 40, box: 1800 }) {
    this.layer = new ProcLayer(
      { name: "flocks", count: spec.flocks * spec.maxMembers * Flocks.SLOTS, libs: [terrainGlsl], glsl: fliersGlsl },
      shared,
    );
  }

  update(): void {
    const { spec } = this;
    this.layer.params.p0.set(spec.flocks, spec.maxMembers, Flocks.SLOTS, spec.box);
    this.layer.params.p2.set(0, 0, 2.0, 0);
    this.layer.updateVersion();
  }
}
