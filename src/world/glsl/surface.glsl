// Ground colour and glow of each realm. A surface answers: what does the ground look like at
// this point, with this facet normal, seen along this direction?

struct Surf {
  vec3 albedo;  // linear reflectance
  vec3 emit;    // linear radiance added after lighting
  float lit;    // 0 hides sun and sky and shows only emit
  vec3 nrm;     // the facet normal, leaned by the relief the splats are too coarse to model
  float cover;  // 1 hides what lies below the ground, less lets the mirror below it show through
};

// About how many ground splats overlap at any point. A share of the light to let through is split
// over that many splats, which each pass the same fraction on.
const float GROUND_OVERLAP = 8.0;

// Metres between splat centres on the ground being drawn, and a random number for this splat
// that stays the same wherever the eye is. The ground layer sets both.
float gSpacing = 0.3;
float gGrain = 0.5;

// How much of a feature of this wavelength the splats can show. Under about two splats per
// wave a feature would only shimmer, so it fades out.
float resolvable(float wavelength) {
  return smoothstep(1.6, 3.6, wavelength / gSpacing);
}

// Relief fades with distance as well, so it never pops where one ring hands over to the next.
float nearOnly(vec3 p, float from, float to) {
  return 1.0 - smoothstep(from, to, distance(p, gW.eye.xyz));
}

// Leans normal n against the slope g of a height field, keeping the tilt in the tangent plane.
vec3 leanNormal(vec3 n, vec2 g) {
  vec3 t = vec3(g.x, 0.0, g.y);
  t -= n * dot(t, n);
  return normalize(n - t);
}

// Wind ripples with crests that run across `wind`, bent a little so they fork and drift like
// real ones. Returns the ripple height in x and its slope, as a tilt of about one, in yz.
vec3 ripples(vec2 xz, vec2 wind, float lambda, float seed) {
  float k = TAU_ / lambda;
  vec2 across = vec2(-wind.y, wind.x);
  float w1 = dot(xz, across) * k * 0.23 + seed;
  float w2 = dot(xz, wind) * k * 0.31 + seed * 2.0;
  float warp = 0.9 * sin(w1) + 0.6 * sin(w2 + 1.7);
  vec2 dwarp = 0.9 * cos(w1) * across * 0.23 + 0.6 * cos(w2 + 1.7) * wind * 0.31;
  float phase = dot(xz, wind) * k + warp * 1.4;
  vec2 dphase = wind + dwarp * 1.4;
  // The lee side is steeper than the windward side.
  float height = sin(phase) + 0.22 * sin(2.0 * phase + 0.6);
  float slope = cos(phase) + 0.44 * cos(2.0 * phase + 0.6);
  return vec3(height, slope * dphase);
}

vec3 palette6(float t, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5) {
  t = clamp(t, 0.0, 1.0) * 5.0;
  vec3 col = c0;
  col = mix(col, c1, clamp(t, 0.0, 1.0));
  col = mix(col, c2, clamp(t - 1.0, 0.0, 1.0));
  col = mix(col, c3, clamp(t - 2.0, 0.0, 1.0));
  col = mix(col, c4, clamp(t - 3.0, 0.0, 1.0));
  col = mix(col, c5, clamp(t - 4.0, 0.0, 1.0));
  return col;
}

float fresnelSchlick(float cosine, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - clamp(cosine, 0.0, 1.0), 5.0);
}

