#!/bin/sh
# L6 verification (run from repo root).
# 1. Decompile fixture (import step): sb2gs eval/fixtures/scrolltutorial-378587848.sb3
# 2. Build edited sources in eval/runs/goboscript/L6/src (see player.gs,
#    PausedSign.gs, paused.svg, stage.gs `paused` var).
# 3. Restore/attach comments via patch_comments.py (goboscript cannot do this).
# 4. check + diff + layout; behavior probes for pause / 1.5x jump / double jump.
set -e
cd "$(dirname "$0")/../../../.."
GOBO="$HOME/.cargo/bin/goboscript"
FIX=eval/fixtures/scrolltutorial-378587848.sb3
L6=eval/runs/goboscript/L6
(cd $L6/src && "$GOBO" build && cp src.sb3 ../out.sb3 && rm -f src.sb3)
# restore_assets is a no-op once src/assets/ holds original bytes (idempotent)
python3 $L6/restore_assets.py > /dev/null
python3 $L6/patch_comments.py
node tools/vmrun/cli.mjs check $L6/out.sb3 > $L6/check.json
node tools/vmrun/cli.mjs diff $FIX $L6/out.sb3 > $L6/diff.json
node tools/vmrun/cli.mjs layout $L6/out.sb3 > $L6/layout.json
cat $L6/check.json | python3 -c "import json,sys; print('check ok:', json.load(sys.stdin)['ok'])"
python3 -c "
import json
d = json.load(open('$L6/diff.json'))
for t, info in d['targets'].items():
    c = info.get('comments', {})
    add = c.get('added', 0)
    print(t, '| del/add/mov/chg/unCH:', len(info.get('deleted', [])), len(info.get('added', [])), len(info.get('moved', [])), len(info.get('changed', [])), info.get('unchangedCount'), '| cmt kept/lost/chg/add:', c.get('kept'), len(c.get('lost', [])), len(c.get('changed', [])), add if isinstance(add, int) else len(add))
"
python3 -c "
import json
d = json.load(open('$L6/layout.json'))
print('overlaps:', {t: v.get('overlaps') for t, v in d['targets'].items()})
"
# behavior: pause freezes world x and shows the sign; jump is higher + twice
node tools/vmrun/cli.mjs run $L6/out.sb3 --frames 60 \
  --input $L6/input_pause.json --probe player.variables.x \
  --probe PausedSign.visible | python3 -c "import json,sys; print('paused@60:', json.load(sys.stdin)['probes'])"
node tools/vmrun/cli.mjs run $L6/out.sb3 --frames 110 \
  --input $L6/input_pause.json --probe player.variables.x \
  --probe PausedSign.visible | python3 -c "import json,sys; print('resumed@110:', json.load(sys.stdin)['probes'])"
node tools/vmrun/cli.mjs run $L6/out.sb3 --frames 120 \
  --input $L6/input_jump.json --trace player 2>/dev/null | python3 -c "
import json,sys
d = json.load(sys.stdin)
ys = [s['targets'][0]['y'] for s in d['trace']]
print('double-jump peak:', round(max(ys), 1), '(original single-jump peak: 109)')
"
