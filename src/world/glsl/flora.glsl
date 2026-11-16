// Objects standing on the ground, one size class per layer. A class is a toroidal window of
// cells; each cell holds at most one object, found by hashing the cell. The realm at the object's
// place picks what it is, so one class draws pines in the dunes, crystals in the forest, coral in
// the deep and basalt in the canyons without a slot being reserved per realm.
//
// p0: cell size, cells per side, window corner (cell units)
// p1: outer radius, fade band, splats per object K, size class
// p2: player x, player z, spread, spare
// p3: density scale, size scale, spare, spare

// Rows are realms in cycle order, columns are size classes small, medium, big, giant.
const int FLORA_TYPE[20] = int[20](
  SHAPE_TUFT, SHAPE_PINE, SHAPE_BOULDER, SHAPE_OBELISK,
  SHAPE_TUFT, SHAPE_CRYSTAL, SHAPE_CRYSTAL, SHAPE_OBELISK,
  SHAPE_TUFT, SHAPE_CORAL, SHAPE_COLUMNS, SHAPE_OBELISK,
  SHAPE_LOTUS, SHAPE_BOULDER, SHAPE_COLUMNS, SHAPE_OBELISK,
  SHAPE_BOULDER, SHAPE_COLUMNS, SHAPE_COLUMNS, SHAPE_OBELISK);
const float FLORA_DENSITY[20] = float[20](
  0.55, 0.24, 0.2, 0.3,
  0.5, 0.32, 0.22, 0.3,
  0.6, 0.38, 0.25, 0.25,
  0.07, 0.12, 0.08, 0.15,
  0.5, 0.35, 0.25, 0.3);
const float FLORA_SIZE_MIN[20] = float[20](
  0.45, 6.0, 12.0, 120.0,
  0.5, 5.0, 22.0, 160.0,
  0.5, 3.0, 22.0, 140.0,
  0.9, 2.5, 20.0, 140.0,
  0.7, 4.0, 20.0, 140.0);
const float FLORA_SIZE_MAX[20] = float[20](
  1.1, 15.0, 38.0, 300.0,
  1.4, 16.0, 70.0, 420.0,
  1.4, 9.0, 60.0, 320.0,
  2.2, 6.0, 50.0, 300.0,
  2.2, 12.0, 55.0, 320.0);

// Wind per realm: heading in xz and strength as the share of its height that a stalk leans in a gust.
// The Dunes blow hard, the Deep sways in slow currents and the canyons shiver in rising heat.
const vec3 FLORA_WIND[5] = vec3[5](
  vec3(0.957, -0.291, 0.34),
  vec3(-0.287, 0.958, 0.12),
  vec3(0.6, -0.8, 0.2),
  vec3(0.8, 0.6, 0.1),
  vec3(-0.707, -0.707, 0.16));

// Leans point p of an object downwind. A gust travels across the land, and the lean grows with
// the square of the height above the root, so stalks bend and roots stay put.
vec3 bendInWind(vec3 p, Inst I, float stiffness, int realm) {
  vec3 wind = FLORA_WIND[realm];
  vec2 across = vec2(-wind.y, wind.x);
  float rise = clamp((p.y - I.pos.y) / I.size, 0.0, 1.2);
  float gust = 0.5 + 0.5 * sin(dot(p.xz, wind.xy) * 0.05 - gTime * 1.1 + 1.6 * sin(dot(p.xz, across) * 0.023));
  float flutter = sin(gTime * 2.7 + I.r.w * 40.0 + p.y * 2.0);
  float lean = wind.z * (0.3 + 0.7 * gust + 0.25 * flutter) * stiffness * rise * rise;
  float push = lean * I.size;
  // A bent stalk keeps its length, so its tip comes down as it goes over.
  float drop = 0.5 * push * push / max(I.size * max(rise, 0.1), 0.05);
  return p + vec3(wind.x * push, -drop, wind.y * push);
}

