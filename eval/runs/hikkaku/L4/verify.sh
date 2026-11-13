#!/bin/sh
# Re-verify L4. Run from repo root.
set -e
D=eval/runs/hikkaku/L4
node tools/vmrun/cli.mjs check $D/out.sb3 | tee $D/vmrun.check.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 1800 --input $D/input.fire.json \
  --probe Stage.variables.score --probe Stage.variables.lives \
  --probe clones.Bullet --probe clones.Enemy --probe Banner.visible \
  | tee $D/vmrun.run-fire.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 1800 \
  --probe Stage.variables.lives --probe Stage.variables.score \
  --probe Banner.visible --probe Banner.costumeName \
  | tee $D/vmrun.run-noinput.json
node tools/vmrun/cli.mjs layout $D/out.sb3 | tee $D/vmrun.layout.json
