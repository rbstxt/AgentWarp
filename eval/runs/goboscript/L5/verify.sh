#!/bin/sh
# L5 verification (run from repo root). Build with goboscript, then check + run.
set -e
cd "$(dirname "$0")/../../../.."
GOBO="$HOME/.cargo/bin/goboscript"
(cd eval/runs/goboscript/L5 && "$GOBO" build && cp L5.sb3 out.sb3 && rm -f L5.sb3)
node tools/vmrun/cli.mjs check eval/runs/goboscript/L5/out.sb3 > eval/runs/goboscript/L5/check.json
# main probe: land on platform (y stable at 36) within 120 frames; jump raises y
node tools/vmrun/cli.mjs run eval/runs/goboscript/L5/out.sb3 --frames 120 \
  --input eval/runs/goboscript/L5/input.json --trace Player > eval/runs/goboscript/L5/run.json
python3 - eval/runs/goboscript/L5/run.json <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
ys = [(s['frame'], s['targets'][0]['y']) for s in d['trace']]
land = [y for f, y in ys if 20 <= f <= 65]
jump = [y for f, y in ys if 70 <= f <= 82]
print('landed stable at 36:', min(land) == max(land) == 36)
print('jump peak:', round(max(jump), 1), 'back to 36:', ys[-1][1] == 36)
assert min(land) == max(land) == 36 and max(jump) > 100 and ys[-1][1] == 36
print('L5 OK')
EOF
# level-2 switch probe: press L, player resets and level var becomes 2
node tools/vmrun/cli.mjs run eval/runs/goboscript/L5/out.sb3 --frames 120 \
  --input eval/runs/goboscript/L5/input_level2.json \
  --probe Stage.variables.level | python3 -c "import json,sys; print('level:', json.load(sys.stdin)['probes'])"
