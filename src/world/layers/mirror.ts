import * as THREE from "three";
import { REALM_FLATS } from "../cpu/terrain.ts";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

/**
 * Upside-down copies of the tall layers, for the water of the Mirror Flats. Each copy runs its
 * source's generator over the same window and field, flipped about the water level. A copy is
 * the same shader program as its source with `p4.y` set to 1, so it costs no compile. They are
 * generated only where the visitor can see water, so every other realm pays nothing for them.
 */
export class WaterMirror {
  readonly layers: ProcLayer[];

  constructor(
    shared: SharedUniforms,
    private readonly sources: ProcLayer[],
  ) {
    this.layers = sources.map((source) => new ProcLayer({ ...source.source, name: `mirror-${source.name}` }, shared, source.field));
  }

  /** Follows the sources' windows. Call after they have moved. `realm` is the realm mix at the visitor. */
  update(realm: { a: number; b: number; t: number }): void {
    const water = (realm.a === REALM_FLATS ? 1 - realm.t : 0) + (realm.b === REALM_FLATS ? realm.t : 0);
    this.layers.forEach((layer, i) => {
      const { params } = this.sources[i]!;
      layer.params.p0.copy(params.p0);
      layer.params.p1.copy(params.p1);
      layer.params.p2.copy(params.p2);
      layer.params.p3.copy(params.p3);
      layer.params.p4.set(THREE.MathUtils.smoothstep(water, 0, 0.3), 1, 0, 0);
      layer.visible = water > 0.001;
    });
  }
}
