import { SplatAccumulator } from "@sparkjsdev/spark";
import { describe, expect, it } from "vitest";
import { FloraLayers } from "../src/world/layers/flora.ts";
import { WaterMirror } from "../src/world/layers/mirror.ts";
import { Wonders } from "../src/world/layers/wonders.ts";
import type { ProcLayer } from "../src/world/layer.ts";
import { DeformUniform, WorldUniform } from "../src/world/uniforms.ts";

function programOf(accumulator: SplatAccumulator, layer: ProcLayer): string {
  return accumulator.prepareProgramMaterial(layer.generator, layer.covGenerator).material.fragmentShader;
}

describe("shader programs", () => {
  const shared = { world: new WorldUniform(), deform: new DeformUniform() };
  const flora = new FloraLayers(shared);
  const wonders = new Wonders(shared);
  const sources = [flora.layers[2]!, flora.layers[3]!, wonders.layer];
  const mirror = new WaterMirror(shared, sources);
  const accumulator = new SplatAccumulator({ extSplats: true, covSplats: true });

  it("gives a water mirror the program of the layer it copies, so it costs no compile", () => {
    mirror.layers.forEach((layer, i) => expect(programOf(accumulator, layer)).toBe(programOf(accumulator, sources[i]!)));
  });

  it("gives the size classes of the flora one program", () => {
    const [first, ...rest] = flora.layers.map((layer) => programOf(accumulator, layer));
    for (const program of rest) expect(program).toBe(first);
  });

  it("gives the flora and the wonders different programs", () => {
    expect(programOf(accumulator, flora.layers[0]!)).not.toBe(programOf(accumulator, wonders.layer));
  });
});
