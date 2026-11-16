// Realm field and terrain height. Mirrored in src/world/cpu/terrain.ts, which the walker, the
// camera and the film path use to stand on the same ground the GPU draws.

const int REALM_COUNT = 5;
const float REALM_FIELD_SCALE = 1.0 / 1500.0;
const float REALM_TURNS = 2.6;
const float REALM_BLEND = 0.34;

struct RealmMix {
  int a;
  int b;
  float t;
  float sc;
};

// The realms form a cycle. A smooth field decides where in the cycle each place lies, so
// neighbouring places blend between realms that sit next to each other in the cycle.
RealmMix realmAt(vec2 xz) {
  float f = fbm1(xz * REALM_FIELD_SCALE + vec2(17.3, -41.9), 4, 0.0, 9001u);
  float sc = (f * 0.5 + 0.5) * float(REALM_COUNT) * REALM_TURNS + 0.5;
  float fl = floor(sc);
  float fr = sc - fl;
  RealmMix r;
  r.a = posmod(int(fl), REALM_COUNT);
  r.b = posmod(int(fl) + 1, REALM_COUNT);
  r.t = smoothstep(1.0 - REALM_BLEND, 1.0, fr);
  r.sc = sc;
  return r;
}

// Rolling dunes with sharp crests.
float heightDunes(vec2 p, float lod) {
  vec2 q = p / 600.0;
  float warp = fbm1(q * 1.7 + 3.1, 3, lod / 350.0, 21u) * 0.22;
  vec2 qw = q + warp;
  float base = fbm1(qw, 5, lod / 600.0, 22u);
  float crest = ridge1(qw * vec2(1.0, 2.3) * 2.2 + 7.0, 4, lod / 270.0, 23u);
  float detail = fbm1(p / 38.0, 3, lod / 38.0, 24u);
  float along = dot(p, vec2(0.866, 0.5));
  float wob = fbm1(p / 85.0 + 5.0, 3, lod / 85.0, 25u);
  float ripple1 = sin((along / 7.5 + wob * 3.0) * 6.2831853) * 0.42 * (1.0 - smoothstep(1.2, 3.0, lod));
  float ripple2 = sin((along / 26.0 + wob * 2.0 + 0.3) * 6.2831853) * 1.3 * (1.0 - smoothstep(4.0, 9.0, lod));
  return base * 62.0 + crest * 34.0 + detail * 1.6 + ripple1 + ripple2;
}

// Shattered plates of black glass, each at its own height.
float heightPrism(vec2 p, float lod) {
  vec4 v = voronoi(p, 150.0, 31u);
  float plate = (v.z - 0.5) * 16.0;
  float crack = 1.0 - smoothstep(0.0, 0.09, v.y - v.x);
  float swell = fbm1(p / 700.0 + 5.0, 4, lod / 700.0, 32u) * 26.0;
  float detail = fbm1(p / 30.0, 3, lod / 30.0, 33u) * 0.9;
  return plate + swell - crack * 4.0 + detail;
}

// A sea floor of long swells, canyons and ripples.
float heightDeep(vec2 p, float lod) {
  float base = fbm1(p / 520.0 + 2.0, 5, lod / 520.0, 41u) * 36.0;
  float canyons = ridge1(p / 340.0 + 9.0, 4, lod / 340.0, 42u) * 30.0;
  float rip = fbm1(p / 70.0, 3, lod / 70.0, 43u);
  float ripples = sin((p.x * 0.8 + p.y * 0.6) / 5.5 + rip * 5.0) * 0.55;
  return base - canyons + ripples;
}

// Salt flats under a skin of water, with rocky islands rising here and there.
float heightFlats(vec2 p, float lod) {
  float swell = fbm1(p / 1100.0 + 4.0, 3, lod / 1100.0, 51u) * 6.0;
  vec4 v = voronoi(p, 34.0, 52u);
  float crust = (1.0 - smoothstep(0.0, 0.12, v.y - v.x)) * 0.5 + (v.z - 0.5) * 0.35;
  float isl = smoothstep(0.30, 0.62, fbm1(p / 780.0 + 9.0, 4, lod / 780.0, 53u));
  float rocks = isl * (30.0 + 46.0 * ridge1(p / 210.0, 4, lod / 210.0, 54u));
  return swell + crust + rocks;
}

// Terraced mesas cut by canyons that hold rivers of lava.
float emberRiver(vec2 p, float lod) {
  float c = fbm1(p / 640.0 + 11.0, 4, lod / 640.0, 63u);
  return 1.0 - smoothstep(0.0, 0.09, abs(c));
}
float heightEmber(vec2 p, float lod) {
  float m = fbm1(p / 800.0 + 6.0, 5, lod / 800.0, 61u) * 70.0 + ridge1(p / 420.0 + 3.0, 4, lod / 420.0, 62u) * 40.0;
  float t = m / 20.0;
  float ft = floor(t);
  float terr = (ft + smoothstep(0.3, 1.0, t - ft)) * 20.0;
  float c = fbm1(p / 640.0 + 11.0, 4, lod / 640.0, 63u);
  float canyon = smoothstep(0.0, 1.0, 1.0 - smoothstep(0.0, 0.42, abs(c)));
  return mix(terr, -44.0, canyon);
}

float heightRealm(int id, vec2 p, float lod) {
  switch (id) {
    case 0: return heightDunes(p, lod);
    case 1: return heightPrism(p, lod);
    case 2: return heightDeep(p, lod);
    case 3: return heightFlats(p, lod);
    default: return heightEmber(p, lod);
  }
}

// Position of a ground facet vertex: the lattice point nudged by a hash, so facets are irregular.
vec2 facetVertex(ivec2 c, float h) {
  vec4 j = hash4(c, 301u);
  return (vec2(c) + (j.xy - 0.5) * 0.7) * h;
}

// Blended height at a point, with the facet size `lod` in metres limiting the detail. The two realms go through one
// loop, so a program holds one copy of `heightRealm`, the largest piece of code in it, and not two at every call.
float terrain(vec2 p, float lod, RealmMix r) {
  float a = 0.0;
  float b = 0.0;
  for (int i = 0; i < 2; i++) {
    float h = heightRealm(i == 0 ? r.a : r.b, p, lod);
    if (i == 0) {
      a = h;
      if (r.t <= 0.001) return a;
    } else {
      b = h;
    }
  }
  return mix(a, b, r.t);
}

// Soft shadow cast by the smooth ground toward the sun, found by marching over it in steps that
// double in length. 1 is fully lit. `lod` is the facet size that gave `p` its height, and the march
// sees the ground at that same detail. A coarse facet is then not shadowed by swell that its own
// height lacks, and a fine one still sees the sand ripples, so they cast shadows.
float groundShadow(vec3 p, RealmMix r, float lod) {
  vec3 L = gW.sun.xyz;
  float horizontal = length(L.xz);
  if (L.y <= 0.004 || horizontal < 1e-4) return 1.0;
  vec2 dir = L.xz / horizontal;
  float rise = L.y / horizontal;
  float vis = 1.0;
  float t = 1.6;
  for (int i = 0; i < 9; i++) {
    float surface = terrain(p.xz + dir * t, lod, r);
    float clear = p.y + t * rise - surface;
    vis = min(vis, clamp(clear / (0.8 + 0.2 * t) * 1.4 + 0.3, 0.0, 1.0));
    t *= 1.75;
  }
  return vis;
}
