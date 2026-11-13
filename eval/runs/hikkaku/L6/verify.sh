#!/bin/sh
# Re-verify L6. Run from repo root.
set -e
D=eval/runs/hikkaku/L6
node tools/vmrun/cli.mjs check $D/out.sb3 | tee $D/vmrun.check.json
node tools/vmrun/cli.mjs diff eval/fixtures/scrolltutorial-378587848.sb3 $D/out.sb3 \
  | tee $D/vmrun.diff.json
node tools/vmrun/cli.mjs layout $D/out.sb3 | tee $D/vmrun.layout.json
# pause: hold right with and without P toggles; bubble while paused
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 300 --input $D/input.right.json \
  --probe player.variables.x | tee $D/vmrun.run-nopause.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 300 --input $D/input.right-pause.json \
  --probe player.variables.x | tee $D/vmrun.run-pause.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 100 --input $D/input.right-pause2.json \
  --probe player.bubble | tee $D/vmrun.run-bubble.json
# jump: two spaced up-presses, baseline fixture vs edited (trace peak)
node tools/vmrun/cli.mjs run eval/fixtures/scrolltutorial-378587848.sb3 \
  --frames 140 --input $D/input.jump.json --trace player 2>/dev/null \
  | tee $D/vmrun.jump-base.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 140 --input $D/input.jump.json \
  --trace player 2>/dev/null | tee $D/vmrun.jump-mod.json
