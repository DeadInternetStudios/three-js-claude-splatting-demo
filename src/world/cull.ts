import * as THREE from "three";

/** A plane pair stops culling once its half angle passes this, because the view is then no longer a wedge. */
const MAX_HALF_ANGLE = THREE.MathUtils.degToRad(80);
/** Radians added to each half angle, so a splat on the edge of the picture is never lost to rounding. */
const EDGE = THREE.MathUtils.degToRad(0.5);
/** Metres every splat's reach grows by. */
const SLACK = 1;
/** Reach in metres per metre of distance, for the pixels a splat spreads over however small it is. */
export const DISTANCE_REACH = 0.01;

/**
 * The part of the world one camera can see, as four planes through the eye. The generators test
 * every splat against it and skip the shading of the ones that lie outside.
 */
export interface ViewCull {
  /** Inward unit normals of the left, right, bottom and top planes. A zero normal never culls. */
  planes: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** Metres added to a splat's own radius before the test. */
  slack: number;
}

const right = new THREE.Vector3();
const up = new THREE.Vector3();
const forward = new THREE.Vector3();

function wedge(side: THREE.Vector3, half: number, front: THREE.Vector3, low: THREE.Vector3, high: THREE.Vector3): void {
  if (half >= MAX_HALF_ANGLE) {
    low.set(0, 0, 0);
    high.set(0, 0, 0);
    return;
  }
  low.copy(side).multiplyScalar(Math.cos(half)).addScaledVector(front, Math.sin(half));
  high.copy(side).multiplyScalar(-Math.cos(half)).addScaledVector(front, Math.sin(half));
}

/** The planes of a perspective camera. `fov` is the vertical angle in degrees. */
export function viewCull(camera: { quaternion: THREE.Quaternion; fov: number; aspect: number }, into: ViewCull = emptyCull()): ViewCull {
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  const [left, rightPlane, bottom, top] = into.planes;
  wedge(right, horizontal + EDGE, forward, left, rightPlane);
  wedge(up, vertical + EDGE, forward, bottom, top);
  into.slack = SLACK;
  return into;
}

export function emptyCull(): ViewCull {
  return { planes: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], slack: SLACK };
}

/** The CPU twin of `outsideView` in world.glsl. True when a sphere lies wholly outside the view. */
export function sphereOutside(cull: ViewCull, eye: THREE.Vector3, center: THREE.Vector3, radius: number): boolean {
  const dx = center.x - eye.x;
  const dy = center.y - eye.y;
  const dz = center.z - eye.z;
  const reach = -(radius + cull.slack + DISTANCE_REACH * Math.hypot(dx, dy, dz));
  for (const n of cull.planes) if (n.x * dx + n.y * dy + n.z * dz < reach) return true;
  return false;
}
