# TurboWarp editor calibration

Measurements were collected on 2026-11-13 from https://turbowarp.org/editor, using Playwright Chromium at 1440 x 900, locale `en-US` and a fresh browser profile. The public editor is a moving target; measurements can change with its version, fonts, platform, settings or language. Values are workspace units, not screen pixels after zoom. `getHeightWidth()` includes the entire connected stack and nested input blocks. The JSON also contains `getBoundingRectangle()` and every rendered block. Sprite IDs and synthesized shadow IDs are VM-generated and may differ on another run.

## Reproduce

From the repository root:

```sh
npm install --prefix tools/calibrate
npx --prefix tools/calibrate playwright install chromium
node tools/calibrate/measure.mjs tools/vmrun/test-fixtures/greenflag.sb3
for f in eval/fixtures/*.sb3 tools/vmrun/test-fixtures/*.sb3; do
  node tools/calibrate/measure.mjs "$f"
done
node tools/calibrate/probe.mjs
node tools/calibrate/analyze.mjs
```

`EDITOR_URL` can override the editor URL. The script accesses the editor's exposed `window.vm` and `window.ScratchBlocks`: `vm.loadProject(arrayBuffer)`, `vm.setEditingTarget(id)`, `ScratchBlocks.getMainWorkspace()`, `workspace.cleanUp()` and `vm.saveProjectSb3()`. It waits for workspace events after each switch and cleanup. Attached comments use `getXY()`, workspace comments use `getRelativeToSurfaceXY()`, and width/height describe the expanded size, including for minimized comments. Browser dialogs are dismissed, including the addon prompt to delete orphan reporters or unused variables. The cleanup SB3 is serialized by the VM, which remaps block IDs and rounds coordinates to integers. The JSON captures the original editor IDs and unrounded workspace coordinates. The source projects are not modified.

## Cleanup behavior

The public editor currently enables the Developer Tools addon and its Enhance Clean up Blocks setting by default. Its wrapper replaces `workspace.cleanUp()` with Clean up Plus. The observed output is therefore not the plain scratch-blocks algorithm. The addon ([source, pinned commit](https://github.com/TurboWarp/scratch-gui/blob/7738389afee319d2c6293550a2f7cb13004b928c/src/addons/addons/editor-devtools/DevTools.js)) works as follows:

1. Assign top-level blocks to the closest existing column with x distance under 256, updating each column's mean x. Separate output-shaped orphan blocks and ask whether to delete them; this run declined.
2. Sort columns by mean x and blocks within each column by y. The declined orphans are prepended as a separate column.
3. Start at x=48, y=64. Stack blocks using their rendered height plus 72 units; advance columns by the maximum rendered block/comment width plus 96.
4. Reposition attached comments automatically and account for their width. Floating workspace comments are not moved by this loop.
5. Ask about unused local variables and lists. This run declined those prompts, and cleanup changes were saved via the VM.

The underlying [scratch-blocks cleanup source](https://github.com/TurboWarp/scratch-blocks/blob/7c58de666658df1bb447d010132aa3914c10f41e/core/workspace_svg.js#L1512) instead sorts `getTopBlocks(true)` by `y + sin(3 degrees) * x` for left-to-right workspaces, starts at `(0, 0)`, moves each block and applies grid snapping if enabled, then advances by rendered stack height plus `BlockSvg.MIN_BLOCK_Y` (48 in the live editor). It groups events and resizes the workspace afterward. It does not separately iterate over workspace comments. Attached comments follow their blocks through the editor's normal block movement behavior. These upstream rules do not describe the default editor measurements above.

## Block measurements

`block-metrics.json` summarizes 107 observed opcodes. A terminal sample has no next block but can still contain inputs or nested substacks; stack samples contain the full connected stack. They are actual fixture values, not a controlled default-input catalog. In this browser an isolated green-flag hat observed in a fixture measured 148.5 x 56; a terminal `motion_movesteps` with its input measured 153.25 x 56; terminal `control_stop` examples were 48 high; `math_number` inputs were 32 high with a 40-unit minimum in these samples. C-block and reporter dimensions vary with their contents; consult the samples and per-block JSON. The separate `probe.mjs` renders fresh blocks with empty inputs, without toolbox shadow XML. Its measurements are in `render-probes.json` and `block-metrics.json`: a repeat is 160 x 112, if/else 160 x 168, forever 160 x 104, and an empty-input addition reporter 129.61 x 40. These are empty-block baselines, not default toolbox blocks. The probe also measures the actual SVG label font (500 16px Helvetica Neue on this machine): ten i characters measure 38.56 units and ten W characters 151.04, showing why a single per-character width is unreliable.

## Estimator comparison

`analyze.mjs` runs `vmrun layout` and `layout --cleanup` on each source fixture. It matches editor scripts by target name and original block ID. Width, height, x and y columns show mean / maximum absolute error in workspace units. Position errors compare the estimator's cleanup SB3 with the live editor's cleanup, not the upstream Scratch-only method. Both real-world projects and small synthetic fixtures are included; the overall mean is weighted per matched script.

| Fixture | Matched | Width mean / max | Height mean / max | Cleanup x mean / max | Cleanup y mean / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| click | 1 | 25.6 / 25.6 | 22.0 / 22.0 | 28.0 / 28.0 | 44.0 / 44.0 |
| clones | 2 | 19.8 / 37.3 | 30.0 / 38.0 | 28.0 / 28.0 | 84.0 / 124.0 |
| greenflag | 2 | 63.9 / 87.1 | 37.0 / 52.0 | 28.0 / 28.0 | 44.0 / 44.0 |
| keys | 2 | 97.2 / 182.3 | 43.0 / 46.0 | 28.0 / 28.0 | 44.0 / 44.0 |
| lightcube-134430880 | 156 | 72.3 / 725.3 | 188.9 / 1880.0 | 433.2 / 3794.2 | 1925.2 / 20280.0 |
| platformer-853110869 | 90 | 162.6 / 2645.5 | 159.6 / 1696.0 | 3929.4 / 11230.9 | 8166.0 / 22138.0 |
| scrolltutorial-378587848 | 14 | 72.8 / 214.0 | 137.3 / 468.0 | 726.6 / 2496.1 | 441.0 / 1218.0 |
| touch | 1 | 208.3 / 208.3 | 116.0 / 116.0 | 28.0 / 28.0 | 44.0 / 44.0 |
| **All matched** | 268 | 102.7 / 2645.5 | 172.1 / 1880.0 | 1610.5 / 11230.9 | 3887.6 / 22138.0 |

Two top-level `data_variable` reporters in platformer render in the editor but are stored as compact arrays in the original SB3, which `vmrun layout` skips. They are excluded from the error statistics. `comparison.json` contains full precision and per-fixture counts. Verification of the saved cleanup projects matched all noncompact top-level block positions against the editor after integer rounding. The two compact reporters require separate handling when comparing SB3 serialization.
