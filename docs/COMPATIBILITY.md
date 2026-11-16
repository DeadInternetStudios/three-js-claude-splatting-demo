# Compatibility

What the project needs from Spark and the browser, what was tested, and what was not.

## Tested environment

| Part | Version |
| --- | --- |
| three.js | 0.187.0 |
| Spark (`@sparkjsdev/spark`) | 2.4.0 |
| Browser | Chrome 157.0.8103.79, headless, driven by Playwright 1.65.1, ANGLE Metal backend. Its WebGL renderer reads "ANGLE Metal Renderer: Apple M1 Max" |
| Other engines | Firefox 159.0 and WebKit 27.2, the headless builds Playwright ships, on the same Mac. Their renderers read "Apple M1, or similar" and "Apple GPU" |
| OS | macOS 27.2.1 |
| GPU | Apple M1 Max, 64 GB of memory |
| Node | 26.13.1. `package.json` asks for 22 or newer. Only 26 was tested |
| Build tools | Vite 8.3.8, TypeScript 7.0.2, Vitest 5.1.0 |

Every automated run used this one machine. Chrome took every timing. Firefox and WebKit drew the same frames and played the same smoke test (see "Other engines"). Nothing was tested on Windows, Linux, the Safari app, a discrete GPU, a phone or a tablet. `docs/QA.md` lists what else is unverified.

## What the page needs

- WebGL 2.
- Render targets with 32-bit float formats for the cell fields, and with 16-bit float formats for the HDR target and the bloom. No test ran without them.
- Enough GPU time to run the generator shaders. `docs/BENCHMARKS.md` has frame times on the tested machine.
- Time to build eight large shader programs before the first picture. On the tested Mac a first visit takes 3.2 to 3.4 s in Chrome, 3.9 to 4.2 s in WebKit and 12.5 s in Firefox, and a second visit 0.3 s in Chrome (`docs/QA.md`). Windows, Linux and phones were not timed.

An inline script in `index.html` checks the browser before the game code runs: WebGL 2, a renderable 32-bit float target and web workers. A failure turns the loading box red and names the problem in plain words. An exception at startup does the same through `window.__boot.fail` (`src/main.ts`), or shows "The world did not unfold" when the boot box is absent. A lost graphics context shows "The graphics context was lost. Reload the page." (`Game.create` in `src/play/game.ts`). Spark's WebAssembly is stored gzipped. `DecompressionStream` unpacks it where it exists (Chrome, Edge, Firefox, Safari 17 and later), and a small inflate in `vite.config.ts` covers older browsers. That path was tested by removing `DecompressionStream` in Chrome: the world rendered with no console errors.

## Other engines

`scripts/qa/game-shots.mjs`, `scripts/qa/play-smoke.mjs` and `scripts/qa/encodable.mjs` take `--browser chrome|firefox|webkit`. On Nov 16 the 19 poses of `game-shots` were photographed in all three engines with the same code and every frame was compared against Chrome's.

| Engine | Against Chrome's 19 frames | Console |
| --- | --- | --- |
| WebKit 27.2 | every pixel the same, in all 19 | no error, no warning |
| Firefox 159.0 | 60.7 to 66.6 dB, mean absolute difference at most 0.05 of 255 | no error. Two known messages are filtered, see below |

Chrome and WebKit agree to the pixel. That fits two engines that reach the GPU through the same ANGLE Metal backend, which is an inference from the equal frames and not something the renderer strings state. Firefox reports a different renderer and a texture limit of 8192 against 16384, and it differs from Chrome in the ways listed next. Three engines on one GPU agree less than three GPUs would. A Windows or Android GPU may differ in ways these did not show.

What the comparison found:

- **Firefox flushes subnormal half floats to zero.** Spark packs a covariance with half floats (item 8 below), and `keepEncodable` in `entry.glsl` exists because of it. Measured with `packHalf2x16` and `unpackHalf2x16`: Firefox read back 0 for every magnitude below 6.1e-5, and Chrome and WebKit read back the value rounded to a subnormal half. The Ember twist pose was 25.1 dB from Chrome before the fix and is 62.7 dB after it.
- **Chrome and WebKit gave a later call of `terrain()` the detail of its first call.** When one shader calls `terrain(p, lod, r)` with a coarse `lod` and then again at a position it derived from a hash with a finer `lod`, the later calls came back as if `lod` had stayed coarse. Reversing the order of the calls, or taking the position from a uniform, gave the right answer. Firefox and the double-precision CPU terrain follow the source. The ground shadow used to depend on this: the farthest ring's field had a mean of 0.77 in Chrome and 0.42 in the CPU twin of the shader. `groundShadow` now takes the detail as a parameter and marches at the facet's own detail, which is what Chrome computed, so no Chrome frame changed. The cause inside the compiler was not found. The bisection is the evidence.
- **Firefox warns about a vertex output nothing reads.** `FullscreenPass` now passes `vUv` on only to a fragment shader that reads it. The warning for Spark's own splat shader, which declares two outputs it never reads, stays. `isKnownNoise` in `scripts/qa/browsers.mjs` lets that exact two-line warning and Firefox's note about tracking policy for a local address pass, and one more, below.
- **The production bundle makes Firefox say it reordered microtasks.** The message is `The execution of microtasks on this page was reordered to avoid unsafe execution.` It appears once, as the bundle starts, and not under the dev server, which unpacks nothing. The build stores Spark's WebAssembly gzipped and reads it back through a `DecompressionStream` (`vite.config.ts`). The Firefox build Playwright ships prints the message for every read of one. All six ways of reading it that were tried print it, a stream that is not decompressed does not, and a page of six lines with no code of ours prints it. The frame rate and the picture are unchanged. Only dropping the native stream for the built-in unpacker would remove the message, and that costs 20 to 61 ms of start-up on this Mac (25 ms against 5 in Chrome, 68 against 7 in Firefox, 31 against 5 in WebKit, medians of 7 runs on the 1.8 MB module). A phone was not measured. `isKnownNoise` passes that exact line. Whether a release Firefox prints it was not tested.

