# Benchmarks

These numbers describe one machine, one browser build and one scripted workload. They are not a claim about any other device. The machine was busy while they were measured, so they show what the page does under load and not what it does at best.

## Reference machine

| | |
| --- | --- |
| Machine | Apple M1 Max, 64 GB, macOS 27.2.1, 10 cores |
| Browser | Chrome 157.0.8103.79, headless, ANGLE Metal backend (`--use-angle=metal`) |
| Display | none. Headless Chrome ticks at 60 Hz with a device pixel ratio of 1 |
| Page | the production build served by `vite preview`, seed 1 |
| Quality | `high`, so the render resolution equals the viewport and the governor does not move it, unless a table says `auto` |
| World | 3,294,048 splat slots, of which 2,714,144 belong to layers that always run and 579,904 to the water mirror of the Flats. Spark draws a median of 983,053 splats at the five realm spawns (`scripts/qa/splat-census.mjs`). The view cull keeps the splats outside the view in the draw order with no opacity, so that count does not fall when the cull works |
| Load | other projects shared the machine. The one-minute load average on its 10 cores read 12 to 366 around the runs in these tables. The scripts print it before and after each invocation |

Run the benchmark again on a quiet machine before quoting a figure for it.

## Method

`scripts/qa/benchmark.mjs` loads the page and waits 8 s. It then plays seven phases of 6 s. Before each phase it puts the walker back at the pose it had when the world loaded and waits 2 s, so every size and every run sees the same view. In each phase it records the gap between consecutive `requestAnimationFrame` callbacks and the time the page spends in its frame callback.

| Phase | Input |
| --- | --- |
| stand | none |
| walk | hold `W` |
| run | hold `Shift` and `W` |
| fly | press `F`, hold `Space` for 1.2 s, then `Shift` and `W`. The walker covers about 580 m |
| planet, twist, fold | press `1`, `2` or `3`, wait 6 s, press it again and wait 2.5 s |

Before each run an empty WebGL clear loop of the same size runs for 4 s. It is the noise floor of the harness on this machine. Runs are interleaved across sizes, three runs per size, so a change in load lands on every size alike. A table cell is the median of the runs.

| Column | Meaning |
| --- | --- |
| fps | frames finished in the median whole second of the phase |
| low 1 s | frames in the worst whole second |
| p50, p95, p99, max | frame gaps in ms |
| slow % | share of gaps of 25 ms or more |
| cost p50, cost p95 | ms the main thread spends in the frame callback |
| moved m | metres the walker covered, so a phase that did nothing shows |
| luma | mean brightness of the canvas, so a phase that drew nothing shows |

### Drained runs

Headless Chrome ticks at 60 Hz, so every frame that fits in 16.7 ms reads the same. A capped run shows whether frames fit and not how much room is left. Turning vsync off alone does not help. The main thread then runs ahead of the GPU and the gaps stop following frame cost. Stalls of 1.4 to 1.5 s appeared in every such run, and the same scene read 40 fps in one run and 66 fps in another.

`--drain` ends every frame callback with a 1×1 `readPixels`, which waits for the GPU. The cost of the callback is then the time to issue the commands plus the GPU time of that frame, and the display rate does not cap it. It overstates a pipelined frame by the issue time and the cost of the readback. An empty clear loop with the same readback costs 1.2 ms at 1280×720, 1.8 ms at 1920×1080 and 2.2 ms at 2560×1440, and the drained tables show that row and do not subtract it. The frame gaps and the fps of a drained run are not comparable with an ordinary run, because the page can no longer work ahead.

A GPU timer query was tried first. `EXT_disjoint_timer_query_webgl2` exists in headless Chrome here. For a frame with every layer hidden it read 19 ms, and for the ground alone it read 46 ms against 40 ms for every layer. It did not measure the work, so it was dropped.

### Saturated runs

A drained run still waits for the display's tick. A frame that leaves the GPU idle for part of the tick may run at a lower clock than one that fills it, and then a small saving hides (inferred). `scripts/qa/saturated.mjs` removes the tick. Chrome runs with `--disable-gpu-vsync --disable-frame-rate-limit`, and every frame callback ends with the 1×1 `readPixels` of a drained run, so the next frame starts when the GPU has finished the last one.

The script also flips the states inside one page load. It alternates a control state with each test state, 40 frames each, and drops the first 14 frames of every window while the state settles. A saving is the mean cost of the two control windows around a test window minus the cost of the test window. A table gives the median over rounds and the lowest and highest round. A slow change in the machine's load lands on the control and the test alike, which a run per state cannot promise. The load average read 12 to 225 around these runs.

