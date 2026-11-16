import * as THREE from "three";
import { FullscreenPass } from "../core/render/fullscreen.ts";
import terrainGlsl from "./glsl/terrain.glsl?raw";
import { COMMON_GLSL, WORLD_GLSL, type WorldUniform, type WorldValue } from "./uniforms.ts";

const HEAD = /* glsl */ `
precision highp float;
precision highp int;
${WORLD_GLSL}
${COMMON_GLSL}
${terrainGlsl}
uniform WorldParams world;
uniform vec4 uRing;
uniform vec4 uExtra;
out vec4 fragColor;
`;

const MAIN = /* glsl */ `
void main() {
  gW = world;
  gSeed = worldSeed(world);
  gTime = world.time.x;
  float cell = uRing.x;
  int size = int(uRing.y + 0.5);
  ivec2 corner = ivec2(uRing.zw);
  ivec2 t = ivec2(gl_FragCoord.xy);
  ivec2 lattice = corner + ivec2(posmod(t.x - corner.x, size), posmod(t.y - corner.y, size));
  fragColor = cellValue(lattice, cell, uExtra);
}`;

/** One value per ground vertex: height, then the shadow the smooth ground casts on it. */
const GROUND_CELL = /* glsl */ `
vec4 cellValue(ivec2 c, float h, vec4 extra) {
  vec2 p = facetVertex(c, h);
  RealmMix r = realmAt(p);
  float height = terrain(p, h, r);
  return vec4(height, groundShadow(vec3(p.x, height + 0.15, p.y), r, h), 0.0, 0.0);
}`;

/** One value per flora cell: ground height, shadow, and the realm mix the cell lies in. */
const FLORA_CELL = /* glsl */ `
vec4 cellValue(ivec2 w, float cell, vec4 extra) {
  int cls = int(extra.x + 0.5);
  vec4 hh = hash4(w, 400u + uint(cls) * 17u);
  vec2 xz = (vec2(w) + 0.12 + hh.xy * 0.76) * cell;
  RealmMix r = realmAt(xz);
  float ground = terrain(xz, cell * 0.25, r);
  return vec4(ground, groundShadow(vec3(xz.x, ground + 0.3, xz.y), r, cell * 0.25), r.t, float(r.a * 8 + r.b));
}`;

export type FieldKind = "ground" | "flora";

/**
 * A float texture a small pass fills with what splat shaders would otherwise recompute for every
 * splat: a facet vertex is shared by dozens of splats, a flora cell by every splat of its object.
 * Texel (x, y) holds the lattice point whose coordinates are congruent to (x, y) modulo the size,
 * so a window that slides over the world keeps its texels.
 *
 * The terrain does not change, so the texels depend only on the window, the seed and the sun that
 * the ground shadow looks toward. `render` refills them only when one of those moved.
 */
export class CellField {
  readonly target: THREE.WebGLRenderTarget;
  private readonly pass: FullscreenPass;
  private readonly ring = { value: new THREE.Vector4() };
  private readonly extra = { value: new THREE.Vector4() };
  private readonly world: WorldValue;
  private readonly inputs = new Float64Array(9);
  private readonly filledFrom = new Float64Array(9);
  private filled = false;

  constructor(readonly size: number, kind: FieldKind, world: WorldUniform) {
    this.world = world.value;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.pass = new FullscreenPass(HEAD + (kind === "ground" ? GROUND_CELL : FLORA_CELL) + MAIN, {
      world: { value: world.value },
      uRing: this.ring,
      uExtra: this.extra,
    });
  }

  /** Fills the texture for the window whose lowest lattice point is (cornerX, cornerZ), unless it already holds that window. */
  render(renderer: THREE.WebGLRenderer, cell: number, cornerX: number, cornerZ: number, extra = 0): void {
    const { inputs, filledFrom } = this;
    const { time, sun } = this.world;
    inputs[0] = cell;
    inputs[1] = cornerX;
    inputs[2] = cornerZ;
    inputs[3] = extra;
    inputs[4] = time.y;
    inputs[5] = time.z;
    inputs[6] = sun.x;
    inputs[7] = sun.y;
    inputs[8] = sun.z;
    if (this.filled && inputs.every((v, i) => v === filledFrom[i])) return;
    this.ring.value.set(cell, this.size, cornerX, cornerZ);
    this.extra.value.set(extra, 0, 0, 0);
    this.pass.render(renderer, this.target);
    filledFrom.set(inputs);
    this.filled = true;
  }

  /** Forgets what the texture holds, so the next `render` fills it again. */
  invalidate(): void {
    this.filled = false;
  }

  dispose(): void {
    this.target.dispose();
    this.pass.dispose();
  }
}
