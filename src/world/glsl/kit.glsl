// A small kit for building objects out of flat triangles. Every object is a handful of triangles
// worked out on the fly from an index, so nothing is stored. A triangle is later covered by a few
// flat splats. Four primitives cover most of what the realms need:
//   prism   columns with a pointed cap: crystals, basalt, obelisks
//   tiers   stacked cones: paper pines, pagodas
//   blades  bent strips: grass, fronds, petals
//   blob    a lumpy rock

const int SHAPE_PINE = 0;
const int SHAPE_CRYSTAL = 1;
const int SHAPE_TUFT = 2;
const int SHAPE_BOULDER = 3;
const int SHAPE_COLUMNS = 4;
const int SHAPE_OBELISK = 5;
const int SHAPE_CORAL = 7;
const int SHAPE_LOTUS = 9;

struct Inst {
  vec3 pos;      // where the object meets the ground
  mat3 rot;      // yaw about the vertical
  float size;    // height in metres
  vec4 r;        // four random numbers owned by the object
  uint seed;
  int type;
};

struct Mat {
  vec3 albedo;   // linear
  vec3 emit;     // linear radiance added after lighting
  float opacity;
  float trans;   // how much light shines through
};

Mat newMat() {
  Mat m;
  m.albedo = vec3(0.5);
  m.emit = vec3(0.0);
  m.opacity = 1.0;
  m.trans = 0.0;
  return m;
}

vec4 rndPart(Inst I, int part) { return hash4i(I.seed + uint(part) * 7919u, 411u); }
vec3 toWorld(Inst I, vec3 l) { return I.pos + I.rot * l; }

// Wind bends things more the higher they stand.
vec3 sway(vec3 l, float height, float phase, float amount) {
  float k = clamp(l.y / max(height, 0.001), 0.0, 1.5);
  float t = gTime * 0.9 + phase;
  vec2 d = vec2(sin(t) + 0.5 * sin(t * 2.3 + 1.7), cos(t * 0.8 + 0.6) * 0.6) * amount * height * k * k;
  return l + vec3(d.x, 0.0, d.y);
}

vec3 tintLin(vec3 c) { return srgb2lin(c); }

// A column cluster with pointed caps: `count` columns of `sides` sides. 3 * sides triangles per column.
bool primPrism(Inst I, int tri, int count, int sides, float radius, float taper, float tilt, float capH,
               float spreadR, vec2 stretch, vec3 c0, vec3 c1, float emitK, float opacity, float transK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  int per = 3 * sides;
  int col = tri / per;
  int loc = tri - col * per;
  if (col >= count) return false;
  vec4 rc = rndPart(I, col + 1);
  vec4 rd = rndPart(I, col + 41);
  float ang = rc.x * 6.2831853;
  float dist = (col == 0 ? 0.0 : (0.35 + 0.65 * rc.y) * spreadR) * I.size;
  vec3 base = vec3(cos(ang) * dist, 0.0, sin(ang) * dist);
  float h = I.size * (col == 0 ? 1.0 : 0.35 + 0.55 * rc.z);
  float rad = I.size * radius * (col == 0 ? 1.0 : 0.6 + 0.4 * rc.w);
  float ta = rd.x * 6.2831853;
  float tl = tilt * (col == 0 ? 0.35 : 1.0) * (0.3 + 0.7 * rd.y);
  vec3 u = normalize(vec3(sin(tl) * cos(ta), cos(tl), sin(tl) * sin(ta)));
  vec3 e1 = normalize(cross(u, vec3(0.0, 0.0, 1.0) + vec3(0.1, 0.0, 0.0)));
  vec3 e2 = cross(u, e1);
  float twist = rd.z * 1.0472;
  float stepA = 6.2831853 / float(sides);
  vec3 top = base + u * h;
  vec3 apex = top + u * (rad * taper * capH);
  float t0 = 0.0;
  float t1 = 0.0;
  if (loc < 2 * sides) {
    int q = loc / 2;
    int half_ = loc - q * 2;
    float a0 = twist + float(q) * stepA;
    float a1 = a0 + stepA;
    vec3 b0 = base + (e1 * cos(a0) + e2 * sin(a0)) * rad;
    vec3 b1 = base + (e1 * cos(a1) + e2 * sin(a1)) * rad;
    vec3 u0 = top + (e1 * cos(a0) + e2 * sin(a0)) * rad * taper;
    vec3 u1 = top + (e1 * cos(a1) + e2 * sin(a1)) * rad * taper;
    if (half_ == 0) { A = b0; B = b1; C = u0; } else { A = b1; B = u1; C = u0; }
    t0 = half_ == 0 ? 0.0 : 0.5;
    t1 = 0.55;
  } else {
    int q = loc - 2 * sides;
    float a0 = twist + float(q) * stepA;
    float a1 = a0 + stepA;
    A = top + (e1 * cos(a0) + e2 * sin(a0)) * rad * taper;
    B = top + (e1 * cos(a1) + e2 * sin(a1)) * rad * taper;
    C = apex;
    t0 = 0.9;
    t1 = 1.0;
  }
  A = toWorld(I, vec3(A.x * stretch.x, A.y, A.z * stretch.y));
  B = toWorld(I, vec3(B.x * stretch.x, B.y, B.z * stretch.y));
  C = toWorld(I, vec3(C.x * stretch.x, C.y, C.z * stretch.y));
  float facet = u24(pcg(I.seed + uint(tri) * 131u + 5u));
  float g = clamp(mix(t0, t1, 0.5), 0.0, 1.0);
  m = newMat();
  m.albedo = tintLin(mix(c0, c1, g)) * (0.8 + 0.4 * facet);
  m.emit = tintLin(c1) * emitK * (0.15 + 0.85 * g) * (0.7 + 0.6 * facet);
  m.opacity = opacity;
  m.trans = transK;
  return true;
}

