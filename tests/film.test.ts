import { describe, expect, it } from "vitest";
import { rampDistance } from "../src/film/animate.ts";
import { turnBetween } from "../src/film/rig.ts";
import { samplesNeeded, type BlurSettings } from "../src/film/blur.ts";
import { CUE, DURATION, GRID, IMPACTS, ONSETS } from "../src/film/cues.ts";
import { evaluate, evaluateWithin } from "../src/film/director.ts";
import { FILM_SEED, SHOTS, shotAt, terrain, wonderAt } from "../src/film/shots.ts";
import { titlesAt } from "../src/film/titles.ts";

const FPS = 24;
const frames = Array.from({ length: Math.round(DURATION * FPS) }, (_, i) => i / FPS);

describe("the cue sheet", () => {
  const marks = [...IMPACTS, ...ONSETS].map((o) => o.t);

  it("names only moments the analysed track really has", () => {
    const named = { hit1: CUE.hit1, hit2: CUE.hit2, hit3: CUE.hit3, drop: CUE.drop, accent: CUE.accent, stop: CUE.stop, snap: CUE.snap, title: CUE.title };
    for (const [name, t] of Object.entries(named)) expect(marks.some((m) => Math.abs(m - t) < 0.03), `${name} at ${t}`).toBe(true);
  });

  it("orders them and ends with the track", () => {
    const order = [CUE.open, CUE.hit1, CUE.hit2, CUE.hit3, CUE.drop, CUE.accent, CUE.stop, CUE.snap, CUE.title, CUE.end];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(CUE.end).toBeCloseTo(48.04, 1);
  });
});

describe("the cut", () => {
  it("is a run of shots with no gap and no overlap that covers the whole track", () => {
    expect(SHOTS[0]!.start).toBe(0);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i]!.start, SHOTS[i]!.name).toBe(SHOTS[i - 1]!.end);
    expect(SHOTS[SHOTS.length - 1]!.end).toBeGreaterThanOrEqual(DURATION);
    expect(new Set(SHOTS.map((s) => s.name)).size).toBe(SHOTS.length);
    for (const s of SHOTS) expect(s.end - s.start, s.name).toBeGreaterThan(1);
  });

  it("finds the shot a time belongs to", () => {
    for (const s of SHOTS) {
      expect(shotAt(s.start + 1e-6)).toBe(s);
      expect(shotAt(s.end - 1e-6)).toBe(s);
    }
  });

  it("cuts on the beat grid of the track or on one of its marked hits", () => {
    const hits = Object.values(CUE).filter((v): v is number => typeof v === "number");
    for (const s of SHOTS.slice(1)) {
      const beats = (s.start - GRID.t0) / (GRID.beat * 2);
      const onGrid = Math.abs(beats - Math.round(beats)) * GRID.beat * 2 < 0.04;
      const onHit = hits.some((h) => Math.abs(h - s.start) < 0.04);
      expect(onGrid || onHit, `${s.name} cuts at ${s.start}`).toBe(true);
    }
  });

  it("puts the film's one seed under every shot", () => {
    expect(FILM_SEED).toBe(1);
    for (const t of [1, 20, 40]) expect(evaluate(t).view.seed).toBe(FILM_SEED);
  });

  it("names the places it flies to, and fails loudly when the world moves them", () => {
    expect(wonderAt(5055, -3931, "The Paper Pennants").kind).toBe("spires");
    expect(() => wonderAt(5055, -3931, "The Wrong Name")).toThrow(/expected The Wrong Name/);
  });
});

