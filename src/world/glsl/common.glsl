// Shared helpers for every procedural layer: integer hashing, value noise, fractal sums and
// small colour and rotation utilities.
// The hash and the noise are mirrored line for line in src/world/cpu/noise.ts, so the
// walker stands on exactly the ground the GPU draws.

const float TAU_ = 6.28318530717959;

uint gSeed;
float gTime;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
uint hash3(uint x, uint y, uint z) { return pcg(x ^ pcg(y ^ pcg(z + 2246822507u))); }
uint hashCell(ivec2 c, uint salt) { return hash3(uint(c.x), uint(c.y), gSeed ^ salt); }
float u24(uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }
// Four independent uniform numbers from one cell.
vec4 hash4(ivec2 c, uint salt) {
  uint h = hashCell(c, salt);
  uint h1 = pcg(h + 1u);
  uint h2 = pcg(h + 2u);
  uint h3 = pcg(h + 3u);
  return vec4(u24(h), u24(h1), u24(h2), u24(h3));
}
vec4 hash4i(uint n, uint salt) {
  uint h = pcg(n ^ pcg(gSeed ^ salt));
  return vec4(u24(h), u24(pcg(h + 1u)), u24(pcg(h + 2u)), u24(pcg(h + 3u)));
}

int posmod(int a, int n) { return a - n * int(floor(float(a) / float(n))); }

float lattice(ivec2 c, uint salt) { return u24(hashCell(c, salt)) * 2.0 - 1.0; }

// Value noise with a quintic fade, in [-1, 1].
float vnoise(vec2 p, uint salt) {
  vec2 ip = floor(p);
  vec2 f = p - ip;
  ivec2 c = ivec2(ip);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = lattice(c, salt);
  float b = lattice(c + ivec2(1, 0), salt);
  float cc = lattice(c + ivec2(0, 1), salt);
  float d = lattice(c + ivec2(1, 1), salt);
  return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y);
}

const mat2 FBM_ROT = mat2(0.8, -0.6, 0.6, 0.8);

// Fractal sum of value noise, normalised to [-1, 1]. Octaves whose wavelength is shorter than
// about 1.4 times the facet size are skipped. `lodUnits` is the facet size in noise units.
float fbm1(vec2 p, int oct, float lodUnits, uint salt) {
  float sum = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  vec2 q = p;
  float norm = 2.0 * (1.0 - exp2(-float(oct)));
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    if (freq * lodUnits > 0.7) break;
    sum += amp * vnoise(q, salt + uint(i) * 977u);
    amp *= 0.5;
    freq *= 2.0;
    q = FBM_ROT * q * 2.0;
  }
  return sum / norm;
}

// Ridged variant with sharp crests, in [0, 1].
float ridge1(vec2 p, int oct, float lodUnits, uint salt) {
  float sum = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float weight = 1.0;
  vec2 q = p;
  float norm = 2.0 * (1.0 - exp2(-float(oct)));
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    if (freq * lodUnits > 0.7) break;
    float r = 1.0 - abs(vnoise(q, salt + uint(i) * 977u));
    sum += amp * weight * r;
    weight = clamp(r * 1.6, 0.0, 1.0);
    amp *= 0.5;
    freq *= 2.0;
    q = FBM_ROT * q * 2.0;
  }
  return sum / norm;
}

// Jittered cells of `scale` metres. x and y are the distances to the nearest and second nearest
// feature point in cell units, zw are two random numbers of the nearest cell.
vec4 voronoi(vec2 p, float scale, uint salt) {
  vec2 q = p / scale;
  vec2 fl = floor(q);
  ivec2 ip = ivec2(fl);
  vec2 f = q - fl;
  float d1 = 9.0;
  float d2 = 9.0;
  ivec2 best = ivec2(0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 c = ip + ivec2(i, j);
      vec2 o = hash4(c, salt).xy;
      vec2 r = vec2(float(i), float(j)) + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; best = c; }
      else if (d < d2) { d2 = d; }
    }
  }
  vec4 hb = hash4(best, salt + 13u);
  return vec4(sqrt(d1), sqrt(d2), hb.x, hb.y);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 srgb2lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
