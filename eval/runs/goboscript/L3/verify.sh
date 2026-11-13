#!/bin/sh
# L3 verification (run from repo root). Build with goboscript, apply monitor
# workaround patch, then check + run.
set -e
cd "$(dirname "$0")/../../../.."
GOBO="$HOME/.cargo/bin/goboscript"
(cd eval/runs/goboscript/L3 && "$GOBO" build && cp L3.sb3 out.sb3 && rm -f L3.sb3)
python3 eval/runs/goboscript/L3/add_monitor.py
node tools/vmrun/cli.mjs check eval/runs/goboscript/L3/out.sb3 > eval/runs/goboscript/L3/check.json
node tools/vmrun/cli.mjs run eval/runs/goboscript/L3/out.sb3 --frames 60 \
  --input eval/runs/goboscript/L3/input.json \
  --probe Stage.variables.score --probe Stage.costumeName | tee eval/runs/goboscript/L3/run.json
# expect: score 10, costumeName "win"
