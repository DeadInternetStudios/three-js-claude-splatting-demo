// Giant structures, one to a coarse cell, drawn from the same hash the CPU twin in
// src/world/wonders.ts uses to name them. The realm at the cell picks the kind, and each kind is a
// handful of triangles worked out from the splat index. The tables come from wonders.ts.
//
// p0: cell size, cells per side, window corner (cell units)
// p1: outer radius, fade band, splats per wonder K, spare
// p2: player x, player z, spread, spare
// p3: density, spare, spare, spare

float groundAt(vec2 xz) { return terrain(xz, 30.0, realmAt(xz)); }

vec3 neonOf(float t) {
  return t < 0.3 ? vec3(0.1, 0.85, 1.0) : t < 0.6 ? vec3(0.95, 0.2, 0.85) : t < 0.85 ? vec3(0.5, 1.0, 0.35) : vec3(1.0, 0.7, 0.2);
}

void wonderColors(int realm, int kind, vec4 r, out vec3 c0, out vec3 c1, out float emitK) {
  c0 = vec3(0.3);
  c1 = vec3(0.7);
  emitK = 0.0;
  if (realm == REALM_DUNES) {
    c0 = vec3(0.42, 0.18, 0.3);
    c1 = vec3(1.0, 0.78, 0.5);
    if (kind == WONDER_SPIRES) { c0 = vec3(0.62, 0.3, 0.44); c1 = vec3(1.0, 0.94, 0.84); }
    if (kind == WONDER_ISLES) { c0 = vec3(0.45, 0.24, 0.32); c1 = vec3(0.98, 0.66, 0.46); }
  } else if (realm == REALM_PRISM) {
    c0 = vec3(0.03, 0.025, 0.1);
    c1 = neonOf(r.z);
    emitK = kind == WONDER_GATE ? 2.8 : 1.9;
  } else if (realm == REALM_DEEP) {
    c0 = vec3(0.12, 0.2, 0.22);
    c1 = vec3(0.8, 0.9, 0.78);
    emitK = 0.35;
    if (kind == WONDER_ISLES) { c0 = vec3(0.35, 0.12, 0.3); c1 = vec3(1.0, 0.55, 0.45); emitK = 0.5; }
  } else if (realm == REALM_FLATS) {
    c0 = vec3(0.3, 0.36, 0.55);
    c1 = vec3(0.85, 0.9, 1.0);
    emitK = kind == WONDER_GATE ? 2.2 : 0.35;
  } else {
    c0 = vec3(0.04, 0.03, 0.035);
    c1 = vec3(0.4, 0.11, 0.06);
    emitK = kind == WONDER_ISLES ? 1.6 : kind == WONDER_ARCH ? 0.25 : 0.8;
  }
  if (kind == WONDER_CRANE || kind == WONDER_BOAT) {
    // c0 is the paper, c1 the colour the wing tips and head of a crane or the sail of a boat take on.
    if (realm == REALM_DUNES) { c0 = vec3(0.9, 0.85, 0.78); c1 = vec3(1.0, 0.42, 0.36); emitK = 0.0; }
    else if (realm == REALM_PRISM) { c0 = vec3(0.05, 0.04, 0.12); c1 = neonOf(r.z); emitK = 2.2; }
    else if (realm == REALM_DEEP) { c0 = vec3(0.72, 0.86, 0.8); c1 = vec3(0.3, 0.95, 0.85); emitK = 0.7; }
    else if (realm == REALM_FLATS) { c0 = vec3(0.88, 0.92, 1.0); c1 = vec3(0.5, 0.68, 1.0); emitK = 0.35; }
    else { c0 = vec3(0.07, 0.055, 0.05); c1 = vec3(1.0, 0.3, 0.06); emitK = 1.7; }
  }
}