Pacing changes the size of a saving and not the cost of the frame. The same frame cost 10.6 ms paced and 10.7 ms saturated. The ground detail levels saved 0.85, 1.05 and 1.25 ms paced, and 1.15, 1.50 and 1.95 ms saturated (measured, one run each, `docs/benchmarks/paced-detail.txt`). The paced run shows about two thirds of the saving. A GPU clock that follows the load would explain it, and the runs do not separate that from other causes.

## Results

### Frame pacing

Cells hold fps, with the range over the three runs in brackets when it is not a single value, and the share of slow frames.

| Phase | 1280×720 fps | slow % | 1920×1080 fps | slow % | 2560×1440 fps | slow % |
| --- | --- | --- | --- | --- | --- | --- |
| empty WebGL loop | 60.0 | 0.0 | 60.0 | 0.0 | 60.0 | 0.0 |
| stand | 60 | 0.0 | 60 | 0.0 | 60 | 0.0 |
| walk | 60 | 0.0 | 60 | 0.0 | 60 | 0.0 |
| run | 60 | 0.0 | 60 | 0.0 | 60 | 0.0 |
| fly | 60 | 0.0 | 60 | 0.3 | 60 | 0.6 |
| planet | 60 | 0.0 | 60 | 0.0 | 60 | 0.0 |
| twist | 60 | 0.0 | 57 (56 to 58) | 4.3 | 43 | 14.6 |
| fold | 60 | 0.0 | 60 | 0.0 | 60 | 0.0 |

The same run at 1920×1080 in full:

| Phase | fps | low 1 s | p50 ms | p95 ms | p99 ms | max ms | slow % | cost p50 ms | moved m | luma |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| empty WebGL loop | 60.0 | 60.0 | 16.7 | 16.8 | 16.8 | 16.8 | 0.0 |  |  |  |
| stand | 60.0 | 59.0 | 16.7 | 16.8 | 16.8 | 16.8 | 0.0 | 0.6 | 0 | 0.52 |
| walk | 60.0 | 59.0 | 16.7 | 16.8 | 16.8 | 16.8 | 0.0 | 0.6 | 28 | 0.48 |
| run | 60.0 | 59.0 | 16.7 | 16.7 | 16.8 | 16.8 | 0.0 | 0.6 | 65 | 0.27 |
| fly | 60.0 | 59.0 | 16.7 | 16.7 | 16.8 | 50.0 | 0.3 | 0.6 | 578 | 0.64 |
| planet | 60.0 | 59.0 | 16.7 | 16.8 | 16.8 | 16.8 | 0.0 | 0.6 | 0 | 0.52 |
| twist | 57.0 | 56.0 | 16.7 | 16.8 | 33.4 | 33.4 | 4.3 | 0.5 | 0 | 0.45 |
| fold | 60.0 | 59.0 | 16.7 | 16.7 | 16.8 | 16.8 | 0.0 | 0.6 | 0 | 0.52 |

Every phase did its work (measured). The walker covered 0, 28, 65 and 578 m in stand, walk, run and fly, and the mean brightness of each phase matches across the three sizes to within 0.01 (stand reads 0.53, 0.52 and 0.52). A size that drew a different view would read differently.

A run writes `.work/bench.json`. It lists the GPU string, every phase of every run and any console errors. The tables here came from runs with none, and `docs/benchmarks/` holds the files behind them (see "Raw files").

### Cost of a frame, drained

Median over three runs of the 50th percentile cost in ms, standing and under twist, with every layer visible and with every layer hidden (`--layers '^$'`).

| Window | empty clear loop | stand, no layer | stand, every layer | twist, no layer | twist, every layer |
| --- | --- | --- | --- | --- | --- |
| 1280×720 | 1.2 | 4.8 | 10.4 | 4.8 | 14.6 |
| 1920×1080 | 1.8 | 7.7 | 11.6 | 7.8 | 21.2 |
| 2560×1440 | 2.2 | 10.9 | 13.4 | 9.7 | 28.8 |

The 95th percentile of the standing frame with every layer visible is 12.2, 13.0 and 15.3 ms at the three sizes.

