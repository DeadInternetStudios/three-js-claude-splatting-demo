// A flower opens where each footstep landed, glows, and folds away again. The steps live in a
// small float texture the game fills: row 0 holds (x, ground height, z, birth time), row 1 holds
// (realm * 2 + tint, scale, 0, 0). A slot nothing has written has a birth time far in the past.
//
// p0: slots in the ring, splats per bloom K, life in seconds, spread
// p1: spare

const int BLOOM_PETALS = 6;

float bloomOpen(float age) {
  float x = clamp(age / 1.7, 0.0, 1.0);
  float c = 1.70158;
  float y = x - 1.0;
  return 1.0 + (c + 1.0) * y * y * y + c * y * y;
}

bool bloomTri(int tri, float open, float S, float rot, out vec3 A, out vec3 B, out vec3 C, out float g, out bool core) {
  core = false;
  g = 0.0;
  if (tri >= BLOOM_PETALS * 3) {
    int q = tri - BLOOM_PETALS * 3;
    float a0 = float(q) * 1.0471976 + rot;
    float a1 = a0 + 1.0471976;
    float r = 0.13 * S;
    A = vec3(0.0, 0.05 * S, 0.0);
    B = vec3(cos(a0) * r, 0.03 * S, sin(a0) * r);
    C = vec3(cos(a1) * r, 0.03 * S, sin(a1) * r);
    core = true;
    return true;
  }
  int petal = tri / 3;
  int seg = tri - petal * 3;
  float th = rot + float(petal) * 1.0471976 + 0.2 * sin(float(petal) * 2.7);
  float beta = mix(1.38, 0.3, open);
  vec3 dir = vec3(cos(th) * cos(beta), sin(beta), sin(th) * cos(beta));
  vec3 side = vec3(-sin(th), 0.0, cos(th));
  float len = S * (0.3 + 0.7 * open);
  vec3 root = dir * 0.1 * len;
  vec3 mid = dir * 0.55 * len + vec3(0.0, 0.06 * len, 0.0);
  vec3 tip = dir * len - vec3(0.0, 0.08 * len * open, 0.0);
  float w0 = 0.07 * S;
  float wm = 0.2 * S * (0.5 + 0.5 * open);
  if (seg == 0) { A = root - side * w0; B = root + side * w0; C = mid - side * wm; g = 0.1; }
  else if (seg == 1) { A = root + side * w0; B = mid + side * wm; C = mid - side * wm; g = 0.4; }
  else { A = mid - side * wm; B = mid + side * wm; C = tip; g = 0.85; }
  return true;
}

void bloomColors(int realm, float tint, out vec3 c0, out vec3 c1, out float emitK) {
  if (realm == REALM_DUNES) {
    c0 = vec3(1.0, 0.8, 0.55);
    c1 = tint > 0.5 ? vec3(1.0, 0.55, 0.5) : vec3(1.0, 0.95, 0.8);
    emitK = 1.1;
  } else if (realm == REALM_PRISM) {
    c0 = vec3(0.1, 0.05, 0.3);
    c1 = hsv2rgb(vec3(0.45 + 0.4 * tint, 0.8, 1.0));
    emitK = 2.4;
  } else if (realm == REALM_DEEP) {
    c0 = vec3(0.1, 0.5, 0.6);
    c1 = tint > 0.5 ? vec3(1.0, 0.6, 0.9) : vec3(0.5, 1.0, 0.9);
    emitK = 1.8;
  } else if (realm == REALM_FLATS) {
    c0 = vec3(0.6, 0.65, 0.95);
    c1 = vec3(1.0, 0.9, 1.0);
    emitK = 1.6;
  } else {
    c0 = vec3(0.6, 0.15, 0.04);
    c1 = tint > 0.5 ? vec3(1.0, 0.75, 0.25) : vec3(1.0, 0.4, 0.12);
    emitK = 2.2;
  }
}

bool layerGen(int index, sampler2D field, out Surfel s) {
  int slots = int(gL.p0.x + 0.5);
  int K = int(gL.p0.y + 0.5);
  float life = gL.p0.z;
  int slot = index / K;
  int j = index - slot * K;
  if (slot >= slots) return false;
  vec4 a = texelFetch(field, ivec2(slot, 0), 0);
  float age = gTime - a.w;
  if (age < 0.0 || age > life) return false;
  vec4 b = texelFetch(field, ivec2(slot, 1), 0);
  int realm = int(floor(b.x * 0.5));
  float tint = b.x - 2.0 * float(realm);
  vec4 r = hash4i(uint(slot) * 7u + uint(a.w * 10.0), 760u);

  float wilt = smoothstep(life * 0.62, life, age);
  float open = bloomOpen(age);
  float S = b.y * (0.5 + 0.35 * r.x) * mix(1.0, 0.45, wilt);
  float rot = r.y * 6.2831853;
  int tri = j / 4;
  int k = j - tri * 4;
  float dist = length(a.xyz - gW.eye.xyz);
  int nUse = dist < 14.0 ? 2 : 1;
  if (k >= nUse * nUse) return false;
  vec3 A, B, C;
  float g;
  bool core;
  if (!bloomTri(tri, open, S, rot, A, B, C, g, core)) return false;
  vec3 o = a.xyz + vec3(0.0, 0.02, 0.0);
  A += o;
  B += o;
  C += o;
  s = triSurfel(A, B, C, nUse, k, gL.p0.w, S * 0.01);
  vec3 c0, c1;
  float emitK;
  bloomColors(realm, tint, c0, c1, emitK);
  float breathe = 1.0 + 0.2 * sin(gTime * 2.0 + r.z * 6.0);
  float glow = (1.0 - wilt) * breathe * smoothstep(0.0, 0.3, age);
  if (core) {
    s.albedo = srgb2lin(vec3(1.0, 0.9, 0.6));
    s.emit = srgb2lin(vec3(1.0, 0.85, 0.5)) * 2.4 * glow;
  } else {
    s.albedo = srgb2lin(mix(c0, c1, g)) * (0.9 + 0.2 * r.w);
    s.emit = srgb2lin(c1) * emitK * (0.25 + 0.75 * g) * glow;
  }
  s.trans = 0.6;
  s.opacity = 1.0 - 0.7 * wilt;
  s.shadow = 1.0;
  return true;
}
