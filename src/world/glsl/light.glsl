// Lighting for one surfel: a lightly wrapped sun, a sky and ground hemisphere, translucency for
// paper and glass, and a rim that makes edges against the sun glow. The normal has already been
// carried through the fold and faces the camera.
vec3 skyAmbient(vec3 n) {
  float up = n.y * 0.5 + 0.5;
  vec3 sky = mix(gW.horizon.rgb, gW.zenith.rgb, smoothstep(0.4, 1.0, up));
  return mix(gW.bounce.rgb, sky, smoothstep(0.1, 0.9, up));
}

// How much a ring of light lights the ground point `xz` right now. A ring spreads at a steady speed and fades out.
float ringGlow(vec4 r, vec4 shape, vec2 xz) {
  float age = gTime - r.z;
  if (r.w <= 0.0 || age < 0.0 || age > shape.y) return 0.0;
  float front = shape.z + age * shape.x;
  float width = shape.w + front * 0.07;
  float x = (length(xz - r.xy) - front) / width;
  return r.w * exp(-x * x) * (1.0 - smoothstep(0.4 * shape.y, shape.y, age));
}

vec3 shadeSurfel(Surfel s, vec3 n, vec3 pos) {
  vec3 view = normalize(gW.eye.xyz - pos);
  vec3 sunCol = gW.sunColor.rgb * gW.sun.w;
  float ndl = dot(n, gW.sun.xyz);
  float diffuse = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
  vec3 direct = sunCol * diffuse * s.shadow;
  direct += sunCol * (s.trans * clamp(-ndl, 0.0, 1.0) * 0.8) * s.shadow;
  vec3 lit = s.albedo * (direct + skyAmbient(n));
  if (gW.skyC.y > 0.0) lit += s.albedo * STORM_TINT * (gW.skyC.y * (0.5 + 2.2 * clamp(dot(n, stormDir()), 0.0, 1.0)));
  float rim = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 3.0);
  float against = clamp(dot(-view, gW.sun.xyz) * 0.5 + 0.5, 0.0, 1.0);
  lit += sunCol * rim * against * against * 0.22 * (0.4 + 0.6 * s.trans);
  float g = 0.0;
  for (int i = 0; i < RING_SLOTS; i++) g += ringGlow(gW.ring[i], gW.shape[i], s.pos.xz);
  float flash = gW.pulse.x * exp(-max(gTime - gW.pulse.y, 0.0) * 5.0) * step(gW.pulse.y, gTime);
  vec3 tint = mix(vec3(1.0), normalize(gW.sunColor.rgb + 0.05) * 1.7, 0.6);
  vec3 bloom = (s.albedo * 2.0 + 0.25) * s.lit * tint * (1.6 * g + 1.2 * flash);
  return s.emit * (1.0 + 6.0 * g + 5.0 * flash) + s.lit * lit * (1.0 + g) + bloom;
}