## What the world needs from Spark

Each fact below was found by reading Spark 2.4.0 or this repository, or by a measurement named in the item.

1. **Covariance mode is opt-in on both sides.** `createStage` in `src/core/render/stage.ts` creates the renderer with `covSplats: true` and `accumExtSplats: true`. Each layer is a `SplatGenerator` with a `covGenerator` that maps an index to a `CovSplat` (`src/world/layer.ts`).
2. **A generator runs again only when its version changes.** `ProcWorld.setView` calls `updateVersion()` on every layer every frame, so every layer regenerates every frame.
3. **A slot without `GSPLAT_FLAG_ACTIVE` is dropped.** `runLayer` in `src/world/glsl/entry.glsl` leaves the flag unset for a declined index. Spark draws `SparkRenderer.activeSplats` instances. `scripts/qa/splat-census.mjs` reads that number.
4. **A generator with `visible = false` contributes no splats.** The census relies on this. With only the `motes` layer visible, the draw count falls to the motes alone.
5. **The colour convention matches Spark's.** Spark's splat shader defines `srgbToLinear(rgb)` as `pow(rgb, vec3(2.2))`. `entry.glsl` writes `pow(colour, 1 / 2.2)` to match.
6. **The sort runs in a worker.** The live page sets `minSortIntervalMs: 0` and lets Spark update on its own, so the sort order lags the camera by a frame or two. A fast turn can show brief ordering errors that correct themselves when the camera rests.
7. **Depth of field uses Spark's parameters.** Photo mode and the film set `focalDistance` and `apertureAngle` on the Spark renderer from the `dof` of the view.
8. **A covariance is stored in half floats.** `packSplatExtCov` stores the log of each variance and, for each pair of axes, the log of the correlation's magnitude, all as half floats (read in `spark.module.js`). A correlation within 6.1e-5 of 1 needs a subnormal half. A GPU that flushes those reads the correlation back as 0, and a long thin splat becomes a fat blob. Splats this thin appear when a fold stretches the world far. With the floor switched off, 87,365 of the 996,380 live splats at the Ember spawn were closer than 1e-4 to a correlation of 1 under twist, 55,644 under twist with hinge, and between 0 and 110 in each realm without a fold. `keepEncodable` adds a floor of 1e-4 of the trace to the variances of any splat whose correlation is closer than 2e-4 to 1. `scripts/qa/encodable.mjs` checks the result in 12 scenes.

## Determinism for the film

The film renders each frame on demand. `createStage({ capture: true })` turns off Spark's automatic update and pre-update. `stage.settle()` then calls `spark.update` until the sort has finished and the displayed order matches the current one. It gives up with an error after 4,000 attempts. A frame therefore never uses a sort from an earlier camera. While the first film was built, frames without this step came out with ordering artefacts that changed from run to run.

The live page keeps Spark's automatic update. Its output is not deterministic.

## Limits

- **The fold is a smooth map, not a physical simulation.** A splat carries its shape through the exact Jacobian of the map at its centre. That is exact to first order, so a splat that is large against the curvature of the fold is slightly wrong. At full strength the planet has a radius of 150 m, and `bowl` fades the world out as the roll passes 2.5 radians.
- **No test compares the shader with the reference.** `src/world/glsl/deform.glsl` mirrors `src/core/deform/stages.ts`. The tests check only the reference. The lab stills and the film are the evidence for the shader.
- **Combined powers can fold the world through itself.** `tests/folds.test.ts` pins each power on its own and checks that all eight combinations stay finite. A scan of the reference maths found two combinations that go further. Twist with fold gives a negative determinant on visible ground. Planet with twist gives a determinant that reaches zero. Stretch reaches about 80 on ground within 3 km. Nothing turns into NaN and stills of every combination show swirls with no holes, which was checked by eye. No test pins this behaviour, so a change to the stages can alter it unnoticed.
- **No test covers the order of splats under the strongest folds.** The film waits for the sort. The live page does not.
- **Distance.** The GPU and the CPU terrain agree at random points out to 40 km (`scripts/qa/terrain-probe.mjs`). The CPU terrain is finite at random points out to 60 km (`tests/world.test.ts`). Nothing was measured beyond 60 km.
- **Light.** Each realm has one fixed light. There is no time of day.
