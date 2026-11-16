import * as THREE from "three";
import { FullscreenPass } from "./fullscreen.ts";
import type { GradeParams } from "./grade.ts";

const LEVELS = 7;
/** A flash of 1 raises the exposure by this many stops, on top of a stronger glow and a slight lift. */
const FLASH_STOPS = 2.5;
const FLASH_GLOW = 3;
const LEVEL_WEIGHTS = [0.5, 0.65, 0.85, 1.0, 0.9, 0.7, 0.5];

const DOWN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uKaris;
uniform float uPreGain;
uniform float uClamp;
in vec2 vUv;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 tap(vec2 o) { return min(texture(tSrc, vUv + uTexel * o).rgb * uPreGain, vec3(uClamp)); }
void main() {
  vec3 a = tap(vec2(-2.0, -2.0)), b = tap(vec2(0.0, -2.0)), c = tap(vec2(2.0, -2.0));
  vec3 d = tap(vec2(-2.0, 0.0)), e = tap(vec2(0.0, 0.0)), f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, 2.0)), h = tap(vec2(0.0, 2.0)), i = tap(vec2(2.0, 2.0));
  vec3 j = tap(vec2(-1.0, -1.0)), k = tap(vec2(1.0, -1.0));
  vec3 l = tap(vec2(-1.0, 1.0)), m = tap(vec2(1.0, 1.0));
  vec3 outc;
  if (uKaris > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25;
    vec3 g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25;
    vec3 g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = 0.125 / (1.0 + luma(g0));
    float w1 = 0.125 / (1.0 + luma(g1));
    float w2 = 0.125 / (1.0 + luma(g2));
    float w3 = 0.125 / (1.0 + luma(g3));
    float w4 = 0.5 / (1.0 + luma(g4));
    outc = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    outc = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(outc, 1.0);
}`;

const UP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexelLow;
uniform float uWeight;
uniform vec3 uTint;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 t = uTexelLow;
  vec3 s = texture(tLow, vUv + vec2(-t.x, t.y)).rgb + texture(tLow, vUv + vec2(t.x, t.y)).rgb
         + texture(tLow, vUv + vec2(-t.x, -t.y)).rgb + texture(tLow, vUv + vec2(t.x, -t.y)).rgb;
  s += 2.0 * (texture(tLow, vUv + vec2(0.0, t.y)).rgb + texture(tLow, vUv + vec2(0.0, -t.y)).rgb
            + texture(tLow, vUv + vec2(-t.x, 0.0)).rgb + texture(tLow, vUv + vec2(t.x, 0.0)).rgb);
  s += 4.0 * texture(tLow, vUv).rgb;
  s /= 16.0;
  fragColor = vec4(s + texture(tHigh, vUv).rgb * uWeight * uTint, 1.0);
}`;

