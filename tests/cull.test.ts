import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { emptySpec, isIdentitySpec } from "../src/core/deform/stages.ts";
import { DISTANCE_REACH, emptyCull, sphereOutside, viewCull } from "../src/world/cull.ts";
import { foldSpec, noFolds } from "../src/world/folds.ts";
import { WorldUniform, type Atmosphere, type WorldFrame } from "../src/world/uniforms.ts";

/** A small deterministic generator, so a failure names the same camera every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

interface Camera {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
  aspect: number;
}

function randomCamera(rnd: () => number): Camera {
  return {
    position: new THREE.Vector3((rnd() - 0.5) * 4000, rnd() * 600, (rnd() - 0.5) * 4000),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 3, rnd() * 6.28, (rnd() - 0.5) * 0.6, "YXZ")),
    fov: 30 + rnd() * 80,
    aspect: 1 + rnd() * 1.4,
  };
}

/** The world position that appears at normalised screen coordinates (x, y) in -1..1, `depth` metres in front. */
function pointOnScreen(camera: Camera, x: number, y: number, depth: number): THREE.Vector3 {
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const local = new THREE.Vector3(x * tanV * camera.aspect * depth, y * tanV * depth, -depth);
  return local.applyQuaternion(camera.quaternion).add(camera.position);
}

describe("view cull", () => {
  it("never culls a point that is on the screen", () => {
    const rnd = random(7);
    for (let i = 0; i < 300; i++) {
      const camera = randomCamera(rnd);
      const cull = viewCull(camera);
      for (let j = 0; j < 20; j++) {
        const p = pointOnScreen(camera, rnd() * 2 - 1, rnd() * 2 - 1, 0.5 + rnd() * 3000);
        expect(sphereOutside(cull, camera.position, p, 0), `camera ${i}, point ${j}`).toBe(false);
      }
    }
  });

  it("keeps a splat whose centre is outside but whose body reaches in", () => {
    const rnd = random(11);
    for (let i = 0; i < 200; i++) {
      const camera = randomCamera(rnd);
      const cull = viewCull(camera);
      const depth = 20 + rnd() * 500;
      const edge = pointOnScreen(camera, 1, 0, depth);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const radius = 5 + rnd() * 50;
      const outside = edge.clone().addScaledVector(side, radius * 0.9);
      expect(sphereOutside(cull, camera.position, outside, radius), `camera ${i}`).toBe(false);
    }
  });

  it("culls what lies behind the camera and what lies far to the side", () => {
    const camera = randomCamera(random(3));
    camera.fov = 50;
    camera.aspect = 16 / 9;
    const cull = viewCull(camera);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    expect(sphereOutside(cull, camera.position, camera.position.clone().addScaledVector(back, 100), 3)).toBe(true);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const front = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const wide = camera.position.clone().addScaledVector(front, 100).addScaledVector(side, 400);
    expect(sphereOutside(cull, camera.position, wide, 3)).toBe(true);
  });

  it("culls less as the radius grows", () => {
    const camera = randomCamera(random(5));
    const cull = viewCull(camera);
    const far = pointOnScreen(camera, 1.6, 0, 200);
    expect(sphereOutside(cull, camera.position, far, 1)).toBe(true);
    expect(sphereOutside(cull, camera.position, far, 400)).toBe(false);
  });

  it("stops testing a pair of planes once the view is too wide to be a wedge", () => {
    const camera = randomCamera(random(9));
    camera.fov = 170;
    camera.aspect = 1;
    const cull = viewCull(camera);
    for (const n of cull.planes) expect(n.length()).toBe(0);
    const anywhere = camera.position.clone().add(new THREE.Vector3(10, 20, 30));
    expect(sphereOutside(cull, camera.position, anywhere, 0)).toBe(false);
  });

  it("writes into the cull it is given", () => {
    const into = emptyCull();
    const camera = randomCamera(random(2));
    expect(viewCull(camera, into)).toBe(into);
  });

});

describe("the cull the shaders read", () => {
  const atmosphere: Atmosphere = {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: [1, 1, 1],
    sunIntensity: 1,
    zenith: [0, 0, 1],
    horizon: [1, 1, 1],
    bounce: [0, 0, 0],
    fogDensity: 0,
    fogFalloff: 0,
    sunGlow: 0,
    sky: { stars: 0, aurora: 0, clouds: 0, planet: 0, milky: 0, water: 0, eclipse: 0, moon: 0, storm: 0 },
  };
  const frame = (extra: Partial<WorldFrame>): WorldFrame => ({
    time: 0,
    seed: 1,
    eye: new THREE.Vector3(),
    feet: new THREE.Vector3(),
    heading: 0,
    atmosphere,
    realmA: 0,
    realmB: 0,
    realmBlend: 0,
    variant: 0,
    ...extra,
  });
  const camera = { quaternion: new THREE.Quaternion(), fov: 60, aspect: 1.5 };

  it("carries the planes, the slack and the reach per metre of the view", () => {
    const uniform = new WorldUniform();
    const cull = viewCull(camera);
    uniform.set(frame({ cull, foldIsIdentity: true }));
    const { viewL, viewR, viewD, viewU, cull: params } = uniform.value;
    [viewL, viewR, viewD, viewU].forEach((v, i) => expect(v.toArray().slice(0, 3)).toEqual(cull.planes[i]!.toArray()));
    expect(params.toArray()).toEqual([cull.slack, 1, 1, DISTANCE_REACH]);
  });

  it("says no splat may be skipped when the frame has no view, and when a fold moves the world", () => {
    const uniform = new WorldUniform();
    uniform.set(frame({}));
    expect(uniform.value.cull.y).toBe(0);
    uniform.set(frame({ cull: viewCull(camera), foldIsIdentity: false }));
    expect([uniform.value.cull.y, uniform.value.cull.z]).toEqual([1, 0]);
  });
});

describe("identity fold", () => {
  it("is true for no stages and for powers at rest, and false once a power bends the world", () => {
    expect(isIdentitySpec(emptySpec())).toBe(true);
    expect(isIdentitySpec(foldSpec(noFolds(), new THREE.Vector3(), 0))).toBe(true);
    expect(isIdentitySpec(foldSpec({ ...noFolds(), planet: 0.5 }, new THREE.Vector3(), 0))).toBe(false);
    expect(isIdentitySpec(foldSpec({ ...noFolds(), rippleAge: 1 }, new THREE.Vector3(), 0))).toBe(false);
  });
});
