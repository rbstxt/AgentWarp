#!/bin/sh
# Re-verify L1. Run from repo root.
set -e
D=eval/runs/hikkaku/L1
node tools/vmrun/cli.mjs check $D/out.sb3 | tee $D/vmrun.check.json
node tools/vmrun/cli.mjs run $D/out.sb3 --seconds 1 \
  --probe Sprite1.x --probe Sprite1.bubble | tee $D/vmrun.run.json
node tools/vmrun/cli.mjs layout $D/out.sb3 | tee $D/vmrun.layout.json