// The tops of floating isles: grass, crystal or glow, by realm.
void isleTop(int realm, vec4 r, out vec3 a, out vec3 b, out float emitK) {
  emitK = 0.0;
  a = vec3(0.1, 0.35, 0.3);
  b = vec3(0.55, 0.9, 0.55);
  if (realm == REALM_DUNES) { a = vec3(0.08, 0.3, 0.32); b = vec3(0.55, 0.9, 0.65); }
  else if (realm == REALM_PRISM) { a = vec3(0.04, 0.03, 0.1); b = neonOf(fract(r.z + 0.4)); emitK = 2.0; }
  else if (realm == REALM_DEEP) { a = vec3(0.5, 0.15, 0.3); b = vec3(1.0, 0.6, 0.5); emitK = 1.2; }
  else if (realm == REALM_FLATS) { a = vec3(0.5, 0.55, 0.8); b = vec3(1.0, 0.8, 0.95); emitK = 1.0; }
  else { a = vec3(0.1, 0.04, 0.03); b = vec3(1.0, 0.45, 0.12); emitK = 1.8; }
}

bool wonderArch(Inst I, int tri, vec3 c0, vec3 c1, float emitK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  float H = I.size;
  float rx = 0.6 * H;
  float ry = 0.9 * H;
  float left = groundAt(I.pos.xz + (I.rot * vec3(-rx, 0.0, 0.0)).xz);
  float right = groundAt(I.pos.xz + (I.rot * vec3(rx, 0.0, 0.0)).xz);
  I.pos.y = min(left, right) - 0.03 * H;
  return primArch(I, tri, 28, vec2(rx, ry), vec2(-0.14, 3.2816), 0.1 * H, 0.14 * H, 0.9, c0, c1, emitK, 0.3, A, B, C, m);
}

// A full ring with a shimmering veil in it. Veil triangles come last and show only their glow.
const int GATE_SEGS = 36;
const int GATE_VEIL = 24;

bool wonderGate(Inst I, int realm, int tri, vec3 c0, vec3 c1, float emitK, out vec3 A, out vec3 B, out vec3 C, out Mat m, out float lit) {
  lit = 1.0;
  float R = 0.5 * I.size;
  I.pos.y += 0.44 * I.size;
  I.rot = I.rot * rotZ((I.r.w - 0.5) * 0.25);
  if (tri < GATE_SEGS * 8) return primArch(I, tri, GATE_SEGS, vec2(R), vec2(0.0, 6.2831853), 0.075 * I.size, 0.1 * I.size, 0.0, c0, c1, emitK, 0.2, A, B, C, m);
  int q = tri - GATE_SEGS * 8;
  if (q >= GATE_VEIL) return false;
  float a0 = float(q) * 6.2831853 / float(GATE_VEIL);
  float a1 = float(q + 1) * 6.2831853 / float(GATE_VEIL);
  float rr = R * 0.93;
  A = toWorld(I, vec3(0.0));
  B = toWorld(I, vec3(cos(a0) * rr, sin(a0) * rr, 0.0));
  C = toWorld(I, vec3(cos(a1) * rr, sin(a1) * rr, 0.0));
  m = newMat();
  float hue = realm == REALM_PRISM ? fract(0.5 + 0.35 * sin(gTime * 0.15 + float(q) * 0.2) + I.r.z * 0.3) : realm == REALM_FLATS ? 0.62 : realm == REALM_EMBER ? 0.04 : 0.1;
  float shimmer = 0.6 + 0.4 * sin(gTime * 1.3 + float(q) * 1.7);
  // The veil thins out as the viewer nears the ring, so flying through it shows what lies beyond.
  float near = smoothstep(0.1 * R, 1.3 * R, length(gW.eye.xyz - toWorld(I, vec3(0.0))));
  m.emit = srgb2lin(hsv2rgb(vec3(hue, 0.55, 1.0))) * (0.5 + 0.7 * shimmer) * near;
  m.opacity = 0.2 * near;
  lit = 0.0;
  return true;
}

const int RIBS_COUNT = 7;
const int RIBS_SEGS = 9;

