// The full sky: haze gradient, sun or moon or black sun, stars, milky way, aurora, a ringed
// planet, paper-cut clouds, distant ranges and, under water, the lit surface seen from below. Used only by the sky
// pass, because stars read screen-space derivatives to keep their size steady.

vec3 starsAt(vec3 d) {
  vec3 g = d * 150.0;
  vec3 fl = floor(g);
  ivec3 id = ivec3(fl);
  vec3 f = g - fl;
  uint h = hash3(uint(id.x), uint(id.y), uint(id.z) + 7u);
  float present = u24(pcg(h + 3u));
  if (present < 0.986) return vec3(0.0);
  vec3 pos = vec3(u24(h), u24(pcg(h + 1u)), u24(pcg(h + 2u)));
  float m = u24(pcg(h + 4u));
  float pw = length(fwidth(g));
  float radius = max(0.1, pw * 0.8);
  float dist = length(f - pos);
  float falloff = 1.0 - smoothstep(0.0, radius, dist);
  float energy = min(1.0, (0.1 * 0.1) / (radius * radius));
  float twinkle = 0.75 + 0.25 * sin(gTime * (2.0 + 4.0 * m) + m * 80.0);
  vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.65), u24(pcg(h + 5u)));
  return tint * falloff * energy * twinkle * (0.5 + 5.0 * m * m * m);
}

// A paper cloud layer: hard-edged shapes lit on the side that faces the sun.
vec4 cloudLayer(vec3 d, float height, float scale, float cover, float seed, vec2 wind) {
  if (d.y < 0.01) return vec4(0.0);
  vec2 uv = d.xz / (d.y + height) * scale + wind * gTime;
  float n = fbm1(uv, 4, 0.0, 830u + uint(seed));
  float m = smoothstep(cover, cover + 0.018, n);
  if (m <= 0.0) return vec4(0.0);
  vec2 toSun = normalize(gW.sun.xz + vec2(0.0001)) * 0.035;
  float n2 = fbm1(uv + toSun, 4, 0.0, 830u + uint(seed));
  float lit = clamp((n - n2) * 14.0 + 0.5, 0.0, 1.0);
  float fade = smoothstep(0.01, 0.16, d.y);
  vec3 shade = mix(gW.zenith.rgb * 0.9 + gW.horizon.rgb * 0.35, gW.horizon.rgb * 0.6, 0.4);
  vec3 sunlit = gW.sunColor.rgb * gW.sun.w * 0.14 + gW.horizon.rgb * 0.4;
  vec3 col = mix(shade, sunlit, lit * clamp(gW.sun.y * 4.0 + 0.7, 0.0, 1.0));
  return vec4(col, m * fade * 0.92);
}

vec3 ringedPlanet(vec3 d, out float alpha) {
  alpha = 0.0;
  vec3 pd = normalize(vec3(-0.62, 0.3, -0.72));
  float R = 0.075;
  vec3 C = pd;
  vec3 rn = normalize(vec3(0.22, 1.0, 0.38));
  vec3 col = vec3(0.0);
  float tSphere = 1e9;
  float b = dot(d, C);
  float disc = b * b - (1.0 - R * R);
  if (disc > 0.0 && b > 0.0) {
    tSphere = b - sqrt(disc);
    vec3 P = d * tSphere;
    vec3 N = normalize(P - C);
    float lit = clamp(dot(N, normalize(vec3(0.6, 0.35, 0.7))) * 0.6 + 0.45, 0.0, 1.0);
    float bands = 0.5 + 0.5 * sin(N.y * 22.0 + 2.5 * vnoise(vec2(N.x * 3.0 + N.z * 2.0, N.y * 7.0), 850u));
    vec3 base = mix(vec3(0.95, 0.72, 0.58), vec3(0.62, 0.34, 0.5), bands);
    col = base * lit * 1.4;
    alpha = 1.0;
  }
  float denom = dot(d, rn);
  if (abs(denom) > 1e-4) {
    float t = dot(C, rn) / denom;
    if (t > 0.0) {
      vec3 P = d * t;
      float r = length(P - C) / R;
      if (r > 1.35 && r < 2.45) {
        float gap = smoothstep(0.0, 0.03, abs(r - 1.95) - 0.05);
        float ring = (0.55 + 0.45 * sin(r * 40.0)) * gap * smoothstep(1.35, 1.5, r) * (1.0 - smoothstep(2.3, 2.45, r));
        if (t < tSphere || alpha < 0.5) {
          vec3 rc = mix(vec3(0.9, 0.78, 0.65), vec3(0.65, 0.5, 0.6), 0.5 + 0.5 * sin(r * 17.0)) * 1.25;
          col = mix(col, rc, ring * 0.85);
          alpha = max(alpha, ring * 0.85);
        }
      }
    }
  }
  return col;
}

