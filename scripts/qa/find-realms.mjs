import { createTerrain, REALM_NAMES } from "../../src/world/cpu/terrain.ts";

/**
 * Lists, for each realm, the nearest points to the origin where it shows alone and where it
 * blends into the next one. Used to aim lab shots and the film path.
 *   node scripts/qa/find-realms.mjs [--seed 1]
 */
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])));
const seed = Number(args.seed ?? 1);
const terrain = createTerrain(seed);
const found = new Map();
const step = 40;
for (let ring = 0; ring < 400; ring++) {
  for (let i = -ring; i <= ring; i++) {
    for (const [x, z] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
      const px = x * step;
      const pz = z * step;
      const r = terrain.realmAt(px, pz);
      const key = `${r.a}${r.t < 0.001 ? "pure" : "blend"}`;
      if (!found.has(key)) found.set(key, { x: px, z: pz, a: r.a, b: r.b, t: r.t, dist: Math.hypot(px, pz).toFixed(0) });
    }
  }
}
for (const [key, v] of [...found.entries()].sort()) console.log(key.padEnd(8), REALM_NAMES[v.a].padEnd(14), JSON.stringify(v));
