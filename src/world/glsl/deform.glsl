// GLSL twin of src/core/deform/stages.ts. Every stage mirrors its TypeScript counterpart and
// maps a point while accumulating the Jacobian. Matrices are built from explicit rows through
// deformRows3 so the row-major reference maps one to one onto GLSL's column-major mat3.
struct DeformParams {
  vec4 grabA;
  vec4 grabB;
  vec4 twistA;
  vec4 twistB;
  vec4 curveA;
  vec4 curveB;
  vec4 curveOrigin;
  vec4 sim0;
  vec4 sim1;
  vec4 sim2;
  vec4 simFlag;
  vec4 frame0;
  vec4 frame1;
  vec4 frame2;
  vec4 frameFlag;
  vec4 bowlA;
  vec4 bowlB;
  vec4 waveA;
  vec4 waveB;
  sampler2D curveTexA;
  sampler2D curveTexB;
};

mat3 deformRows3(vec3 r0, vec3 r1, vec3 r2) {
  return transpose(mat3(r0, r1, r2));
}

float deformSinc(float x) {
  float x2 = x * x;
  return x2 < 1e-6 ? 1.0 - x2 / 6.0 + x2 * x2 / 120.0 : sin(x) / x;
}

void deformGrab(vec4 a, vec4 b, inout vec3 p, inout mat3 jac) {
  float radius = a.w;
  if (radius <= 0.0) return;
  vec3 d = p - a.xyz;
  float r = length(d);
  float u = r / radius;
  if (u >= 1.0) return;
  float w = pow(1.0 - u, 4.0) * (1.0 + 4.0 * u);
  float dw = -20.0 * u * pow(1.0 - u, 3.0);
  vec3 grad = r > 1e-6 ? d * (dw / (radius * r)) : vec3(0.0);
  p += b.xyz * w;
  mat3 stage = mat3(1.0) + mat3(b.xyz * grad.x, b.xyz * grad.y, b.xyz * grad.z);
  jac = stage * jac;
}

void deformTwist(vec4 a, vec4 b, inout vec3 p, inout mat3 jac) {
  float rate = a.w;
  if (rate == 0.0) return;
  vec3 n = b.xyz;
  vec3 q = p - a.xyz;
  float axial = dot(n, q);
  vec3 radial = q - n * axial;
  float phi = rate * (axial - b.w);
  float c = cos(phi);
  float s = sin(phi);
  mat3 k = mat3(vec3(0.0, n.z, -n.y), vec3(-n.z, 0.0, n.x), vec3(n.y, -n.x, 0.0));
  mat3 nn = outerProduct(n, n);
  mat3 rot = c * mat3(1.0) + s * k + (1.0 - c) * nn;
  vec3 rotated = rot * radial;
  mat3 perp = mat3(1.0) - nn;
  mat3 dPhi = outerProduct(cross(n, rotated), n);
  mat3 stage = nn + rot * perp + rate * dPhi;
  p = a.xyz + n * axial + rotated;
  jac = stage * jac;
}

void deformCurve(vec4 cfg, float origin, sampler2D tex, inout vec3 p, inout mat3 jac) {
  if (cfg.w < 2.0) return;
  int axis = int(cfg.x + 0.5);
  float v = (axis == 0 ? p.x : p.y) - origin;
  float x = (p.z - cfg.y) / cfg.z;
  int last = int(cfg.w + 0.5) - 1;
  float along;
  float offset;
  float theta;
  float kappa;
  if (x <= 0.0 || x >= float(last)) {
    int k = x <= 0.0 ? 0 : last;
    vec4 kt = texelFetch(tex, ivec2(k, 0), 0);
    float dist = p.z - (cfg.y + float(k) * cfg.z);
    theta = kt.z;
    along = kt.x + dist * cos(theta);
    offset = kt.y + dist * sin(theta);
    kappa = 0.0;
  } else {
    int k = int(floor(x));
    float delta = (x - float(k)) * cfg.z;
    vec4 k0 = texelFetch(tex, ivec2(k, 0), 0);
    vec4 k1 = texelFetch(tex, ivec2(k + 1, 0), 0);
    kappa = (k1.z - k0.z) / cfg.z;
    float phi = kappa * delta;
    float m = delta * deformSinc(phi * 0.5);
    float ang = k0.z + phi * 0.5;
    along = k0.x + m * cos(ang);
    offset = k0.y + m * sin(ang);
    theta = k0.z + phi;
  }
  float sinT = sin(theta);
  float cosT = cos(theta);
  float f = 1.0 - kappa * v;
  vec3 q = p;
  if (axis == 0) { q.x = origin + offset + v * cosT; } else { q.y = origin + offset + v * cosT; }
  q.z = along - v * sinT;
  mat3 stage = mat3(1.0);
  stage[axis][axis] = cosT;
  stage[2][axis] = sinT * f;
  stage[axis][2] = -sinT;
  stage[2][2] = cosT * f;
  p = q;
  jac = stage * jac;
}

