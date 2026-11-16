import * as THREE from "three";
import { FullscreenPass } from "../core/render/fullscreen.ts";
import type { WorldUniform } from "./uniforms.ts";
import { COMMON_GLSL, WORLD_GLSL } from "./uniforms.ts";
import skyGlsl from "./glsl/sky.glsl?raw";
import skyCommonGlsl from "./glsl/sky_common.glsl?raw";
import horizonGlsl from "./glsl/horizon.glsl?raw";

const SKY_FRAG = /* glsl */ `
precision highp float;
precision highp int;
${WORLD_GLSL}
${COMMON_GLSL}
${skyCommonGlsl}
${horizonGlsl}
${skyGlsl}
uniform WorldParams world;
uniform mat3 uCamToWorld;
uniform vec2 uTanHalf;
in vec2 vUv;
out vec4 fragColor;
void main() {
  gW = world;
  gSeed = worldSeed(world);
  gTime = world.time.x;
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uCamToWorld * vec3(ndc * uTanHalf, -1.0));
  fragColor = vec4(skyAndWater(dir), 1.0);
}`;

/** Draws the sky behind the splats from the same world state the splat layers read. */
export class SkyPass {
  private readonly pass: FullscreenPass;
  private readonly basis = new THREE.Matrix3();

  constructor(world: WorldUniform) {
    this.pass = new FullscreenPass(SKY_FRAG, {
      world: { value: world.value },
      uCamToWorld: { value: this.basis },
      uTanHalf: { value: new THREE.Vector2(1, 1) },
    });
  }

  /** Overwrites `target`. `orientation` is the rotation the sky is looked up with. */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera, orientation: THREE.Quaternion): void {
    const u = this.pass.material.uniforms;
    this.basis.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(orientation));
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    (u.uTanHalf!.value as THREE.Vector2).set(tanHalf * camera.aspect, tanHalf);
    this.pass.render(renderer, target);
  }

  dispose(): void {
    this.pass.dispose();
  }
}
