// CPU twin of src/world/glsl/terrain.glsl and of the facet layout in ground.glsl. The walker, the
// camera and the film path ask it where the ground is.

import { createNoise, mix, smoothstep, type NoiseField } from "./noise.ts";

export const REALM_COUNT = 5;
export const REALM_NAMES = ["Paper Dunes", "Prism Forest", "Lantern Deep", "Mirror Flats", "Ember Canyons"] as const;
/** Index of the Mirror Flats in the realm cycle. */
export const REALM_FLATS = 3;
const REALM_FIELD_SCALE = 1 / 1500;
const REALM_TURNS = 2.6;
const REALM_BLEND = 0.34;

/** Height of the finest ground ring's facets, in metres, and how far their vertices are jittered. */
export const FACET_JITTER = 0.7;

export interface RealmMix {
  a: number;
  b: number;
  /** 0 shows realm a alone, 1 shows realm b alone. */
  t: number;
  /** Position along the realm cycle, before wrapping. */
  sc: number;
}

const posmod = (a: number, n: number): number => ((a % n) + n) % n;

export interface Terrain {
  readonly noise: NoiseField;
  realmAt(x: number, z: number): RealmMix;
  /** Smooth height of one realm with detail limited by `lod` metres. */
  heightRealm(id: number, x: number, z: number, lod: number): number;
  /** Blended smooth height. */
  height(x: number, z: number, lod: number): number;
  /** Height of the finest ring's facets, which is the surface the GPU draws near the player. */
  facetHeight(x: number, z: number, cell: number): number;
  /** Unit normal of the facet under (x, z). */
  facetNormal(x: number, z: number, cell: number): [number, number, number];
  emberRiver(x: number, z: number, lod: number): number;
}

