// Wonders are giant structures that stand one to a coarse cell: arches, rings, rib cages, stone
// circles, spires, floating isles and the odd paper crane or boat. The GPU draws them in glsl/wonders.glsl. This
// file holds the tables both sides read and a CPU twin of the cell logic, so the interface can
// name the one in front of you and the film can fly through it.

import type { Terrain } from "./cpu/terrain.ts";

export const WONDER_KINDS = ["arch", "gate", "ribs", "spires", "henge", "isles", "crane", "boat"] as const;
export type WonderKind = (typeof WONDER_KINDS)[number];

/** Edge of a wonder cell in metres. */
export const WONDER_CELL = 900;
/** Cells per side of the window around the player. */
export const WONDER_CELLS = 8;
/** Share of cells that hold a wonder. */
export const WONDER_DENSITY = 0.5;
/** The flora hash salts are 400 + 17 * class; wonders are class 4. */
const CLASS_SALT = 17 * 4;

/** Where the cell's random number switches from the first kind to the second and from the second to the third. */
export const PICK_AT = [0.4, 0.8] as const;

/** Three kinds per realm, in realm order. A cell picks one of the three. */
const KINDS_BY_REALM: readonly (readonly WonderKind[])[] = [
  ["arch", "spires", "isles"],
  ["spires", "gate", "isles"],
  ["ribs", "arch", "isles"],
  ["henge", "gate", "isles"],
  ["spires", "arch", "isles"],
];

/** Share of cells per realm where a paper crane takes the place of whatever the cell would have held. */
const CRANE_RATE = [0.14, 0.08, 0.1, 0.14, 0.08] as const;
/** Hash salt of the roll that picks the cranes, on top of the wonder class salt. */
const CRANE_SALT = 511;

/** Share of the cells that are not cranes where a paper boat takes the place of whatever the cell would have held. Only the Dunes, the Deep and the Flats have them. */
const BOAT_RATE = [0.12, 0, 0.08, 0.14, 0] as const;
/** Hash salt of the roll that picks the boats. */
const BOAT_SALT = 616;

/** Size range in metres. For a gate it is the diameter, for a henge the slab height, for a crane the half wingspan and for a boat the length. */
const SIZE_RANGE: Record<WonderKind, readonly [number, number]> = {
  arch: [150, 300],
  gate: [130, 240],
  ribs: [90, 170],
  spires: [260, 520],
  henge: [45, 85],
  isles: [160, 320],
  crane: [130, 230],
  boat: [120, 220],
};

const ADJECTIVES: readonly (readonly string[])[] = [
  ["Folded", "Ochre", "Hushed", "Paper", "Wandering", "Gilded"],
  ["Glass", "Mirrored", "Hollow", "Lit", "Prismatic", "Quiet"],
  ["Drowned", "Slow", "Sleeping", "Lantern", "Silent", "Tidal"],
  ["Moon", "Level", "Pale", "Waiting", "Silvered", "Still"],
  ["Black", "Smouldering", "Last", "Burnt", "Iron", "Red"],
];

function nouns(kind: WonderKind, realm: number): readonly string[] {
  switch (kind) {
    case "arch":
      return ["Arch", "Doorway", "Bridge"];
    case "gate":
      return ["Gate", "Ring", "Halo"];
    case "ribs":
      return ["Ribs", "Choir", "Cage"];
    case "henge":
      return ["Circle", "Court", "Sundial"];
    case "isles":
      return ["Isles", "Drift", "Archipelago"];
    case "crane":
      return ["Crane", "Heron", "Orizuru"];
    case "boat":
      return ["Boat", "Sail", "Skiff"];
    case "spires":
      return realm === 0 ? ["Needles", "Spindles", "Pennants"] : realm === 1 ? ["Cathedral", "Choir", "Organ"] : realm === 4 ? ["Fangs", "Teeth", "Crown"] : ["Spires", "Needles", "Pillars"];
  }
}

export interface Wonder {
  kind: WonderKind;
  realm: number;
  x: number;
  z: number;
  size: number;
  yaw: number;
  name: string;
  /** Cell coordinates, which also identify the wonder. */
  cx: number;
  cz: number;
  /** The four random numbers the shader keeps for the wonder, which bend its ribs and bob its isles. */
  r: readonly [number, number, number, number];
}

