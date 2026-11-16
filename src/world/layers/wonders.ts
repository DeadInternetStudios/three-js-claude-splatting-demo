import * as THREE from "three";
import kitGlsl from "../glsl/kit.glsl?raw";
import mirrorGlsl from "../glsl/mirror.glsl?raw";
import terrainGlsl from "../glsl/terrain.glsl?raw";
import wondersGlsl from "../glsl/wonders.glsl?raw";
import { CellField } from "../field.ts";
import { ProcLayer, type SharedUniforms } from "../layer.ts";
import { WONDER_CELL, WONDER_CELLS, WONDER_DENSITY, wonderGlslTables } from "../wonders.ts";

/** Gates use the most triangles of the kinds that show a 3 x 3 patch per triangle up close: 312 of them. Ribs and isles use up to 588 with 2 x 2. A crane has 28 triangles of up to 10 x 10 splats each, which takes 2,800 of the slots, and a boat has 22 of them, which take 2,200. */
const SLOTS = 312 * 9;

/** Giant arches, rings, rib cages, stone circles, spires, floating isles and paper cranes and boats, one to a coarse cell. */
export class Wonders {
  readonly layer: ProcLayer;
  private readonly field: CellField;

  constructor(shared: SharedUniforms) {
    this.field = new CellField(WONDER_CELLS, "flora", shared.world);
    this.layer = new ProcLayer(
      {
        name: "wonders",
        count: WONDER_CELLS * WONDER_CELLS * SLOTS,
        libs: [terrainGlsl, wonderGlslTables(), kitGlsl, mirrorGlsl],
        glsl: wondersGlsl,
      },
      shared,
      this.field.target.texture,
    );
  }

  update(player: THREE.Vector3, renderer: THREE.WebGLRenderer): void {
    const cx = Math.floor(player.x / WONDER_CELL) - WONDER_CELLS / 2;
    const cz = Math.floor(player.z / WONDER_CELL) - WONDER_CELLS / 2;
    const outer = (WONDER_CELLS * WONDER_CELL) / 2 - 1.5 * WONDER_CELL;
    const { params } = this.layer;
    params.p0.set(WONDER_CELL, WONDER_CELLS, cx, cz);
    params.p1.set(outer, outer * 0.22, SLOTS, 0);
    params.p2.set(player.x, player.z, 1.5, 0);
    params.p3.set(WONDER_DENSITY, 0, 0, 0);
    this.field.render(renderer, WONDER_CELL, cx, cz, 4);
    this.layer.updateVersion();
  }
}