Twist adds 4.2, 9.6 and 15.4 ms to the standing frame, which is 4.6, 4.6 and 4.2 ms for each megapixel of the window (measured). With every layer hidden twist costs about what standing costs (4.8 and 4.8, 7.7 and 7.8, 10.9 and 9.7 ms). The extra cost sits in the splat layers and grows with the pixel count, which points at fill. A frame of the twist shows the spires near the walker sheared into long ribbons that cover much of the screen, so overdraw of large splats is the likely cause (inferred, not isolated).

## What the field cache changed

An earlier build refilled twelve float textures every frame, the cell fields that hold the terrain height and the ground shadow (`docs/ARCHITECTURE.md`). `scripts/qa/stage-cost.mjs` found it by switching parts of the pipeline off one after another (see "Cost by stage"). With the layers and the sky off, switching the cell field passes off took a drained frame at 1920×1080 from 8.9 and 9.4 ms to 2.3 and 2.5 ms in that build. In the current build the same step changes nothing. `CellField.render` now skips a fill whose inputs equal the last one.

The comparison below built the version of `src/world/field.ts` before the change into a second folder, served it on a second port and alternated the two builds with `--base`, three pairs at 1920×1080 and 8 s per phase.

| | before | after |
| --- | --- | --- |
| stand fps, slow frames | 48, 16.2 % | 60, 0.0 % |
| walk fps, slow frames | 50 (48 to 52), 16.1 % | 60, 0.0 % |
| twist fps, slow frames | 34, 32.6 % | 58 (57 to 58), 4.3 % |
| drained cost p50, standing | 17.9 ms (17.6 to 17.9) | 11.6 ms (11.6 to 12.2) |
| drained cost p95, standing | 20.7 ms | 12.8 ms |

`scripts/qa/field-cache.mjs` counted the fills. A frame made 0.00 fills standing, 0.03 walking, 0.06 running and 3.19 flying, against 12 before (measured, 1280×720). Flying crosses realm blends, where the sun direction changes every frame and every field has to fill.

The change did not alter a pixel in the checks (measured). The same script compared 4,457,817 texels of cached fields with fresh fills at 63 moments and found none that differed. 37 film frames rendered again with the cache are byte-identical to the delivered frames. `docs/QA.md` lists the two deliberately broken cache keys that the script caught.

## Cost by layer

All tables in this part come from `scripts/qa/saturated.mjs` at 1920×1080, with the walker standing at the Dunes spawn unless a row says otherwise. `layers` hides each splat layer in turn. This run used 80 frames per window and six rounds (`docs/benchmarks/saturated-layers-long.txt`). With every layer drawn the frame cost 10.80 ms and Spark drew 982,141 splats. A saving is what the frame loses when the layer is hidden.

| Layer | Cell size m | Slots | Saves ms | Range |
| --- | --- | --- | --- | --- |
| groundNear0 | 0.9 | 93,312 | 0.35 | 0.15 to 0.40 |
| groundNear1 | 0.9 | 96,800 | 0.40 | 0.20 to 0.55 |
| ground0 | 0.9 | 165,888 | 0.50 | 0.35 to 0.80 |
| ground1 | 2.7 | 294,912 | 0.90 | 0.80 to 1.05 |
| ground2 | 8.1 | 165,888 | 0.75 | 0.50 to 0.90 |
| ground3 | 24.3 | 165,888 | 0.95 | 0.55 to 1.05 |
| ground4 | 72.9 | 165,888 | 0.95 | 0.70 to 1.30 |
| ground5 | 218.7 | 73,728 | 0.65 | 0.50 to 0.75 |
| ground6 | 656.1 | 73,728 | 0.75 | 0.45 to 1.00 |
| flora0 to flora3 | | 970,400 | 1.10 | -0.10 to 0.55 each |
| flocks | | 43,920 | 0.60 | 0.35 to 0.75 |
| wonders | | 179,712 | 0.40 | 0.25 to 0.60 |
| motes | | 200,000 | 0.35 | 0.05 to 0.40 |
| beasts | | 7,696 | 0.10 | -0.25 to 0.35 |
| clouds | | 4,096 | 0.10 | -0.05 to 0.35 |
| blooms | | 12,288 | -0.05 | -0.20 to 0.05 |

The savings add up to 8.80 ms, which is 81 % of the frame (measured). The nine ground rings account for 6.20 ms of that, so the ground is 57 % of the frame. The remaining 2.0 ms belongs to what no layer owns, which is the sky pass, the resolve and the readback of the harness (inferred from the difference).

