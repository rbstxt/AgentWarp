#!/bin/sh
# Re-verify L5. Run from repo root.
set -e
D=eval/runs/hikkaku/L5
node tools/vmrun/cli.mjs check $D/out.sb3 | tee $D/vmrun.check.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 120 \
  --probe Player.variables.worldY --probe Player.variables.onGround --probe Player.x \
  | tee $D/vmrun.run-settle.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 150 --input $D/input.jump.json \
  --probe Player.variables.worldY --probe Player.variables.onGround \
  | tee $D/vmrun.run-jump.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 260 --input $D/input.level2.json \
  --probe Player.variables.worldY --probe Player.variables.worldX \
  | tee $D/vmrun.run-level2.json
node tools/vmrun/cli.mjs layout $D/out.sb3 | tee $D/vmrun.layout.json
