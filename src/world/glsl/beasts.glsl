// Large slow creatures: paper whales that cross the sky of every dry realm, and manta rays and
// jellyfish that drift through the Deep. Each follows a gently curving path wrapped into a box
// around the player, so none is stored and each is found again from its index every frame. The
// path maths is mirrored in src/world/cpu/beasts.ts.
//
// p0: whales, deep creatures, splats per creature K, spare
// p1: wrap box for whales, wrap box for deep creatures, spread, spare

const int BEAST_WHALE = 0;
const int BEAST_MANTA = 1;
const int BEAST_JELLY = 2;

const int WHALE_RINGS = 9;
const int WHALE_SIDES = 6;
const int WHALE_BODY_TRIS = (WHALE_RINGS - 1) * WHALE_SIDES * 2;

// Local space: z forward, y up, x to the left, body length 1.
float whaleRadius(float s) { return 0.125 * sin(3.14159265 * pow(clamp(s, 0.0, 1.0), 0.6)) * (1.0 - 0.3 * s); }

vec3 whaleRing(int ring, int side, float swim, float amp) {
  float s = float(ring) / float(WHALE_RINGS - 1);
  float a = (float(side) + 0.5) * 6.2831853 / float(WHALE_SIDES);
  float rad = whaleRadius(s);
  float y0 = amp * sin(6.2831853 * s * 0.8 - swim) * (0.1 + 0.9 * s * s) * 0.12;
  return vec3(cos(a) * rad, sin(a) * rad * 0.9 + y0, 0.5 - s * 0.95);
}

// part 0 body, 1 tail and dorsal fin, 2 pectoral fins. `up` is how far the facet looks up.
bool whaleTri(int tri, float swim, float amp, out vec3 A, out vec3 B, out vec3 C, out int part, out float up) {
  part = 0;
  up = 0.5;
  if (tri < WHALE_BODY_TRIS) {
    int g = tri / (WHALE_SIDES * 2);
    int rem = tri - g * WHALE_SIDES * 2;
    int q = rem / 2;
    int half_ = rem - q * 2;
    int q1 = (q + 1) % WHALE_SIDES;
    vec3 v00 = whaleRing(g, q, swim, amp);
    vec3 v01 = whaleRing(g, q1, swim, amp);
    vec3 v10 = whaleRing(g + 1, q, swim, amp);
    vec3 v11 = whaleRing(g + 1, q1, swim, amp);
    if (half_ == 0) { A = v00; B = v01; C = v10; } else { A = v01; B = v11; C = v10; }
    up = sin(float(q + 1) * 6.2831853 / float(WHALE_SIDES));
    return true;
  }
  float tail = amp * sin(6.2831853 * 0.8 - swim) * 0.12;
  float flick = amp * 0.1 * sin(swim - 1.2);
  vec3 root = vec3(0.0, tail, -0.44);
  vec3 notch = vec3(0.0, tail + flick * 0.4, -0.53);
  float flap = 0.06 * sin(swim * 0.5);
  switch (tri - WHALE_BODY_TRIS) {
    case 0: part = 1; A = root; B = vec3(0.21, tail + flick, -0.62); C = notch; return true;
    case 1: part = 1; A = root; B = notch; C = vec3(-0.21, tail + flick, -0.62); return true;
    case 2: part = 2; A = vec3(0.085, -0.03, 0.22); B = vec3(0.3, -0.13 + flap, 0.03); C = vec3(0.1, -0.05, 0.05); return true;
    case 3: part = 2; A = vec3(-0.085, -0.03, 0.22); B = vec3(-0.1, -0.05, 0.05); C = vec3(-0.3, -0.13 + flap, 0.03); return true;
    case 4: part = 1; A = vec3(0.0, 0.1, -0.02); B = vec3(0.0, 0.18, -0.16); C = vec3(0.0, 0.085, -0.21); return true;
    default: return false;
  }
}

// Local space: y up, bell radius 1. Eight triangles in the cap, sixteen in each of four bands,
// sixteen strands of three triangles.
const int JELLY_SIDES = 8;
const int JELLY_BELL_TRIS = JELLY_SIDES + 4 * JELLY_SIDES * 2;

vec3 jellyRing(int ring, int side, float pulse) {
  float phi = float(ring) * 0.36;
  float flare = ring == 5 ? 1.25 : 1.0;
  float a = float(side) * 6.2831853 / float(JELLY_SIDES);
  float rr = sin(phi) * (1.0 + 0.2 * pulse) * flare;
  float yy = cos(phi) * 0.8 * (1.0 - 0.25 * pulse) - (ring == 5 ? 0.06 : 0.0);
  return vec3(cos(a) * rr, yy, sin(a) * rr);
}