A ring costs about the same whether it holds the splats next to the walker or the far horizon. The ring with 72.9 m cells saves 0.95 ms with 165,888 slots, and the near ring with 0.9 m cells saves 0.35 ms with 93,312 (measured). Cost per slot does not decide it. Two earlier runs with 40 frames per window and five and seven rounds agree on the ground's share and on the ranking of the rings within about 0.5 ms (`saturated-layers.txt`, `saturated-layers-2.txt`). Their control cost was 11.00 and 13.60 ms, so the level of a run moves by more than any one layer's saving, and only a saving measured inside one run is comparable.

## What the view cull saves

Every layer tests each splat against four planes through the camera and skips the shading of the ones outside (`docs/ARCHITECTURE.md`). `saturated.mjs cull` turns that off and on inside one run. The table gives what the frame loses with the cull off. Six rounds of 40 frames each (`docs/benchmarks/saturated-cull.txt`).

| View | Frame with the cull ms | Turning it off adds ms | Range |
| --- | --- | --- | --- |
| Dunes, standing | 10.80 | 1.75 | 1.35 to 2.00 |
| Deep, standing | 9.90 | 1.85 | 1.55 to 2.05 |
| Ember, standing | 11.60 | 2.40 | 2.15 to 2.55 |
| Dunes, flying 70 m up, looking down | 9.50 | 2.20 | 1.75 to 2.40 |
| Dunes, looking up at 0.6 rad | 10.70 | 2.00 | 1.75 to 2.40 |
| Dunes, flying 2.5 km up, looking down at 0.9 rad | 9.10 | 1.30 | 0.80 to 1.65 |

The cull saves between 1.3 and 2.4 ms in all six views, which is 12 to 19 % of the frame with it off (measured). It saves least from 2.5 km up, where most of the ring on screen is far ground that the cull cannot reach. The pictures do not change. The 19 live poses of `scripts/qa/game-shots.mjs` are byte-identical to the frames from before the cull. Nine film frames and 39 of 40 random poses are identical with the cull on and off. The fortieth flickers between two images in both states, so the cull is not the cause (measured).

## What the ground detail levels save

`GroundRings.setDetail` takes a share of the splats out of every ring. Level 0 draws all of them. Levels 1, 2 and 3 draw 0.75, 0.55 and 0.4 of the subdivision per side, which is 56 %, 30 % and 16 % of the splats before the subdivision is rounded to a whole number. The page picks the level from its render scale (`src/play/quality.ts`). At the 0.8 start scale of a 1080p display it runs level 0. The table gives what a coarser level saves against level 0, three sizes, six rounds of 40 frames each (`docs/benchmarks/saturated-detail.txt`).

| Size | Level 0 ms | Level 1 saves | Level 2 saves | Level 3 saves |
| --- | --- | --- | --- | --- |
| 640×360 | 9.50 | 0.80 (-0.30 to 1.30) | 0.30 (-0.25 to 1.50) | 0.55 (0.35 to 0.55) |
| 1280×720 | 10.00 | 0.75 (0.15 to 1.15) | 0.95 (0.80 to 1.15) | 0.50 (-0.55 to 0.85) |
| 1920×1080 | 11.10 | 1.30 (0.85 to 1.70) | 1.60 (1.05 to 1.95) | 1.75 (0.85 to 1.80) |

At 1920×1080 each level saves more than the one before. At the two smaller sizes the savings are between 0.3 and 1.0 ms and out of order, and their ranges reach zero, so those runs show a gain smaller than their noise (measured). A level 3 frame draws 260,474 splats against 982,141 at level 0, and it still costs 8.8 ms at 1920×1080 (`saturated-layers-level3.txt`). Hiding any one layer of that frame saves 0.85 ms or less, and the ranges of most layers reach below zero. The savings add up to 5.4 ms of the 8.8. These runs cannot split the time of a level 3 frame by layer, and the cause is not known.

Level 3 smears the thin line patterns of the ground, which are Ember's lava cracks and the cell edges of Prism and Flats. Level 1 looks the same as level 0 in Ember, Prism and Flats (measured by eye, one frame each).

## Cost by stage

`scripts/qa/stage-cost.mjs` switches parts of the pipeline off one after another and times the drained frame after each step. Every step keeps the earlier ones off. The table is 1920×1080, standing, p50 in ms, two runs per build. The earlier build is the one before the field cache.