void floraColors(int realm, int type, vec4 r, out vec3 c0, out vec3 c1, out float emitK) {
  emitK = 0.0;
  c0 = vec3(0.3);
  c1 = vec3(0.6);
  if (realm == REALM_DUNES) {
    if (type == SHAPE_PINE) {
      if (r.x > 0.82) { c0 = vec3(0.5, 0.22, 0.1); c1 = vec3(1.0, 0.76, 0.34); }
      else { c0 = vec3(0.04, 0.18, 0.25); c1 = vec3(0.3, 0.7, 0.56); }
    } else if (type == SHAPE_TUFT) { c0 = vec3(0.55, 0.4, 0.2); c1 = vec3(1.0, 0.88, 0.55); }
    else { c0 = vec3(0.5, 0.34, 0.44); c1 = vec3(0.98, 0.76, 0.58); }
  } else if (realm == REALM_PRISM) {
    float hue = r.y;
    vec3 neon = hue < 0.3 ? vec3(0.1, 0.85, 1.0) : hue < 0.6 ? vec3(0.95, 0.2, 0.85) : hue < 0.85 ? vec3(0.5, 1.0, 0.35) : vec3(1.0, 0.7, 0.2);
    c0 = vec3(0.04, 0.03, 0.12);
    c1 = neon;
    emitK = type == SHAPE_TUFT ? 2.4 : 1.7;
  } else if (realm == REALM_DEEP) {
    bool warm = r.y > 0.4;
    c0 = warm ? vec3(0.6, 0.1, 0.25) : vec3(0.25, 0.1, 0.5);
    c1 = warm ? vec3(1.0, 0.55, 0.4) : vec3(0.7, 0.5, 1.0);
    if (type == SHAPE_COLUMNS) { c0 = vec3(0.04, 0.12, 0.16); c1 = vec3(0.3, 0.55, 0.5); }
    emitK = type == SHAPE_TUFT ? 1.2 : 0.35;
  } else if (realm == REALM_FLATS) {
    c0 = vec3(0.2, 0.3, 0.6);
    c1 = vec3(0.72, 0.84, 1.0);
    if (type != SHAPE_LOTUS) { c0 = vec3(0.14, 0.18, 0.3); c1 = vec3(0.55, 0.6, 0.78); }
    emitK = type == SHAPE_LOTUS ? 0.35 : 0.0;
  } else {
    c0 = vec3(0.03, 0.025, 0.03);
    c1 = type == SHAPE_OBELISK ? vec3(0.35, 0.1, 0.06) : vec3(0.22, 0.07, 0.045);
    emitK = 0.45;
  }
}

bool buildShape(int realm, Inst I, int tri, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  vec3 c0, c1;
  float emitK;
  floraColors(realm, I.type, I.r, c0, c1, emitK);
  switch (I.type) {
    case SHAPE_PINE:
      return primTiers(I, tri, 5, 7, 0.3, 1.45, c0, c1, vec3(0.3, 0.14, 0.18), emitK, 0.012, A, B, C, m);
    case SHAPE_TUFT:
      return primBlades(I, tri, 7, 0.3, 0.06, 0.35, 0.5, c0, c1, emitK, 0.05, 1.0, A, B, C, m);
    case SHAPE_BOULDER:
      return primBlob(I, tri, realm == REALM_FLATS ? 4 : 6, realm == REALM_FLATS ? vec3(1.6, 0.35, 1.6) : vec3(1.25, 0.8, 1.0), c0, c1, A, B, C, m);
    case SHAPE_CRYSTAL:
      return primPrism(I, tri, 4, 6, 0.075, 0.7, 0.55, 3.0, 0.5, vec2(1.0), c0, c1, emitK, 0.92, 0.7, A, B, C, m);
    case SHAPE_COLUMNS:
      return primPrism(I, tri, 5, 6, 0.1, 0.95, 0.07, 0.15, 0.45, vec2(1.0), c0, c1, emitK, 1.0, 0.0, A, B, C, m);
    case SHAPE_OBELISK:
      return primPrism(I, tri, 3, 4, 0.06, 0.55, 0.1, 2.4, 0.22, vec2(1.0), c0, c1, emitK, 0.96, 0.3, A, B, C, m);
    case SHAPE_CORAL:
      return primPrism(I, tri, 4, 5, 0.04, 0.6, 0.9, 0.8, 0.5, vec2(1.0), c0, c1, emitK, 0.95, 0.6, A, B, C, m);
    default:
      return primBlades(I, tri, 8, 0.12, 0.09, 0.9, 0.2, c0, c1, emitK, 0.02, 0.95, A, B, C, m);
  }
}

