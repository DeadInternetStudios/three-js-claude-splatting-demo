// Flocks of paper cranes (and, under water, fish). A flock follows a gently curving path whose
// place is a function of the flock number and the time, wrapped into a box around the player, and
// its members drift in a loose cloud around that path, each on its own slow cycles. Nothing is stored, so every bird is found again
// each frame from its index. Each bird also casts a shadow blob on the ground.
//
// p0: flocks, most members, slots per bird K, wrap box in metres
// p1: spare

const int FLOCK_CRANE = 0;
const int FLOCK_FISH = 1;

// Fifteen triangles. Local space: z forward, y up, x to the left, body length 1.
// `flap` swings the wings about the body axis, `lag` bends the outer panel behind the inner one.
bool craneTri(int tri, float flap, float lag, out vec3 A, out vec3 B, out vec3 C, out int part) {
  vec3 front = vec3(0.0, 0.02, 0.32);
  vec3 back = vec3(0.0, 0.0, -0.3);
  vec3 left = vec3(0.1, 0.0, 0.0);
  vec3 right = vec3(-0.1, 0.0, 0.0);
  vec3 top = vec3(0.0, 0.085, 0.02);
  vec3 bottom = vec3(0.0, -0.06, 0.0);
  part = 0;
  switch (tri) {
    case 0: A = front; B = top; C = left; return true;
    case 1: A = front; B = right; C = top; return true;
    case 2: A = back; B = left; C = top; return true;
    case 3: A = back; B = top; C = right; return true;
    case 4: A = front; B = left; C = bottom; return true;
    case 5: A = front; B = bottom; C = right; return true;
    case 6: A = back; B = bottom; C = left; return true;
    case 7: A = back; B = right; C = bottom; return true;
    case 8: part = 1; A = vec3(0.02, 0.03, 0.28); B = vec3(-0.02, 0.03, 0.28); C = vec3(0.0, 0.3, 0.45); return true;
    case 9: part = 2; A = vec3(0.015, 0.3, 0.45); B = vec3(-0.015, 0.3, 0.45); C = vec3(0.0, 0.33, 0.62); return true;
    case 10: part = 1; A = vec3(0.02, 0.03, -0.28); B = vec3(-0.02, 0.03, -0.28); C = vec3(0.0, 0.14, -0.55); return true;
    default: break;
  }
  float side = tri < 13 ? 1.0 : -1.0;
  int w = (tri - 11) % 2;
  vec3 rootF = vec3(0.05 * side, 0.06, 0.22);
  vec3 rootB = vec3(0.05 * side, 0.06, -0.2);
  float c1 = cos(flap);
  float s1 = sin(flap);
  vec3 mid = vec3(0.05 * side + 0.34 * side * c1, 0.06 + 0.34 * s1, -0.02);
  float a2 = flap * 1.5 - lag;
  vec3 outer = mid + vec3(0.3 * side * cos(a2), 0.3 * sin(a2), -0.28);
  if (w == 0) { A = rootF; B = rootB; C = mid; part = 3; }
  else { A = mid; B = rootB + (mid - rootB) * 0.3; C = outer; part = 4; }
  return true;
}

// Six triangles of a fish. z forward.
bool fishTri(int tri, float wig, out vec3 A, out vec3 B, out vec3 C, out int part) {
  vec3 nose = vec3(0.0, 0.0, 0.5);
  vec3 tailRoot = vec3(wig * 0.05, 0.0, -0.3);
  vec3 top = vec3(0.0, 0.14, 0.05);
  vec3 bot = vec3(0.0, -0.1, 0.05);
  vec3 l = vec3(0.09, 0.0, 0.05);
  vec3 r = vec3(-0.09, 0.0, 0.05);
  part = 0;
  switch (tri) {
    case 0: A = nose; B = top; C = l; return true;
    case 1: A = nose; B = r; C = top; return true;
    case 2: A = tailRoot; B = l; C = top; return true;
    case 3: A = tailRoot; B = top; C = r; return true;
    case 4: part = 1; A = tailRoot; B = tailRoot + vec3(wig * 0.15, 0.17, -0.22); C = tailRoot + vec3(wig * 0.15, -0.17, -0.22); return true;
    case 5: part = 1; A = nose; B = l; C = bot; return true;
    default: return false;
  }
}

