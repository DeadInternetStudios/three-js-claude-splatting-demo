import { createTerrain, REALM_NAMES } from "../../src/world/cpu/terrain.ts";
import { wondersNear } from "../../src/world/wonders.ts";

/**
 * Lists the wonders around a point, nearest first, with the camera pose that frames each one.
 *   node scripts/qa/find-wonders.mjs [--seed 1] [--x 0] [--z 0] [--radius 4000]
 */
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])));
const terrain = createTerrain(Number(args.seed ?? 1));
const x = Number(args.x ?? 0);
const z = Number(args.z ?? 0);
for (const w of wondersNear(terrain, x, z, Number(args.radius ?? 4000))) {
  const d = Math.hypot(w.x - x, w.z - z);
  console.log(`${w.kind.padEnd(7)} ${REALM_NAMES[w.realm].padEnd(14)} size ${w.size.toFixed(0).padStart(4)} at (${w.x.toFixed(0)}, ${w.z.toFixed(0)}) ${d.toFixed(0)} m  ${w.name}`);
}
