#!/bin/sh
# Re-verify L2. Run from repo root.
set -e
D=eval/runs/hikkaku/L2
node tools/vmrun/cli.mjs check $D/out.sb3 | tee $D/vmrun.check.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 30 --input $D/input.hold-right.json \
  --probe Sprite1.x | tee $D/vmrun.run30.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 600 --input $D/input.hold-right.json \
  --probe Sprite1.x --probe Ball.x --probe Ball.y --trace Ball | tee $D/vmrun.run600.json
node tools/vmrun/cli.mjs layout $D/out.sb3 | tee $D/vmrun.layout.json