Surf surfDunes(vec3 p, vec3 n, vec3 toEye, float hA, float hB) {
  float slope = 1.0 - n.y;
  float t = (p.y + 12.0) / 62.0 + (hA - 0.5) * 0.06;
  float band = floor(t * 7.0) / 7.0;
  t = mix(t, band + 0.07, 0.55);
  vec3 col = palette6(t,
    vec3(0.42, 0.32, 0.42), vec3(0.76, 0.5, 0.48), vec3(0.95, 0.68, 0.48),
    vec3(0.98, 0.8, 0.56), vec3(1.0, 0.9, 0.7), vec3(1.0, 0.96, 0.86));
  col = mix(col, col * vec3(0.8, 0.6, 0.75), smoothstep(0.2, 0.6, slope) * 0.5);
  col *= 0.94 + 0.12 * hB;
  // Wind ripples, strongest where the sand lies flat and gone from the steep lee faces. The
  // wind blows at an angle to the sun, so the low light rakes across the crests.
  float calm = (1.0 - smoothstep(0.2, 0.5, slope)) * nearOnly(p, 16.0, 38.0);
  float tinySeen = resolvable(0.43) * calm;
  float fineSeen = resolvable(1.15) * calm;
  float swellSeen = resolvable(3.1) * calm;
  vec3 tiny = ripples(p.xz, vec2(0.906, -0.423), 0.43, 7.0);
  vec3 fine = ripples(p.xz, vec2(0.957, -0.291), 1.15, 2.0);
  vec3 swell = ripples(p.xz, vec2(-0.03, -1.0), 3.1, 5.0);
  vec3 nn = leanNormal(n, tiny.yz * 0.2 * tinySeen + fine.yz * 0.46 * fineSeen + swell.yz * 0.16 * swellSeen);
  col *= 1.0 + 0.03 * tiny.x * tinySeen + 0.07 * fine.x * fineSeen + 0.03 * swell.x * swellSeen;
  col *= 1.0 + (gGrain - 0.5) * 0.14 * resolvable(0.3) * nearOnly(p, 5.0, 14.0);
  Surf s;
  s.albedo = srgb2lin(col);
  s.nrm = nn;
  // A few grains catch the sun per facet, so the sand glitters as the eye moves.
  float glint = pow(clamp(dot(reflect(-normalize(toEye), nn), sunDir()), 0.0, 1.0), 48.0);
  s.emit = gW.sunColor.rgb * glint * (0.25 + 1.3 * pow(hB, 6.0)) * gW.sun.w * 0.14;
  s.lit = 1.0;
  s.cover = 1.0;
  return s;
}

Surf surfPrism(vec3 p, vec3 n, vec3 toEye, float hA, float hB) {
  vec4 v = voronoi(p.xz, 150.0, 31u);
  float edge = 1.0 - smoothstep(0.0, 0.04, v.y - v.x);
  float pulse = 0.65 + 0.35 * sin(gTime * 0.9 + v.z * 40.0);
  vec3 neon = srgb2lin(hsv2rgb(vec3(0.48 + 0.38 * v.w, 0.8, 1.0)));
  vec3 glass = vec3(0.03, 0.025, 0.07) + vec3(0.04, 0.03, 0.08) * hB;
  // The floor is a slab of cut crystal. Its facets are a few metres wide, each leans its own
  // way, and dim neon seams join them.
  vec4 cut = voronoi(p.xz, 3.6, 33u);
  float seen = resolvable(3.0) * nearOnly(p, 24.0, 52.0);
  float turn = cut.z * TAU_;
  vec3 nn = leanNormal(n, vec2(cos(turn), sin(turn)) * (0.06 + 0.2 * cut.w) * seen);
  float seam = (1.0 - smoothstep(0.0, 0.06, cut.y - cut.x)) * seen;
  vec3 seamColor = srgb2lin(hsv2rgb(vec3(0.5 + 0.3 * cut.w, 0.7, 1.0)));
  Surf s;
  s.albedo = srgb2lin(glass);
  s.nrm = nn;
  float f = fresnelSchlick(dot(nn, normalize(toEye)), 0.04);
  vec3 rdir = reflect(-normalize(toEye), nn);
  vec3 refl = skyReflection(rdir);
  float glint = pow(clamp(dot(rdir, sunDir()), 0.0, 1.0), 160.0);
  s.emit = neon * edge * 2.4 * pulse + seamColor * seam * 0.55 * (0.6 + 0.4 * pulse) + refl * f * 1.4 + gW.sunColor.rgb * glint * 2.2;
  s.lit = 1.0;
  s.cover = 1.0;
  return s;
}

float caustic(vec2 xz, float t) {
  vec4 a = voronoi(xz + vec2(t * 0.55, t * 0.35), 7.0, 71u);
  vec4 b = voronoi(xz * 1.3 + vec2(-t * 0.4, t * 0.6), 6.0, 72u);
  float la = 1.0 - smoothstep(0.0, 0.2, a.y - a.x);
  float lb = 1.0 - smoothstep(0.0, 0.2, b.y - b.x);
  return la * 0.7 + lb * 0.7;
}

