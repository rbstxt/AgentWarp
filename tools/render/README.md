# render

Run Scratch projects in headless Chromium with TurboWarp's `scratch-vm`, a WebGL `scratch-render`, and local project assets. The stage, pen layer, sprite effects and speech bubbles are drawn by the renderer. Collision and color sensing use its pixel data. The CLI blocks network requests during a run.

## Setup

```sh
cd tools/render
npm ci
npx playwright install chromium
```

`compare` also needs `npm ci` in `tools/vmrun`. Node must support ES modules. Playwright's Chromium needs a working headless WebGL implementation; the CLI enables SwiftShader for software rendering. All packages and the browser must be installed before offline use. A bundle is built in memory on each invocation.

## Commands

From the repository root:

```sh
node tools/render/cli.mjs shot game.sb3 --frames 90 --at 0,29,89 --out /tmp/shot --gif
node tools/render/cli.mjs compare game.sb3 --frames 90 --input inputs.json --seed 7 --out /tmp/comparison
python3 tools/render/test-render.py
```

Both commands require a nonnegative integer `--frames`. `--timeout` sets the overall wall-clock deadline in seconds and defaults to 120. On timeout the command exits nonzero; PNGs already written remain in the output directory. Progress goes to stderr, including asset loads and completed frames. The asset count is the number of asset creation operations, which can include repeated assets. `--seed` defaults to 1. `--at` is a comma-separated list of zero-based frame indices, captured **after** that frame's step. It defaults to the final frame; a zero-frame run has no PNG. `--out` defaults to `render-output`. PNG names are `frame-000000.png`, and `state.json` contains the final state. With `--gif`, `run.gif` contains every frame at an average 30 fps; GIF's centisecond resolution makes individual delays alternate between 30 and 40 ms. GIF requires at least one frame. Screenshots are 480×360 stage pixels, including renderer-drawn bubbles and pen; Scratch editor monitor widgets and ask fields are not drawn.

`shot` prints the final state as JSON. `compare` prints `{file, frames, equal, differences, rendered}`. Each difference gives a JSON path and both values; arrays are compared by index. It invokes `tools/vmrun/cli.mjs run` with the same frames, input and seed. Differences are diagnostic, so unequal states do not change the exit code. Execution and argument errors exit nonzero.

`--input` accepts the same array or `{ "inputs": [...] }` as vmrun. Events run before their frame's step. Supported types are `keydown`, `keypress`, `keyup`, `mouse`, `click`, `broadcast`, `greenflag`, `stop`, and `answer`, with the same fields and key normalization documented in [vmrun](../vmrun/README.md#input-scripts). Inputs are injected into the VM rather than synthesized as DOM events. The copied stepping code is in `harness.mjs`; keep it synchronized with vmrun when its semantics change.

The clock advances by 1000/30 ms per step. The seeded mulberry32 generator replaces `Math.random` before project load. Say/think-for-seconds uses the VM's virtual stack timer, as in vmrun. SVG skins finish decoding before the first step, so a collision in frame 0 sees the actual image. The renderer is drawn after each selected step, and on every step when encoding a GIF.

## Verification and differences

The included `test-render.py` creates a temporary project, verifies touching-color against a red backdrop, and checks for pen pixels in the output PNG. Samples under `samples/` were generated with the seven `tools/vmrun/test-fixtures/*.sb3` files and `eval/p2c/ts/L4/out.sb3` and `L5/out.sb3`, using 30 frames and `sample-input.json`. On the development Mac, complete `compare` invocations took 1.36–2.07 seconds, including browser startup and bundling; the 30-frame GIF run took 3.07 seconds. The GIF has 30 frames and a one-second duration. Repeated greenflag screenshots matched by SHA-256.

The rendered collision test uses actual silhouettes and rotation, while vmrun uses unrotated bounding boxes and always returns false for color sensing. Renderer bounds and minimum/maximum size constraints can also change sprite positions or sizes. With the sample input, the keys fixture differed in position after edge bounce; L5 differed in one position and three constrained sizes. Click, L4 and L5 also reported browser VM warnings about missing audio assets, which vmrun did not report. The other tested state fields matched in that run. These results depend on project inputs and frame count.

Audio is not attached, so sound is silent and sound timing is not simulated. Built-in pen works; external extensions and cloud/network access are unavailable. The VM still uses a wall-clock work budget for pure-compute loops, and date/username blocks are not virtualized, matching vmrun's limitations. Browser, GPU, fonts, and renderer versions can affect pixels and execution cost. The lockfile pins the tested dependencies, including the `scratch-render` prerelease. Browser console VM warnings are recorded in `vmWarnings`; their wording and coverage can differ from vmrun's stderr capture.