// Light shafts. Every pixel marches toward the sun on screen and gathers the glow of the sky near
// it, so the glow leaks out through gaps and past edges in rays. The start is jittered per pixel
// and the grain hides the banding.
const SHAFT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uSun;
uniform float uAspect;
uniform float uFrame;
in vec2 vUv;
out vec4 fragColor;
const int STEPS = 40;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 step_ = (uSun - vUv) * (0.94 / float(STEPS));
  vec2 uv = vUv + step_ * hash(gl_FragCoord.xy + uFrame * 7.13);
  vec3 acc = vec3(0.0);
  float weight = 1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 c = texture(tSrc, uv).rgb;
    float near = 1.0 - smoothstep(0.16, 0.6, length((uv - uSun) * vec2(uAspect, 1.0)));
    acc += max(c - 0.4, vec3(0.0)) * near * weight;
    weight *= 0.955;
    uv += step_;
  }
  fragColor = vec4(acc / float(STEPS), 1.0);
}`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tHdr;
uniform sampler2D tBloom;
uniform sampler2D tTitle;
uniform sampler2D tShaft;
uniform sampler2D tProbe;
uniform vec2 uHdrTexel;
uniform vec2 uRes;
uniform vec3 uSun;
uniform vec3 uSunTint;
uniform float uExposure, uBloom, uContrast, uSaturation, uVignette, uGrain, uAberration;
uniform float uLift, uFade, uFlash, uFrame, uSplit, uTitle, uShafts, uFlare;
uniform vec3 uShadowTint, uHighlightTint;
in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 sampleHdr(vec2 uv) {
#if SS > 1
  vec3 acc = vec3(0.0);
  for (int y = 0; y < SS; y++) {
    for (int x = 0; x < SS; x++) {
      vec2 o = (vec2(float(x), float(y)) + 0.5 - 0.5 * float(SS)) * uHdrTexel;
      acc += texture(tHdr, uv + o).rgb;
    }
  }
  return acc / float(SS * SS);
#else
  return texture(tHdr, uv).rgb;
#endif
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 scurve(vec3 c, float k) {
  vec3 lo = 0.5 * pow(2.0 * c, vec3(k));
  vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - c), vec3(k));
  return mix(lo, hi, step(0.5, c));
}

vec3 toSrgb(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// The sun as a lens sees it: soft ghosts mirrored through the middle of the frame and a thin
// streak across the sun. It shows only while the sun is in view and something bright sits on it,
// so a spire in front of the sun puts it out.
vec3 lensFlare(vec2 uv) {
  float edge = max(abs(uSun.x - 0.5), abs(uSun.y - 0.5));
  float inView = (1.0 - smoothstep(0.5, 0.8, edge)) * uSun.z;
  if (inView < 0.002) return vec3(0.0);
  vec2 q = clamp(uSun.xy, 0.0, 1.0);
  vec2 e = vec2(0.012, 0.0);
  float glow = max(max(luma(texture(tProbe, q).rgb), luma(texture(tProbe, q + e.xy).rgb)), max(luma(texture(tProbe, q - e.xy).rgb), max(luma(texture(tProbe, q + e.yx * 1.78).rgb), luma(texture(tProbe, q - e.yx * 1.78).rgb))));
  float amount = inView * smoothstep(0.7, 3.0, glow);
  if (amount < 0.002) return vec3(0.0);
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (uv - 0.5) * asp;
  vec2 s = (uSun.xy - 0.5) * asp;
  vec3 f = vec3(0.0);
  const float K[5] = float[5](-0.35, 0.3, -0.85, 0.65, -1.5);
  const float R[5] = float[5](0.05, 0.085, 0.035, 0.06, 0.13);
  const vec3 C[5] = vec3[5](vec3(1.0, 0.6, 0.35), vec3(0.4, 0.7, 1.0), vec3(0.6, 1.0, 0.75), vec3(1.0, 0.5, 0.9), vec3(0.5, 0.6, 1.0));
  for (int i = 0; i < 5; i++) {
    float d = length(p - s * K[i]) / R[i];
    float ring = (1.0 - smoothstep(0.7, 1.0, d)) * (0.35 + 0.65 * smoothstep(0.25, 0.95, d));
    f += C[i] * ring * 0.22;
  }
  float streak = exp(-abs(p.y - s.y) * 150.0) * exp(-abs(p.x - s.x) * 2.4);
  f += vec3(0.35, 0.55, 1.0) * streak * 0.5;
  return f * mix(vec3(1.0), uSunTint, 0.5) * amount;
}

void main() {
  vec2 d = vUv - 0.5;
  d.x *= uRes.x / uRes.y;
  float r2 = dot(d, d);
  vec2 off = (vUv - 0.5) * (uAberration * r2 * 4.0);
  vec3 col;
  col.r = sampleHdr(vUv + off).r;
  col.g = sampleHdr(vUv).g;
  col.b = sampleHdr(vUv - off).b;
  col *= exp2(uExposure);
  col += texture(tBloom, vUv).rgb * uBloom;
  col += texture(tShaft, vUv).rgb * uShafts;
  if (uFlare > 0.0) col += lensFlare(vUv) * uFlare;
  col += uFlash * 0.18 * vec3(1.0, 0.96, 0.9);
  col *= 1.0 - uVignette * smoothstep(0.12, 0.85, r2);

  float lum0 = luma(col);
  col = mix(vec3(lum0), col, 1.0 / (1.0 + lum0 * 0.04));
  col = aces(col);
  col = scurve(col, uContrast);

  float lum = luma(col);
  vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.05, 0.85, lum));
  col *= mix(vec3(1.0), tint, uSplit);
  col = mix(vec3(luma(col)), col, uSaturation);
  col = col * (1.0 - uLift) + uLift * vec3(0.55, 0.62, 0.75);

  col *= uFade;

  vec4 t = texture(tTitle, vUv);
  col = mix(col, t.rgb, t.a * uTitle);

  col = toSrgb(clamp(col, 0.0, 1.0));
  vec2 px = floor(vUv * uRes);
  float lumS = luma(col);
  float n = hash(px + uFrame * vec2(17.13, 31.71)) + hash(px.yx + uFrame * vec2(5.31, 11.17)) - 1.0;
  col += n * uGrain * uFade * (1.0 - smoothstep(0.65, 1.0, lumS)) * (0.55 + 0.45 * (1.0 - lumS)) * (1.0 - t.a * uTitle);
  float dn = hash(px + 91.7 + uFrame * 3.1) - hash(px + 13.3 + uFrame * 7.7);
  col += dn / 255.0;
  fragColor = vec4(col, 1.0);
}`;

