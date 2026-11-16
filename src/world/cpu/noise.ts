// CPU twin of the hash and noise in src/world/glsl/common.glsl. It does the same integer
// arithmetic, so a lattice value is bit-identical to the GPU's and the smooth functions built on
// it agree to float precision.

export function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

export function hash3(x: number, y: number, z: number): number {
  return pcg((x >>> 0) ^ pcg((y >>> 0) ^ pcg((z + 2246822507) >>> 0)));
}

/** Uniform number in [0, 1) from the top 24 bits of a hash. Exactly representable in f32. */
export function u24(h: number): number {
  return (h >>> 8) / 16777216;
}

export type Vec4 = [number, number, number, number];

export interface NoiseField {
  readonly seed: number;
  hashCell(cx: number, cy: number, salt: number): number;
  hash4(cx: number, cy: number, salt: number): Vec4;
  vnoise(x: number, y: number, salt: number): number;
  fbm1(x: number, y: number, oct: number, lodUnits: number, salt: number): number;
  ridge1(x: number, y: number, oct: number, lodUnits: number, salt: number): number;
  voronoi(x: number, y: number, scale: number, salt: number): Vec4;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Noise functions bound to a world seed. */
export function createNoise(seed: number): NoiseField {
  const s = seed >>> 0;
  const hashCell = (cx: number, cy: number, salt: number): number => hash3(cx | 0, cy | 0, (s ^ salt) >>> 0);
  const hash4 = (cx: number, cy: number, salt: number): Vec4 => {
    const h = hashCell(cx, cy, salt);
    return [u24(h), u24(pcg((h + 1) >>> 0)), u24(pcg((h + 2) >>> 0)), u24(pcg((h + 3) >>> 0))];
  };
  const lattice = (cx: number, cy: number, salt: number): number => u24(hashCell(cx, cy, salt)) * 2 - 1;

  const vnoise = (x: number, y: number, salt: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = lattice(ix, iy, salt);
    const b = lattice(ix + 1, iy, salt);
    const c = lattice(ix, iy + 1, salt);
    const d = lattice(ix + 1, iy + 1, salt);
    return mix(mix(a, b, ux), mix(c, d, ux), uy);
  };

  const rotate = (x: number, y: number): [number, number] => [(0.8 * x + 0.6 * y) * 2, (-0.6 * x + 0.8 * y) * 2];

  const fbm1 = (px: number, py: number, oct: number, lodUnits: number, salt: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let x = px;
    let y = py;
    const norm = 2 * (1 - Math.pow(2, -oct));
    for (let i = 0; i < 8; i++) {
      if (i >= oct) break;
      if (freq * lodUnits > 0.7) break;
      sum += amp * vnoise(x, y, (salt + i * 977) >>> 0);
      amp *= 0.5;
      freq *= 2;
      [x, y] = rotate(x, y);
    }
    return sum / norm;
  };

  const ridge1 = (px: number, py: number, oct: number, lodUnits: number, salt: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let weight = 1;
    let x = px;
    let y = py;
    const norm = 2 * (1 - Math.pow(2, -oct));
    for (let i = 0; i < 8; i++) {
      if (i >= oct) break;
      if (freq * lodUnits > 0.7) break;
      const r = 1 - Math.abs(vnoise(x, y, (salt + i * 977) >>> 0));
      sum += amp * weight * r;
      weight = Math.min(1, Math.max(0, r * 1.6));
      amp *= 0.5;
      freq *= 2;
      [x, y] = rotate(x, y);
    }
    return sum / norm;
  };

  const voronoi = (px: number, py: number, scale: number, salt: number): Vec4 => {
    const qx = px / scale;
    const qy = py / scale;
    const ix = Math.floor(qx);
    const iy = Math.floor(qy);
    const fx = qx - ix;
    const fy = qy - iy;
    let d1 = 9;
    let d2 = 9;
    let bx = 0;
    let by = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const o = hash4(cx, cy, salt);
        const rx = i + o[0] - fx;
        const ry = j + o[1] - fy;
        const d = rx * rx + ry * ry;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          bx = cx;
          by = cy;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    const hb = hash4(bx, by, (salt + 13) >>> 0);
    return [Math.sqrt(d1), Math.sqrt(d2), hb[0], hb[1]];
  };

  return { seed: s, hashCell, hash4, vnoise, fbm1, ridge1, voronoi };
}

/** Four uniform numbers for an integer key, matching hash4i in common.glsl. */
export function hash4i(seed: number, n: number, salt: number): Vec4 {
  const h = pcg(((n >>> 0) ^ pcg(((seed >>> 0) ^ salt) >>> 0)) >>> 0);
  return [u24(h), u24(pcg((h + 1) >>> 0)), u24(pcg((h + 2) >>> 0)), u24(pcg((h + 3) >>> 0))];
}
