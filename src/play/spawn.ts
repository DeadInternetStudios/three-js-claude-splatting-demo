import type { Terrain } from "../world/cpu/terrain.ts";
import { REALM_LOOKS } from "../world/realms.ts";
import { wondersNear } from "../world/wonders.ts";

export interface Spawn {
  x: number;
  z: number;
  yaw: number;
}

const GOLDEN_ANGLE = 2.399963229728653;

/** True when the ground within `radius` of (x, z) belongs to one realm alone. */
function pure(terrain: Terrain, realm: number, x: number, z: number, radius: number): boolean {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = terrain.realmAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
    if (m.a !== realm || m.t > 0.02) return false;
  }
  const centre = terrain.realmAt(x, z);
  return centre.a === realm && centre.t <= 0.02;
}

/** Slope of the smooth ground over a few metres, as rise over run. */
function slope(terrain: Terrain, x: number, z: number): number {
  const h = terrain.height(x, z, 3);
  const dx = terrain.height(x + 6, z, 3) - h;
  const dz = terrain.height(x, z + 6, 3) - h;
  return Math.hypot(dx, dz) / 6;
}

/** How far a wonder may be and still count toward where a visitor starts. */
const WONDER_VIEW = 1700;

const SIGHT_RANGES = [18, 36, 70, 120, 200, 320, 500] as const;

/**
 * How clear the view is along `yaw`, from 0 for a wall of ground at the visitor's feet to 1 for a
 * view that never rises above the horizon. The measure is the steepest rise in the ground ahead.
 */
function openness(terrain: Terrain, x: number, z: number, yaw: number): number {
  const eye = terrain.height(x, z, 6) + 1.7;
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  let rise = 0;
  for (const d of SIGHT_RANGES) {
    rise = Math.max(rise, (terrain.height(x + dx * d, z + dz * d, 6) - eye) / d);
  }
  return Math.min(1, Math.max(0.05, 1 - rise / 0.16));
}

/**
 * Where a new visitor starts: among the first gentle spots of the realm along a spiral from the
 * origin, the one that shows the most of a wonder, facing it with a little room beside it. With
 * no wonder in reach the visitor faces the sun, so the first view is lit from ahead.
 */
export function findSpawn(terrain: Terrain, realm = 0): Spawn {
  const sun = REALM_LOOKS[realm]!.atmosphere.sunDir;
  const sunYaw = Math.atan2(-sun.x, -sun.z);
  let best: (Spawn & { score: number }) | null = null;
  let found = 0;
  for (let i = 0; i < 4000 && found < 48; i++) {
    const r = 40 * Math.sqrt(i + 1) * 1.6;
    const a = i * GOLDEN_ANGLE;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!pure(terrain, realm, x, z, 60) || slope(terrain, x, z) >= 0.22) continue;
    found++;
    let yaw = sunYaw;
    let score = 0.04;
    for (const w of wondersNear(terrain, x, z, WONDER_VIEW)) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < Math.max(250, w.size * 0.8)) continue;
      const seen = Math.min(w.size / d, 0.5) * (w.realm === realm ? 1.6 : 1) * (w.kind === "isles" ? 0.7 : w.kind === "crane" ? 2.4 : 1);
      if (seen > score) {
        score = seen;
        yaw = Math.atan2(-(w.x - x), -(w.z - z)) + 0.2;
      }
    }
    score *= openness(terrain, x, z, yaw);
    if (!best || score > best.score) best = { x, z, yaw, score };
  }
  return best ? { x: best.x, z: best.z, yaw: best.yaw } : { x: 0, z: 0, yaw: sunYaw };
}
