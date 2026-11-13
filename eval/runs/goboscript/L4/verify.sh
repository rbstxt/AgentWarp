#!/bin/sh
# L4 verification (run from repo root). Build with goboscript, then check + run.
set -e
cd "$(dirname "$0")/../../../.."
GOBO="$HOME/.cargo/bin/goboscript"
(cd eval/runs/goboscript/L4 && "$GOBO" build && cp L4.sb3 out.sb3 && rm -f L4.sb3)
node tools/vmrun/cli.mjs check eval/runs/goboscript/L4/out.sb3 > eval/runs/goboscript/L4/check.json
# mid-run: clone counts bounded, score already increasing
node tools/vmrun/cli.mjs run eval/runs/goboscript/L4/out.sb3 --frames 150 \
  --input eval/runs/goboscript/L4/input.json \
  --probe Stage.variables.score --probe Stage.variables.lives \
  --probe clones.Enemy --probe clones.Bullet > eval/runs/goboscript/L4/run150.json
# full run: score increases, lives -> 0, Game Over shown, clones disposed by stop_all
node tools/vmrun/cli.mjs run eval/runs/goboscript/L4/out.sb3 --frames 1800 \
  --input eval/runs/goboscript/L4/input.json \
  --probe Stage.variables.score --probe Stage.variables.lives \
  --probe GameOver.visible | tee eval/runs/goboscript/L4/run.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('probes:', d['probes'])"
# expect 150f: score>=1, clones single digits; 1800f: score>0, lives 0, GameOver.visible True
