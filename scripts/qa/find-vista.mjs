#!/usr/bin/env node
// Finds camera runs toward a wonder that stay inside the wonder's own realm, for film shots, and
// writes three lab shots (start, middle, end) for each so they can be looked at together.
//
//   node scripts/qa/find-vista.mjs --kind spires --realm 0 [--length 160] [--min 0.97] [--top 6] [--agl 2]
//     [--near 150] [--far 700] [--radius 8000] [--out .work/vistas.json]
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createTerrain, REALM_NAMES } from "../../src/world/cpu/terrain.ts";
import { wondersNear } from "../../src/world/wonders.ts";

const { values } = parseArgs({
  options: {
    kind: { type: "string" },
    realm: { type: "string" },
    length: { type: "string", default: "160" },
    min: { type: "string", default: "0.97" },
    top: { type: "string", default: "6" },
    agl: { type: "string", default: "2" },
    near: { type: "string", default: "150" },
    far: { type: "string", default: "700" },
    radius: { type: "string", default: "8000" },
    seed: { type: "string", default: "1" },
    out: { type: "string", default: ".work/vistas.json" },
  },
});
const terrain = createTerrain(Number(values.seed));
const length = Number(values.length);
const min = Number(values.min);

const own = (w, x, z) => {
  const m = terrain.realmAt(x, z);
  return m.a === w.realm ? 1 - m.t : m.b === w.realm ? m.t : 0;
};

const found = [];
for (const w of wondersNear(terrain, 0, 0, Number(values.radius))) {
  if (values.kind && w.kind !== values.kind) continue;
  if (values.realm !== undefined && w.realm !== Number(values.realm)) continue;
  let best = null;
  for (let bearing = 0; bearing < 360; bearing += 6) {
    const b = (bearing * Math.PI) / 180;
    for (let end = Number(values.near); end <= Number(values.far); end += 25) {
      const start = end + length;
      let worst = 1;
      for (let i = 0; i <= 16; i++) {
        const d = start - (length * i) / 16;
        worst = Math.min(worst, own(w, w.x + Math.sin(b) * d, w.z + Math.cos(b) * d));
      }
      if (worst < min) continue;
      const score = worst * 10 - end / 1000;
      if (!best || score > best.score) best = { w, bearing, end, start, worst, score };
    }
  }
  if (best) found.push(best);
}
found.sort((a, b) => b.score - a.score);
const shots = [];
for (const f of found.slice(0, Number(values.top))) {
  const b = (f.bearing * Math.PI) / 180;
  const yaw = f.bearing;
  console.log(`${f.w.kind} ${REALM_NAMES[f.w.realm]} ${f.w.name} size ${f.w.size.toFixed(0)} at (${f.w.x.toFixed(0)}, ${f.w.z.toFixed(0)}) bearing ${f.bearing} start ${f.start} end ${f.end} purity ${f.worst.toFixed(2)}`);
  for (const [k, frac] of [["a", 0], ["b", 0.5], ["c", 1]]) {
    const d = f.start - length * frac;
    const x = f.w.x + Math.sin(b) * d;
    const z = f.w.z + Math.cos(b) * d;
    const m = terrain.realmAt(x, z);
    shots.push({ name: `V${shots.length / 3 | 0}${k}`, pos: [x, 0, z], agl: Number(values.agl), yaw, pitch: 4, fov: 62, realm: { a: m.a, b: m.b, t: m.t }, player: [x, 0, z], time: 20 });
  }
}
writeFileSync(values.out, JSON.stringify(shots));
console.log(`wrote ${shots.length} shots to ${values.out}`);