// Stacked cones. tiers * 2 * sides triangles, plus 8 for the trunk.
bool primTiers(Inst I, int tri, int tiers, int sides, float radius, float squash, vec3 c0, vec3 c1, vec3 trunk,
               float emitK, float swayK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  int tierTris = tiers * 2 * sides;
  if (tri >= tierTris + 8) return false;
  float H = I.size;
  m = newMat();
  if (tri >= tierTris) {
    int loc = tri - tierTris;
    int q = loc / 2;
    int half_ = loc - q * 2;
    float a0 = float(q) * 1.5707963;
    float a1 = a0 + 1.5707963;
    float rr = H * 0.022;
    float top = H * 0.4;
    vec3 b0 = vec3(cos(a0) * rr, 0.0, sin(a0) * rr);
    vec3 b1 = vec3(cos(a1) * rr, 0.0, sin(a1) * rr);
    vec3 u0 = vec3(b0.x, top, b0.z);
    vec3 u1 = vec3(b1.x, top, b1.z);
    if (half_ == 0) { A = b0; B = b1; C = u0; } else { A = b1; B = u1; C = u0; }
    m.albedo = tintLin(trunk) * (0.8 + 0.4 * u24(pcg(I.seed + uint(tri) * 17u)));
  } else {
    int tier = tri / (2 * sides);
    int loc = tri - tier * 2 * sides;
    bool under = loc >= sides;
    int s = under ? loc - sides : loc;
    float ft = float(tier) / float(max(tiers - 1, 1));
    float y0 = H * (0.16 + 0.62 * float(tier) / float(tiers));
    float hT = H * (0.84 - 0.16) / float(tiers) * 1.9;
    float rT = H * radius * (1.0 - 0.78 * ft) * (0.88 + 0.24 * u24(pcg(I.seed + uint(tier) * 29u + 3u)));
    float stepA = 6.2831853 / float(sides);
    float rot = float(tier) * 0.43;
    float a0 = rot + float(s) * stepA;
    float a1 = a0 + stepA;
    vec3 r0 = vec3(cos(a0) * rT, y0, sin(a0) * rT);
    vec3 r1 = vec3(cos(a1) * rT, y0, sin(a1) * rT);
    vec3 apex = vec3(0.0, y0 + hT * squash, 0.0);
    vec3 hub = vec3(0.0, y0 + hT * 0.12 * squash, 0.0);
    if (under) { A = hub; B = r1; C = r0; } else { A = r0; B = r1; C = apex; }
    float facet = u24(pcg(I.seed + uint(tri) * 131u + 5u));
    vec3 col = mix(c0, c1, ft);
    m.albedo = tintLin(col) * (under ? 0.55 : 0.85 + 0.3 * facet);
    m.emit = tintLin(c1) * emitK * ft * (under ? 0.2 : 1.0);
    m.trans = 0.35;
  }
  A = sway(A, H, float(I.seed & 255u), swayK);
  B = sway(B, H, float(I.seed & 255u), swayK);
  C = sway(C, H, float(I.seed & 255u), swayK);
  A = toWorld(I, A);
  B = toWorld(I, B);
  C = toWorld(I, C);
  return true;
}

