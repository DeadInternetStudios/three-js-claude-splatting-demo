// A toroidal clipmap ring of paper facets. Each cell of the ring holds two triangles, each
// triangle is covered by n * n flat splats. Cell (u, v) of the ring always shows the same world
// cell, so cells keep their splat index while the ring window slides over the world.
//
// p0: cell size h, cells per side N, window corner (cell units)
// p1: inner radius, outer radius, outer fade band, subdivision n. The layer holds slots for the
//     finest n, and a coarser n leaves the slots past the last cell idle.
// p2: player x, player z, thickness factor, spread
// p3: inner fade band

// Height and shadow of a facet vertex, precomputed by CellField.
vec4 vertexField(sampler2D field, ivec2 c) {
  int m = int(gL.p0.y + 0.5) + 1;
  return texelFetch(field, ivec2(posmod(c.x, m), posmod(c.y, m)), 0);
}

bool layerGen(int index, sampler2D field, out Surfel s) {
  float h = gL.p0.x;
  int N = int(gL.p0.y);
  ivec2 corner = ivec2(gL.p0.zw);
  int n = int(gL.p1.w + 0.5);
  int perTri = n * n;
  int perCell = 2 * perTri;
  int cell = index / perCell;
  if (cell >= N * N) return false;
  int sub = index - cell * perCell;
  int tri = sub / perTri;
  int k = sub - tri * perTri;
  int u = cell % N;
  int v = cell / N;
  ivec2 w = corner + ivec2(posmod(u - corner.x, N), posmod(v - corner.y, N));

  vec4 cellHash = hash4(w, 300u);
  bool flip = cellHash.x > 0.5;
  ivec2 c00 = w;
  ivec2 c10 = w + ivec2(1, 0);
  ivec2 c01 = w + ivec2(0, 1);
  ivec2 c11 = w + ivec2(1, 1);
  ivec2 ca, cb, cc;
  if (!flip) {
    if (tri == 0) { ca = c00; cb = c10; cc = c01; } else { ca = c10; cb = c11; cc = c01; }
  } else {
    if (tri == 0) { ca = c00; cb = c10; cc = c11; } else { ca = c00; cb = c11; cc = c01; }
  }
  vec2 pa = facetVertex(ca, h);
  vec2 pb = facetVertex(cb, h);
  vec2 pc = facetVertex(cc, h);

  vec2 centerXZ = (pa + pb + pc) * (1.0 / 3.0);
  vec2 dp = abs(centerXZ - gL.p2.xy);
  float cheb = max(dp.x, dp.y);
  float inner = gL.p1.x;
  float outer = gL.p1.y;
  float alpha = 1.0 - smoothstep(outer - gL.p1.z, outer, cheb);
  if (inner > 0.0) alpha *= smoothstep(inner - gL.p3.x, inner, cheb);
  if (alpha <= 0.002) return false;

  // Realm blends are evaluated at each vertex, so facets that share a vertex agree on its height.
  vec4 fa = vertexField(field, ca);
  vec4 fb = vertexField(field, cb);
  vec4 fc = vertexField(field, cc);
  vec3 A = vec3(pa.x, fa.x, pa.y);
  vec3 B = vec3(pb.x, fb.x, pb.y);
  vec3 C = vec3(pc.x, fc.x, pc.y);
  s = triSurfel(A, B, C, n, k, gL.p2.w, h * gL.p2.z);
  if (gW.cull.z > 0.5 && outsideView(s.pos, splatReach(s.cov))) {
    s.culled = true;
    return true;
  }
  RealmMix realm = realmAt(centerXZ);
  float shadow = dot(vec3(fa.y, fb.y, fc.y), gBary);
  if (s.nrm.y < 0.0) s.nrm = -s.nrm;
  vec3 toEye = gW.eye.xyz - s.pos;
  gSpacing = h / float(n);
  gGrain = u24(pcg(uint(index) * 2654435761u + 17u));
  Surf surf = surfaceAt(realm, s.pos, s.nrm, toEye, cellHash.y, cellHash.z);
  s.nrm = surf.nrm;
  s.albedo = surf.albedo;
  s.emit = surf.emit;
  s.lit = surf.lit;
  s.shadow = shadow;
  s.opacity = alpha * surf.cover;
  return true;
}
