#!/bin/sh
# Re-verify L6b. Run from repo root.
set -e
D=eval/runs/hikkaku/L6b
node tools/vmrun/cli.mjs check $D/out.sb3 | tee $D/vmrun.check.json
node tools/vmrun/cli.mjs diff eval/fixtures/platformer-853110869.sb3 $D/out.sb3 \
  | tee $D/vmrun.diff.json
node tools/vmrun/cli.mjs layout $D/out.sb3 | tee $D/vmrun.layout.json
node tools/vmrun/cli.mjs run $D/out.sb3 --seconds 7 \
  --probe Stage.variables.タイム | tee $D/vmrun.run.json