// part 0 bell, 1 strand, 2 oral arm.
bool jellyTri(int tri, float t, float pulse, float phase, out vec3 A, out vec3 B, out vec3 C, out int part, out float along) {
  part = 0;
  along = 0.0;
  if (tri < JELLY_SIDES) {
    A = vec3(0.0, 0.8 * (1.0 - 0.25 * pulse), 0.0);
    B = jellyRing(1, tri, pulse);
    C = jellyRing(1, (tri + 1) % JELLY_SIDES, pulse);
    return true;
  }
  if (tri < JELLY_BELL_TRIS) {
    int q = tri - JELLY_SIDES;
    int band = q / (2 * JELLY_SIDES);
    int rem = q - band * 2 * JELLY_SIDES;
    int s = rem / 2;
    int half_ = rem - s * 2;
    int s1 = (s + 1) % JELLY_SIDES;
    int r0 = 1 + band;
    vec3 v00 = jellyRing(r0, s, pulse);
    vec3 v01 = jellyRing(r0, s1, pulse);
    vec3 v10 = jellyRing(r0 + 1, s, pulse);
    vec3 v11 = jellyRing(r0 + 1, s1, pulse);
    if (half_ == 0) { A = v00; B = v01; C = v10; } else { A = v01; B = v11; C = v10; }
    along = float(band) * 0.25;
    return true;
  }
  int sq = tri - JELLY_BELL_TRIS;
  int strand = sq / 3;
  int seg = sq - strand * 3;
  if (strand >= 16) return false;
  bool arm = strand >= 12;
  part = arm ? 2 : 1;
  vec4 r = hash4i(uint(strand) + uint(phase * 100.0), 703u);
  float ang = (float(strand) + r.x * 0.6) * (arm ? 1.5707963 : 6.2831853 / 12.0) + (arm ? 0.78 : 0.0);
  float rad = arm ? 0.25 : 0.88;
  float len = arm ? 1.1 + 0.5 * r.y : 1.6 + 2.2 * r.y;
  float w = arm ? 0.11 : 0.035;
  vec3 root = vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
  vec3 side = vec3(-sin(ang), 0.0, cos(ang));
  float sw = 0.16 + 0.1 * r.z;
  vec3 p1 = root + vec3(sin(t * 0.9 + r.w * 6.0) * sw * 0.5, -len * 0.5, cos(t * 0.8 + r.z * 6.0) * sw * 0.5);
  vec3 p2 = root + vec3(sin(t * 1.1 + r.w * 6.0 - 1.0) * sw * 1.4, -len, cos(t * 0.9 + r.z * 6.0 - 1.0) * sw * 1.4);
  if (seg == 0) { A = root - side * w; B = root + side * w; C = p1 - side * w * 0.6; along = 0.0; }
  else if (seg == 1) { A = root + side * w; B = p1 + side * w * 0.6; C = p1 - side * w * 0.6; along = 0.3; }
  else { A = p1 - side * w * 0.6; B = p1 + side * w * 0.6; C = p2; along = 0.8; }
  return true;
}

float mantaFlap(float x, float swim) { return 0.17 * sin(swim - 3.2 * abs(x)) * abs(x); }

// Nine triangles, z forward, wing span about 1.3.
bool mantaTri(int tri, float swim, out vec3 A, out vec3 B, out vec3 C) {
  vec3 N = vec3(0.0, 0.0, 0.5);
  vec3 O = vec3(0.0, 0.035, 0.05);
  vec3 T = vec3(0.0, 0.0, -0.26);
  vec3 SL = vec3(0.3, mantaFlap(0.3, swim), 0.17);
  vec3 TL = vec3(0.66, mantaFlap(0.66, swim), -0.06);
  vec3 BL = vec3(0.32, mantaFlap(0.32, swim), -0.27);
  vec3 SR = vec3(-0.3, mantaFlap(-0.3, swim), 0.17);
  vec3 TR = vec3(-0.66, mantaFlap(-0.66, swim), -0.06);
  vec3 BR = vec3(-0.32, mantaFlap(-0.32, swim), -0.27);
  vec3 Q = vec3(0.0, 0.03 * sin(swim * 1.2), -0.95);
  switch (tri) {
    case 0: A = O; B = N; C = SL; return true;
    case 1: A = O; B = SL; C = TL; return true;
    case 2: A = O; B = TL; C = BL; return true;
    case 3: A = O; B = BL; C = T; return true;
    case 4: A = O; B = T; C = BR; return true;
    case 5: A = O; B = BR; C = TR; return true;
    case 6: A = O; B = TR; C = SR; return true;
    case 7: A = O; B = SR; C = N; return true;
    case 8: A = T + vec3(0.025, 0.0, 0.0); B = T - vec3(0.025, 0.0, 0.0); C = Q; return true;
    default: return false;
  }
}

