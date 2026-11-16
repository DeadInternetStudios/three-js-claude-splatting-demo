import * as THREE from "three";

const triangle = new THREE.BufferGeometry();
triangle.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
triangle.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FULLSCREEN_VERT = /* glsl */ `
#ifdef FULLSCREEN_UV
out vec2 vUv;
#endif
void main() {
#ifdef FULLSCREEN_UV
  vUv = uv;
#endif
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** One shader drawn over the whole target with a single oversized triangle. The vertex shader passes `vUv` on only to a fragment shader that reads it, because Firefox warns about an output nothing reads. */
export class FullscreenPass {
  readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms,
      defines: /\bvUv\b/.test(fragmentShader) ? { FULLSCREEN_UV: 1, ...defines } : defines,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(triangle, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.material.dispose();
  }
}
