// A Surfel is what a layer produces for one splat index, in the rest space of the world,
// before the fold. The entry point turns it into a Gaussian: it carries the position and the
// covariance through the deformation, lights it with the folded normal and packs the result.
struct Surfel {
  vec3 pos;
  vec3 nrm;     // unit normal used for shading
  mat3 cov;     // covariance in rest space, thickness included
  vec3 albedo;  // linear reflectance
  vec3 emit;    // linear radiance added after lighting, may exceed 1
  float opacity;
  float lit;     // 1 lets the sun and sky light the surface, 0 shows only emit
  float shadow;  // multiplies the direct sun, 1 is fully lit
  float trans;   // 0..1 how much sun shines through from behind, for paper and petals
  bool culled;   // set by a layer that found the surfel outside the view and skipped the rest of its work
};

Surfel newSurfel() {
  Surfel s;
  s.pos = vec3(0.0);
  s.nrm = vec3(0.0, 1.0, 0.0);
  s.cov = mat3(0.0);
  s.albedo = vec3(0.5);
  s.emit = vec3(0.0);
  s.opacity = 1.0;
  s.lit = 1.0;
  s.shadow = 1.0;
  s.trans = 0.0;
  s.culled = false;
  return s;
}

mat3 covDisc(vec3 n, float radius, float thickness) {
  return mat3(radius * radius) + outerProduct(n, n) * (thickness * thickness - radius * radius);
}
mat3 covIso(float r) { return mat3(r * r); }
// Elongated along dir: sigma l along it, w across.
mat3 covStroke(vec3 dir, float l, float w) {
  return mat3(w * w) + outerProduct(dir, dir) * (l * l - w * w);
}

// Radius in metres that holds the visible part of a splat with covariance cov: 2.83 standard
// deviations, with the trace standing in for the largest variance.
float splatReach(mat3 cov) { return 2.83 * sqrt(cov[0][0] + cov[1][1] + cov[2][2]); }

// Barycentric weights, on the triangle a, b, c, of the centre of the last sub-triangle triSurfel made.
vec3 gBary;

// Sub-triangle k of the n x n subdivision of triangle (a, b, c). Fills the three corners.
void triSub(int n, int k, out vec2 v0, out vec2 v1, out vec2 v2) {
  int row = int(floor(float(n) - sqrt(float(n * n - k))));
  row = clamp(row, 0, n - 1);
  if (2 * n * (row + 1) - (row + 1) * (row + 1) <= k) row++;
  else if (2 * n * row - row * row > k) row--;
  int local = k - (2 * n * row - row * row);
  int i = local / 2;
  float fi = float(i);
  float fj = float(row);
  if ((local & 1) == 0) {
    v0 = vec2(fi, fj);
    v1 = vec2(fi + 1.0, fj);
    v2 = vec2(fi, fj + 1.0);
  } else {
    v0 = vec2(fi + 1.0, fj);
    v1 = vec2(fi, fj + 1.0);
    v2 = vec2(fi + 1.0, fj + 1.0);
  }
}

// A flat patch covering sub-triangle k of triangle (a, b, c). spread scales the footprint, so
// 1.0 follows the sub-triangle's own spread and larger values overlap neighbours.
Surfel triSurfel(vec3 a, vec3 b, vec3 c, int n, int k, float spread, float thickness) {
  vec2 u0, u1, u2;
  triSub(n, k, u0, u1, u2);
  float inv = 1.0 / float(n);
  vec3 ab = b - a;
  vec3 ac = c - a;
  vec3 q0 = a + ab * (u0.x * inv) + ac * (u0.y * inv);
  vec3 q1 = a + ab * (u1.x * inv) + ac * (u1.y * inv);
  vec3 q2 = a + ab * (u2.x * inv) + ac * (u2.y * inv);
  vec3 g = (q0 + q1 + q2) * (1.0 / 3.0);
  float bx = (u0.x + u1.x + u2.x) * inv / 3.0;
  float by = (u0.y + u1.y + u2.y) * inv / 3.0;
  gBary = vec3(1.0 - bx - by, bx, by);
  vec3 d0 = q0 - g;
  vec3 d1 = q1 - g;
  vec3 d2 = q2 - g;
  vec3 nrm = normalize(cross(ab, ac));
  Surfel s = newSurfel();
  s.pos = g;
  s.nrm = nrm;
  mat3 inplane = (outerProduct(d0, d0) + outerProduct(d1, d1) + outerProduct(d2, d2)) * (spread * spread / 12.0);
  s.cov = inplane + outerProduct(nrm, nrm) * (thickness * thickness);
  return s;
}

// Cofactor matrix: transforms normals through a map with Jacobian j, up to a positive scale.
mat3 cofactor3(mat3 j) {
  return mat3(cross(j[1], j[2]), cross(j[2], j[0]), cross(j[0], j[1]));
}