bool wonderRibs(Inst I, int tri, vec3 c0, vec3 c1, float emitK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  int per = RIBS_SEGS * 8;
  int k = tri / per;
  if (k >= RIBS_COUNT) return false;
  int local = tri - k * per;
  float H = I.size;
  float fk = (float(k) + 0.5) / float(RIBS_COUNT);
  float prof = pow(sin(3.14159 * (0.1 + 0.8 * fk)), 0.75);
  float along = (fk - 0.5) * H * 2.7;
  float bend = sin(fk * 3.0 + I.r.x * 6.0) * H * 0.3;
  float rx = 0.5 * H * prof;
  I.pos += I.rot * vec3(bend, 0.0, along);
  float left = groundAt(I.pos.xz + (I.rot * vec3(-rx, 0.0, 0.0)).xz);
  float right = groundAt(I.pos.xz + (I.rot * vec3(rx, 0.0, 0.0)).xz);
  I.pos.y = min(left, right) - 0.1 * H * prof;
  I.seed += uint(k) * 7001u;
  return primArch(I, local, RIBS_SEGS, vec2(rx, 1.0 * H * prof), vec2(-0.1, 3.2416), 0.055 * H, 0.05 * H, 0.5, c0, c1, emitK, 0.2, A, B, C, m);
}

// A paper crane at rest with its wings raised, folded from flat triangles in units of the half
// wingspan. Vertices below CRANE_BODY_VERTS are the body, neck, head and tail. The rest are the
// right wing, which the left wing mirrors.
const int CRANE_TRIS = 28;
const int CRANE_BODY_VERTS = 17;
// Splats along one side of the finest patch a triangle of a crane or a boat takes, and how far splats overlap.
const int PAPER_PATCH = 10;
const float PAPER_SPREAD = 2.0;
const vec3 CRANE_V[23] = vec3[23](
  vec3(0.0, 0.14, 0.42), vec3(0.0, 0.14, -0.42), vec3(-0.2, 0.28, 0.0), vec3(0.2, 0.28, 0.0), vec3(0.0, 0.44, 0.0), vec3(0.0, 0.0, 0.0),
  vec3(-0.06, 0.18, 0.37), vec3(0.06, 0.18, 0.37), vec3(0.0, 0.46, 0.55), vec3(0.0, 0.9, 0.58),
  vec3(-0.045, 0.8, 0.66), vec3(0.045, 0.8, 0.66), vec3(0.0, 0.72, 0.9),
  vec3(-0.06, 0.18, -0.37), vec3(0.06, 0.18, -0.37), vec3(0.0, 0.4, -0.56), vec3(0.0, 0.72, -0.84),
  vec3(0.12, 0.36, 0.3), vec3(0.12, 0.36, -0.3), vec3(0.55, 0.66, 0.18), vec3(1.0, 0.98, -0.2), vec3(0.58, 0.56, -0.4), vec3(0.5, 0.52, -0.08));

// Three vertex indices and the side of the body: 0 for the middle, 1 for the right wing, -1 for the left.
const ivec4 CRANE_F[CRANE_TRIS] = ivec4[CRANE_TRIS](
  ivec4(0, 2, 4, 0), ivec4(0, 4, 3, 0), ivec4(1, 4, 2, 0), ivec4(1, 3, 4, 0),
  ivec4(0, 5, 2, 0), ivec4(0, 3, 5, 0), ivec4(1, 2, 5, 0), ivec4(1, 5, 3, 0),
  ivec4(6, 8, 7, 0), ivec4(6, 9, 8, 0), ivec4(8, 9, 7, 0), ivec4(7, 9, 6, 0),
  ivec4(9, 10, 12, 0), ivec4(9, 12, 11, 0),
  ivec4(13, 14, 15, 0), ivec4(13, 15, 16, 0), ivec4(15, 14, 16, 0), ivec4(14, 13, 16, 0),
  ivec4(17, 19, 22, 1), ivec4(19, 20, 22, 1), ivec4(22, 20, 21, 1), ivec4(18, 22, 21, 1), ivec4(17, 22, 18, 1),
  ivec4(17, 19, 22, -1), ivec4(19, 20, 22, -1), ivec4(22, 20, 21, -1), ivec4(18, 22, 21, -1), ivec4(17, 22, 18, -1));

