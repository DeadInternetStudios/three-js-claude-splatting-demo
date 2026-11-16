// CPU twin of the creature paths in src/world/glsl/beasts.glsl, for cameras that follow one.

import { hash4i } from "./noise.ts";
import type { Terrain } from "./terrain.ts";

export const BEAST_KINDS = ["whale", "manta", "jelly"] as const;
export type BeastKind = (typeof BEAST_KINDS)[number];

export interface BeastSpec {
  whales: number;
  deep: number;
  whaleBox: number;
  deepBox: number;
}

export const DEFAULT_BEASTS: BeastSpec = { whales: 6, deep: 10, whaleBox: 5200, deepBox: 1000 };

export interface BeastPoint {
  kind: BeastKind;
  x: number;
  y: number;
  z: number;
  /** Unit heading in the ground plane. */
  dx: number;
  dz: number;
  /** Body length of a whale, wing span of a manta, bell radius of a jellyfish, in metres. */
  size: number;
}

export function beastKind(slot: number, spec: BeastSpec = DEFAULT_BEASTS): BeastKind {
  return slot < spec.whales ? "whale" : (slot - spec.whales) % 2 === 0 ? "manta" : "jelly";
}

/** Where creature `slot` is at time `t`, for a player standing at (px, pz). Slots below `spec.whales` are whales. */
export function beastPoint(terrain: Terrain, seed: number, slot: number, t: number, px: number, pz: number, spec: BeastSpec = DEFAULT_BEASTS): BeastPoint {
  const f = hash4i(seed, slot, 700);
  const f2 = hash4i(seed, slot, 701);
  const kind = beastKind(slot, spec);
  const whale = kind === "whale";
  const manta = kind === "manta";
  const box = whale ? spec.whaleBox : spec.deepBox;
  const ang = f[0] * 6.2831853;
  const dirx = Math.cos(ang);
  const dirz = Math.sin(ang);
  const perpx = -dirz;
  const perpz = dirx;
  const speed = whale ? 6 + 5 * f[1] : manta ? 3 + 4 * f[1] : 0.8 + 1.4 * f[1];
  const amp = whale ? 160 + 300 * f2[1] : manta ? 40 + 90 * f2[1] : 8 + 20 * f2[1];
  const wv = whale ? 0.006 + 0.008 * f2[2] : manta ? 0.02 + 0.03 * f2[2] : 0.03 + 0.04 * f2[2];
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
  const alt = whale
    ? 70 + 170 * f[2] + 14 * Math.sin(t * 0.05 + phase)
    : manta
      ? 12 + 45 * f2[1] + 4 * Math.sin(t * 0.2 + phase)
      : 20 + 80 * f2[1] + 6 * Math.sin(t * 0.3 + phase);
  const size = whale ? 45 + 55 * f[3] : manta ? 9 + 9 * f[3] : 6 + 10 * f[3];
  const len = Math.hypot(vx, vz) || 1;
  return { kind, x, y: ground + alt, z, dx: vx / len, dz: vz / len, size };
}