function makeTarget(width: number, height: number, type: THREE.TextureDataType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.NoColorSpace,
  });
}

export interface PostOptions {
  width: number;
  height: number;
  /** The HDR input is this many times larger than the output in each direction (1 to 3). */
  supersample?: number;
}

/**
 * HDR to display pipeline: dual-filter bloom with halation, then a filmic resolve with grade,
 * aberration, vignette, grain and dither. Input must be linear light.
 */
export class CinematicPost {
  width: number;
  height: number;
  readonly supersample: number;
  readonly output: THREE.WebGLRenderTarget;
  readonly titleTexture: THREE.CanvasTexture;
  readonly titleCanvas: HTMLCanvasElement;

  /** Where the sun is on screen as (u, v, how far in front of the camera it is from 0 to 1). The world sets it each frame. */
  readonly sun = new THREE.Vector3(0.5, 0.5, 0);
  readonly sunTint = new THREE.Vector3(1, 1, 1);

  private readonly down: THREE.WebGLRenderTarget[] = [];
  private readonly up: THREE.WebGLRenderTarget[] = [];
  private readonly shaftTarget: THREE.WebGLRenderTarget;
  private readonly downPass: FullscreenPass;
  private readonly upPass: FullscreenPass;
  private readonly shaftPass: FullscreenPass;
  private readonly finalPass: FullscreenPass;
  private readBuffer: Uint8Array;