describe("the camera", () => {
  it("stays above the ground with a sane lens on every frame", () => {
    for (const t of frames) {
      const { pose } = evaluate(t);
      for (const v of Object.values(pose)) expect(Number.isFinite(v), `pose at ${t}`).toBe(true);
      expect(pose.y - terrain.facetHeight(pose.x, pose.z, 2.7), `height above ground at ${t}`).toBeGreaterThan(0.4);
      expect(pose.fov).toBeGreaterThan(20);
      expect(pose.fov).toBeLessThan(100);
    }
  });

  it("never jumps inside a shot", () => {
    for (let i = 1; i < frames.length; i++) {
      const a = evaluate(frames[i - 1]!);
      const b = evaluate(frames[i]!);
      if (a.shot !== b.shot) continue;
      expect(Math.hypot(b.pose.x - a.pose.x, b.pose.y - a.pose.y, b.pose.z - a.pose.z), `move at ${frames[i]}`).toBeLessThan(30);
      expect(Math.abs(Math.atan2(Math.sin(b.pose.yaw - a.pose.yaw), Math.cos(b.pose.yaw - a.pose.yaw))), `turn at ${frames[i]}`).toBeLessThan(0.3);
      expect(Math.abs(b.pose.fov - a.pose.fov), `zoom at ${frames[i]}`).toBeLessThan(4);
    }
  });

  it("keeps each shot in the realm it was chosen for, away from the blend between realms", () => {
    const pure = ["dunes-dawn", "prism-glide", "cage-run", "rib-rise"];
    for (const name of pure) {
      const shot = SHOTS.find((s) => s.name === name)!;
      const realms = new Set<number>();
      for (let u = 0; u < shot.end - shot.start; u += 0.1) {
        const p = shot.camera(u);
        const m = terrain.realmAt(p.x, p.z);
        expect(m.t, `${name} at ${u}`).toBeLessThan(0.05);
        realms.add(m.a);
      }
      expect(realms.size, name).toBe(1);
    }
  });
});

describe("the director", () => {
  it("fades up from black and out to black", () => {
    expect(evaluate(0).grade.fade).toBe(0);
    expect(evaluate(DURATION * 0.5).grade.fade).toBe(1);
    expect(evaluate(DURATION - 0.05).grade.fade).toBeLessThan(0.01);
  });

  it("is a pure function of the time", () => {
    for (const t of [3.3, 17.5, 30.1, 44.4]) {
      const a = evaluate(t);
      const b = evaluate(t);
      expect(b.pose).toEqual(a.pose);
      expect(b.grade).toEqual(a.grade);
      expect(b.view.time).toBe(a.view.time);
    }
  });

  it("starts a ring of light that outruns the camera on each hit", () => {
    for (const hit of [CUE.hit2, CUE.hit3, CUE.drop]) {
      const frame = evaluate(hit + 0.05);
      const ring = (frame.view.lightRings ?? []).find((r) => r && Math.abs(r.start - frame.shot.clock(hit - frame.shot.start)) < 1e-6);
      expect(ring, `ring for the hit at ${hit}`).toBeTruthy();
      const next = frame.shot.camera(hit - frame.shot.start + 0.1);
      const here = frame.shot.camera(hit - frame.shot.start);
      const travel = Math.hypot(next.x - here.x, next.z - here.z) / 0.1;
      expect(ring!.speed).toBeGreaterThan(travel * 2);
      expect(ring!.amplitude).toBeLessThanOrEqual(1);
    }
  });

  it("holds the blur sub-frames of a frame inside its shot, so a cut stays hard", () => {
    const half = 0.5 / FPS / 2;
    for (const t of frames) {
      const shot = evaluate(t).shot;
      for (const offset of [-half, 0, half]) expect(evaluateWithin(t, offset).shot).toBe(shot);
    }
  });

  it("shows no title until the closing card and none at the very end", () => {
    expect(titlesAt(CUE.title - 0.1)).toEqual([]);
    expect(titlesAt(CUE.title + 3.5).map((l) => l.text)[0]).toBe("REALITY ORIGAMI");
    for (const l of titlesAt(CUE.title + 3.5)) expect(l.alpha).toBeLessThanOrEqual(1);
    expect(titlesAt(DURATION)).toEqual([]);
  });

  it("folds the dunes shut during the riser and holds them folded in the silence", () => {
    const rise = SHOTS.find((s) => s.name === "fold-rise")!;
    const hold = SHOTS.find((s) => s.name === "hold")!;
    expect(rise.end).toBe(hold.start);
    expect(hold.start).toBe(CUE.stop);
    expect(evaluate(rise.start + 0.05).view.spec.curves.length).toBe(0);
    expect(rise.fold!(rise.end - rise.start, rise.end).hinge).toBeCloseTo(1, 2);
    expect(hold.fold!(0.5, hold.start + 0.5).hinge).toBe(1);
    expect(hold.camera(0).x).toBeCloseTo(rise.camera(rise.end - rise.start).x, 6);
    expect(hold.camera(0).z).toBeCloseTo(rise.camera(rise.end - rise.start).z, 6);
  });
});

