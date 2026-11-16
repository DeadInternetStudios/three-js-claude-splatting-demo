// A splat nobody can see. It stays in the draw order with no opacity, so when the view turns toward it the
// next frame draws it where the order already expects it, and Spark's vertex stage drops it on one fetch.
CovSplat culledSplat(CovSplat o, vec3 p) {
  o.center = p;
  o.flags = GSPLAT_FLAG_ACTIVE;
  o.xxyyzz = vec3(1e-3);
  return o;
}

// Spark stores how two axes of a splat move together as the log of their correlation in a half float. A
// correlation within 6e-5 of 1 needs a subnormal half. A GPU that flushes those to zero (Firefox on a Mac
// does) reads it back as 0, and a long thin splat turns into a fat blob. A fold that stretches the world makes
// many such splats, and a few facets are that thin without one. A small floor on the variances keeps every
// correlation clear of the limit. `scripts/qa/encodable.mjs` checks it.
const float CORRELATION_GAP = 2e-4;
mat3 keepEncodable(mat3 cov) {
  vec3 v = max(vec3(cov[0][0], cov[1][1], cov[2][2]), vec3(1e-20));
  vec3 c = vec3(cov[0][1] * inversesqrt(v.x * v.y), cov[0][2] * inversesqrt(v.x * v.z), cov[1][2] * inversesqrt(v.y * v.z));
  if (max(abs(c.x), max(abs(c.y), abs(c.z))) < 1.0 - CORRELATION_GAP) return cov;
  return cov + mat3(0.5 * CORRELATION_GAP * (v.x + v.y + v.z));
}

// Entry point of every procedural layer. The layer supplies `bool layerGen(int index, sampler2D field, out Surfel s)`,
// where `field` holds values a pass precomputed per cell, or one empty texel for layers that have none.
CovSplat runLayer(int index, WorldParams w, DeformParams d, LayerParams l, sampler2D field) {
  gW = w;
  gL = l;
  gSeed = worldSeed(w);
  gTime = w.time.x;
  CovSplat o;
  o.center = vec3(0.0);
  o.flags = 0u;
  o.rgba = vec4(0.0);
  o.xxyyzz = vec3(0.0);
  o.index = index;
  o.xyxzyz = vec3(0.0);
  Surfel s = newSurfel();
  if (!layerGen(index, field, s)) return o;
  if (s.culled) return culledSplat(o, s.pos);
  if (s.opacity <= 0.002) return o;
  vec3 p = s.pos;
  mat3 jac = mat3(1.0);
  float vis = 1.0;
  deformPoint(d, p, jac, vis);
  if (vis <= 0.002) return o;
  mat3 cov = keepEncodable(jac * s.cov * transpose(jac));
  if (outsideView(p, splatReach(cov))) return culledSplat(o, p);
  vec3 n = normalize(cofactor3(jac) * s.nrm);
  vec3 toEye = w.eye.xyz - p;
  if (dot(n, toEye) < 0.0) n = -n;
  vec3 col = shadeSurfel(s, n, p);
  float keep = fogTransmittance(p);
  col = col * keep + hazeColor(normalize(-toEye)) * (1.0 - keep);
  o.center = p;
  o.flags = GSPLAT_FLAG_ACTIVE;
  o.rgba = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), s.opacity * vis);
  o.xxyyzz = vec3(cov[0][0], cov[1][1], cov[2][2]);
  o.xyxzyz = vec3(cov[0][1], cov[0][2], cov[1][2]);
  return o;
}
