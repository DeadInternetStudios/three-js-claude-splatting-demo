// Distant ranges on the edge of the world, so that every long view has a skyline. Each of the three
// ranges is a polyline of peaks around the whole circle of the horizon. It runs straight between its
// knots, so every slope is one flat facet, like folded paper. Far ranges sit in haze, near ones are dark.
// Sky pass only: the ranges are drawn behind every splat and never reached.

// Per realm and range, far to near: elevation of the foot in radians, extra height of the peaks,
// how sharp the peaks are (above 1 means few tall ones), and how far off the range lies in km.
const vec4 RANGES[15] = vec4[15](
  vec4(0.015, 0.20, 1.6, 90.0), vec4(0.008, 0.12, 1.4, 60.0), vec4(0.002, 0.06, 1.2, 40.0),
  vec4(0.018, 0.28, 2.4, 90.0), vec4(0.008, 0.17, 2.0, 60.0), vec4(0.002, 0.08, 1.8, 40.0),
  vec4(0.010, 0.10, 1.2, 90.0), vec4(0.002, 0.06, 1.2, 60.0), vec4(-0.004, 0.03, 1.0, 40.0),
  vec4(0.006, 0.09, 2.0, 90.0), vec4(0.002, 0.05, 1.6, 60.0), vec4(0.000, 0.01, 1.0, 40.0),
  vec4(0.020, 0.32, 2.6, 90.0), vec4(0.008, 0.17, 2.0, 60.0), vec4(0.002, 0.07, 1.5, 40.0)
);
const int RANGE_KNOTS[3] = int[3](36, 56, 88);
const float RANGE_HAZE[3] = float[3](0.72, 0.46, 0.2);

float rangePeak(int knot, int n, float sharp, uint salt) {
  float r = u24(pcg(uint(posmod(knot, n)) * 2654435761u + salt + gSeed * 40503u));
  return pow(r, sharp);
}

// Height and slope of one polyline at `turns` of the way round the circle.
vec2 rangeLine(float turns, int n, float sharp, uint salt) {
  float x = turns * float(n);
  float i = floor(x);
  float h0 = rangePeak(int(i), n, sharp, salt);
  float h1 = rangePeak(int(i) + 1, n, sharp, salt);
  return vec2(mix(h0, h1, x - i), h1 - h0);
}

// Draws the ranges over `col` for the view direction d. `aa` is the size of a pixel in d.y.
vec3 horizonRanges(vec3 col, vec3 d, float aa) {
  if (d.y > 0.2 || d.y < -0.1) return col;
  int ra = int(gW.realm.x + 0.5);
  int rb = int(gW.realm.y + 0.5);
  float blend = gW.realm.z;
  float az = atan(d.x, -d.z);
  float sunAz = atan(gW.sun.x, -gW.sun.z);
  vec3 haze = hazeColor(normalize(vec3(d.x, 0.02, d.z)));
  vec3 lit = gW.sunColor.rgb * gW.sun.w * 0.07 + gW.horizon.rgb * 0.6;
  vec3 shade = gW.zenith.rgb * 0.5 + gW.bounce.rgb * 0.6 + gW.horizon.rgb * 0.15;
  float ember = (ra == REALM_EMBER ? 1.0 - blend : 0.0) + (rb == REALM_EMBER ? blend : 0.0);
  for (int k = 0; k < 3; k++) {
    vec4 range = mix(RANGES[ra * 3 + k], RANGES[rb * 3 + k], blend);
    // Moving the visitor sideways moves a range by its distance, so near ranges slide past the far ones.
    float bearing = az + dot(gW.eye.xz, vec2(cos(az), sin(az))) / (range.w * 1000.0);
    float turns = fract(bearing / 6.2831853);
    int n = RANGE_KNOTS[k];
    uint salt = 700u + uint(k) * 31u;
    vec2 broad = rangeLine(turns, n, range.z, salt);
    vec2 fine = rangeLine(turns, 3 * n, range.z, salt + 7u);
    float height = broad.x * 0.75 + fine.x * 0.25;
    float top = range.x + range.y * height;
    float over = smoothstep(top - aa, top + aa, d.y);
    float inside = (1.0 - over) * smoothstep(-0.1, -0.05, d.y);
    float facet = u24(pcg(uint(posmod(int(floor(turns * float(3 * n))), 3 * n)) + salt * 97u + gSeed));
    float side = sin(az - sunAz) * (broad.y * 0.75 * float(n) + fine.y * 0.25 * float(3 * n));
    vec3 rock = mix(shade, lit, smoothstep(-0.2, 0.2, side)) * (0.8 + 0.4 * facet);
    float depth = RANGE_HAZE[k] + (1.0 - RANGE_HAZE[k]) * 0.5 * (1.0 - smoothstep(top - 0.05, top, d.y));
    vec3 face = mix(rock, haze, depth);
    // The edge of a range against a low sun glows.
    float back = pow(max(cos(az - sunAz), 0.0), 6.0);
    face += gW.sunColor.rgb * gW.sun.w * 0.22 * back * exp(-max(top - d.y, 0.0) * 140.0);
    col = mix(col, face, inside);
    if (ember > 0.0) {
      // Some peaks of the Ember Canyons are volcanoes with a hot crown.
      float crown = smoothstep(0.5, 0.8, height) * ember;
      vec3 magma = vec3(1.0, 0.28, 0.05) * (0.8 + 0.4 * sin(gTime * 1.3 + facet * 40.0));
      col += magma * crown * (1.1 * inside * smoothstep(top - 0.012, top, d.y) + 0.35 * over * exp(-max(d.y - top, 0.0) * 55.0)) * (1.0 - RANGE_HAZE[k] * 0.5);
    }
  }
  return col;
}
