import { writeFileSync } from "node:fs";
import { beastPoint } from "../../src/world/cpu/beasts.ts";
import { createTerrain } from "../../src/world/cpu/terrain.ts";

/**
 * Writes lab shot specs that frame creatures from the side and from below.
 *   node scripts/qa/beast-shots.mjs --out .work/beasts.json [--seed 1] [--time 30]
 */
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])));
const seed = Number(args.seed ?? 1);
const time = Number(args.time ?? 30);
const terrain = createTerrain(seed);
const places = [
  ["dunes", 720, 760, [0, 1]],
  ["prism", 120, -40, [2]],
  ["flats", -320, 240, [3]],
  ["ember", -400, 600, [4]],
  ["deep", 0, 0, [6, 7, 8, 9]],
];
const shots = [];
for (const [name, x, z, slots] of places) {
  const rm = terrain.realmAt(x, z);
  for (const slot of slots) {
    const b = beastPoint(terrain, seed, slot, time, x, z);
    const distance = b.size * (b.kind === "whale" ? 1.7 : 2.6);
    const above = b.kind === "whale" ? b.size * 0.15 : b.size * 0.3;
    shots.push({ name: `B-${name}-${slot}-${b.kind}`, pos: [x, 0, z], fov: 60, realm: { a: rm.a, b: rm.b, t: rm.t }, player: [x, 0, z], time, beast: { slot, distance, above, side: 1 } });
  }
}
writeFileSync(args.out ?? ".work/beasts.json", JSON.stringify(shots));
console.log(shots.map((s) => s.name).join("\n"));
