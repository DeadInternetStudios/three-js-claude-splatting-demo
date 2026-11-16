import * as THREE from "three";
import { FullscreenPass } from "./fullscreen.ts";

const ADD_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform float uWeight;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(tSrc, vUv).rgb * uWeight, 1.0);
}`;

/** Averages several HDR renders into one, which is how sub-frames become motion blur. */
export class Accumulator {
  readonly target: THREE.WebGLRenderTarget;
  private readonly pass: FullscreenPass;

  constructor(private readonly renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.pass = new FullscreenPass(ADD_FRAG, { tSrc: { value: null }, uWeight: { value: 1 } });
    const m = this.pass.material;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.ZeroFactor;
  }

  clear(): void {
    const { renderer } = this;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.setRenderTarget(previous);
  }

  add(source: THREE.Texture, weight: number): void {
    const { renderer } = this;
    this.pass.material.uniforms.tSrc!.value = source;
    this.pass.material.uniforms.uWeight!.value = weight;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.pass.render(renderer, this.target);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.target.dispose();
    this.pass.dispose();
  }
}