vec3 sunVisual(vec3 d) {
  float s = dot(d, gW.sun.xyz);
  vec3 sunCol = gW.sunColor.rgb * gW.sun.w;
  float ang = acos(clamp(s, -1.0, 1.0));
  vec3 col = vec3(0.0);
  if (gW.skyB.z > 0.5) {
    float r0 = 0.05;
    float corona = exp(-max(ang - r0, 0.0) * 38.0) * 2.4;
    float az = atan(d.x - gW.sun.x, d.z - gW.sun.z);
    float rays = 0.65 + 0.35 * vnoise(vec2(az * 9.0, 0.0), 860u);
    col += vec3(1.0, 0.45, 0.12) * corona * rays * step(r0, ang);
    col += vec3(1.0, 0.3, 0.08) * pow(max(s, 0.0), 12.0) * 0.5;
    return col * gW.sun.w * 0.5;
  }
  if (gW.skyB.w > 0.5) {
    float r0 = 0.035;
    if (ang < r0) {
      vec3 e1 = normalize(cross(gW.sun.xyz, vec3(0.0, 1.0, 0.0)));
      vec3 e2 = cross(gW.sun.xyz, e1);
      vec2 q = vec2(dot(d, e1), dot(d, e2)) / r0;
      float crater = vnoise(q * 3.0, 870u) * 0.5 + vnoise(q * 7.0, 871u) * 0.25;
      float limb = 1.0 - smoothstep(r0 * 0.9, r0, ang);
      col = vec3(0.8, 0.88, 1.0) * (0.75 + 0.45 * crater) * limb * 3.0;
    }
    col += vec3(0.4, 0.55, 1.0) * (pow(max(s, 0.0), 160.0) * 0.8 + pow(max(s, 0.0), 14.0) * 0.12);
    return col;
  }
  float disc = smoothstep(0.9993, 0.99965, s);
  float halo = pow(max(s, 0.0), 220.0);
  col += sunCol * (disc * 14.0 + halo * 1.5);
  return col;
}

vec3 waterCeiling(vec3 d) {
  float s = max(dot(d, gW.sun.xyz), 0.0);
  float az = atan(d.x - gW.sun.x, d.z - gW.sun.z);
  float rays = 0.45 + 0.55 * vnoise(vec2(az * 10.0 + gTime * 0.06, 3.0), 880u);
  vec3 col = gW.sunColor.rgb * gW.sun.w * 0.12 * (pow(s, 5.0) * rays + pow(s, 40.0));
  if (d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.3) * 1.8 + vec2(gTime * 0.05, gTime * 0.03);
    float ripple = 1.0 - smoothstep(0.0, 0.25, abs(vnoise(uv * 3.0, 881u) + 0.4 * vnoise(uv * 7.0, 882u)));
    col += vec3(0.5, 0.95, 1.0) * ripple * 0.22 * smoothstep(0.05, 0.4, d.y);
  }
  return col;
}

// Meteors for the starry realms: three streaks, each crossing for about two seconds in
// every half minute or so. A head with a tail along the great circle it travels.
vec3 meteors(vec3 d, float t) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float cyc = 23.0 + fi * 7.0;
    float ph = fract(t / cyc + fi * 0.37);
    if (ph > 0.09) continue;
    float life = ph / 0.09;
    vec3 axis = normalize(vec3(sin(fi * 2.4 + 1.0), 0.3 + 0.18 * fi, cos(fi * 1.7)));
    vec3 start = normalize(vec3(cos(fi * 3.1), 0.6 - 0.12 * fi, sin(fi * 2.2 + 0.5)));
    float travel = life * 0.85;
    vec3 head = normalize(start + axis * travel);
    float headGlow = pow(clamp(dot(d, head), 0.0, 1.0), 600.0) * 4.0;
    vec3 lp = start + axis * clamp(dot(d - start, axis), 0.0, travel);
    float tail = exp(-pow(acos(clamp(dot(d, normalize(lp)), -1.0, 1.0)) * 38.0, 2.0));
    sum += (headGlow + tail * 1.5) * sin(3.14159 * life);
  }
  return sum * vec3(0.85, 0.92, 1.1);
}

