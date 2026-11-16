import * as THREE from "three";
import skyCommonGlsl from "../glsl/sky_common.glsl?raw";
import surfaceGlsl from "../glsl/surface.glsl?raw";
import terrainGlsl from "../glsl/terrain.glsl?raw";
import groundGlsl from "../glsl/ground.glsl?raw";
import { CellField } from "../field.ts";
import { ProcLayer, type SharedUniforms } from "../layer.ts";

export interface RingSpec {
  /** Facet cell size in metres. */
  cell: number;
  /** Cells per side of the ring window. */
  cells: number;
  /** Each triangle is covered by sub * sub flat splats. */
  sub: number;
  /** Layer name. Rings without one are called `ground` and their number among the unnamed rings. */
  name?: string;
  /** Cells the window moves by. A small window needs a small step to stay centred on the player. Defaults to 8. */
  snap?: number;
  /** Splat thickness as a fraction of the cell size. Defaults to 0.03. */
  thickness?: number;
}

/**
 * Facet size grows by 3 per ring, so facets keep a similar size on screen at every distance. Two
 * near rings cut the same facets into finer splats around the walker, where the eye is closest to
 * the ground and a splat of the first full ring would show as a soft blot.
 */
export function defaultRings(base = 0.9): RingSpec[] {
  return [
    { cell: base, cells: 24, sub: 9, snap: 2, thickness: 0.01, name: "groundNear0" },
    { cell: base, cells: 44, sub: 5, snap: 4, thickness: 0.018, name: "groundNear1" },
    { cell: base, cells: 96, sub: 3 },
    { cell: base * 3, cells: 96, sub: 4 },
    { cell: base * 9, cells: 96, sub: 3 },
    { cell: base * 27, cells: 96, sub: 3 },
    { cell: base * 81, cells: 96, sub: 3 },
    { cell: base * 243, cells: 96, sub: 2 },
    { cell: base * 729, cells: 96, sub: 2 },
  ];
}

/** The ground comes in this many levels of detail, 0 being the full one. */
export const GROUND_DETAIL_LEVELS = 4;

const DETAIL_SHARE = [1, 0.75, 0.55, 0.4] as const;

/**
 * Splats per side of a facet's triangle at a level of detail. A frame costs about what the splats it
 * draws cost, and idle slots cost next to nothing, so a coarser level saves time by drawing fewer splats.
 */
export function ringSubdivision(sub: number, level: number): number {
  return Math.max(1, Math.round(sub * DETAIL_SHARE[level]!));
}

/** How many cells a ring's window moves by when it follows the player, unless the ring says otherwise. */
const SNAP = 8;

export class GroundRings {
  readonly layers: ProcLayer[] = [];
  private readonly fields: CellField[] = [];
  private readonly specs: RingSpec[];
  private detail = 0;

  constructor(shared: SharedUniforms, specs: RingSpec[] = defaultRings()) {
    this.specs = specs;
    let plain = 0;
    for (const spec of specs) {
      const field = new CellField(spec.cells + 1, "ground", shared.world);
      this.fields.push(field);
      this.layers.push(
        new ProcLayer(
          {
            name: spec.name ?? `ground${plain++}`,
            count: spec.cells * spec.cells * 2 * spec.sub * spec.sub,
            libs: [terrainGlsl, skyCommonGlsl, surfaceGlsl],
            glsl: groundGlsl,
          },
          shared,
          field.target.texture,
        ),
      );
    }
  }

  get splatCount(): number {
    return this.layers.reduce((sum, l) => sum + l.numSplats, 0);
  }

  /** Picks the level of detail, from 0 (all splats) to `GROUND_DETAIL_LEVELS - 1`. */
  setDetail(level: number): void {
    this.detail = Math.min(GROUND_DETAIL_LEVELS - 1, Math.max(0, Math.round(level)));
  }

  /** Radius, in metres, up to which ring i shows its facets, measured as the larger of |dx| and |dz|. */
  private outerRadius(i: number): number {
    const s = this.specs[i]!;
    return (s.cells * s.cell) / 2 - ((s.snap ?? SNAP) / 2 + 2) * s.cell;
  }

  /** Moves each ring's window to the player and fills the vertex fields where the window moved. Call after the world uniforms are set. */
  update(player: THREE.Vector3, renderer: THREE.WebGLRenderer): void {
    this.specs.forEach((s, i) => {
      const layer = this.layers[i]!;
      const px = Math.floor(player.x / s.cell);
      const pz = Math.floor(player.z / s.cell);
      const snap = s.snap ?? SNAP;
      const cx = Math.round((px - s.cells / 2) / snap) * snap;
      const cz = Math.round((pz - s.cells / 2) / snap) * snap;
      const next = this.specs[i + 1];
      const inner = i === 0 ? 0 : this.outerRadius(i - 1);
      layer.params.p0.set(s.cell, s.cells, cx, cz);
      layer.params.p1.set(inner, this.outerRadius(i), next ? 2 * next.cell : 0.001, ringSubdivision(s.sub, this.detail));
      layer.params.p2.set(player.x, player.z, s.thickness ?? 0.03, 2.2);
      layer.params.p3.set(2 * s.cell, 0, 0, 0);
      this.fields[i]!.render(renderer, s.cell, cx, cz);
      layer.updateVersion();
    });
  }
}
