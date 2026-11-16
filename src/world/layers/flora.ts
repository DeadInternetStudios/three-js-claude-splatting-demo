import * as THREE from "three";
import floraGlsl from "../glsl/flora.glsl?raw";
import kitGlsl from "../glsl/kit.glsl?raw";
import mirrorGlsl from "../glsl/mirror.glsl?raw";
import terrainGlsl from "../glsl/terrain.glsl?raw";
import { CellField } from "../field.ts";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

export interface FloraClass {
  /** Cell size in metres. At most one object per cell. */
  cell: number;
  /** Cells per side of the window. */
  cells: number;
  /** Splat slots per object, including one for its contact shadow. */
  slots: number;
}

/**
 * Four size classes. Each reaches about as far as its objects stay visible, so a distant giant
 * and a close tuft take up a similar share of the screen where they fade out.
 */
export function defaultFloraClasses(): FloraClass[] {
  return [
    { cell: 5, cells: 44, slots: 4 * 21 + 1 },
    { cell: 20, cells: 36, slots: 4 * 78 + 1 },
    { cell: 70, cells: 32, slots: 4 * 72 + 1 },
    { cell: 260, cells: 24, slots: 4 * 45 + 1 },
  ];
}

const SNAP = 4;

export class FloraLayers {
  readonly layers: ProcLayer[] = [];
  private readonly fields: CellField[] = [];
  private readonly classes: FloraClass[];

  constructor(shared: SharedUniforms, classes: FloraClass[] = defaultFloraClasses()) {
    this.classes = classes;
    for (const [i, c] of classes.entries()) {
      const field = new CellField(c.cells, "flora", shared.world);
      this.fields.push(field);
      this.layers.push(
        new ProcLayer(
          { name: `flora${i}`, count: c.cells * c.cells * c.slots, libs: [terrainGlsl, kitGlsl, mirrorGlsl], glsl: floraGlsl },
          shared,
          field.target.texture,
        ),
      );
    }
  }

  get splatCount(): number {
    return this.layers.reduce((sum, l) => sum + l.numSplats, 0);
  }

  update(player: THREE.Vector3, renderer: THREE.WebGLRenderer): void {
    this.classes.forEach((c, i) => {
      const layer = this.layers[i]!;
      const px = Math.floor(player.x / c.cell);
      const pz = Math.floor(player.z / c.cell);
      const cx = Math.round((px - c.cells / 2) / SNAP) * SNAP;
      const cz = Math.round((pz - c.cells / 2) / SNAP) * SNAP;
      const outer = (c.cells * c.cell) / 2 - (SNAP / 2 + 2) * c.cell;
      layer.params.p0.set(c.cell, c.cells, cx, cz);
      layer.params.p1.set(outer, outer * 0.18, c.slots, i);
      layer.params.p2.set(player.x, player.z, 2.0, 0);
      layer.params.p3.set(1, 1, 0, 0);
      this.fields[i]!.render(renderer, c.cell, cx, cz, i);
      layer.updateVersion();
    });
  }
}
