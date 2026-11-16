import { describe, expect, it } from "vitest";
import { findSpawn } from "../src/play/spawn.ts";
import { formatShare, parseShare, type ShareState } from "../src/play/share.ts";
import { BEAST_KINDS, DEFAULT_BEASTS, beastKind, beastPoint } from "../src/world/cpu/beasts.ts";
import { REALM_COUNT, createTerrain } from "../src/world/cpu/terrain.ts";
import { WONDER_CELL, WONDER_DENSITY, WONDER_KINDS, gateFrame, wonderInCell, wonderPoint, wondersNear } from "../src/world/wonders.ts";

const terrain = createTerrain(1);

/** A deterministic scatter of points, so a failure names the same point every run. */
function scatter(count: number, spread: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963229728653;
    const r = spread * Math.sqrt((i + 0.5) / count);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

describe("terrain", () => {
  it("keeps the Ember canyon walls from turning into streaked vertical sheets", () => {
    const spawn = findSpawn(terrain, 4);
    const slopes: number[] = [];
    for (const [dx, dz] of scatter(4000, 3000)) {
      const x = spawn.x + dx;
      const z = spawn.z + dz;
      const m = terrain.realmAt(x, z);
      if (m.a !== 4 || m.t > 0.02) continue;
      const here = terrain.height(x, z, 3);
      slopes.push(Math.hypot(terrain.height(x + 2.5, z, 3) - here, terrain.height(x, z + 2.5, 3) - here) / 2.5);
    }
    slopes.sort((a, b) => a - b);
    expect(slopes.length).toBeGreaterThan(300);
    expect(slopes[Math.floor(slopes.length * 0.995)]!).toBeLessThan(2);
    expect(slopes[slopes.length - 1]!).toBeLessThan(3);
  });

  it("is the same world for the same seed and a different one for another", () => {
    const other = createTerrain(2);
    let differing = 0;
    for (const [x, z] of scatter(40, 6000)) {
      expect(createTerrain(1).height(x, z, 4)).toBe(terrain.height(x, z, 4));
      if (Math.abs(other.height(x, z, 4) - terrain.height(x, z, 4)) > 1) differing++;
    }
    expect(differing).toBeGreaterThan(30);
  });

  it("has finite ground everywhere, far from the origin as well", () => {
    for (const [x, z] of scatter(400, 60000)) {
      expect(Number.isFinite(terrain.facetHeight(x, z, 2.7)), `ground at ${x}, ${z}`).toBe(true);
      expect(Number.isFinite(terrain.height(x, z, 20))).toBe(true);
    }
  });

  it("blends neighbouring realms of the cycle only", () => {
    for (const [x, z] of scatter(600, 20000)) {
      const m = terrain.realmAt(x, z);
      expect(m.a).toBeGreaterThanOrEqual(0);
      expect(m.a).toBeLessThan(REALM_COUNT);
      expect(m.b).toBe((m.a + 1) % REALM_COUNT);
      expect(m.t).toBeGreaterThanOrEqual(0);
      expect(m.t).toBeLessThanOrEqual(1);
    }
  });

  it("shows every realm within a day's walk of the start", () => {
    const seen = new Set<number>();
    for (const [x, z] of scatter(3000, 12000)) seen.add(terrain.realmAt(x, z).a);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("wonders", () => {
  const cells: [number, number][] = [];
  for (let cz = -30; cz < 30; cz++) for (let cx = -30; cx < 30; cx++) cells.push([cx, cz]);
  const all = cells.flatMap(([cx, cz]) => wonderInCell(terrain, cx, cz) ?? []);

  it("stand in the middle of their own cell and are the same every time", () => {
    for (const w of all) {
      expect(w.x).toBeGreaterThan((w.cx + 0.1) * WONDER_CELL);
      expect(w.x).toBeLessThan((w.cx + 0.9) * WONDER_CELL);
      expect(w.z).toBeGreaterThan((w.cz + 0.1) * WONDER_CELL);
      expect(w.z).toBeLessThan((w.cz + 0.9) * WONDER_CELL);
      expect(w.size).toBeGreaterThan(20);
      expect(w.name).toMatch(/^The \S+ \S+/);
      expect(wonderInCell(terrain, w.cx, w.cz)).toEqual(w);
    }
  });

  it("fill about the density asked for and use every kind", () => {
    expect(all.length / cells.length).toBeGreaterThan(WONDER_DENSITY - 0.08);
    expect(all.length / cells.length).toBeLessThan(WONDER_DENSITY + 0.08);
    expect(new Set(all.map((w) => w.kind))).toEqual(new Set(WONDER_KINDS));
  });

  it("hold a paper crane in about one cell in nine and name it", () => {
    const cranes = all.filter((w) => w.kind === "crane");
    expect(cranes.length / all.length).toBeGreaterThan(0.06);
    expect(cranes.length / all.length).toBeLessThan(0.16);
    for (const w of cranes) expect(w.name).toMatch(/(Crane|Heron|Orizuru)$/);
  });

  it("hold a paper boat in the Dunes, the Deep and the Flats and nowhere else, and name it", () => {
    const boats = all.filter((w) => w.kind === "boat");
    expect(new Set(boats.map((w) => w.realm))).toEqual(new Set([0, 2, 3]));
    expect(boats.length / all.length).toBeGreaterThan(0.04);
    expect(boats.length / all.length).toBeLessThan(0.1);
    for (const w of boats) expect(w.name).toMatch(/(Boat|Sail|Skiff)$/);
  });

  it("are found by distance, nearest first", () => {
    const near = wondersNear(terrain, 1500, -900, 3000);
    expect(near.length).toBeGreaterThan(3);
    let last = 0;
    for (const w of near) {
      const d = Math.hypot(w.x - 1500, w.z + 900);
      expect(d).toBeLessThanOrEqual(3000);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    const brute = all.filter((w) => Math.hypot(w.x - 1500, w.z + 900) <= 3000).map((w) => w.name + w.cx + w.cz);
    expect(near.map((w) => w.name + w.cx + w.cz).sort()).toEqual(brute.sort());
  });

  it("have a frame whose along axis is the gate normal and whose axes are square", () => {
    for (const w of all.slice(0, 80)) {
      const [ox, oz] = wonderPoint(w, 0, 0);
      expect([ox, oz]).toEqual([w.x, w.z]);
      const [ax, az] = wonderPoint(w, 0, 1);
      const [bx, bz] = wonderPoint(w, 1, 0);
      expect(Math.hypot(ax - ox, az - oz)).toBeCloseTo(1, 8);
      expect(Math.hypot(bx - ox, bz - oz)).toBeCloseTo(1, 8);
      expect((ax - ox) * (bx - ox) + (az - oz) * (bz - oz)).toBeCloseTo(0, 8);
      const g = gateFrame(terrain, w);
      expect(g.nx).toBeCloseTo(ax - ox, 8);
      expect(g.nz).toBeCloseTo(az - oz, 8);
      expect(g.radius).toBe(0.5 * w.size);
    }
  });
});

describe("creatures", () => {
  it("put whales first and the deep sea after", () => {
    expect(beastKind(0)).toBe("whale");
    expect(beastKind(DEFAULT_BEASTS.whales - 1)).toBe("whale");
    expect(new Set([...Array(DEFAULT_BEASTS.whales + DEFAULT_BEASTS.deep).keys()].map((s) => beastKind(s)))).toEqual(new Set(BEAST_KINDS));
  });

  it("appear as the copy nearest the player, so the herd surrounds them", () => {
    for (const [px, pz] of scatter(30, 30000)) {
      for (let slot = 0; slot < DEFAULT_BEASTS.whales + DEFAULT_BEASTS.deep; slot++) {
        const b = beastPoint(terrain, 1, slot, 777.7, px, pz);
        const box = b.kind === "whale" ? DEFAULT_BEASTS.whaleBox : DEFAULT_BEASTS.deepBox;
        expect(Math.abs(b.x - px)).toBeLessThanOrEqual(box / 2 + 1e-6);
        expect(Math.abs(b.z - pz)).toBeLessThanOrEqual(box / 2 + 1e-6);
        expect(Number.isFinite(b.y) && b.size > 0).toBe(true);
        expect(Math.hypot(b.dx, b.dz)).toBeCloseTo(1, 6);
      }
    }
  });

  it("move smoothly and the same way every time", () => {
    for (let slot = 0; slot < DEFAULT_BEASTS.whales + DEFAULT_BEASTS.deep; slot++) {
      const a = beastPoint(terrain, 1, slot, 1000, 0, 0);
      const b = beastPoint(terrain, 1, slot, 1000.5, a.x, a.z);
      expect(beastPoint(terrain, 1, slot, 1000, 0, 0)).toEqual(a);
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.5).toBeLessThan(40);
    }
  });
});

describe("where a visitor starts", () => {
  it("is a gentle patch of the realm asked for, the same each time", () => {
    for (let realm = 0; realm < REALM_COUNT; realm++) {
      const s = findSpawn(terrain, realm);
      expect(findSpawn(terrain, realm)).toEqual(s);
      const m = terrain.realmAt(s.x, s.z);
      expect(m.a).toBe(realm);
      expect(m.t).toBeLessThanOrEqual(0.02);
      expect(Number.isFinite(s.yaw)).toBe(true);
      const h = terrain.height(s.x, s.z, 3);
      const slope = Math.hypot(terrain.height(s.x + 6, s.z, 3) - h, terrain.height(s.x, s.z + 6, 3) - h) / 6;
      expect(slope).toBeLessThan(0.22);
    }
  });

  it("differs from one seed to the next", () => {
    const a = findSpawn(createTerrain(1));
    const b = findSpawn(createTerrain(2));
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
  });
});

describe("share links", () => {
  const state: ShareState = { seed: 4242, x: -1234.5, z: 987.6, yaw: 2.718, pitch: -0.25, agl: 12.5 };

  it("round trip", () => {
    expect(parseShare(`#${formatShare(state)}`)).toEqual({ ok: true, state });
  });

  it("treat an empty hash as no link", () => {
    expect(parseShare("")).toBeNull();
    expect(parseShare("#")).toBeNull();
  });

  it("reject a link that is missing a place or out of range", () => {
    expect(parseShare("#s=1&z=2&yaw=0")).toEqual({ ok: false, reason: "missing x" });
    expect(parseShare("#s=1&x=0&z=9e9&yaw=0")).toEqual({ ok: false, reason: "z is out of range" });
    expect(parseShare("#s=1.5&x=0&z=0&yaw=0")).toEqual({ ok: false, reason: "seed must be a whole number" });
    expect(parseShare("#s=-3&x=0&z=0&yaw=0")).toEqual({ ok: false, reason: "seed is out of range" });
    expect(parseShare("#s=1&x=NaN&z=0&yaw=0")).toEqual({ ok: false, reason: "x is out of range" });
  });
});
