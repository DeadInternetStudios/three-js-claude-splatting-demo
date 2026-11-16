// Per-frame state shared by every layer, atmosphere helpers and the sky colour.
// Fields are packed as vec4 so the uniform block stays small and easy to fill from TypeScript.

const int REALM_DUNES = 0;
const int REALM_PRISM = 1;
const int REALM_DEEP = 2;
const int REALM_FLATS = 3;
const int REALM_EMBER = 4;

struct WorldParams {
  vec4 time;     // x seconds, y and z the two 16 bit halves of the world seed, w quality 0..1
  vec4 eye;      // xyz camera position
  vec4 feet;     // xyz player position, w heading in radians
  vec4 sun;      // xyz unit vector toward the sun, w sun intensity
  vec4 sunColor; // rgb linear
  vec4 zenith;   // rgb sky colour overhead
  vec4 horizon;  // rgb sky colour at the horizon, w fog density per metre at sea level
  vec4 bounce;   // rgb light bounced up from the ground, w fog height falloff per metre
  vec4 realm;    // x realm a, y realm b, z blend toward b, w variant
  vec4 pulse;    // x strength of a world-wide flash, y the time it started, z and w spare
  vec4 ring[RING_SLOTS];  // travelling rings of light: x and z of the centre, start time, amplitude. Zero amplitude is an empty slot
  vec4 shape[RING_SLOTS]; // how each ring spreads: speed in m/s, life in s, radius at birth, width
  vec4 skyA;     // x stars, y aurora, z clouds, w ringed planet, each 0..1
  vec4 skyB;     // x milky way, y underwater, z eclipse, w moon in place of the sun
  vec4 skyC;     // x strength of the sun's glow in the haze, y brightness of a lightning flash, z its azimuth, w its shape
  vec4 viewL;    // inward unit normals of the planes through the eye that bound the view: left, right, bottom, top
  vec4 viewR;
  vec4 viewD;
  vec4 viewU;
  vec4 cull;     // x metres of slack, y 1 when splats outside the view may be skipped, z 1 when no fold moves the world, w slack per metre of distance
};

WorldParams gW;

uint worldSeed(WorldParams w) { return uint(w.time.y + 0.5) | (uint(w.time.z + 0.5) << 16u); }

vec3 sunDir() { return gW.sun.xyz; }

// How much of the ground around the eye is the Mirror Flats, from 0 to 1.
float flatsAtEye() {
  float w = 0.0;
  if (int(gW.realm.x + 0.5) == REALM_FLATS) w += 1.0 - gW.realm.z;
  if (int(gW.realm.y + 0.5) == REALM_FLATS) w += gW.realm.z;
  return w;
}

const vec3 STORM_TINT = vec3(1.0, 0.8, 0.62);

// Unit vector toward a lightning bolt, which hangs a little above the horizon like the sun does.
vec3 stormDir() {
  return normalize(vec3(sin(gW.skyC.z), 0.3, -cos(gW.skyC.z)));
}

// True when a sphere of radius r at world position p lies wholly outside the view. The reach also
// grows with distance, because a splat of any size spreads over a few pixels.
bool outsideView(vec3 p, float r) {
  if (gW.cull.y < 0.5) return false;
  vec3 v = p - gW.eye.xyz;
  float reach = -(r + gW.cull.x + gW.cull.w * length(v));
  return dot(gW.viewL.xyz, v) < reach || dot(gW.viewR.xyz, v) < reach || dot(gW.viewD.xyz, v) < reach || dot(gW.viewU.xyz, v) < reach;
}

// Colour of the haze seen along a view direction.
vec3 hazeColor(vec3 dir) {
  float s = clamp(dot(dir, gW.sun.xyz), 0.0, 1.0);
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = mix(gW.horizon.rgb, gW.zenith.rgb, smoothstep(0.5, 0.9, h));
  base = mix(gW.bounce.rgb * 0.7, base, smoothstep(0.0, 0.5, h));
  vec3 glow = gW.sunColor.rgb * (pow(s, 6.0) * 0.55 + pow(s, 40.0) * 0.9);
  vec3 col = base + glow * gW.sun.w * 0.12 * gW.skyC.x;
  if (gW.skyC.y > 0.0) col += STORM_TINT * gW.skyC.y * (0.1 + 0.4 * pow(clamp(dot(dir, stormDir()), 0.0, 1.0), 3.0));
  return col;
}

// Exponential height fog integrated along the segment from the camera to p.
float fogTransmittance(vec3 p) {
  vec3 d = p - gW.eye.xyz;
  float dist = length(d);
  float k = gW.bounce.w;
  float y0 = gW.eye.y;
  float dy = d.y;
  float dens = gW.horizon.w;
  float tau;
  float ky = k * dy;
  if (abs(ky) < 1e-3) {
    tau = dens * dist * exp(-k * y0);
  } else {
    tau = dens * dist * exp(-k * y0) * (1.0 - exp(-ky)) / ky;
  }
  return exp(-max(tau, 0.0));
}
