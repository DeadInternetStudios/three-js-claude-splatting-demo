import { SparkRenderer } from "@sparkjsdev/spark";
import * as THREE from "three";

export interface StageOptions {
  canvas?: HTMLCanvasElement;
  width: number;
  height: number;
  /** The HDR target is this many times larger than the output in each direction. */
  supersample?: number;
  /** `half` halves the memory and bandwidth of the HDR target; `float` keeps full precision for measurements. */
  hdr?: "float" | "half";
  /** Capture mode renders on demand: no automatic generate or sort between frames. */
  capture?: boolean;
  /** Extra SparkRenderer options such as blurAmount or focalDistance. */
  spark?: Partial<ConstructorParameters<typeof SparkRenderer>[0]>;
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  spark: SparkRenderer;
  hdrTarget: THREE.WebGLRenderTarget;
  resize(width: number, height: number): void;
  /** Regenerates splats for the current camera and waits until the sort order matches them. */
  settle(): Promise<void>;
  /**
   * Renders the scene into the HDR target. `background` draws behind the splats and must overwrite
   * the target, the default is black.
   */
  renderHdr(background?: (target: THREE.WebGLRenderTarget) => void): void;
  readHdr(): Float32Array;
  dispose(): void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createStage(options: StageOptions): Stage {
  const supersample = options.supersample ?? 1;
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(options.width, options.height, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, options.width / options.height, 0.05, 1000);
  const capture = options.capture ?? false;
  const spark = new SparkRenderer({
    renderer,
    covSplats: true,
    accumExtSplats: true,
    autoUpdate: !capture,
    preUpdate: !capture,
    minSortIntervalMs: 0,
    ...options.spark,
  });
  scene.add(spark);

  const half = options.hdr === "half";
  const hdrTarget = new THREE.WebGLRenderTarget(options.width * supersample, options.height * supersample, {
    type: half ? THREE.HalfFloatType : THREE.FloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: half ? THREE.LinearFilter : THREE.NearestFilter,
    magFilter: half ? THREE.LinearFilter : THREE.NearestFilter,
  });

  const stage: Stage = {
    renderer,
    scene,
    camera,
    spark,
    hdrTarget,
    resize(width, height) {
      renderer.setSize(width, height, false);
      hdrTarget.setSize(width * supersample, height * supersample);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    async settle() {
      camera.updateMatrixWorld(true);
      await spark.update({ scene, camera });
      for (let i = 0; i < 4000; i++) {
        if (!spark.sorting && !spark.sortDirty && spark.display === spark.current) return;
        if (!spark.sorting && spark.sortDirty) await spark.update({ scene, camera });
        else await sleep(1);
      }
      throw new Error("splat sort did not settle");
    },
    renderHdr(background) {
      renderer.setRenderTarget(hdrTarget);
      if (background) background(hdrTarget);
      else renderer.clear();
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
      renderer.setRenderTarget(null);
    },
    readHdr() {
      if (half) throw new Error("readHdr needs the float HDR target");
      const out = new Float32Array(hdrTarget.width * hdrTarget.height * 4);
      renderer.readRenderTargetPixels(hdrTarget, 0, 0, hdrTarget.width, hdrTarget.height, out);
      return out;
    },
    dispose() {
      hdrTarget.dispose();
      spark.dispose();
      renderer.dispose();
    },
  };
  return stage;
}
