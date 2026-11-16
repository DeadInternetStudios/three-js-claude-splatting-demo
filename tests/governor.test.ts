import { describe, expect, it } from "vitest";
import { ResolutionGovernor } from "../src/play/governor.ts";

const FRAME = 1000 / 60;

const governor = (start = 1) => new ResolutionGovernor({ min: 0.4, max: 1, step: 0.1, start });

/** Feeds frames of `ms` for `seconds` of simulated time and returns every scale the governor chose, in order. */
function play(g: ResolutionGovernor, ms: number, seconds: number): number[] {
  const chosen: number[] = [];
  for (let t = 0; t < seconds * 1000; t += ms) {
    const next = g.observe(ms);
    if (next !== null) chosen.push(next);
  }
  return chosen;
}

describe("the resolution governor", () => {
  it("holds the resolution while frames arrive on time", () => {
    const g = governor();
    expect(play(g, FRAME, 30)).toEqual([]);
    expect(g.scale).toBe(1);
  });

  it("lowers the resolution by one step when frames run slow", () => {
    const g = governor();
    play(g, FRAME, 3);
    expect(play(g, 40, 1.5)[0]).toBe(0.9);
  });

  it("does not take one long stall, such as a tab that was hidden, for slow frames", () => {
    const g = governor();
    play(g, FRAME, 3);
    expect(g.observe(30_000)).toBeNull();
    expect(play(g, FRAME, 25)).toEqual([]);
    expect(g.scale).toBe(1);
  });

  it("still lowers the resolution when every frame takes longer than a stall", () => {
    const g = governor();
    play(g, FRAME, 3);
    expect(play(g, 400, 3)[0]).toBe(0.9);
  });

  it("keeps lowering it while the machine stays slow, down to the minimum and no further", () => {
    const g = governor();
    play(g, FRAME, 3);
    const chosen = play(g, 40, 40);
    expect(chosen.at(-1)).toBe(0.4);
    expect(chosen).toEqual([...chosen].sort((a, b) => b - a));
    expect(g.scale).toBe(0.4);
  });

  it("does not return to the scale that just failed for twenty seconds, then tries it again", () => {
    const g = governor();
    play(g, FRAME, 3);
    expect(play(g, 40, 1.5)[0]).toBe(0.9);
    play(g, FRAME, 2);
    expect(play(g, FRAME, 12)).toEqual([]);
    expect(g.scale).toBe(0.9);
    expect(play(g, FRAME, 10)).toEqual([1]);
  });

  it("climbs back one step at a time after a clean stretch", () => {
    const g = governor(0.5);
    const chosen = play(g, FRAME, 12);
    expect(chosen.length).toBeGreaterThanOrEqual(2);
    chosen.forEach((scale, i) => expect(scale).toBeCloseTo(0.5 + 0.1 * (i + 1), 10));
  });

  it("judges speed against the best frame time seen, so a 120 Hz display is held to 120 Hz", () => {
    const g = governor();
    play(g, 1000 / 120, 3);
    expect(play(g, 1000 / 70, 2)[0]).toBe(0.9);
  });

  it("holds a locked resolution whatever the frame times are, and adapts again when unlocked", () => {
    const g = governor();
    g.lock(0.7);
    expect(play(g, 100, 20)).toEqual([]);
    expect(g.scale).toBe(0.7);
    g.lock(null);
    play(g, FRAME, 3);
    expect(play(g, 40, 3)[0]).toBe(0.6);
  });

  it("keeps a locked resolution inside its range", () => {
    const g = governor();
    g.lock(2);
    expect(g.scale).toBe(1);
    g.lock(0.1);
    expect(g.scale).toBe(0.4);
  });
});