// The wings beat slowly, each point a little behind the one nearer the body.
vec3 craneVertex(int i, int side) {
  vec3 v = CRANE_V[i];
  if (i < CRANE_BODY_VERTS) return v;
  float sd = float(side);
  v.x *= sd;
  vec3 root = vec3(0.12 * sd, 0.36, 0.0);
  float span = clamp((abs(v.x) - 0.12) / 0.88, 0.0, 1.0);
  float a = 0.2 * sin(gTime * 0.9 - 1.1 * span) * sd;
  vec3 d = v - root;
  float c = cos(a);
  float s = sin(a);
  return root + vec3(c * d.x - s * d.y, s * d.x + c * d.y, d.z);
}

bool wonderCrane(Inst I, int tri, vec3 c0, vec3 c1, float emitK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  if (tri >= CRANE_TRIS) return false;
  float S = I.size;
  float front = groundAt(I.pos.xz + (I.rot * vec3(0.0, 0.0, 0.4 * S)).xz);
  float back = groundAt(I.pos.xz + (I.rot * vec3(0.0, 0.0, -0.4 * S)).xz);
  I.pos.y = min(min(front, back), I.pos.y) - 0.02 * S + 0.006 * S * sin(gTime * 0.45);
  I.rot = I.rot * rotY(0.1 * sin(gTime * 0.07 + I.r.x * 6.0));
  ivec4 f = CRANE_F[tri];
  vec3 a = craneVertex(f.x, f.w);
  vec3 b = craneVertex(f.y, f.w);
  vec3 c = craneVertex(f.z, f.w);
  A = toWorld(I, a * S);
  B = toWorld(I, b * S);
  C = toWorld(I, c * S);
  vec3 mid = (a + b + c) * (1.0 / 3.0);
  float g = smoothstep(0.3, 0.85, abs(mid.x));
  if (f.x == 9 && f.y >= 10) g = 1.0;
  if (f.x >= 13 && f.x <= 15 && mid.y > 0.45) g = max(g, 0.6);
  float facet = u24(pcg(I.seed + uint(tri) * 131u + 5u));
  m = newMat();
  m.albedo = tintLin(mix(c0, c1, g)) * (0.9 + 0.2 * facet);
  m.emit = tintLin(c1) * emitK * g * (0.6 + 0.8 * facet);
  m.trans = 0.55;
  return true;
}

// A paper boat folded from flat triangles, in units of its length. x runs across the beam, y up and z along the keel.
// Vertices 0 to 3 are the keel, 4 to 7 the rim of the hull, 8 to 11 the creased middles of its sides and ends, and 12 to 18 the sail.
const int BOAT_TRIS = 22;
const vec3 BOAT_V[19] = vec3[19](
  vec3(-0.07, 0.0, -0.3), vec3(0.07, 0.0, -0.3), vec3(0.07, 0.0, 0.3), vec3(-0.07, 0.0, 0.3),
  vec3(-0.155, 0.19, -0.5), vec3(0.155, 0.19, -0.5), vec3(0.155, 0.19, 0.5), vec3(-0.155, 0.19, 0.5),
  vec3(0.145, 0.095, 0.0), vec3(-0.145, 0.095, 0.0), vec3(0.0, 0.095, 0.44), vec3(0.0, 0.095, -0.44),
  vec3(-0.03, 0.19, -0.38), vec3(-0.03, 0.19, 0.38), vec3(0.03, 0.19, -0.38), vec3(0.03, 0.19, 0.38),
  vec3(-0.075, 0.19, 0.0), vec3(0.075, 0.19, 0.0), vec3(0.0, 0.78, 0.0));

