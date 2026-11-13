"""Build packages/core/metrics/structure.json from probe2.json + catalog.

Per opcode: ordered input structure (names, types, check shapes) and field
slots (labels incl. icons, value fields with width rules). Run offline:
  python3 tools/calibrate/extract-structure.py
"""
import json
from collections import defaultdict

REPO = '/path/to/agentwarp'
probe = json.load(open(f'{REPO}/eval/calibration/probe2.json'))
catalog = json.load(open(f'{REPO}/packages/core/catalog/blocks.json'))['blocks']

RIGHT_ICON_OPS = {'control_repeat', 'control_repeat_until', 'control_while', 'control_forever'}

by_op = defaultdict(list)
for f, v in probe.items():
    for t in v['targets']:
        for b in t['blocks']:
            by_op[b['type']].append(b)

def field_rule(op, shape, fname, fl):
    """Return width-rule id for a NAMED field, cross-checked with catalog."""
    spec = catalog.get(op, {})
    cat = {f['name']: f['kind'] for f in spec.get('fields', [])}.get(fname)
    ed, box, arrow = fl['editable'], fl['hasBox'], fl['hasArrow']
    cls = fl.get('className') or ''
    if cat == 'color' or fname == 'COLOUR':
        return 'color'
    if fname == 'MATRIX':
        return 'matrix'
    if fname == 'NOTE':
        return 'note'
    if cat in ('variable', 'list'):
        if (op, fname) in (('data_variable', 'VARIABLE'), ('data_listcontents', 'LIST')):
            return 'getter'
        return 'dropdown'
    if op in ('argument_reporter_boolean', 'argument_reporter_string_number'):
        return 'label'
    if cat == 'broadcast':
        return 'dropdown'
    if cat == 'dropdown':
        return 'dropdown'
    if cat in ('text', 'number', 'angle'):
        return 'text'
    # unnamed handled by caller; fall back to observed flags
    if arrow:
        return 'dropdown'
    if ed:
        return 'text'
    return 'label'

out = {}
problems = []
DYNAMIC_OPS = {'procedures_call', 'procedures_prototype'}
for op, insts in sorted(by_op.items()):
    if op in DYNAMIC_OPS:
        continue  # structure is mutation-driven; metrics.ts builds it dynamically
    shape = catalog.get(op, {}).get('shape')
    # prefer non-shadow instance with most inputs
    insts_sorted = sorted(insts, key=lambda b: (b['isShadow'], -len(b['inputs'])))
    base = insts_sorted[0]
    inputs = []
    for i in base['inputs']:
        fields = []
        for fl in i['fields']:
            size = fl.get('size', {}) or {}
            h = size.get('h', 0)
            if not fl.get('name') and h and h > 0 and (fl.get('text') in ('*', 'flag') or h >= 16):
                fields.append({'k': 'image', 'w': size['w'], 'h': h})
            elif not fl.get('name'):
                fields.append({'k': 'label', 't': fl.get('text')})
            else:
                r = field_rule(op, shape, fl['name'], fl)
                fields.append({'k': 'field', 'name': fl['name'], 'rule': r})
        inp = {'name': i['name'], 't': i['type'], 'fields': fields}
        if i['type'] == 1:
            chk = i.get('check')
            hexed = (chk == ['Boolean']) or (i.get('outputShape') == 1)
            inp['hex'] = bool(hexed)
        inputs.append(inp)
    # consistency: all instances must agree on input skeleton
    skel = [(x['name'], x['t']) for x in inputs]
    for b in insts:
        s2 = [(x['name'], x['type']) for x in b['inputs']]
        # allow fewer inputs (e.g. missing trailing dummy?) - flag real diffs
        if s2 != skel:
            # labels may differ per instance? check named-field rules agree
            problems.append((op, f"skeleton {skel} vs {s2} in {b['id'][:8]}"))
            break
    out[op] = {'inputs': inputs, 'n': len(insts)}
    # align marker for right-aligned icon dummy rows
    if op in RIGHT_ICON_OPS:
        for x in out[op]['inputs']:
            if x['t'] == 5 and any(f.get('k') == 'image' for f in x['fields']):
                x['align'] = 'right'

print(f'opcodes: {len(out)}')
print(f'skeleton mismatches: {len(problems)}')
for p in problems[:20]:
    print('  ', p)

# cross-check: recompute every NAMED field width from rule+value
import sys
sys.path.insert(0, '.')
g = json.load(open(f'{REPO}/packages/core/metrics/glyphs.json'))
A = g['ascii']
SPACE = g['probes']['space']
def tw(s):
    s = s.replace(' ', ' ')
    if s == '':
        s = ' '
    tot = 0.0
    for ch in s:
        if ch == ' ':
            tot += SPACE
        elif ch in A:
            tot += A[ch]
        elif ch in g['jp']:
            tot += g['jp'][ch]
        elif ch in X:
            tot += X[ch]
        elif ch in g.get('latin', {}):
            tot += g['latin'][ch]
        else:
            tot += g['avgJp'] if ord(ch) > 0x3000 else g['avgAscii']
    return tot
X = g.get('extra', {})
def fw(rule, value, shadow, has_box):
    value = (value or '').replace(' ', ' ')
    t = tw(value)
    if rule == 'dropdown':
        return t + 6 + 20 + (0 if (shadow or not has_box) else 16)
    if rule == 'text':
        return t + 6
    if rule == 'getter':
        return t
    if rule == 'label':
        return t
    if rule == 'color':
        return 10.453125
    if rule == 'matrix':
        return 50
    if rule == 'note':
        return t + 6 + (0 if (shadow or not has_box) else 16)
    raise ValueError(rule)
bad = 0
worst = []
for op, insts in by_op.items():
    if op in DYNAMIC_OPS:
        continue
    st = out[op]
    for b in insts:
        if len(b['inputs']) != len(st['inputs']):
            continue
        for i, si in zip(b['inputs'], st['inputs']):
            if len(i['fields']) != len(si['fields']):
                continue
            for fl, sf in zip(i['fields'], si['fields']):
                if sf['k'] == 'field':
                    got = fw(sf['rule'], fl['text'] or '', b['isShadow'], fl.get('hasBox'))
                    exp = (fl['size'] or {}).get('w')
                    if exp is not None and abs(got - exp) > 0.6:
                        bad += 1
                        worst.append((abs(got - exp), op, sf['rule'], repr(fl['text']), round(got, 2), exp))
worst.sort(reverse=True)
for w in worst[:20]:
    print('FIELD MISMATCH', w)
print('field width mismatches:', bad)
json.dump(out, open(f'{REPO}/packages/core/metrics/structure.json', 'w'), ensure_ascii=False, indent=1)
print('wrote structure.json')