// Rolls the ground into a sphere of radius 1 / curvature that touches the plane at the apex.
// A point at height y over the plane lands at radius R + y from the sphere centre. Beyond
// phi0 the world fades out and is gone at phi1, so the far side of the planet never folds back.
void deformBowl(vec4 a, vec4 b, inout vec3 p, inout mat3 jac, inout float vis) {
  float k = a.w;
  if (k < 1e-7) return;
  vec3 q = p - a.xyz;
  float radius = 1.0 / k;
  float rho = length(q.xz);
  float phi = rho * k;
  float s = sin(phi);
  float c = cos(phi);
  float y = q.y;
  float scale = 1.0 + y * k;
  vec3 e = rho > 1e-5 ? vec3(q.x / rho, 0.0, q.z / rho) : vec3(1.0, 0.0, 0.0);
  vec3 t = vec3(-e.z, 0.0, e.x);
  float sincPhi = deformSinc(phi);
  float radial = scale * c;
  float tangential = scale * sincPhi;
  float coupling = scale * s;
  vec3 outp = vec3(0.0, -radius, 0.0) + (radius + y) * (s * e + vec3(0.0, c, 0.0));
  mat3 basis = mat3(e, t, vec3(0.0, 1.0, 0.0));
  mat3 local = mat3(vec3(radial, 0.0, -coupling), vec3(0.0, tangential, 0.0), vec3(s, 0.0, c));
  mat3 stage = basis * local * transpose(basis);
  vis *= 1.0 - smoothstep(b.x, b.y, phi);
  p = a.xyz + outp;
  jac = stage * jac;
}

// A travelling ring of vertical displacement centred on a point of the ground plane.
void deformWave(vec4 a, vec4 b, inout vec3 p, inout mat3 jac) {
  float amp = a.w;
  if (amp == 0.0) return;
  vec2 q = p.xz - a.xz;
  float rho = length(q);
  float x = (rho - b.x) / b.y;
  float env = exp(-x * x);
  float denv = -2.0 * x * env / b.y;
  float osc = 1.0;
  float dosc = 0.0;
  if (b.z > 0.0) {
    float arg = TAU_ * (rho - b.x) / b.z;
    osc = cos(arg);
    dosc = -TAU_ / b.z * sin(arg);
  }
  float dy = amp * env * osc;
  float g = amp * (denv * osc + env * dosc);
  vec2 dir = rho > 1e-6 ? q / rho : vec2(0.0);
  p.y += dy;
  mat3 stage = mat3(1.0) + outerProduct(vec3(0.0, 1.0, 0.0), vec3(g * dir.x, 0.0, g * dir.y));
  jac = stage * jac;
}

// Maps p and accumulates the Jacobian into jac, which must start as the identity. vis falls
// toward 0 where the map folds the world away.
void deformPoint(DeformParams d, inout vec3 p, inout mat3 jac, inout float vis) {
  bool framed = d.frameFlag.x > 0.5;
  mat3 rot = mat3(1.0);
  vec3 origin = vec3(0.0);
  if (framed) {
    rot = deformRows3(d.frame0.xyz, d.frame1.xyz, d.frame2.xyz);
    origin = vec3(d.frame0.w, d.frame1.w, d.frame2.w);
    mat3 inv = transpose(rot);
    p = inv * (p - origin);
    jac = inv;
  }
  deformGrab(d.grabA, d.grabB, p, jac);
  deformTwist(d.twistA, d.twistB, p, jac);
  deformCurve(d.curveA, d.curveOrigin.x, d.curveTexA, p, jac);
  deformCurve(d.curveB, d.curveOrigin.y, d.curveTexB, p, jac);
  deformBowl(d.bowlA, d.bowlB, p, jac, vis);
  deformWave(d.waveA, d.waveB, p, jac);
  if (d.simFlag.x > 0.5) {
    mat3 sim = deformRows3(d.sim0.xyz, d.sim1.xyz, d.sim2.xyz);
    p = sim * p + vec3(d.sim0.w, d.sim1.w, d.sim2.w);
    jac = sim * jac;
  }
  if (framed) {
    p = rot * p + origin;
    jac = rot * jac;
  }
}