| Step | earlier build | current build |
| --- | --- | --- |
| every layer | 19.3 and 17.8 | 11.9 and 13.2 |
| no layer | 10.1 and 9.9 | 5.5 and 4.7 |
| and no sky pass | 8.9 and 9.4 | 2.4 and 2.3 |
| and no cell field passes | 2.3 and 2.5 | 2.3 and 2.3 |
| and no resolve | 0.5 and 0.5 | 0.5 and 0.5 |
| and no HDR draw | 0.4 and 0.4 | 0.4 and 0.4 |

The cell field passes cost 6.6 and 6.9 ms in the earlier build and 0.1 and 0.0 ms in the current one (measured). That is what the cache removed. The sky pass shows the reverse. Switching it off saved 1.2 and 0.5 ms in the earlier build and 3.1 and 2.4 ms in the current one. One pass does not cost both, so what a pass saves depends on what else the GPU runs. Passes that overlap would do this, and so would a clock that follows the load (inferred, not separated). The resolve costs 1.8 to 2.0 ms in all four runs (measured).

The frame with every layer hidden is the least stable reading. It was 5.5 and 4.7 ms here and 7.7 and 7.8 ms in the drained table by size above, which hides the layers the same way (measured). Quote none of these as the cost of an empty frame.

## What a visitor gets

The page runs with `quality=auto` unless a link says otherwise. The governor starts at the size that holds 1.35 million pixels, which is 1549×871 at 1920×1080 and at 2560×1440 and the full window at 1280×720. It lowers the size by a tenth when the smoothed frame time passes 1.5 times the best one, and it climbs by a tenth after 4 s of clean frames (`src/play/governor.ts`). It also picks a level of ground detail from the scale it applies. Level 0 holds from 0.8, level 1 from 0.7, level 2 from 0.6 and level 3 below that (`src/play/quality.ts`). The runs in the table below kept the full window width, so they ran level 0.

This table is two runs per size, 10 s per phase, after the 8 s load. It ran on the build with the title texture fix and the stall cap (`docs/QA.md`). The same run on the build before them logged `GL_INVALID_VALUE` errors from four pages. This run logged none.

| Window | Phase | fps | slow % | render width at the end of the phase |
| --- | --- | --- | --- | --- |
| 1280×720 | stand | 60 | 0.0 | 1280, 1280 |
| 1280×720 | walk | 60 | 0.0 | 1280, 1280 |
| 1280×720 | twist | 60 | 0.0 | 1280, 1280 |
| 1920×1080 | stand | 60 | 0.0 | 1920, 1920 |
| 1920×1080 | walk | 60 | 0.0 | 1920, 1920 |
| 1920×1080 | twist | 57 (56 to 57) | 6.4 | 1920, 1920 |
| 2560×1440 | stand | 60 | 0.0 | 2560, 2560 |
| 2560×1440 | walk | 60 | 0.0 | 2560, 2560 |
| 2560×1440 | twist | 41 (40 to 41) | 18.8 | 2560, 2560 |

At every size the governor reached the full window width before the stand phase ended and kept it (measured). Twist at 2560×1440 reads 41 fps with the size untouched. A frame time of 24 ms is under the limit of 25 ms, so the governor does not step in (inferred from the code and the render width). A page that shows 41 fps on a 60 Hz display judders, and a lower threshold would trade pixels for smoothness there (a design choice and not a measurement).

## What this says

- **The harness is not the limit (measured).** The empty WebGL loop holds 60.0 fps with no slow frame at every size.
- **The page fits the tick in every phase but twist (measured).** Standing, walking, running, flying, the planet and the fold hold 60 fps at all three sizes. At most 0.6 % of their frames are slow, in the fly phase at 2560×1440. The main thread spends 0.5 to 0.6 ms in each frame callback, so the limit is on the GPU side (inferred).
- **A standing frame leaves room in a 16.7 ms tick (inferred).** Drained, it costs 10.4, 11.6 and 13.4 ms at the three sizes, and the harness takes 1.2, 1.8 and 2.2 ms of that. What is left is 9.2, 9.8 and 11.2 ms. The tick leaves at least 7.5, 6.9 and 5.5 ms. At the 95th percentile the figures are 5.7, 5.5 and 3.6 ms.
- **Moving costs almost nothing (measured).** Walking, running and flying read 60 fps like standing. Flying drops 0.3 % and 0.6 % of its frames at the two larger sizes. It is the one phase that crosses realm blends, where every cell field fills each frame, and that may be where its slow frames come from (a guess).
- **Twist is the one power that follows the pixel count (measured).** It reads 60, 57 and 43 fps at the three sizes and costs 4.6, 4.6 and 4.2 ms more than standing for each megapixel. The planet and the fold read 60 fps at every size.
- **The ground is 57 % of a 1920×1080 frame (measured).** Its nine rings save 6.20 ms of 10.80 when hidden one at a time inside a saturated run. The flora saves 1.10 ms and no other family saves more than 0.60.
- **The view cull takes 1.3 to 2.4 ms out of a 1920×1080 frame (measured).** That holds in six views, on the ground, in the air and looking up, and it does not change a pixel.
- **A coarser ground level saves 1.3 to 1.75 ms at 1920×1080 (measured).** At 640×360 and 1280×720 the saving is inside the noise of the runs.
- **The cell field cache took about 7 ms out of a drained frame at 1920×1080 (measured).** The passes cost 6.6 and 6.9 ms before it and 0.1 and 0.0 ms after it.

