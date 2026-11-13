#!/bin/sh
# L6b verification (run from repo root).
set -e
cd "$(dirname "$0")/../../../.."
GOBO="$HOME/.cargo/bin/goboscript"
FIX=eval/fixtures/platformer-853110869.sb3
L6b=eval/runs/goboscript/L6b
(cd $L6b/src && "$GOBO" build && cp src.sb3 ../out.sb3 && rm -f src.sb3)
# restore_assets is a no-op once src/assets/ holds original bytes (idempotent)
python3 $L6b/restore_assets.py > /dev/null
python3 $L6b/patch_rename.py
node tools/vmrun/cli.mjs check $L6b/out.sb3 > $L6b/check.json
node tools/vmrun/cli.mjs diff $FIX $L6b/out.sb3 > $L6b/diff.json
node tools/vmrun/cli.mjs layout $L6b/out.sb3 > $L6b/layout.json
python3 -c "import json; print('check ok:', json.load(open('$L6b/check.json'))['ok'])"
python3 -c "
import json
d = json.load(open('$L6b/diff.json'))
tot = {'del': 0, 'add': 0, 'unCH': 0}
for t, info in d['targets'].items():
    tot['del'] += len(info.get('deleted', [])); tot['add'] += len(info.get('added', [])); tot['unCH'] += info.get('unchangedCount') or 0
    c = info.get('comments', {})
    add = c.get('added', 0)
    print(t, '| scripts del/add/unCH:', len(info.get('deleted', [])), len(info.get('added', [])), info.get('unchangedCount'), '| cmt kept/lost/add:', c.get('kept'), len(c.get('lost', [])), add if isinstance(add, int) else len(add))
print('TOTAL scripts del/add/unCH:', tot)
"
python3 -c "
import json
d = json.load(open('$L6b/layout.json'))
bad = {t: v.get('overlaps') for t, v in d['targets'].items() if v.get('overlaps')}
print('overlaps:', bad if bad else 'none')
"
# behavior: タイム counts seconds since green flag; monitor visible
node tools/vmrun/cli.mjs run $L6b/out.sb3 --frames 6 \
  --probe Stage.variables.タイム | python3 -c "import json,sys; print('t=6f:', json.load(sys.stdin)['probes'])"
node tools/vmrun/cli.mjs run $L6b/out.sb3 --frames 100 \
  --probe Stage.variables.タイム | python3 -c "import json,sys; print('t=100f:', json.load(sys.stdin)['probes'])"
node tools/vmrun/cli.mjs run $L6b/out.sb3 --frames 100 \
  --probe monitors | python3 -c "import json,sys; print('monitors:', json.dumps(json.load(sys.stdin)['probes']))"