Surf surfDeep(vec3 p, vec3 n, float hA, float hB) {
  float t = smoothstep(-30.0, 30.0, p.y);
  vec3 col = mix(vec3(0.03, 0.17, 0.22), vec3(0.42, 0.5, 0.4), t);
  col = mix(col, vec3(0.9, 0.42, 0.45), smoothstep(0.55, 0.9, hA) * 0.25 * (1.0 - t));
  col *= 0.92 + 0.16 * hB;
  // Slow currents have combed the sand into ripples.
  float seen = resolvable(0.95) * nearOnly(p, 14.0, 34.0);
  float tinySeen = resolvable(0.4) * nearOnly(p, 6.0, 16.0);
  vec3 rip = ripples(p.xz, vec2(0.6, -0.8), 0.95, 3.1);
  vec3 tiny = ripples(p.xz, vec2(0.8, -0.6), 0.4, 8.0);
  col *= 1.0 + 0.12 * rip.x * seen + 0.05 * tiny.x * tinySeen;
  col *= 1.0 + (gGrain - 0.5) * 0.12 * resolvable(0.3) * nearOnly(p, 5.0, 14.0);
  Surf s;
  s.albedo = srgb2lin(col);
  s.nrm = leanNormal(n, rip.yz * 0.55 * seen + tiny.yz * 0.2 * tinySeen);
  // Caustic lines narrower than a splat only shimmer, so far off they settle to their mean.
  float c = mix(0.5, caustic(p.xz, gTime), resolvable(1.4));
  s.emit = s.albedo * c * vec3(0.7, 1.4, 1.6) * 0.9;
  s.lit = 1.0;
  s.cover = 1.0;
  return s;
}

Surf surfFlats(vec3 p, vec3 n, vec3 toEye, float hA, float hB) {
  vec4 v = voronoi(p.xz, 34.0, 52u);
  float edge = 1.0 - smoothstep(0.0, 0.12, v.y - v.x);
  // The salt crust has cracked into polygons a few metres wide. Each is rimmed by a dry ridge
  // that breaks the mirror, and a slow swell moves the film of water over the rest.
  vec4 crust = voronoi(p.xz, 3.4, 53u);
  float seen = resolvable(0.9) * nearOnly(p, 22.0, 48.0);
  float ridge = (1.0 - smoothstep(0.0, 0.1, crust.y - crust.x)) * seen;
  vec3 swell = ripples(p.xz, vec2(0.8, 0.6), 7.0, 1.0);
  vec3 nn = leanNormal(n, swell.yz * 0.03 * resolvable(7.0));
  vec3 dir = normalize(toEye);
  float f = fresnelSchlick(dot(nn, dir), 0.02);
  vec3 refl = skyReflection(reflect(-dir, nn)) * (1.0 - 0.75 * ridge);
  vec3 under = srgb2lin(mix(vec3(0.13, 0.19, 0.28), vec3(0.5, 0.55, 0.6), clamp(edge * 0.8 + hB * 0.1 + ridge * 0.9, 0.0, 1.0)));
  Surf s;
  s.albedo = under;
  s.nrm = nn;
  float glint = pow(clamp(dot(reflect(-dir, nn), sunDir()), 0.0, 1.0), 220.0);
  s.emit = refl * (0.55 + 0.9 * f) + gW.sunColor.rgb * glint * gW.sun.w * 1.6;
  s.lit = 0.35 + 0.4 * ridge;
  // Water is a mirror only at a grazing angle. Close by or from above it is clear and shows the
  // crust, so the splats stay solid there and thin out toward the horizon, where the mirror
  // below the ground shows through. Dry ridges break the mirror.
  float reflected = 0.85 * smoothstep(0.04, 0.5, f) * (1.0 - ridge);
  s.cover = 1.0 - pow(reflected, 1.0 / GROUND_OVERLAP);
  return s;
}

// Canyon strata: each 7 m band of height is one rock, picked by a hash of the band number.
vec3 emberStratum(float band) {
  float h = hash4i(uint(int(band) + 4096), 83u).x;
  return palette6(floor(h * 5.999) / 5.0,
    vec3(0.045, 0.035, 0.04), vec3(0.3, 0.085, 0.05), vec3(0.5, 0.25, 0.1),
    vec3(0.17, 0.04, 0.055), vec3(0.13, 0.075, 0.06), vec3(0.34, 0.26, 0.24));
}