// A forked bolt that comes down out of the clouds at the azimuth in skyC.z.
vec3 lightningBolt(vec3 d) {
  float az = atan(d.x, -d.z) - gW.skyC.z;
  az -= 6.2831853 * floor((az + 3.1415927) / 6.2831853);
  float el = d.y;
  if (abs(az) > 0.3 || el < -0.01 || el > 0.75) return vec3(0.0);
  float shape = gW.skyC.w * 40.0;
  float reach = smoothstep(-0.01, 0.02, el) * (1.0 - smoothstep(0.5, 0.68, el));
  float wander = 0.045 * vnoise(vec2(el * 8.0, shape), 861u) + 0.016 * vnoise(vec2(el * 29.0, shape), 862u) + 0.005 * vnoise(vec2(el * 90.0, shape), 863u);
  float x = az - wander;
  float w = 0.0028 * (0.7 + 0.9 * el / 0.6);
  float core = exp(-x * x / (w * w));
  float halo = exp(-x * x / (w * w * 140.0));
  float forkAt = 0.12 + 0.22 * fract(shape * 0.183);
  float side = fract(shape * 0.331) < 0.5 ? -1.0 : 1.0;
  float xf = x - side * (el - forkAt) * 0.45 - 0.01 * vnoise(vec2(el * 45.0, shape + 3.0), 864u);
  float fork = exp(-xf * xf / (w * w * 0.6)) * step(forkAt, el) * (1.0 - smoothstep(forkAt + 0.06, forkAt + 0.2, el));
  return (vec3(1.0, 0.94, 0.86) * (core + 0.7 * fork) * 7.0 + STORM_TINT * halo * 0.55) * reach * gW.skyC.y;
}

// Each feature of the sky is skipped where it cannot show: below the horizon, where the ground
// hides it, and in realms that have none of it. The sky pass is the dearest pass of the frame.
vec3 skyColor(vec3 d) {
  vec3 col = hazeColor(d);
  if (d.y > -0.02) {
    float up = smoothstep(-0.02, 0.18, d.y);
    if (gW.skyA.x > 0.0) {
      col += (starsAt(d) * gW.skyA.x) * up;
      col += meteors(d, gTime) * gW.skyA.x * up;
    }
    if (gW.skyB.x > 0.0) col += milkyWay(d) * gW.skyB.x * up;
    if (gW.skyA.y > 0.0) col += auroraSky(d, gTime) * up;
  }
  if (dot(d, gW.sun.xyz) > 0.5) col += sunVisual(d);
  if (gW.skyA.w > 0.0 && d.y > -0.05) {
    float pa;
    vec3 pc = ringedPlanet(d, pa);
    col = mix(col, pc, pa * gW.skyA.w * smoothstep(0.0, 0.05, d.y + 0.05));
  }
  if (gW.skyA.z > 0.1 && d.y > 0.01) {
    vec4 c0 = cloudLayer(d, 0.35, 1.2, 0.78 - 0.5 * gW.skyA.z, 1.0, vec2(0.004, 0.0015));
    vec4 c1 = cloudLayer(d, 0.2, 2.1, 0.8 - 0.5 * gW.skyA.z, 2.0, vec2(0.007, -0.002));
    vec4 c2 = cloudLayer(d, 0.1, 3.4, 0.82 - 0.5 * gW.skyA.z, 3.0, vec2(0.011, 0.003));
    vec3 lift = vec3(1.0);
    if (gW.skyC.y > 0.0) lift += STORM_TINT * gW.skyC.y * (1.5 + 6.0 * pow(clamp(dot(d, stormDir()), 0.0, 1.0), 4.0));
    col = mix(col, c0.rgb * 0.85 * lift, c0.a);
    col = mix(col, c1.rgb * 0.95 * lift, c1.a);
    col = mix(col, c2.rgb * lift, c2.a);
  }
  if (gW.skyC.y > 0.0) col += lightningBolt(d);
  col = horizonRanges(col, d, fwidth(d.y));
  if (gW.skyB.y > 0.0) col += waterCeiling(d) * gW.skyB.y;
  return col;
}

// Below the horizon the Mirror Flats show the sky upside down, seen through a thin film of
// water that the ground splats leave open at grazing angles. Each pixel draws the sky once.
vec3 skyAndWater(vec3 d) {
  float below = flatsAtEye() * (1.0 - smoothstep(-0.004, 0.0, d.y));
  if (below <= 0.0) return skyColor(d);
  vec3 mirrored = skyColor(vec3(d.x, abs(d.y), d.z)) * vec3(0.72, 0.8, 0.9);
  if (below >= 1.0) return mirrored;
  return mix(skyColor(d), mirrored, below);
}
