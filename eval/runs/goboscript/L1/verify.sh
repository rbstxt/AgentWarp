#!/bin/sh
# L1 verification (run from repo root)
set -e
cd "$(dirname "$0")/../../../.."
node tools/vmrun/cli.mjs check eval/runs/goboscript/L1/out.sb3 > eval/runs/goboscript/L1/check.json
node tools/vmrun/cli.mjs run eval/runs/goboscript/L1/out.sb3 --seconds 1 \
  --probe Sprite1.x --probe Sprite1.bubble.text | tee eval/runs/goboscript/L1/run.json
# expect probes: {"Sprite1.x": 10, "Sprite1.bubble.text": "Hello!"}