Surf surfEmber(vec3 p, vec3 n, float hA, float hB) {
  float k = (p.y + 44.0) / 7.0 + (hA - 0.5) * 0.35;
  float band = floor(k);
  vec3 col = mix(emberStratum(band), emberStratum(band + 1.0), smoothstep(0.8, 1.0, fract(k)));
  float flatTop = (1.0 - smoothstep(0.03, 0.16, 1.0 - n.y)) * smoothstep(-20.0, 30.0, p.y);
  col = mix(col, vec3(0.3, 0.2, 0.17), flatTop * 0.55);
  col *= 0.82 + 0.36 * hB;
  // Thin beds of rock show as fine stripes across the steep faces.
  float rise = sqrt(max(1.0 - n.y * n.y, 0.0));
  float bed = 0.5 + 0.5 * sin(p.y * (TAU_ / 0.8) + 1.6 * sin(p.y * (TAU_ / 3.3)));
  col *= 1.0 - 0.34 * bed * smoothstep(0.15, 0.6, rise) * resolvable(0.8 / max(rise, 0.1));

  float river = emberRiver(p.xz, 0.0);
  float lava = smoothstep(0.5, 0.78, river);
  float rim = smoothstep(0.34, 0.5, river) * (1.0 - lava);
  vec4 cr = voronoi(p.xz, 55.0, 81u);
  float crack = (1.0 - smoothstep(0.0, 0.035, cr.y - cr.x)) * (0.35 + 0.65 * (1.0 - smoothstep(-20.0, 40.0, p.y)));
  float flow = 0.6 + 0.4 * sin(p.x * 0.07 + p.z * 0.05 - gTime * 0.5 + hA * 6.0);
  vec3 magma = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.7, 0.18), flow);
  vec3 emit = magma * (crack * 1.1 + rim * 1.4);
  // Cooled crust has split into plates a few metres wide. Each plate leans a little, and the
  // seams between them still glow from the heat underneath.
  vec4 plate = voronoi(p.xz, 4.4, 84u);
  float seen = resolvable(1.3) * nearOnly(p, 20.0, 46.0) * (1.0 - smoothstep(0.1, 0.35, 1.0 - n.y));
  float turn = plate.z * TAU_;
  vec3 nn = leanNormal(n, vec2(cos(turn), sin(turn)) * (0.04 + 0.12 * plate.w) * seen);
  float plateSeam = 1.0 - smoothstep(0.0, 0.07, plate.y - plate.x);
  emit += mix(magma, vec3(1.0, 0.3, 0.05), 0.45) * plateSeam * seen * (0.22 + 0.3 * flow) * (1.0 - lava);
  if (lava > 0.01) {
    // Dark crust plates drift on the river and glow along the seams between them.
    vec4 pv = voronoi(p.xz + vec2(gTime * 1.4, gTime * 0.6), 11.0, 82u);
    float gap = pv.y - pv.x;
    float seam = 1.0 - smoothstep(0.0, 0.2, gap);
    float open = 1.0 - smoothstep(0.1, 0.45, gap);
    emit += magma * lava * ((0.3 + 0.7 * flow) * (0.3 + 0.5 * open) + 3.0 * seam);
  }
  Surf s;
  s.albedo = srgb2lin(mix(col, vec3(0.012, 0.008, 0.01), lava));
  s.emit = emit;
  s.nrm = nn;
  s.lit = 1.0;
  s.cover = 1.0;
  return s;
}

Surf surfRealm(int id, vec3 p, vec3 n, vec3 toEye, float hA, float hB) {
  switch (id) {
    case 0: return surfDunes(p, n, toEye, hA, hB);
    case 1: return surfPrism(p, n, toEye, hA, hB);
    case 2: return surfDeep(p, n, hA, hB);
    case 3: return surfFlats(p, n, toEye, hA, hB);
    default: return surfEmber(p, n, hA, hB);
  }
}

Surf surfaceAt(RealmMix r, vec3 p, vec3 n, vec3 toEye, float hA, float hB) {
  Surf a = surfRealm(r.a, p, n, toEye, hA, hB);
  if (r.t <= 0.001) return a;
  Surf b = surfRealm(r.b, p, n, toEye, hA, hB);
  Surf s;
  s.albedo = mix(a.albedo, b.albedo, r.t);
  s.emit = mix(a.emit, b.emit, r.t);
  s.lit = mix(a.lit, b.lit, r.t);
  s.nrm = normalize(mix(a.nrm, b.nrm, r.t));
  s.cover = mix(a.cover, b.cover, r.t);
  return s;
}