describe("rampDistance", () => {
  it("starts at the first speed and ends at the second, without a jump in speed", () => {
    const v = (u: number): number => (rampDistance(u + 1e-4, 4, 7, 2, 14) - rampDistance(u, 4, 7, 2, 14)) / 1e-4;
    expect(v(1)).toBeCloseTo(2, 3);
    expect(v(3.9999)).toBeCloseTo(v(4.0001), 2);
    expect(v(6.9999)).toBeCloseTo(v(7.0001), 1);
    expect(v(9)).toBeCloseTo(14, 3);
    let last = -1;
    for (let u = 0; u < 12; u += 0.05) {
      const d = rampDistance(u, 4, 7, 2, 14);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
  });
});

describe("motion blur sample count", () => {
  const settings: BlurSettings = { fps: FPS, shutter: 0.5, height: 1080, spacing: 3.5, min: 2, max: 12 };

  it("stays inside its limits for every frame of the film", () => {
    for (const t of frames) {
      const n = samplesNeeded(t, settings);
      expect(n).toBeGreaterThanOrEqual(settings.min);
      expect(n).toBeLessThanOrEqual(settings.max);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("gives the fast ride more sub-frames than the quiet drift at the end", () => {
    const busy = samplesNeeded(15.5, settings);
    const quiet = samplesNeeded(46, settings);
    expect(busy).toBeGreaterThan(quiet);
    expect(quiet).toBeLessThanOrEqual(settings.min + 2);
  });

  it("asks for more sub-frames when the allowed gap shrinks or the picture grows", () => {
    for (const t of [6, 18, 27, 33]) {
      const base = samplesNeeded(t, { ...settings, max: 64 });
      expect(samplesNeeded(t, { ...settings, spacing: settings.spacing / 2, max: 64 })).toBeGreaterThanOrEqual(base);
      expect(samplesNeeded(t, { ...settings, height: 2160, max: 64 })).toBeGreaterThanOrEqual(base);
    }
  });
});

describe("the lightning", () => {
  const ember = SHOTS.find((s) => s.name === "ember-doorway")!;
  const lit = frames.filter((t) => evaluate(t).view.storm);

  it("falls only in the Ember shot, and twice", () => {
    expect(lit.length).toBeGreaterThan(5);
    for (const t of lit) expect(shotAt(t), `shot at ${t}`).toBe(ember);
    const gaps = lit.filter((t, i) => i > 0 && t - lit[i - 1]! > 0.3);
    expect(gaps.length).toBe(1);
  });

  it("strikes on beats of the track, in front of the camera, and stays between 0 and 1", () => {
    const first = lit[0]!;
    expect(ONSETS.some((o) => Math.abs(o.t - 26.75) < 0.03)).toBe(true);
    expect(first).toBeGreaterThan(26.75);
    expect(first).toBeLessThan(26.75 + 0.1);
    for (const t of lit) {
      const { view, pose } = evaluate(t);
      expect(view.storm!.level).toBeGreaterThan(0);
      expect(view.storm!.level).toBeLessThanOrEqual(1);
      expect(Math.abs(turnBetween(-pose.yaw, view.storm!.azimuth)), `bolt off screen at ${t}`).toBeLessThan(0.9);
    }
  });

  it("is dark before it and after it", () => {
    expect(evaluate(26.7).view.storm).toBeUndefined();
    expect(evaluate(27.5).view.storm).toBeUndefined();
    expect(evaluate(28.3).view.storm).toBeUndefined();
  });
});