bool layerGen(int index, sampler2D field, out Surfel s) {
  int nW = int(gL.p0.x + 0.5);
  int nD = int(gL.p0.y + 0.5);
  int K = int(gL.p0.z + 0.5);
  int slot = index / K;
  int j = index - slot * K;
  if (slot >= nW + nD) return false;

  vec3 pl = gW.feet.xyz;
  RealmMix rm = realmAt(pl.xz);
  vec4 f = hash4i(uint(slot), 700u);
  vec4 f2 = hash4i(uint(slot), 701u);
  int realm = f2.w < rm.t ? rm.b : rm.a;
  bool deepSlot = slot >= nW;
  if (deepSlot != (realm == REALM_DEEP)) return false;
  int kind = deepSlot ? ((slot - nW) % 2 == 0 ? BEAST_MANTA : BEAST_JELLY) : BEAST_WHALE;

  float t = gTime;
  float box = kind == BEAST_WHALE ? gL.p1.x : gL.p1.y;
  float ang = f.x * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 perp = vec2(-dir.y, dir.x);
  float speed = kind == BEAST_WHALE ? 6.0 + 5.0 * f.y : kind == BEAST_MANTA ? 3.0 + 4.0 * f.y : 0.8 + 1.4 * f.y;
  float amp = kind == BEAST_WHALE ? 160.0 + 300.0 * f2.y : kind == BEAST_MANTA ? 40.0 + 90.0 * f2.y : 8.0 + 20.0 * f2.y;
  float wv = kind == BEAST_WHALE ? 0.006 + 0.008 * f2.z : kind == BEAST_MANTA ? 0.02 + 0.03 * f2.z : 0.03 + 0.04 * f2.z;
  float phase = f2.z * 20.0;
  vec2 baseXZ = (vec2(f.z, f.w) - 0.5) * box;
  vec2 c = baseXZ + dir * speed * t + perp * amp * sin(wv * t + phase);
  vec2 vel = dir * speed + perp * amp * wv * cos(wv * t + phase);
  vec2 acc = -perp * amp * wv * wv * sin(wv * t + phase);

  vec2 rel = c - pl.xz;
  rel -= box * floor(rel / box + 0.5);
  float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(rel.x), abs(rel.y)) / box);
  if (edge <= 0.004) return false;
  vec2 cxz = pl.xz + rel;

  float size = kind == BEAST_WHALE ? 45.0 + 55.0 * f.w : kind == BEAST_MANTA ? 9.0 + 9.0 * f.w : 6.0 + 10.0 * f.w;
  float groundC = terrain(cxz, 120.0, realmAt(cxz));
  float alt = kind == BEAST_WHALE ? 70.0 + 170.0 * f.z + 14.0 * sin(t * 0.05 + phase)
            : kind == BEAST_MANTA ? 12.0 + 45.0 * f2.y + 4.0 * sin(t * 0.2 + phase)
            : 20.0 + 80.0 * f2.y + 6.0 * sin(t * 0.3 + phase);
  vec3 centre = vec3(cxz.x, groundC + alt, cxz.y);

  float rise = kind == BEAST_WHALE ? 0.1 * cos(t * 0.07 + phase) : 0.12 * cos(t * 0.11 + phase);
  vec3 fwd = normalize(vec3(vel.x, rise * length(vel), vel.y));
  vec3 X = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 Y = cross(fwd, X);
  float bank = clamp(dot(vec3(acc.x, 0.0, acc.y), X) * (kind == BEAST_WHALE ? 90.0 : 20.0), -0.5, 0.5);
  mat3 R = kind == BEAST_JELLY ? rotY(f.x * 6.2831853 + t * 0.05) * rotZ(0.12 * sin(t * 0.3 + phase)) : mat3(X, Y, fwd) * rotZ(bank);

  vec3 palA;
  vec3 palB;
  float emitK = 0.0;
  float tint = f2.x;
  if (kind == BEAST_WHALE) {
    if (realm == REALM_DUNES) { palA = vec3(1.0, 0.92, 0.8); palB = tint > 0.5 ? vec3(0.95, 0.5, 0.45) : vec3(0.35, 0.6, 0.7); }
    else if (realm == REALM_PRISM) { palA = vec3(0.08, 0.06, 0.2); palB = hsv2rgb(vec3(0.5 + 0.35 * tint, 0.75, 1.0)); emitK = 1.8; }
    else if (realm == REALM_FLATS) { palA = vec3(0.7, 0.78, 1.0); palB = vec3(0.95, 0.9, 1.0); emitK = 0.9; }
    else { palA = vec3(0.07, 0.045, 0.045); palB = vec3(1.0, 0.4, 0.1); emitK = 1.5; }
  } else if (kind == BEAST_MANTA) {
    palA = vec3(0.05, 0.12, 0.2);
    palB = tint > 0.5 ? vec3(0.5, 1.0, 0.95) : vec3(0.95, 0.6, 1.0);
    emitK = 0.9;
  } else {
    palA = tint > 0.5 ? vec3(0.3, 0.85, 1.0) : vec3(1.0, 0.45, 0.85);
    palB = tint > 0.5 ? vec3(0.65, 0.4, 1.0) : vec3(1.0, 0.85, 0.5);
    emitK = 1.6;
  }

  s = newSurfel();
  if (j == K - 1) {
    if (kind != BEAST_WHALE) return false;
    float sy = max(gW.sun.y, 0.28);
    vec3 L = normalize(vec3(gW.sun.x, 0.0, gW.sun.z) + vec3(0.0001));
    float height = centre.y - terrain(centre.xz, 60.0, realmAt(centre.xz));
    vec3 g = vec3(centre.x, centre.y - height, centre.z) - L * (height / sy);
    float gy = terrain(g.xz, 30.0, realmAt(g.xz));
    vec3 gp = vec3(g.x, gy + 0.3, g.z);
    s.pos = gp + normalize(gW.eye.xyz - gp) * 0.3;
    s.nrm = vec3(0.0, 1.0, 0.0);
    s.cov = outerProduct(L, L) * (size * size * 0.09) + outerProduct(vec3(-L.z, 0.0, L.x), vec3(-L.z, 0.0, L.x)) * (size * size * 0.03) + outerProduct(s.nrm, s.nrm) * 0.0004;
    s.albedo = vec3(0.0);
    s.lit = 0.0;
    s.opacity = 0.3 * exp(-height / 220.0) * edge;
    return s.opacity > 0.004;
  }

  int tri = j / 4;
  int k = j - tri * 4;
  float dist = length(centre - gW.eye.xyz);
  int nUse = (size / max(dist, 1.0)) > 0.05 ? 2 : 1;
  if (k >= nUse * nUse) return false;
  vec3 a, b, cc;
  int part = 0;
  float up = 0.5;
  float along = 0.0;
  bool ok;
  float swim = t * (kind == BEAST_WHALE ? 0.9 : 2.4) + phase;
  float pulse = 0.5 + 0.5 * sin(t * 1.4 + phase);
  if (kind == BEAST_WHALE) ok = whaleTri(tri, swim, 1.0, a, b, cc, part, up);
  else if (kind == BEAST_MANTA) ok = mantaTri(tri, swim, a, b, cc);
  else ok = jellyTri(tri, t, pulse, phase, a, b, cc, part, along);
  if (!ok) return false;
  a = centre + R * (a * size);
  b = centre + R * (b * size);
  cc = centre + R * (cc * size);
  if (dot(cross(b - a, cc - a), cross(b - a, cc - a)) < 1e-9) return false;
  s = triSurfel(a, b, cc, nUse, k, gL.p1.z, size * 0.004);
  float facet = u24(pcg(uint(tri) * 977u + uint(slot) * 131u));
  vec3 albedo;
  vec3 emit;
  float trans = 0.5;
  if (kind == BEAST_WHALE) {
    albedo = mix(palB, palA, smoothstep(-0.4, 0.5, up));
    if (part == 1) albedo = palA * 0.8;
    if (part == 2) albedo = mix(palB, palA, 0.3);
    emit = srgb2lin(palB) * emitK * (part == 0 ? 0.25 * (1.0 - smoothstep(-0.2, 0.4, up)) : 0.55);
    trans = 0.45;
  } else if (kind == BEAST_MANTA) {
    float lateral = abs(dot(s.pos - centre, R[0])) / (size * 0.66);
    albedo = mix(palA, palB, 0.08 + 0.3 * lateral);
    emit = srgb2lin(palB) * emitK * lateral * lateral;
  } else {
    albedo = part == 0 ? mix(palA, palB, 0.25 + 0.4 * along) : mix(palB, palA, along);
    emit = srgb2lin(mix(palA, palB, part == 0 ? 0.3 : along)) * emitK * (part == 0 ? 0.4 + 0.6 * pulse : 0.9 + along);
    trans = 0.8;
  }
  s.albedo = srgb2lin(albedo) * (0.85 + 0.3 * facet);
  s.emit = emit;
  s.trans = trans;
  s.opacity = (kind == BEAST_JELLY ? (part == 0 ? 0.8 : 0.9) : 1.0) * edge;
  return true;
}