/** GLSL constants generated from the tables above, so the shader and this file cannot drift apart. */
export function wonderGlslTables(): string {
  const kinds = KINDS_BY_REALM.flatMap((row) => row.map((k) => WONDER_KINDS.indexOf(k)));
  const lows = WONDER_KINDS.map((k) => SIZE_RANGE[k][0].toFixed(1));
  const highs = WONDER_KINDS.map((k) => SIZE_RANGE[k][1].toFixed(1));
  return [
    ...WONDER_KINDS.map((k, i) => `const int WONDER_${k.toUpperCase()} = ${i};`),
    `const int WONDER_KIND[${kinds.length}] = int[${kinds.length}](${kinds.join(", ")});`,
    `const float WONDER_PICK_AT[2] = float[2](${PICK_AT.map((v) => v.toFixed(2)).join(", ")});`,
    `const uint WONDER_CRANE_SALT = ${CRANE_SALT + CLASS_SALT}u;`,
    `const float WONDER_CRANE_RATE[${CRANE_RATE.length}] = float[${CRANE_RATE.length}](${CRANE_RATE.map((v) => v.toFixed(2)).join(", ")});`,
    `const uint WONDER_BOAT_SALT = ${BOAT_SALT + CLASS_SALT}u;`,
    `const float WONDER_BOAT_RATE[${BOAT_RATE.length}] = float[${BOAT_RATE.length}](${BOAT_RATE.map((v) => v.toFixed(2)).join(", ")});`,
    `const float WONDER_SIZE_MIN[${lows.length}] = float[${lows.length}](${lows.join(", ")});`,
    `const float WONDER_SIZE_MAX[${highs.length}] = float[${highs.length}](${highs.join(", ")});`,
  ].join("\n");
}

/** The wonder of one cell, or null when the cell is empty. Mirrors layerGen in wonders.glsl. */
export function wonderInCell(terrain: Terrain, cx: number, cz: number, density = WONDER_DENSITY): Wonder | null {
  const { hash4 } = terrain.noise;
  const hh = hash4(cx, cz, 400 + CLASS_SALT);
  if (hh[2] > density) return null;
  const x = (cx + 0.12 + hh[0] * 0.76) * WONDER_CELL;
  const z = (cz + 0.12 + hh[1] * 0.76) * WONDER_CELL;
  const rm = terrain.realmAt(x, z);
  const h2 = hash4(cx, cz, 450 + CLASS_SALT);
  const realm = h2[0] < rm.t ? rm.b : rm.a;
  const crane = hash4(cx, cz, CRANE_SALT + CLASS_SALT)[0] < CRANE_RATE[realm]!;
  const boat = !crane && hash4(cx, cz, BOAT_SALT + CLASS_SALT)[0] < BOAT_RATE[realm]!;
  const kind = crane ? "crane" : boat ? "boat" : KINDS_BY_REALM[realm]![h2[2] < PICK_AT[0] ? 0 : h2[2] < PICK_AT[1] ? 1 : 2]!;
  const [lo, hi] = SIZE_RANGE[kind];
  const size = lo + (hi - lo) * Math.pow(hh[3], 1.4);
  const r = hash4(cx, cz, 470 + CLASS_SALT);
  const adjectives = ADJECTIVES[realm]!;
  const pool = nouns(kind, realm);
  const name = `The ${adjectives[Math.floor(r[0] * adjectives.length)]} ${pool[Math.floor(r[1] * pool.length)]}`;
  return { kind, realm, x, z, size, yaw: h2[1] * Math.PI * 2, name, cx, cz, r: [r[0], r[1], r[2], r[3]] };
}

/** Every wonder whose centre lies within `radius` of (x, z). */
export function wondersNear(terrain: Terrain, x: number, z: number, radius: number): Wonder[] {
  const out: Wonder[] = [];
  const c0x = Math.floor((x - radius) / WONDER_CELL) - 1;
  const c1x = Math.floor((x + radius) / WONDER_CELL) + 1;
  const c0z = Math.floor((z - radius) / WONDER_CELL) - 1;
  const c1z = Math.floor((z + radius) / WONDER_CELL) + 1;
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const w = wonderInCell(terrain, cx, cz);
      if (w && Math.hypot(w.x - x, w.z - z) <= radius) out.push(w);
    }
  }
  return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}

/** Height of the ground a wonder stands on, as the shader samples it for the cell. */
export function wonderGround(terrain: Terrain, w: Wonder): number {
  return terrain.height(w.x, w.z, WONDER_CELL * 0.25);
}

/** Ground-plane point at `across` metres to the wonder's side and `along` metres through it. Along is the direction a gate or arch is passed through. */
export function wonderPoint(w: Wonder, across: number, along: number): [number, number] {
  const c = Math.cos(w.yaw);
  const s = Math.sin(w.yaw);
  return [w.x + across * c + along * s, w.z - across * s + along * c];
}

export interface GateFrame {
  x: number;
  y: number;
  z: number;
  /** Unit normal in the ground plane. */
  nx: number;
  nz: number;
  radius: number;
}

/** Where a gate's ring stands, matching wonderGate in wonders.glsl. */
export function gateFrame(terrain: Terrain, w: Wonder): GateFrame {
  return { x: w.x, y: wonderGround(terrain, w) + 0.44 * w.size, z: w.z, nx: Math.sin(w.yaw), nz: Math.cos(w.yaw), radius: 0.5 * w.size };
}
