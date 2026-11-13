#!/bin/sh
# Re-verify L3. Run from repo root.
set -e
D=eval/runs/hikkaku/L3
node tools/vmrun/cli.mjs check $D/out.sb3 | tee $D/vmrun.check.json
node tools/vmrun/cli.mjs run $D/out.sb3 --frames 60 --input $D/input.clicks10.json \
  --probe Cookie.variables.score --probe Stage.costumeName | tee $D/vmrun.run.json
node tools/vmrun/cli.mjs layout $D/out.sb3 | tee $D/vmrun.layout.json
