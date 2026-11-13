#!/bin/sh
# L2 verification (run from repo root)
set -e
cd "$(dirname "$0")/../../../.."
node tools/vmrun/cli.mjs check eval/runs/goboscript/L2/out.sb3 > eval/runs/goboscript/L2/check.json
node tools/vmrun/cli.mjs run eval/runs/goboscript/L2/out.sb3 --frames 600 \
  --input eval/runs/goboscript/L2/input.json \
  --probe Cat.x --probe Ball.x --probe Ball.y | tee eval/runs/goboscript/L2/run.json
# expect: Cat.x >= 100 (150); |Ball.x| <= 240, |Ball.y| <= 180
