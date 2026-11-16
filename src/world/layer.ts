import { dyno, SplatGenerator } from "@sparkjsdev/spark";
import * as THREE from "three";
import entryGlsl from "./glsl/entry.glsl?raw";
import lightGlsl from "./glsl/light.glsl?raw";
import surfelGlsl from "./glsl/surfel.glsl?raw";
import {
  COMMON_GLSL,
  DEFORM_GLSL,
  LAYER_GLSL,
  LayerParamsType,
  WORLD_GLSL,
  type DeformUniform,
  type WorldUniform,
} from "./uniforms.ts";

export interface LayerSource {
  name: string;
  /** Number of splat indices the layer owns. Indices the layer declines cost almost nothing to generate. */
  count: number;
  /** GLSL libraries the layer code uses, in dependency order. */
  libs?: string[];
  /** GLSL defining `bool layerGen(int index, sampler2D field, out Surfel s)`. Return false for an inactive index. */
  glsl: string;
}

interface LayerValue {
  p0: THREE.Vector4;
  p1: THREE.Vector4;
  p2: THREE.Vector4;
  p3: THREE.Vector4;
  p4: THREE.Vector4;
  p5: THREE.Vector4;
}

let emptyField: THREE.DataTexture | null = null;
/** One texel for layers that have no field, so the sampler is always bound. */
function placeholderField(): THREE.DataTexture {
  if (!emptyField) {
    emptyField = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    emptyField.internalFormat = "RGBA32F";
    emptyField.minFilter = THREE.NearestFilter;
    emptyField.magFilter = THREE.NearestFilter;
    emptyField.needsUpdate = true;
  }
  return emptyField;
}

export interface SharedUniforms {
  world: WorldUniform;
  deform: DeformUniform;
}

/**
 * One procedural layer: a Spark generator whose shader program maps a splat index to a surfel,
 * folds it, lights it and packs it as a Gaussian. Everything happens in one GPU pass, so lighting
 * sees the folded normal and no splat data is ever uploaded.
 */
export class ProcLayer extends SplatGenerator {
  readonly params: LayerValue;
  readonly source: LayerSource;
  readonly field: THREE.Texture | undefined;

  constructor(source: LayerSource, shared: SharedUniforms, field?: THREE.Texture) {
    const params: LayerValue = {
      p0: new THREE.Vector4(),
      p1: new THREE.Vector4(),
      p2: new THREE.Vector4(),
      p3: new THREE.Vector4(),
      p4: new THREE.Vector4(),
      p5: new THREE.Vector4(),
    };
    const fieldUniform = dyno.dynoSampler2D(field ?? placeholderField());
    const layerUniform = new dyno.DynoUniform({
      key: "layer",
      type: LayerParamsType,
      globals: () => [LAYER_GLSL],
      value: params as never,
    });
    const globals = [dyno.defineGsplat, dyno.defineCovSplat, WORLD_GLSL, COMMON_GLSL, DEFORM_GLSL, surfelGlsl, lightGlsl, LAYER_GLSL, ...(source.libs ?? []), source.glsl, entryGlsl];
    const covGenerator = dyno.dynoBlock({ index: "int" }, { covsplat: dyno.CovSplat }, ({ index }) => {
      const stage = new dyno.Dyno({
        inTypes: { index: "int", world: shared.world.uniform.type, deform: shared.deform.uniform.type, layer: LayerParamsType, field: "sampler2D" },
        outTypes: { covsplat: dyno.CovSplat },
        globals: () => globals,
        inputs: { index: index as never, world: shared.world.uniform as never, deform: shared.deform.uniform as never, layer: layerUniform as never, field: fieldUniform as never },
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(/* glsl */ `
            ${outputs.covsplat} = runLayer(${inputs.index}, ${inputs.world}, ${inputs.deform}, ${inputs.layer}, ${inputs.field});
          `),
      });
      return { covsplat: stage.outputs.covsplat };
    });
    super({ numSplats: source.count, covGenerator: covGenerator as never });
    this.name = source.name;
    this.params = params;
    this.source = source;
    this.field = field;
  }
}