// Three vertex indices and 1 when the triangle belongs to the sail.
const ivec4 BOAT_F[BOAT_TRIS] = ivec4[BOAT_TRIS](
  ivec4(0, 1, 2, 0), ivec4(0, 2, 3, 0),
  ivec4(1, 2, 8, 0), ivec4(2, 6, 8, 0), ivec4(6, 5, 8, 0), ivec4(5, 1, 8, 0),
  ivec4(0, 3, 9, 0), ivec4(3, 7, 9, 0), ivec4(7, 4, 9, 0), ivec4(4, 0, 9, 0),
  ivec4(3, 2, 10, 0), ivec4(2, 6, 10, 0), ivec4(6, 7, 10, 0), ivec4(7, 3, 10, 0),
  ivec4(0, 1, 11, 0), ivec4(1, 5, 11, 0), ivec4(5, 4, 11, 0), ivec4(4, 0, 11, 0),
  ivec4(12, 16, 18, 1), ivec4(16, 13, 18, 1), ivec4(14, 17, 18, 1), ivec4(17, 15, 18, 1));

// On the Flats the boat floats and rocks. Elsewhere it lies where it ran aground, a little sunk and out of true.
bool wonderBoat(Inst I, int realm, int tri, vec3 c0, vec3 c1, float emitK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  if (tri >= BOAT_TRIS) return false;
  float S = I.size;
  float bow = groundAt(I.pos.xz + (I.rot * vec3(0.0, 0.0, 0.3 * S)).xz);
  float stern = groundAt(I.pos.xz + (I.rot * vec3(0.0, 0.0, -0.3 * S)).xz);
  if (realm == REALM_FLATS) {
    I.pos.y = min(bow, stern) + 0.004 * S * (1.0 + sin(gTime * 0.45 + I.r.x * 6.0));
    I.rot = I.rot * rotZ(0.03 * sin(gTime * 0.31 + I.r.y * 6.0)) * rotX(0.02 * sin(gTime * 0.23 + I.r.z * 6.0));
  } else {
    I.pos.y = min(bow, stern) - 0.03 * S;
    I.rot = I.rot * rotZ(0.28 * (I.r.y - 0.5)) * rotX(0.2 * (I.r.z - 0.5));
  }
  ivec4 f = BOAT_F[tri];
  vec3 a = BOAT_V[f.x];
  vec3 b = BOAT_V[f.y];
  vec3 c = BOAT_V[f.z];
  A = toWorld(I, a * S);
  B = toWorld(I, b * S);
  C = toWorld(I, c * S);
  float sail = float(f.w);
  float facet = u24(pcg(I.seed + uint(tri) * 131u + 5u));
  m = newMat();
  m.albedo = tintLin(mix(c0, c1, sail)) * (0.9 + 0.2 * facet);
  m.emit = tintLin(c1) * emitK * sail * (0.6 + 0.8 * facet);
  m.trans = 0.55;
  return true;
}

const int HENGE_SLABS = 9;

bool wonderHenge(Inst I, int tri, vec3 c0, vec3 c1, float emitK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  int k = tri / 12;
  int local = tri - k * 12;
  if (k > HENGE_SLABS) return false;
  float H = I.size;
  vec4 rk = hash4i(I.seed + uint(k) * 31u, 531u);
  Inst S = I;
  vec2 stretch = vec2(1.9, 0.5);
  if (k < HENGE_SLABS) {
    float phi = 6.2831853 * (float(k) + 0.25 * (rk.x - 0.5)) / float(HENGE_SLABS);
    S.pos = I.pos + I.rot * vec3(cos(phi), 0.0, sin(phi)) * 1.7 * H;
    S.rot = I.rot * rotY(-(phi + 1.5707963));
    S.size = H * (0.85 + 0.3 * rk.y);
    S.seed = I.seed + uint(k) * 977u;
  } else {
    S.size = 0.3 * H;
    stretch = vec2(4.0, 4.0);
  }
  S.pos.y = groundAt(S.pos.xz) - 0.03 * H;
  return primPrism(S, local, 1, 4, 0.2, 0.9, 0.0, 0.08, 0.0, stretch, c0, c1, emitK, 1.0, 0.1, A, B, C, m);
}

const int ISLES_COUNT = 4;
const int ISLE_TRIS = 150;

