// Sky pieces that need no screen-space derivatives, so ground layers can reflect them.

vec3 milkyWay(vec3 d) {
  vec3 n = normalize(vec3(0.35, 0.75, 0.55));
  vec3 e1 = normalize(cross(n, vec3(0.0, 0.0, 1.0)));
  vec3 e2 = cross(n, e1);
  float band = dot(d, n);
  float along = atan(dot(d, e2), dot(d, e1));
  float w = exp(-band * band / 0.014);
  float dust = fbm1(vec2(along * 3.0, band * 16.0), 5, 0.0, 811u);
  float core = exp(-pow(abs(along - 0.8), 2.0) / 0.9);
  vec3 col = mix(vec3(0.22, 0.28, 0.7), vec3(0.95, 0.55, 0.75), core);
  float lanes = 1.0 - 0.85 * smoothstep(0.05, 0.4, -dust);
  return col * w * (0.3 + 0.9 * smoothstep(-0.25, 0.6, dust)) * lanes * 0.16;
}

vec3 auroraSky(vec3 d, float t) {
  if (d.y < 0.02) return vec3(0.0);
  float az = atan(d.x, -d.z);
  float el = d.y;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float cz = az + fi * 2.1 + 0.4 * sin(t * 0.07 + fi);
    float rays = 0.5 + 0.5 * vnoise(vec2(cz * 11.0 + t * 0.15, fi * 3.7), 820u);
    float fold = vnoise(vec2(cz * 2.2 + t * 0.05, el * 1.5 + fi), 821u) * 0.5 + 0.5;
    float base = 0.14 + 0.1 * fi + 0.1 * fold;
    float reach = smoothstep(0.05, 0.55, vnoise(vec2(cz * 0.9 + 4.0, fi * 5.1), 822u) * 0.5 + 0.5);
    float h = smoothstep(base, base + 0.025, el) * exp(-(el - base) * (6.5 - fi)) * reach;
    vec3 col = mix(vec3(0.1, 1.0, 0.45), vec3(0.85, 0.2, 1.0), smoothstep(base, base + 0.4, el));
    sum += col * rays * rays * fold * h;
  }
  return sum * 0.32 * gW.skyA.y;
}

// What a mirror sees: haze, milky way and aurora, without stars or clouds.
vec3 skyReflection(vec3 d) {
  vec3 col = hazeColor(d);
  if (d.y > 0.0) {
    float up = smoothstep(0.0, 0.25, d.y);
    col += (milkyWay(d) * gW.skyB.x + auroraSky(d, gTime) * gW.skyA.y) * up;
  }
  return col;
}