  constructor(private readonly renderer: THREE.WebGLRenderer, options: PostOptions) {
    this.width = options.width;
    this.height = options.height;
    this.supersample = options.supersample ?? 1;
    const inW = this.width * this.supersample;
    const inH = this.height * this.supersample;
    let w = Math.max(2, Math.floor(inW / 2));
    let h = Math.max(2, Math.floor(inH / 2));
    for (let i = 0; i < LEVELS; i++) {
      this.down.push(makeTarget(w, h, THREE.HalfFloatType));
      this.up.push(makeTarget(w, h, THREE.HalfFloatType));
      w = Math.max(2, Math.floor(w / 2));
      h = Math.max(2, Math.floor(h / 2));
    }
    this.shaftTarget = makeTarget(this.down[1]!.width, this.down[1]!.height, THREE.HalfFloatType);
    this.output = makeTarget(this.width, this.height, THREE.UnsignedByteType);
    this.readBuffer = new Uint8Array(this.width * this.height * 4);

    this.titleCanvas = document.createElement("canvas");
    this.titleCanvas.width = this.width;
    this.titleCanvas.height = this.height;
    this.titleTexture = new THREE.CanvasTexture(this.titleCanvas);
    this.titleTexture.colorSpace = THREE.NoColorSpace;
    this.titleTexture.minFilter = THREE.LinearFilter;
    this.titleTexture.generateMipmaps = false;

    this.downPass = new FullscreenPass(DOWN_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uKaris: { value: 0 },
      uPreGain: { value: 1 },
      uClamp: { value: 1e9 },
    });
    this.upPass = new FullscreenPass(UP_FRAG, {
      tLow: { value: null },
      tHigh: { value: null },
      uTexelLow: { value: new THREE.Vector2() },
      uWeight: { value: 1 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.shaftPass = new FullscreenPass(SHAFT_FRAG, {
      tSrc: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: this.width / this.height },
      uFrame: { value: 0 },
    });
    this.finalPass = new FullscreenPass(
      FINAL_FRAG,
      {
        tHdr: { value: null },
        tBloom: { value: null },
        tShaft: { value: null },
        tProbe: { value: null },
        tTitle: { value: this.titleTexture },
        uSun: { value: this.sun },
        uSunTint: { value: this.sunTint },
        uShafts: { value: 0 },
        uFlare: { value: 0 },
        uHdrTexel: { value: new THREE.Vector2(1 / inW, 1 / inH) },
        uRes: { value: new THREE.Vector2(this.width, this.height) },
        uExposure: { value: 0 },
        uBloom: { value: 0 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uVignette: { value: 0 },
        uGrain: { value: 0 },
        uAberration: { value: 0 },
        uLift: { value: 0 },
        uFade: { value: 1 },
        uFlash: { value: 0 },
        uFrame: { value: 0 },
        uSplit: { value: 0 },
        uTitle: { value: 0 },
        uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
        uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
      },
      { SS: this.supersample },
    );
  }

  /** Changes the output size. The HDR input must be resized to match by the caller. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const inW = width * this.supersample;
    const inH = height * this.supersample;
    let w = Math.max(2, Math.floor(inW / 2));
    let h = Math.max(2, Math.floor(inH / 2));
    for (let i = 0; i < LEVELS; i++) {
      this.down[i]!.setSize(w, h);
      this.up[i]!.setSize(w, h);
      w = Math.max(2, Math.floor(w / 2));
      h = Math.max(2, Math.floor(h / 2));
    }
    this.shaftTarget.setSize(this.down[1]!.width, this.down[1]!.height);
    this.shaftPass.material.uniforms.uAspect!.value = width / height;
    this.output.setSize(width, height);
    this.readBuffer = new Uint8Array(width * height * 4);
    this.titleCanvas.width = width;
    this.titleCanvas.height = height;
    // three allocates a texture's storage once, so a canvas of a new size needs a new texture.
    this.titleTexture.dispose();
    const fp = this.finalPass.material.uniforms;
    (fp.uHdrTexel!.value as THREE.Vector2).set(1 / inW, 1 / inH);
    (fp.uRes!.value as THREE.Vector2).set(width, height);
  }

  titleChanged(): void {
    this.titleTexture.needsUpdate = true;
  }

  /**
   * Runs bloom and the resolve. Pass `null` to draw to the canvas, otherwise the result lands in
   * `output` and can be read back with `read()`.
   */
  render(hdr: THREE.Texture, grade: GradeParams, title = 0, toScreen = false): void {
    const { renderer } = this;
    const dp = this.downPass.material.uniforms;
    let src: THREE.Texture = hdr;
    let srcW = this.width * this.supersample;
    let srcH = this.height * this.supersample;
    for (let i = 0; i < LEVELS; i++) {
      dp.tSrc!.value = src;
      (dp.uTexel!.value as THREE.Vector2).set(1 / srcW, 1 / srcH);
      dp.uKaris!.value = i === 0 ? 1 : 0;
      dp.uPreGain!.value = i === 0 ? 2 ** (grade.exposure + FLASH_STOPS * grade.flash) : 1;
      dp.uClamp!.value = i === 0 ? grade.bloomClamp : 1e9;
      const target = this.down[i]!;
      this.downPass.render(renderer, target);
      src = target.texture;
      srcW = target.width;
      srcH = target.height;
    }

    const up = this.upPass.material.uniforms;
    const spread = grade.bloomSpread;
    let low: THREE.Texture = this.down[LEVELS - 1]!.texture;
    let lowTarget = this.down[LEVELS - 1]!;
    for (let i = LEVELS - 2; i >= 0; i--) {
      const target = this.up[i]!;
      up.tLow!.value = low;
      up.tHigh!.value = this.down[i]!.texture;
      (up.uTexelLow!.value as THREE.Vector2).set(1 / lowTarget.width, 1 / lowTarget.height);
      const depth = i / (LEVELS - 1);
      const wide = THREE.MathUtils.lerp(1.4 - depth * 1.2, 0.5 + depth * 1.1, spread);
      up.uWeight!.value = LEVEL_WEIGHTS[i]! * wide * 0.35;
      const warm = grade.halation * depth * depth;
      (up.uTint!.value as THREE.Vector3).set(1 + 0.5 * warm, 1 - 0.35 * warm, 1 - 0.8 * warm);
      this.upPass.render(renderer, target);
      low = target.texture;
      lowTarget = target;
    }

    const shafts = grade.shafts * this.sun.z;
    if (shafts > 0.002) {
      const sp = this.shaftPass.material.uniforms;
      sp.tSrc!.value = this.down[1]!.texture;
      (sp.uSun!.value as THREE.Vector2).set(this.sun.x, this.sun.y);
      sp.uFrame!.value = grade.frame % 997;
      this.shaftPass.render(renderer, this.shaftTarget);
    }

    const fp = this.finalPass.material.uniforms;
    fp.tHdr!.value = hdr;
    fp.tBloom!.value = low;
    fp.tShaft!.value = shafts > 0.002 ? this.shaftTarget.texture : low;
    fp.tProbe!.value = this.down[1]!.texture;
    fp.uShafts!.value = shafts > 0.002 ? shafts : 0;
    fp.uFlare!.value = grade.flare;
    fp.uExposure!.value = grade.exposure + FLASH_STOPS * grade.flash;
    fp.uBloom!.value = grade.bloom * (1 + FLASH_GLOW * grade.flash);
    fp.uContrast!.value = grade.contrast;
    fp.uSaturation!.value = grade.saturation;
    fp.uVignette!.value = grade.vignette;
    fp.uGrain!.value = grade.grain;
    fp.uAberration!.value = grade.aberration;
    fp.uLift!.value = grade.lift;
    fp.uFade!.value = grade.fade;
    fp.uFlash!.value = grade.flash;
    fp.uFrame!.value = grade.frame % 997;
    fp.uSplit!.value = grade.split;
    fp.uTitle!.value = title;
    (fp.uShadowTint!.value as THREE.Vector3).set(...grade.shadowTint);
    (fp.uHighlightTint!.value as THREE.Vector3).set(...grade.highlightTint);
    this.finalPass.render(renderer, toScreen ? null : this.output);
  }

  /** Reads the last resolved frame as RGBA bytes, top row first. */
  read(): Uint8Array {
    this.renderer.readRenderTargetPixels(this.output, 0, 0, this.width, this.height, this.readBuffer);
    const stride = this.width * 4;
    const flipped = new Uint8Array(this.readBuffer.length);
    for (let y = 0; y < this.height; y++) {
      flipped.set(this.readBuffer.subarray((this.height - 1 - y) * stride, (this.height - y) * stride), y * stride);
    }
    return flipped;
  }

  dispose(): void {
    for (const t of [...this.down, ...this.up, this.shaftTarget, this.output]) t.dispose();
    this.titleTexture.dispose();
    this.downPass.dispose();
    this.upPass.dispose();
    this.shaftPass.dispose();
    this.finalPass.dispose();
  }
}
