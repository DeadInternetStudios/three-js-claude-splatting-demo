// CPU twin of the flock paths in src/world/glsl/fliers.glsl, for cameras that follow a flock.

import { hash4i } from "./noise.ts";
import type { Terrain } from "./terrain.ts";

export interface FlockPoint {
  x: number;
  y: number;
  z: number;
  /** Unit heading in the ground plane. */
  dx: number;
  dz: number;
  /** Size of one bird in metres. */
  size: number;
  /** Members in the flock. */
  members: number;
}

/** Where flock `flock` is at time `t`, for a player standing at (px, pz). */
export function flockPoint(terrain: Terrain, seed: number, flock: number, t: number, px: number, pz: number, box: number, maxMembers: number): FlockPoint {
  const f = hash4i(seed, flock, 600);
  const f2 = hash4i(seed, flock, 601);
  const ang = f[0] * 6.2831853;
  const dirx = Math.cos(ang);
  const dirz = Math.sin(ang);
  const perpx = -dirz;
  const perpz = dirx;
  const speed = 9 + 13 * f[1];
  const amp = 40 + 120 * f2[1];
  const wv = 0.03 + 0.05 * f2[2];
  const phase = f2[2] * 20;
  const bx = (f[2] - 0.5) * box;
  const bz = (f[3] - 0.5) * box;
  const s = Math.sin(wv * t + phase);
  const c = Math.cos(wv * t + phase);
  const cx = bx + dirx * speed * t + perpx * amp * s;
  const cz = bz + dirz * speed * t + perpz * amp * s;
  const vx = dirx * speed + perpx * amp * wv * c;
  const vz = dirz * speed + perpz * amp * wv * c;
  let rx = cx - px;
  let rz = cz - pz;
  rx -= box * Math.floor(rx / box + 0.5);
  rz -= box * Math.floor(rz / box + 0.5);
  const x = px + rx;
  const z = pz + rz;
  const ground = terrain.height(x, z, 120);
  const alt = 28 + 110 * f[2] + 14 * Math.sin(t * 0.07 + phase);
  const len = Math.hypot(vx, vz) || 1;
  return { x, y: ground + alt, z, dx: vx / len, dz: vz / len, size: 3.5 + 4 * f[3], members: 7 + Math.floor(f2[0] * (maxMembers - 7)) };
}