// Bent strips. 3 triangles per blade: a quad and a point.
bool primBlades(Inst I, int tri, int blades, float spreadR, float width, float lean, float bend,
                vec3 c0, vec3 c1, float emitK, float swayK, float opacity, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  int blade = tri / 3;
  int loc = tri - blade * 3;
  if (blade >= blades) return false;
  vec4 rb = rndPart(I, blade + 101);
  vec4 rc = rndPart(I, blade + 201);
  float ang = rb.x * 6.2831853;
  float dist = sqrt(rb.y) * spreadR * I.size;
  vec3 root = vec3(cos(ang) * dist, 0.0, sin(ang) * dist);
  float h = I.size * (0.55 + 0.7 * rb.z);
  float w = I.size * width * (0.7 + 0.6 * rb.w);
  float la = rc.x * 6.2831853;
  vec2 leanDir = vec2(cos(la), sin(la)) * lean * h * (0.4 + 0.6 * rc.y);
  vec3 side = vec3(-sin(ang + 1.2 * rc.z), 0.0, cos(ang + 1.2 * rc.z));
  vec3 mid = root + vec3(leanDir.x * 0.25, h * 0.5, leanDir.y * 0.25);
  vec3 tip = root + vec3(leanDir.x * (1.0 + bend), h * (1.0 - 0.15 * bend), leanDir.y * (1.0 + bend));
  vec3 r0 = root - side * w;
  vec3 r1 = root + side * w;
  vec3 m0 = mid - side * w * 0.65;
  vec3 m1 = mid + side * w * 0.65;
  float t0 = 0.0;
  float t1 = 0.5;
  if (loc == 0) { A = r0; B = r1; C = m0; }
  else if (loc == 1) { A = r1; B = m1; C = m0; t0 = 0.0; t1 = 0.6; }
  else { A = m0; B = m1; C = tip; t0 = 0.5; t1 = 1.0; }
  float phase = float(I.seed & 255u) + float(blade) * 0.7;
  A = sway(A, I.size, phase, swayK);
  B = sway(B, I.size, phase, swayK);
  C = sway(C, I.size, phase, swayK);
  A = toWorld(I, A);
  B = toWorld(I, B);
  C = toWorld(I, C);
  float g = mix(t0, t1, 0.5);
  m = newMat();
  m.albedo = tintLin(mix(c0, c1, g)) * (0.85 + 0.3 * rc.w);
  m.emit = tintLin(c1) * emitK * g;
  m.opacity = opacity;
  m.trans = 0.5;
  return true;
}

vec3 blobVertex(Inst I, int ring, int s, int sides, vec3 stretch) {
  float phi = float(ring) * 0.5236 + 0.35;
  float a = (float(s) + 0.5 * float(ring & 1)) * 6.2831853 / float(sides);
  vec4 j = hash4i(I.seed + uint(ring * 17 + (s % sides)) * 613u, 421u);
  float rr = sin(phi) * (0.75 + 0.5 * j.x);
  float yy = cos(phi) * (0.7 + 0.5 * j.y);
  return vec3(cos(a) * rr * stretch.x, yy * stretch.y, sin(a) * rr * stretch.z) * I.size * 0.5;
}

