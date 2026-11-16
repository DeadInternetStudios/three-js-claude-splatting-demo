// Motes: sand, lanterns, fireflies, snow and embers. Each is one round (or streaked) Gaussian whose
// place is a function of its index and the time, wrapped into a box around the player, so the cloud
// always surrounds them and no state is kept. The realm at the player picks what drifts by, and a
// hash of each mote fades the population from one realm to the next.
//
// p0: box x, y, z in metres, spare
// p1: spare

bool layerGen(int index, sampler2D field, out Surfel s) {
  vec3 box = gL.p0.xyz;
  vec3 pl = gW.feet.xyz;
  vec4 h = hash4i(uint(index), 500u);
  vec4 g = hash4i(uint(index), 501u);
  RealmMix rm = realmAt(pl.xz);
  int realm = g.w < rm.t ? rm.b : rm.a;
  float t = gTime;

  vec3 vel = vec3(0.0);
  float rise = 0.0;
  float range = 20.0;
  float size = 0.05;
  float opacity = 0.6;
  float lit = 0.0;
  float emitK = 0.0;
  float wob = 0.0;
  float pulseAmt = 0.0;
  float streak = 0.0;
  float bigFrac = 0.0;
  float keep = 1.0;
  vec3 col = vec3(1.0);

  // Each realm has a fine, plentiful kind of mote and a rare, bigger and brighter one.
  switch (realm) {
    case 0:
      bigFrac = 0.0007; keep = 0.1;
      if (g.x < bigFrac) {
        vel = vec3(1.2, 0.0, 0.5); rise = 0.12; range = 32.0; size = 0.5 + 0.5 * g.y; wob = 2.0;
        col = vec3(1.0, 0.6, 0.26); emitK = 3.2; opacity = 0.95; pulseAmt = 0.25;
      } else {
        vel = vec3(7.0, 0.0, 3.5) * (0.6 + 0.8 * g.y); range = 7.0; size = 0.028; wob = 0.5;
        col = vec3(1.0, 0.72, 0.42); lit = 1.0; emitK = 0.1; opacity = 0.32; streak = 0.3;
      }
      break;
    case 1:
      bigFrac = 0.004; keep = 0.08;
      vel = vec3(0.3, 0.0, 0.2); rise = 0.05; range = 26.0; wob = 3.0; pulseAmt = 0.85;
      col = hsv2rgb(vec3(0.45 + 0.4 * g.z, 0.75, 1.0));
      if (g.x < bigFrac) { size = 0.3; emitK = 2.4; opacity = 0.55; } else { size = 0.07; emitK = 4.0; opacity = 0.9; }
      break;
    case 2:
      bigFrac = 0.008; keep = 0.85;
      vel = vec3(0.25, 0.0, 0.1); rise = -0.22; range = 70.0; wob = 0.9;
      if (g.x < bigFrac) { size = 0.15; col = vec3(0.2, 0.9, 1.0); emitK = 3.2; opacity = 0.8; pulseAmt = 0.8; }
      else { size = 0.05; col = vec3(0.7, 0.92, 1.0); emitK = 0.55; opacity = 0.7; }
      break;
    case 3:
      bigFrac = 0.003; keep = 0.08;
      vel = vec3(0.1, 0.0, 0.05); rise = 0.35; range = 26.0; wob = 0.7; pulseAmt = 0.7;
      if (g.x < bigFrac) { size = 0.4; col = vec3(0.55, 0.7, 1.0); emitK = 2.2; opacity = 0.7; }
      else { size = 0.055; col = vec3(1.0, 0.92, 0.7); emitK = 3.0; opacity = 0.9; }
      break;
    default:
      bigFrac = 0.06; keep = 0.03;
      if (g.x < bigFrac) {
        rise = -0.4; range = 60.0; vel = vec3(0.8, 0.0, 0.4); size = 0.1; col = vec3(0.35, 0.3, 0.3); lit = 1.0; opacity = 0.45; wob = 1.0;
      } else {
        rise = 3.2; range = 95.0; vel = vec3(0.9, 0.0, 0.5); size = 0.1; wob = 1.3;
        col = mix(vec3(1.0, 0.78, 0.22), vec3(0.9, 0.16, 0.03), fract(h.y + t * rise / range + g.z));
        emitK = 5.0; opacity = 0.95; pulseAmt = 0.3;
      }
      break;
  }
  bool big = g.x < bigFrac;
  if (!big && h.w > keep) return false;
  vec2 hxz = h.xz * box.xz + vel.xz * t + vec2(sin(t * 0.7 + g.z * 40.0), cos(t * 0.6 + g.y * 30.0)) * wob;
  vec2 rel = hxz - pl.xz;
  rel -= box.xz * floor(rel / box.xz + 0.5);
  vec2 wxz = pl.xz + rel;
  float edge = 1.0 - smoothstep(0.34, 0.5, max(abs(rel.x) / box.x, abs(rel.y) / box.z));
  if (edge <= 0.004) return false;
  float v = fract(h.y + (t * rise) / range + g.z);
  float vf = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.85, 1.0, v));
  if (vf <= 0.004) return false;
  float ground = terrain(wxz, 16.0, realmAt(wxz));
  vec3 pos = vec3(wxz.x, ground + 0.2 + v * range, wxz.y);

  float pulse = 1.0 - pulseAmt + pulseAmt * (0.5 + 0.5 * sin(t * (1.4 + 2.2 * g.y) + g.z * 50.0));
  s = newSurfel();
  s.pos = pos;
  s.nrm = normalize(gW.eye.xyz - pos);
  float r = size * 0.5;
  if (streak > 0.0) {
    vec3 dir = normalize(vec3(vel.x, 0.15, vel.z));
    s.cov = covStroke(dir, r * (1.0 + 7.0 * streak), r);
  } else {
    s.cov = covIso(r);
  }
  s.albedo = col;
  s.emit = col * emitK * pulse * pulse;
  s.lit = lit;
  s.opacity = opacity * edge * vf * (0.35 + 0.65 * pulse);
  return true;
}
