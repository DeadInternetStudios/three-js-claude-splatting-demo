import { terrain } from "./shots.ts";
import { evaluate, evaluateWithin, type FrameState } from "./director.ts";

/** Radians of view swing per unit change of each fold amount, for ground a few tens of metres away. */
const FOLD_SWING = { planet: 1.2, corkscrew: 0.9, hinge: 1.0 } as const;

export interface BlurSettings {
  fps: number;
  /** Fraction of the frame interval the shutter stays open. */
  shutter: number;
  /** Output height in pixels. */
  height: number;
  /** The widest gap, in output pixels, allowed between neighbouring copies of something that moves. */
  spacing: number;
  min: number;
  max: number;
}

/** Distance in metres of the nearest ground that matters for how fast things slide past. */
function nearDistance(frame: FrameState): number {
  const agl = frame.pose.y - terrain.facetHeight(frame.pose.x, frame.pose.z, 2.7);
  return Math.min(40, Math.max(2.5, 2.5 * agl + 2));
}

/**
 * How many sub-frames a frame needs for its motion blur to look smooth. The shutter interval is
 * sampled at three times. The pixels that near ground sweeps across in that time come from the
 * camera turning, the camera sliding past, the lens zooming and the world folding. Dividing the
 * sweep by the allowed gap gives the sample count, so quiet shots are cheap and hard cuts of
 * motion get the most.
 */
export function samplesNeeded(t: number, settings: BlurSettings): number {
  const half = settings.shutter / settings.fps / 2;
  const frames = [evaluateWithin(t, -half), evaluate(t), evaluateWithin(t, half)];
  const centre = frames[1]!;
  const focal = settings.height / 2 / Math.tan((centre.pose.fov * Math.PI) / 360);
  const near = nearDistance(centre);
  let swing = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    const amountsA = a.shot.fold?.(a.t - a.shot.start, a.t);
    const amountsB = b.shot.fold?.(b.t - b.shot.start, b.t);
    swing +=
      a.view.camera.quaternion.angleTo(b.view.camera.quaternion) +
      a.view.camera.position.distanceTo(b.view.camera.position) / near +
      (Math.abs(b.pose.fov - a.pose.fov) * Math.PI) / 180 +
      FOLD_SWING.planet * Math.abs((amountsB?.planet ?? 0) - (amountsA?.planet ?? 0)) +
      FOLD_SWING.corkscrew * Math.abs((amountsB?.corkscrew ?? 0) - (amountsA?.corkscrew ?? 0)) +
      FOLD_SWING.hinge * Math.abs((amountsB?.hinge ?? 0) - (amountsA?.hinge ?? 0));
  }
  return Math.min(settings.max, Math.max(settings.min, Math.ceil((focal * swing) / settings.spacing)));
}
