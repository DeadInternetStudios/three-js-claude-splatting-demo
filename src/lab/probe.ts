import * as THREE from "three";
import { FullscreenPass } from "../core/render/fullscreen.ts";
import terrainGlsl from "../world/glsl/terrain.glsl?raw";
import { COMMON_GLSL, WORLD_GLSL } from "../world/uniforms.ts";

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
${WORLD_GLSL}
${COMMON_GLSL}
${terrainGlsl}
uniform sampler2D uPoints;
uniform vec2 uSeed;
out vec4 fragColor;
void main() {
  gSeed = uint(uSeed.x + 0.5) | (uint(uSeed.y + 0.5) << 16u);
  vec3 q = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0).xyz;
  RealmMix r = realmAt(q.xy);
  float h = terrain(q.xy, q.z, r);
  fragColor = vec4(h, float(r.a), float(r.b), r.t);
}`;

export interface ProbeSample {
  height: number;
  a: number;
  b: number;
  t: number;
}

/** Evaluates the GPU terrain at points so tests can compare it with the CPU twin. */
export function probeTerrain(renderer: THREE.WebGLRenderer, seed: number, points: [number, number, number][]): ProbeSample[] {
  const width = 256;
  const height = Math.ceil(points.length / width);
  const data = new Float32Array(width * height * 4);
  points.forEach((p, i) => data.set([p[0], p[1], p[2], 0], i * 4));
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.internalFormat = "RGBA32F";
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const pass = new FullscreenPass(FRAG, { uPoints: { value: tex }, uSeed: { value: new THREE.Vector2(seed & 0xffff, seed >>> 16) } });
  pass.render(renderer, target);
  const out = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, out);
  pass.dispose();
  target.dispose();
  tex.dispose();
  return points.map((_, i) => ({ height: out[i * 4]!, a: out[i * 4 + 1]!, b: out[i * 4 + 2]!, t: out[i * 4 + 3]! }));
}
