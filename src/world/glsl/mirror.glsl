// A reflection in still water. A mirror layer runs the same generator as the layer it copies,
// then turns each splat upside down about the water level under its object, so the copy hangs as
// far below the surface as the original stands above it. Where the ground looks down on the
// copy at a grazing angle the ground is thin enough to show it (surface.glsl `cover`). A layer
// is a mirror when its p4.y is 1. The copy and its source are one shader program, which is why
// every layer that has a copy includes this file.

// Height of the water under the Mirror Flats at `xz`: the long swell of the salt pan plus half
// a crust. The rock islands that rise out of the water have no reflection of their own.
float flatsWaterLevel(vec2 xz) {
  return fbm1(xz / 1100.0 + 4.0, 3, 0.0, 51u) * 6.0 + 0.25;
}

// The level of the mirror under an object at `xz` standing on `ground` in `realm`. False where
// there is none, so the object throws no reflection.
bool mirrorLevel(int realm, vec2 xz, float ground, out float level) {
  level = ground;
  if (realm == REALM_FLATS) {
    level = flatsWaterLevel(xz);
    return ground - level < 2.0;
  }
  return false;
}

// Turns a finished surfel upside down about the plane y = level. The normal turns with it, so
// the copy is lit as a real object that hung below the water would be. The layer's p4.x fades
// the copies in as the visitor comes to the water, so none appear all at once.
void mirrorSurfel(inout Surfel s, float level) {
  float height = max(s.pos.y - level, 0.0);
  s.pos.y = 2.0 * level - s.pos.y;
  s.nrm.y = -s.nrm.y;
  s.cov[0][1] = -s.cov[0][1];
  s.cov[1][0] = -s.cov[1][0];
  s.cov[1][2] = -s.cov[1][2];
  s.cov[2][1] = -s.cov[2][1];
  // The surface of the water ripples, and a reflection shivers more the further it reaches.
  vec2 shiver = vec2(sin(s.pos.x * 0.05 + gTime * 0.7 + height * 0.03), cos(s.pos.z * 0.06 - gTime * 0.5 + height * 0.025));
  s.pos.xz += shiver * (0.0015 * height);
  // Water is a little darker and bluer than the thing it shows.
  vec3 tint = vec3(0.78, 0.88, 1.0) * 0.9;
  s.albedo *= tint;
  s.emit *= tint;
  s.opacity *= 0.9 * gL.p4.x;
}