bool wonderIsles(Inst I, int realm, float ground, int tri, vec3 c0, vec3 c1, float emitK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  int k = tri / ISLE_TRIS;
  if (k >= ISLES_COUNT) return false;
  int local = tri - k * ISLE_TRIS;
  vec4 rk = hash4i(I.seed + uint(k) * 43u, 532u);
  float size = I.size;
  float phi = 6.2831853 * (float(k) + rk.x) / float(ISLES_COUNT);
  float reach = size * (0.25 + 0.45 * rk.y);
  float D = size * (0.3 + 0.2 * rk.z);
  float alt = 70.0 + size * (0.25 + 0.55 * rk.w);
  float bob = 5.0 * sin(gTime * 0.27 + float(k) * 2.0 + I.r.x * 9.0);
  vec3 centre = vec3(I.pos.x, ground + alt + bob, I.pos.z) + I.rot * vec3(cos(phi) * reach, 0.0, sin(phi) * reach);
  mat3 spin = rotY(gTime * (0.012 + 0.01 * rk.x) * (rk.y > 0.5 ? 1.0 : -1.0) + rk.z * 6.0);
  vec3 topA, topB;
  float topEmit;
  isleTop(realm, I.r, topA, topB, topEmit);

  Inst P = I;
  P.seed = I.seed + uint(k) * 5003u;
  if (local < 64) {
    float Hb = 0.5 * D;
    P.size = Hb;
    P.pos = centre + vec3(0.0, 0.16 * Hb, 0.0);
    P.rot = spin * rotX(3.1415927);
    return primTiers(P, local, 4, 7, 0.98, 1.0, c0, c1, c0 * 0.5, emitK, 0.0, A, B, C, m);
  }
  if (local < 99) {
    P.size = 0.95 * D;
    P.pos = centre + vec3(0.0, -0.01 * D, 0.0);
    P.rot = spin;
    return primBlob(P, local - 64, 7, vec3(1.0, 0.3, 1.0), topA, topB, A, B, C, m);
  }
  if (local < 120) {
    P.size = 0.22 * D;
    P.pos = centre + vec3(0.0, 0.08 * D, 0.0);
    P.rot = spin;
    return primBlades(P, local - 99, 7, 1.4, 0.07, 0.3, 0.4, topA, topB, topEmit, 0.04, 1.0, A, B, C, m);
  }
  P.size = 0.6 * D;
  P.pos = centre + vec3(0.0, -0.05 * D, 0.0);
  P.rot = spin * rotX(3.1415927);
  return primBlades(P, local - 120, 9, 0.28, 0.012, 0.14, 0.2, c0, topB, 3.2, 0.07, 0.95, A, B, C, m);
}

bool buildWonder(int kind, int realm, float ground, Inst I, int tri, out vec3 A, out vec3 B, out vec3 C, out Mat m, out float lit) {
  vec3 c0, c1;
  float emitK;
  wonderColors(realm, kind, I.r, c0, c1, emitK);
  lit = 1.0;
  switch (kind) {
    case WONDER_ARCH:
      return wonderArch(I, tri, c0, c1, emitK, A, B, C, m);
    case WONDER_GATE:
      return wonderGate(I, realm, tri, c0, c1, emitK, A, B, C, m, lit);
    case WONDER_RIBS:
      return wonderRibs(I, tri, c0, c1, emitK, A, B, C, m);
    case WONDER_HENGE:
      return wonderHenge(I, tri, c0, c1, emitK, A, B, C, m);
    case WONDER_ISLES:
      return wonderIsles(I, realm, ground, tri, c0, c1, emitK, A, B, C, m);
    case WONDER_CRANE:
      return wonderCrane(I, tri, c0, c1, emitK, A, B, C, m);
    case WONDER_BOAT:
      return wonderBoat(I, realm, tri, c0, c1, emitK, A, B, C, m);
    default:
      I.pos.y -= 0.1 * I.size;
      return primPrism(I, tri, 9, realm == REALM_DUNES ? 3 : 5, realm == REALM_DUNES ? 0.05 : 0.075, realm == REALM_DUNES ? 0.5 : 0.6, 0.45,
                       realm == REALM_DUNES ? 6.0 : 4.0, 0.4, vec2(1.0), c0, c1, emitK, 1.0, 0.3, A, B, C, m);
  }
}