bool layerGen(int index, sampler2D field, out Surfel s) {
  int flocks = int(gL.p0.x + 0.5);
  int maxM = int(gL.p0.y + 0.5);
  int K = int(gL.p0.z + 0.5);
  float box = gL.p0.w;
  int slot = index / K;
  int j = index - slot * K;
  int flock = slot / maxM;
  int mem = slot - flock * maxM;

  vec4 f = hash4i(uint(flock), 600u);
  vec4 f2 = hash4i(uint(flock), 601u);
  int members = 7 + int(f2.x * float(maxM - 7));
  if (mem >= members) return false;

  vec3 pl = gW.feet.xyz;
  RealmMix rm = realmAt(pl.xz);
  int realm = f2.w < rm.t ? rm.b : rm.a;
  int kind = realm == REALM_DEEP ? FLOCK_FISH : FLOCK_CRANE;

  float t = gTime;
  float ang = f.x * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 perp = vec2(-dir.y, dir.x);
  float speed = (kind == FLOCK_FISH ? 4.0 : 9.0) + (kind == FLOCK_FISH ? 5.0 : 13.0) * f.y;
  float amp = 40.0 + 120.0 * f2.y;
  float wv = 0.03 + 0.05 * f2.z;
  float phase = f2.z * 20.0;
  vec2 baseXZ = (vec2(f.z, f.w) - 0.5) * box;
  vec2 c = baseXZ + dir * speed * t + perp * amp * sin(wv * t + phase);
  vec2 vel = dir * speed + perp * amp * wv * cos(wv * t + phase);
  vec2 acc = -perp * amp * wv * wv * sin(wv * t + phase);

  vec2 rel = c - pl.xz;
  rel -= box * floor(rel / box + 0.5);
  float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(rel.x), abs(rel.y)) / box);
  if (edge <= 0.004) return false;
  vec2 cxz = pl.xz + rel;

  float size = kind == FLOCK_FISH ? 1.6 + 1.6 * f.w : 3.5 + 4.0 * f.w;
  float groundC = terrain(cxz, 120.0, realmAt(cxz));
  float alt = kind == FLOCK_FISH ? 6.0 + 40.0 * f2.y : 28.0 + 110.0 * f.z + 14.0 * sin(t * 0.07 + phase);
  vec3 centre = vec3(cxz.x, groundC + alt, cxz.y);

  vec3 fwd = normalize(vec3(vel.x, 0.12 * cos(t * 0.11 + phase), vel.y));
  vec3 X = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 Y = cross(fwd, X);
  float bank = clamp(dot(vec3(acc.x, 0.0, acc.y), X) / 9.0, -0.6, 0.6);
  mat3 R = mat3(X, Y, fwd) * rotZ(bank);

  float fm = float(mem);
  vec3 off;
  float sp = size * (kind == FLOCK_FISH ? 0.9 : 1.55) * (1.0 + 0.08 * sin(t * 0.4 + phase));
  vec4 mr = hash4i(uint(flock * 64 + mem), 602u);
  vec4 mq = hash4i(uint(flock * 64 + mem), 603u);
  float bsize = size;
  vec3 bfwd = fwd;
  float flapRate = 7.0;
  float flapAmp = 0.0;
  if (kind == FLOCK_CRANE) {
    float az = mr.x * 6.2831853;
    float el = mr.y * 2.0 - 1.0;
    float ring = sqrt(1.0 - el * el);
    vec3 home = vec3(ring * cos(az), el * 0.35, ring * sin(az)) * (sqrt(mr.z) * sp * 5.5);
    vec3 wander = vec3(
      sin(t * (0.21 + 0.25 * mq.x) + mq.w * 40.0),
      0.5 * sin(t * (0.17 + 0.2 * mq.y) + mr.w * 30.0),
      sin(t * (0.13 + 0.22 * mq.z) + mq.y * 50.0)) * sp * 1.8;
    vec3 o = home + wander;
    off = X * o.x + Y * o.y + fwd * o.z;
    bfwd = normalize(fwd + X * sin(t * (0.3 + 0.3 * mq.z) + mr.w * 20.0) * 0.28 + Y * sin(t * 0.4 + mq.x * 20.0) * 0.12);
    bsize = size * (0.78 + 0.5 * mq.w);
    flapRate = 2.8 + 1.8 * mq.y;
    float flapping = smoothstep(-0.3, 0.5, sin(t * (0.2 + 0.2 * mq.z) + mq.x * 40.0));
    flapAmp = 0.62 * (0.12 + 0.88 * flapping);
    vec3 bx = normalize(cross(vec3(0.0, 1.0, 0.0), bfwd));
    R = mat3(bx, cross(bfwd, bx), bfwd) * rotZ(bank + 0.3 * sin(t * 0.5 + mq.x * 30.0));
  } else {
    float a = mr.x * 6.2831853 + t * (0.15 + 0.2 * mr.y);
    float r = pow(mr.z, 0.6) * sp * 6.0;
    off = X * cos(a) * r + Y * (mr.w - 0.5) * r * 0.8 + fwd * sin(a * 1.3 + mr.y * 6.0) * r;
  }
  vec3 pos = centre + off;
  float memberPhase = (kind == FLOCK_CRANE ? mq.x * 18.8495559 : fm * 0.37) + f.x * 11.0;
  float flap = flapAmp * sin(t * flapRate + memberPhase) + (kind == FLOCK_CRANE ? 0.12 : 0.0);
  float lag = 0.5 + 0.35 * cos(t * flapRate + memberPhase);
  float wig = sin(t * 9.0 + memberPhase) * 1.0;

  vec3 palA;
  vec3 palB;
  float emitK = 0.0;
  float trans = 0.5;
  float roll = f2.y;
  if (realm == REALM_DUNES) {
    palA = roll > 0.8 ? vec3(0.2, 0.62, 0.62) : roll > 0.6 ? vec3(1.0, 0.45, 0.35) : vec3(1.0, 0.93, 0.82);
    palB = roll > 0.8 ? vec3(0.1, 0.35, 0.4) : roll > 0.6 ? vec3(0.8, 0.28, 0.3) : vec3(0.9, 0.58, 0.52);
  } else if (realm == REALM_PRISM) {
    palA = hsv2rgb(vec3(0.5 + 0.35 * roll, 0.7, 1.0));
    palB = palA * 0.3;
    emitK = 2.6;
  } else if (realm == REALM_DEEP) {
    palA = vec3(0.8, 0.9, 1.0);
    palB = vec3(1.0, 0.55, 0.25);
    emitK = 0.35;
  } else if (realm == REALM_FLATS) {
    palA = vec3(0.92, 0.94, 1.0);
    palB = vec3(0.55, 0.65, 1.0);
    emitK = 1.1;
  } else {
    palA = vec3(0.1, 0.07, 0.08);
    palB = vec3(0.35, 0.1, 0.05);
    emitK = 1.2;
  }

  s = newSurfel();
  if (j == K - 1) {
    float sy = max(gW.sun.y, 0.28);
    vec3 L = normalize(vec3(gW.sun.x, 0.0, gW.sun.z) + vec3(0.0001));
    float height = pos.y - terrain(pos.xz, 60.0, realmAt(pos.xz));
    vec3 g = vec3(pos.x, pos.y - height, pos.z) - L * (height / sy);
    float gy = terrain(g.xz, 30.0, realmAt(g.xz));
    vec3 gp = vec3(g.x, gy + 0.2, g.z);
    s.pos = gp + normalize(gW.eye.xyz - gp) * 0.3;
    s.nrm = vec3(0.0, 1.0, 0.0);
    float r = size * 0.5;
    s.cov = covIso(r * 0.6);
    s.albedo = vec3(0.0);
    s.lit = 0.0;
    s.opacity = (kind == FLOCK_FISH ? 0.0 : 0.3) * exp(-height / 140.0) * edge;
    return s.opacity > 0.004;
  }

  int tri = j / 4;
  int k = j - tri * 4;
  float dist = length(pos - gW.eye.xyz);
  int nUse = (bsize / max(dist, 1.0)) > 0.04 ? 2 : 1;
  if (k >= nUse * nUse) return false;
  vec3 a, b, cc;
  int part;
  bool ok = kind == FLOCK_CRANE ? craneTri(tri, flap, lag, a, b, cc, part) : fishTri(tri, wig, a, b, cc, part);
  if (!ok) return false;
  a = pos + R * (a * bsize);
  b = pos + R * (b * bsize);
  cc = pos + R * (cc * bsize);
  if (dot(cross(b - a, cc - a), cross(b - a, cc - a)) < 1e-10) return false;
  s = triSurfel(a, b, cc, nUse, k, gL.p2.z, bsize * 0.004);
  float facet = u24(pcg(uint(tri) * 977u + uint(flock * 64 + mem)));
  bool wing = part >= 3;
  s.albedo = srgb2lin(mix(palA, palB, wing ? 0.15 + 0.35 * float(part == 4) : 0.0 + 0.25 * float(part == 1))) * (0.85 + 0.3 * facet);
  s.emit = srgb2lin(palA) * emitK * (wing ? 0.6 + 0.8 * float(part == 4) : 0.5);
  s.trans = trans;
  s.opacity = edge;
  return true;
}
