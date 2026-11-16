import { writeFileSync } from "node:fs";
import { createTerrain } from "../../src/world/cpu/terrain.ts";
import { WONDER_KINDS, wondersNear } from "../../src/world/wonders.ts";

/**
 * Writes lab shot specs that frame the nearest wonder of each kind, from far and from close.
 *   node scripts/qa/wonder-shots.mjs --out .work/wonders.json [--seed 1] [--time 30] [--kinds arch,gate] [--realm 0] [--tag name]
 */
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])));
const seed = Number(args.seed ?? 1);
const time = Number(args.time ?? 30);
const kinds = args.kinds ? args.kinds.split(",") : [...WONDER_KINDS];
const terrain = createTerrain(seed);
const all = wondersNear(terrain, 0, 0, 16000).filter((w) => args.realm === undefined || w.realm === Number(args.realm));
const shots = [];
for (const kind of kinds) {
  const w = all.find((o) => o.kind === kind);
  if (!w) continue;
  const rm = terrain.realmAt(w.x, w.z);
  for (const [label, dist, agl, bearing] of [["far", 1.9, 30, 0.6], ["near", 0.95, 12, -0.5], ["low", 1.3, 3, 2.4]]) {
    const d = dist * w.size * (kind === "henge" ? 3 : 1);
    const cx = w.x + Math.sin(bearing) * d;
    const cz = w.z + Math.cos(bearing) * d;
    const dx = w.x - cx;
    const dz = w.z - cz;
    const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    const aim = (kind === "isles" ? 0.9 : kind === "henge" ? 0.1 : 0.45) * w.size;
    const pitch = (Math.atan2(aim - agl, d) * 180) / Math.PI;
    shots.push({ name: `W${args.tag ?? ""}-${kind}-${label}`, pos: [cx, 0, cz], agl, yaw, pitch, fov: 70, realm: { a: rm.a, b: rm.b, t: rm.t }, player: [cx, 0, cz], time, info: w.name });
  }
}
writeFileSync(args.out ?? ".work/wonders.json", JSON.stringify(shots));
console.log(shots.map((s) => `${s.name} ${s.info}`).join("\n"));