## What this does not say

- **What an empty frame costs, and how it splits.** The frame with every layer hidden read 4.7 to 7.9 ms across the runs, so no figure is stable. The resolve takes 1.8 to 2.0 ms in every run. The sky pass saved 0.5 to 1.2 ms in the earlier build and 2.4 to 3.1 ms in the current one, so this page quotes no cost for it.
- **What sets most of the cost of a small frame.** The frame costs 9.5 ms at 640×360 and 11.1 ms at 1920×1080, which is nine times the pixels (`saturated-detail.txt`). A level 3 frame at 1920×1080 draws a quarter of the splats and costs 8.8 ms. Neither pixels nor splats set most of it, and the layer tables cannot place it. The cause is not known.
- **How far above 60 fps the page can go.** The drained cost suggests room. No run used a display faster than 60 Hz.
- **A quiet machine.** The load average sat between 12 and 366 on 10 cores. The empty loop held 60.0 fps through all of it, so the timer was steady. A quiet machine would probably give lower costs (a guess).
- **Any other GPU, display or browser.** No run used a device pixel ratio above 1, a 120 Hz display, battery power or a browser other than Chrome. The page caps its pixel ratio at 1.5 and lets the governor lower the scale from there.
- **Frame time over a long session.** No run of frame times lasted more than a few minutes. `scripts/qa/soak.mjs` played five minutes and watched memory, not frame time (`docs/QA.md`).
- **The start of a page.** Every phase above begins after the first frame. How long a visitor waits for it, and how that changes between a first visit and a second, is in `docs/QA.md` (`scripts/qa/cold-start.mjs`).

## Raw files

| File | Behind |
| --- | --- |
| `docs/benchmarks/sweep.json` | the frame pacing tables |
| `docs/benchmarks/drained-sizes.json` | the drained cost by size |
| `docs/benchmarks/saturated-layers-long.txt` | the cost by layer. `saturated-layers.txt` and `saturated-layers-2.txt` are two earlier runs with shorter windows |
| `docs/benchmarks/saturated-layers-level3.txt` | the cost by layer at ground detail level 3 |
| `docs/benchmarks/saturated-cull.txt` | what the view cull saves |
| `docs/benchmarks/saturated-detail.txt` | what the ground detail levels save |
| `docs/benchmarks/paced-detail.txt` | the same levels with the display pacing on and off |
| `docs/benchmarks/stage-cost.txt` | the cost by stage |
| `docs/benchmarks/field-cache-ab/` | the before and after of the field cache. `ab-old-*` and `ab-new-*` are the ordinary runs, `ab-drain-old-*` and `ab-drain-new-*` the drained ones |
| `docs/benchmarks/auto.json` | what a visitor gets |
| `docs/benchmarks/share-encode.json` | the share file against the master (`docs/QA.md`) |

## Film render

The film is not real time. It renders each frame on demand.

| | |
| --- | --- |
| Frames | 1,153 at 1920×1080, 2× supersampling (a 3840×2160 half-float target) |
| Sub-frames | 12,503 in total for motion blur, 10.84 per frame on average, 2 to 20 (`scripts/qa/blur-stats.mjs --spacing 2.5 --max 20`) |
| Processes | two, sharing the GPU (`--shard 0/2` and `--shard 1/2`) |
| Wall time | 9 min 2 s for the two processes, from the last render of Nov 16 (an earlier render the same night took 7 min 52 s). The machine ran other projects during this one, with a load average of 12.6 to 14.7, so the gap says little about the code (inferred) |
| Encode | 2 min 6 s for the master and 1 min 9 s for the share file, one after the other, with the machine busy |

These figures are not evidence of real-time performance.