bool layerGen(int index, sampler2D field, out Surfel s) {
  float cell = gL.p0.x;
  int N = int(gL.p0.y);
  ivec2 corner = ivec2(gL.p0.zw);
  float outer = gL.p1.x;
  float band = gL.p1.y;
  int K = int(gL.p1.z + 0.5);
  int slot = index / K;
  int j = index - slot * K;
  int u = slot % N;
  int v = slot / N;
  ivec2 w = corner + ivec2(posmod(u - corner.x, N), posmod(v - corner.y, N));

  vec4 hh = hash4(w, 468u);
  if (hh.z > gL.p3.x) return false;
  vec2 xz = (vec2(w) + 0.12 + hh.xy * 0.76) * cell;
  vec2 dp = abs(xz - gL.p2.xy);
  float fade = 1.0 - smoothstep(outer - band, outer, max(dp.x, dp.y));
  if (fade <= 0.003) return false;

  vec4 cellData = texelFetch(field, ivec2(u, v), 0);
  float ground = cellData.x;
  int packedRealms = int(cellData.w + 0.5);
  int ra = packedRealms / 8;
  int rb = packedRealms - ra * 8;
  vec4 h2 = hash4(w, 518u);
  int realm = h2.x < cellData.z ? rb : ra;
  bool mirrored = gL.p4.y > 0.5;
  float level = ground;
  if (mirrored && !mirrorLevel(realm, xz, ground, level)) return false;
  int kind = WONDER_KIND[realm * 3 + (h2.z < WONDER_PICK_AT[0] ? 0 : h2.z < WONDER_PICK_AT[1] ? 1 : 2)];
  if (hash4(w, WONDER_CRANE_SALT).x < WONDER_CRANE_RATE[realm]) kind = WONDER_CRANE;
  else if (hash4(w, WONDER_BOAT_SALT).x < WONDER_BOAT_RATE[realm]) kind = WONDER_BOAT;

  Inst I;
  I.size = mix(WONDER_SIZE_MIN[kind], WONDER_SIZE_MAX[kind], pow(hh.w, 1.4));
  I.type = kind;
  I.r = hash4(w, 538u);
  I.seed = hashCell(w, 548u);
  I.rot = rotY(h2.y * 6.2831853);
  I.pos = vec3(xz.x, ground, xz.y);

  // Ribs and isles have too many triangles for a 3 x 3 patch each, so they stop at 2 x 2. A crane or a boat has few
  // triangles and each can take up to PAPER_PATCH x PAPER_PATCH.
  bool paper = kind == WONDER_CRANE || kind == WONDER_BOAT;
  int stride = paper ? PAPER_PATCH * PAPER_PATCH : (kind == WONDER_RIBS || kind == WONDER_ISLES) ? 4 : 9;
  int tri = j / stride;
  int k = j - tri * stride;
  float reach = I.size / max(length(I.pos - gW.eye.xyz), 1.0);
  int nUse = reach > 0.35 && stride == 9 ? 3 : reach > 0.1 ? 2 : 1;
  if (paper) nUse = reach > 0.5 ? PAPER_PATCH : reach > 0.25 ? 7 : reach > 0.12 ? 5 : reach > 0.05 ? 3 : 2;
  if (k >= nUse * nUse) return false;
  vec3 A, B, C;
  Mat m;
  float lit;
  if (!buildWonder(kind, realm, ground, I, tri, A, B, C, m, lit)) return false;
  vec3 ab = B - A;
  vec3 ac = C - A;
  if (dot(cross(ab, ac), cross(ab, ac)) < 1e-6) return false;
  s = triSurfel(A, B, C, nUse, k, paper ? PAPER_SPREAD : gL.p2.z, I.size * 0.002);
  s.albedo = m.albedo;
  s.emit = m.emit;
  s.trans = m.trans;
  s.lit = lit;
  s.opacity = m.opacity * fade;
  s.shadow = mix(cellData.y, 1.0, smoothstep(0.0, 1.0, max(s.pos.y - ground, 0.0) / (0.4 * I.size)));
  if (mirrored) mirrorSurfel(s, level);
  return true;
}