// A lumpy rock: a cap of `sides` triangles and two bands of quads. 5 * sides triangles.
bool primBlob(Inst I, int tri, int sides, vec3 stretch, vec3 c0, vec3 c1, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  if (tri >= 5 * sides) return false;
  vec3 apex = vec3(0.0, 0.52 * I.size * stretch.y, 0.0);
  if (tri < sides) {
    A = apex;
    B = blobVertex(I, 1, tri, sides, stretch);
    C = blobVertex(I, 1, (tri + 1) % sides, sides, stretch);
  } else {
    int q = tri - sides;
    int band = q / (2 * sides);
    int loc = q - band * 2 * sides;
    int s = loc / 2;
    int half_ = loc - s * 2;
    int r0 = 1 + band;
    int s1 = (s + 1) % sides;
    vec3 v00 = blobVertex(I, r0, s, sides, stretch);
    vec3 v01 = blobVertex(I, r0, s1, sides, stretch);
    vec3 v10 = blobVertex(I, r0 + 1, s, sides, stretch);
    vec3 v11 = blobVertex(I, r0 + 1, s1, sides, stretch);
    if (half_ == 0) { A = v00; B = v01; C = v10; } else { A = v01; B = v11; C = v10; }
  }
  A = toWorld(I, A);
  B = toWorld(I, B);
  C = toWorld(I, C);
  float facet = u24(pcg(I.seed + uint(tri) * 131u + 9u));
  m = newMat();
  float up = clamp((A.y + B.y + C.y) / 3.0 - I.pos.y, 0.0, I.size) / I.size;
  m.albedo = tintLin(mix(c0, c1, up)) * (0.75 + 0.5 * facet);
  return true;
}

vec3 archPoint(vec2 R, float ang, float s, float z) {
  return vec3((R.x + s) * cos(ang), (R.y + s) * sin(ang), z);
}

// An arch or a ring of rectangular section standing in the local xy plane. 8 triangles per segment:
// outer face, inner face and the two sides. R holds the radii of the centre line, span the angle
// range, w the radial thickness and d the depth. A buttress thickens the feet.
bool primArch(Inst I, int tri, int segs, vec2 R, vec2 span, float w, float d, float buttress,
              vec3 c0, vec3 c1, float emitK, float transK, out vec3 A, out vec3 B, out vec3 C, out Mat m) {
  if (tri >= segs * 8) return false;
  int seg = tri / 8;
  int r = tri - seg * 8;
  int face = r / 2;
  int half_ = r - face * 2;
  float a0 = mix(span.x, span.y, float(seg) / float(segs));
  float a1 = mix(span.x, span.y, float(seg + 1) / float(segs));
  float b0 = 1.0 + buttress * pow(1.0 - clamp(sin(a0), 0.0, 1.0), 3.0);
  float b1 = 1.0 + buttress * pow(1.0 - clamp(sin(a1), 0.0, 1.0), 3.0);
  float w0 = w * b0 * 0.5;
  float w1 = w * b1 * 0.5;
  float d0 = d * (1.0 + 0.5 * (b0 - 1.0)) * 0.5;
  float d1 = d * (1.0 + 0.5 * (b1 - 1.0)) * 0.5;
  vec3 q00, q10, q01, q11;
  if (face < 2) {
    float sgn = face == 0 ? 1.0 : -1.0;
    q00 = archPoint(R, a0, sgn * w0, -d0);
    q10 = archPoint(R, a1, sgn * w1, -d1);
    q01 = archPoint(R, a0, sgn * w0, d0);
    q11 = archPoint(R, a1, sgn * w1, d1);
  } else {
    float sz = face == 2 ? 1.0 : -1.0;
    q00 = archPoint(R, a0, -w0, sz * d0);
    q10 = archPoint(R, a1, -w1, sz * d1);
    q01 = archPoint(R, a0, w0, sz * d0);
    q11 = archPoint(R, a1, w1, sz * d1);
  }
  if (half_ == 0) { A = q00; B = q10; C = q01; } else { A = q10; B = q11; C = q01; }
  A = toWorld(I, A);
  B = toWorld(I, B);
  C = toWorld(I, C);
  float facet = u24(pcg(I.seed + uint(tri) * 131u + 5u));
  float g = clamp(sin(0.5 * (a0 + a1)), 0.0, 1.0);
  float band = 0.84 + 0.24 * float(seg & 1);
  m = newMat();
  m.albedo = tintLin(mix(c0, c1, g)) * band * (0.82 + 0.36 * facet);
  m.emit = tintLin(c1) * emitK * (face == 1 ? 1.0 : 0.12) * (0.65 + 0.7 * facet);
  m.trans = transK;
  return true;
}