export function createTerrain(seed: number): Terrain {
  const n = createNoise(seed);
  const { fbm1, ridge1, voronoi } = n;

  const realmAt = (x: number, z: number): RealmMix => {
    const f = fbm1(x * REALM_FIELD_SCALE + 17.3, z * REALM_FIELD_SCALE - 41.9, 4, 0, 9001);
    const sc = (f * 0.5 + 0.5) * REALM_COUNT * REALM_TURNS + 0.5;
    const fl = Math.floor(sc);
    const fr = sc - fl;
    return { a: posmod(fl, REALM_COUNT), b: posmod(fl + 1, REALM_COUNT), t: smoothstep(1 - REALM_BLEND, 1, fr), sc };
  };

  const heightDunes = (x: number, z: number, lod: number): number => {
    const qx = x / 600;
    const qz = z / 600;
    const warp = fbm1(qx * 1.7 + 3.1, qz * 1.7 + 3.1, 3, lod / 350, 21) * 0.22;
    const wx = qx + warp;
    const wz = qz + warp;
    const base = fbm1(wx, wz, 5, lod / 600, 22);
    const crest = ridge1(wx * 2.2 + 7, wz * 2.3 * 2.2 + 7, 4, lod / 270, 23);
    const detail = fbm1(x / 38, z / 38, 3, lod / 38, 24);
    const along = x * 0.866 + z * 0.5;
    const wob = fbm1(x / 85 + 5, z / 85 + 5, 3, lod / 85, 25);
    const ripple1 = Math.sin((along / 7.5 + wob * 3) * 6.2831853) * 0.42 * (1 - smoothstep(1.2, 3, lod));
    const ripple2 = Math.sin((along / 26 + wob * 2 + 0.3) * 6.2831853) * 1.3 * (1 - smoothstep(4, 9, lod));
    return base * 62 + crest * 34 + detail * 1.6 + ripple1 + ripple2;
  };

  const heightPrism = (x: number, z: number, lod: number): number => {
    const v = voronoi(x, z, 150, 31);
    const plate = (v[2] - 0.5) * 16;
    const crack = 1 - smoothstep(0, 0.09, v[1] - v[0]);
    const swell = fbm1(x / 700 + 5, z / 700 + 5, 4, lod / 700, 32) * 26;
    const detail = fbm1(x / 30, z / 30, 3, lod / 30, 33) * 0.9;
    return plate + swell - crack * 4 + detail;
  };

  const heightDeep = (x: number, z: number, lod: number): number => {
    const base = fbm1(x / 520 + 2, z / 520 + 2, 5, lod / 520, 41) * 36;
    const canyons = ridge1(x / 340 + 9, z / 340 + 9, 4, lod / 340, 42) * 30;
    const rip = fbm1(x / 70, z / 70, 3, lod / 70, 43);
    const ripples = Math.sin((x * 0.8 + z * 0.6) / 5.5 + rip * 5) * 0.55;
    return base - canyons + ripples;
  };

  const heightFlats = (x: number, z: number, lod: number): number => {
    const swell = fbm1(x / 1100 + 4, z / 1100 + 4, 3, lod / 1100, 51) * 6;
    const v = voronoi(x, z, 34, 52);
    const crust = (1 - smoothstep(0, 0.12, v[1] - v[0])) * 0.5 + (v[2] - 0.5) * 0.35;
    const isl = smoothstep(0.3, 0.62, fbm1(x / 780 + 9, z / 780 + 9, 4, lod / 780, 53));
    const rocks = isl * (30 + 46 * ridge1(x / 210, z / 210, 4, lod / 210, 54));
    return swell + crust + rocks;
  };

  const emberRiver = (x: number, z: number, lod: number): number => {
    const c = fbm1(x / 640 + 11, z / 640 + 11, 4, lod / 640, 63);
    return 1 - smoothstep(0, 0.09, Math.abs(c));
  };

  const heightEmber = (x: number, z: number, lod: number): number => {
    const m = fbm1(x / 800 + 6, z / 800 + 6, 5, lod / 800, 61) * 70 + ridge1(x / 420 + 3, z / 420 + 3, 4, lod / 420, 62) * 40;
    const t = m / 20;
    const ft = Math.floor(t);
    const terr = (ft + smoothstep(0.3, 1.0, t - ft)) * 20;
    const c = fbm1(x / 640 + 11, z / 640 + 11, 4, lod / 640, 63);
    const canyon = 1 - smoothstep(0, 0.42, Math.abs(c));
    return mix(terr, -44, canyon * canyon * (3 - 2 * canyon));
  };

  const heightRealm = (id: number, x: number, z: number, lod: number): number => {
    switch (id) {
      case 0:
        return heightDunes(x, z, lod);
      case 1:
        return heightPrism(x, z, lod);
      case 2:
        return heightDeep(x, z, lod);
      case 3:
        return heightFlats(x, z, lod);
      default:
        return heightEmber(x, z, lod);
    }
  };

  const height = (x: number, z: number, lod: number): number => {
    const r = realmAt(x, z);
    const a = heightRealm(r.a, x, z, lod);
    if (r.t <= 0.001) return a;
    return mix(a, heightRealm(r.b, x, z, lod), r.t);
  };

  const facetVertex = (cx: number, cz: number, cell: number): [number, number] => {
    const j = n.hash4(cx, cz, 301);
    return [(cx + (j[0] - 0.5) * FACET_JITTER) * cell, (cz + (j[1] - 0.5) * FACET_JITTER) * cell];
  };

  interface Facet {
    ax: number;
    az: number;
    ay: number;
    bx: number;
    bz: number;
    by: number;
    cx: number;
    cz: number;
    cy: number;
  }

  const insideTriangle = (px: number, pz: number, f: Facet): [number, number, number] | undefined => {
    const d = (f.bz - f.cz) * (f.ax - f.cx) + (f.cx - f.bx) * (f.az - f.cz);
    const wa = ((f.bz - f.cz) * (px - f.cx) + (f.cx - f.bx) * (pz - f.cz)) / d;
    const wb = ((f.cz - f.az) * (px - f.cx) + (f.ax - f.cx) * (pz - f.cz)) / d;
    const wc = 1 - wa - wb;
    const e = -1e-9;
    return wa >= e && wb >= e && wc >= e ? [wa, wb, wc] : undefined;
  };

  /** The facet of the ring with the given cell size that lies under (x, z), as the GPU lays it out. */
  const facetAt = (x: number, z: number, cell: number): { facet: Facet; w: [number, number, number] } => {
    const fx = Math.floor(x / cell);
    const fz = Math.floor(z / cell);
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const wx = fx + dx;
        const wz = fz + dz;
        const flip = n.hash4(wx, wz, 300)[0] > 0.5;
        const corners: [number, number][] = [
          [wx, wz],
          [wx + 1, wz],
          [wx, wz + 1],
          [wx + 1, wz + 1],
        ];
        const tris: number[][] = flip
          ? [
              [0, 1, 3],
              [0, 3, 2],
            ]
          : [
              [0, 1, 2],
              [1, 3, 2],
            ];
        for (const tri of tris) {
          const [pa, pb, pc] = tri.map((i) => facetVertex(corners[i]![0], corners[i]![1], cell)) as [[number, number], [number, number], [number, number]];
          const facet: Facet = {
            ax: pa[0],
            az: pa[1],
            ay: height(pa[0], pa[1], cell),
            bx: pb[0],
            bz: pb[1],
            by: height(pb[0], pb[1], cell),
            cx: pc[0],
            cz: pc[1],
            cy: height(pc[0], pc[1], cell),
          };
          const w = insideTriangle(x, z, facet);
          if (w) return { facet, w };
        }
      }
    }
    // Rounding at a shared edge can miss every test. Fall back to the smooth surface.
    const y = height(x, z, cell);
    return { facet: { ax: x, az: z, ay: y, bx: x, bz: z, by: y, cx: x, cz: z, cy: y }, w: [1, 0, 0] };
  };

  const facetHeight = (x: number, z: number, cell: number): number => {
    const { facet, w } = facetAt(x, z, cell);
    return facet.ay * w[0] + facet.by * w[1] + facet.cy * w[2];
  };

  const facetNormal = (x: number, z: number, cell: number): [number, number, number] => {
    const { facet: f } = facetAt(x, z, cell);
    const abx = f.bx - f.ax;
    const aby = f.by - f.ay;
    const abz = f.bz - f.az;
    const acx = f.cx - f.ax;
    const acy = f.cy - f.ay;
    const acz = f.cz - f.az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  };

  return { noise: n, realmAt, heightRealm, height, facetHeight, facetNormal, emberRiver };
}