bool layerGen(int index, sampler2D field, out Surfel s) {
  float cell = gL.p0.x;
  int N = int(gL.p0.y);
  ivec2 corner = ivec2(gL.p0.zw);
  float outer = gL.p1.x;
  float band = gL.p1.y;
  int K = int(gL.p1.z + 0.5);
  int cls = int(gL.p1.w + 0.5);
  int slot = index / K;
  int j = index - slot * K;
  int u = slot % N;
  int v = slot / N;
  ivec2 w = corner + ivec2(posmod(u - corner.x, N), posmod(v - corner.y, N));

  vec4 hh = hash4(w, 400u + uint(cls) * 17u);
  vec2 xz = (vec2(w) + 0.12 + hh.xy * 0.76) * cell;
  vec2 dp = abs(xz - gL.p2.xy);
  float cheb = max(dp.x, dp.y);
  float fade = 1.0 - smoothstep(outer - band, outer, cheb);
  if (fade <= 0.003) return false;

  // The cell's ground height, shadow and realm mix were precomputed by CellField.
  vec4 cellData = texelFetch(field, ivec2(u, v), 0);
  RealmMix rm;
  rm.t = cellData.z;
  int packedRealms = int(cellData.w + 0.5);
  rm.a = packedRealms / 8;
  rm.b = packedRealms - rm.a * 8;
  rm.sc = 0.0;
  vec4 h2 = hash4(w, 450u + uint(cls) * 17u);
  int realm = h2.x < rm.t ? rm.b : rm.a;
  bool mirrored = gL.p4.y > 0.5;
  float level = cellData.x;
  if (mirrored && (j == K - 1 || !mirrorLevel(realm, xz, cellData.x, level))) return false;
  int row = realm * 4 + cls;
  float patchiness = fbm1(xz / (cell * 9.0) + float(cls) * 7.3, 3, 0.0, 460u) * 0.5 + 0.5;
  float dens = FLORA_DENSITY[row] * gL.p3.x * mix(0.2, 1.7, smoothstep(0.25, 0.7, patchiness));
  if (hh.z > dens) return false;

  Inst I;
  I.size = mix(FLORA_SIZE_MIN[row], FLORA_SIZE_MAX[row], pow(hh.w, 1.4)) * gL.p3.y;
  I.type = FLORA_TYPE[row];
  I.r = hash4(w, 470u + uint(cls) * 17u);
  I.seed = hashCell(w, 480u + uint(cls) * 17u);
  I.rot = rotY(h2.y * 6.2831853);
  float ground = cellData.x;
  I.pos = vec3(xz.x, ground - 0.02 * I.size, xz.y);
  // A rounded mass seen from within its own size shows only a few big, soft splats, so it
  // melts away as the visitor comes close instead of filling the view with blur.
  if (I.type == SHAPE_BOULDER) {
    fade *= smoothstep(0.9, 2.4, length(I.pos - gW.eye.xyz) / I.size);
    if (fade <= 0.003) return false;
  }

  s = newSurfel();
  if (j == K - 1) {
    vec3 L = normalize(vec3(gW.sun.x, 0.0, gW.sun.z) + vec3(0.0001));
    float el = max(gW.sun.y, 0.08);
    float length_ = min(I.size * 0.7 / tan(asin(min(el, 0.99))), I.size * 3.5);
    float wide = I.size * (I.type == SHAPE_PINE ? 0.3 : I.type == SHAPE_TUFT ? 0.3 : 0.4);
    vec3 side = vec3(-L.z, 0.0, L.x);
    vec3 centre = I.pos - L * length_ * 0.45 + vec3(0.0, 0.1, 0.0);
    vec3 toEye = normalize(gW.eye.xyz - centre);
    s.pos = centre + toEye * 0.3;
    s.nrm = vec3(0.0, 1.0, 0.0);
    s.cov = outerProduct(L, L) * (length_ * length_ * 0.1) + outerProduct(side, side) * (wide * wide * 0.1) + outerProduct(s.nrm, s.nrm) * 0.0004;
    s.albedo = vec3(0.0);
    s.lit = 0.0;
    // On water a dark patch would float on the mirror, so far-off shadows give way to the reflection.
    s.opacity = 0.42 * fade * (realm == REALM_FLATS ? 1.0 - smoothstep(5.0, 18.0, length(I.pos - gW.eye.xyz)) : 1.0);
    return true;
  }
  int tri = j / 4;
  int k = j - tri * 4;
  float dist = length(I.pos - gW.eye.xyz);
  int nUse = (I.size / max(dist, 1.0)) > 0.05 ? 2 : 1;
  if (k >= nUse * nUse) return false;
  vec3 A, B, C;
  Mat m;
  if (!buildShape(realm, I, tri, A, B, C, m)) return false;
  // Stone and crystal stand still. Grass, pines, lotus and coral give to the wind.
  float limp = I.type == SHAPE_TUFT || I.type == SHAPE_LOTUS ? 1.0 : I.type == SHAPE_PINE ? 0.16 : I.type == SHAPE_CORAL ? 0.45 : 0.0;
  if (limp > 0.0) {
    A = bendInWind(A, I, limp, realm);
    B = bendInWind(B, I, limp, realm);
    C = bendInWind(C, I, limp, realm);
  }
  vec3 ab = B - A;
  vec3 ac = C - A;
  if (dot(cross(ab, ac), cross(ab, ac)) < 1e-10) return false;
  s = triSurfel(A, B, C, nUse, k, gL.p2.z, I.size * 0.004);
  s.albedo = m.albedo;
  s.emit = m.emit;
  s.trans = m.trans;
  s.opacity = m.opacity * fade;
  s.shadow = cls == 0 ? cellData.y : mix(cellData.y, 1.0, smoothstep(0.0, 1.0, max(s.pos.y - ground, 0.0) / (0.55 * I.size)));
  if (mirrored) mirrorSurfel(s, level);
  return true;
}
