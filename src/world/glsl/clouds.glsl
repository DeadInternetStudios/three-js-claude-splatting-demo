// Clouds: big soft sheets of paper drifting high over the player, one flat Gaussian each.
// Their places wrap in a box around the player like the motes, so the sky has depth at any
// position without state. The realm's cloud amount (skyA.z) sets the coverage, and the deep
// has none. Sun-facing sheets take the sun's colour, the rest take the horizon's.

bool layerGen(int index, sampler2D field, out Surfel s) {
  float amount = gW.skyA.z * (1.0 - gW.skyB.y);
  if (amount <= 0.01) return false;
  vec4 h = hash4i(uint(index), 700u);
  vec4 g = hash4i(uint(index), 701u);
  if (g.w > amount * 0.55) return false;
  vec3 pl = gW.feet.xyz;
  vec2 box = vec2(1700.0);
  vec2 rel = h.xz * box + vec2(9.0, 3.5) * gTime - pl.xz;
  rel -= box * floor(rel / box + 0.5);
  float edge = 1.0 - smoothstep(0.30, 0.5, max(abs(rel.x) / box.x, abs(rel.y) / box.y));
  if (edge <= 0.01) return false;
  vec3 pos = vec3(pl.x + rel.x, pl.y + 195.0 + h.y * 200.0, pl.z + rel.y);
  float nearFade = smoothstep(70.0, 240.0, distance(pos, gW.eye.xyz));
  if (nearFade <= 0.01) return false;
  vec3 eyeDir = normalize(pos - gW.eye.xyz);
  float sunAmt = pow(clamp(dot(eyeDir, sunDir()), 0.0, 1.0), 3.0);
  vec3 col = mix(gW.horizon.rgb * 1.05 + gW.zenith.rgb * 0.45, gW.sunColor.rgb * 1.1, sunAmt * 0.35);
  col *= 0.8 + 0.55 * g.y;
  s = newSurfel();
  s.pos = pos;
  s.nrm = vec3(0.0, 1.0, 0.0);
  s.cov = covDisc(vec3(0.0, 1.0, 0.0), 24.0 + 54.0 * g.x, 3.0 + 4.0 * g.z);
  s.albedo = col;
  s.emit = col * (0.38 + 0.35 * sunAmt);
  s.lit = 0.0;
  s.opacity = (0.07 + 0.13 * g.z) * edge * nearFade;
  return true;
}
