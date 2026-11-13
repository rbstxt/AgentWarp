/**
 * Diagnostics: parse errors carry file/line/col and helpful messages
 * (unknown block text with did-you-mean, unbalanced nesting, unknown
 * variable with nearest names, wrong input kind).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scratchblocks } from '../index.ts';

const CTX = {
    targetName: 'Sprite1',
    file: 'Sprite1/scripts.sb',
    targetJson: {
        variables: [{ name: 'score', id: 'v1' }, { name: 'lives', id: 'v2' }],
        lists: [{ name: 'items', id: 'l1' }],
        broadcasts: [],
    },
    isStage: false,
};

function parse(text: string): { scripts: any[]; diagnostics: any[] } {
    return scratchblocks.parse(text, CTX as any);
}

function errors(text: string): any[] {
    return parse(text).diagnostics.filter((d) => d.severity === 'error');
}

test('unknown block text suggests similar blocks', () => {
    const ds = errors('when clicked\nmovee (10) steps\n');
    assert.equal(ds.length, 1);
    assert.match(ds[0].message, /unknown block "movee \(10\) steps"/);
    assert.match(ds[0].message, /did you mean/);
    assert.match(ds[0].message, /move \(...\) steps/);
    assert.equal(ds[0].line, 2);
    assert.equal(ds[0].file, 'Sprite1/scripts.sb');
});

test('unbalanced nesting: missing end', () => {
    const ds = errors('when clicked\nif <(score) > (10)> then\nsay [hi]\n');
    assert.ok(ds.some((d) => /unclosed block/.test(d.message) || /missing "end"/.test(d.message)), JSON.stringify(ds));
});

test('unbalanced nesting: stray end', () => {
    const ds = errors('when clicked\nsay [hi]\nend\n');
    assert.ok(ds.some((d) => /"end" without an open/.test(d.message)), JSON.stringify(ds));
});

test('unbalanced brackets', () => {
    const ds = errors('when clicked\nsay [hi\n');
    assert.ok(ds.length >= 1, JSON.stringify(ds));
});

test('unknown variable suggests nearest names', () => {
    const ds = errors('when clicked\nset [scroe v] to (0)\n');
    assert.ok(ds.some((d) => /unknown (var|variable) "scroe"/.test(d.message)), JSON.stringify(ds));
    assert.ok(ds.some((d) => /did you mean.*score/.test(d.message)), JSON.stringify(ds));
});

test('unknown reporter suggests catalog and variables', () => {
    const ds = errors('when clicked\nsay (scroe)\n');
    assert.ok(ds.some((d) => /unknown reporter or variable "scroe"/.test(d.message)), JSON.stringify(ds));
});

test('wrong input kind: reporter in field slot', () => {
    const ds = errors('when clicked\nset (score) to (0)\n');
    assert.ok(ds.some((d) => /field "VARIABLE" needs/.test(d.message)), JSON.stringify(ds));
});

test('variable/reporter disambiguation with :: hints', () => {
    // Plain (timer) is the catalog reporter; the variable needs a hint.
    const ctx2 = {
        ...CTX,
        targetJson: { variables: [{ name: 'timer', id: 'v9' }], lists: [], broadcasts: [] },
    };
    const plain = scratchblocks.parse('when clicked\nsay (timer)\n', ctx2 as any);
    assert.equal(plain.diagnostics.filter((d) => d.severity === 'error').length, 0);
    assert.equal((plain.scripts[0] as any).top.next.inputs.MESSAGE.kind, 'block');
    const hinted = scratchblocks.parse('when clicked\nsay (timer :: variables)\n', ctx2 as any);
    assert.equal(hinted.diagnostics.filter((d) => d.severity === 'error').length, 0);
    assert.equal((hinted.scripts[0] as any).top.next.inputs.MESSAGE.kind, 'var');
});

test('literal forms preserve value types and tags', () => {
    const r = parse(
        'when clicked\nsay ["10"]\nsay [10]\nmove (10) steps\nmove ("10") steps\nmove (10 :: 6) steps\n',
    );
    assert.deepEqual(
        r.diagnostics.filter((d) => d.severity === 'error'),
        [],
    );
    const say = (r.scripts[0] as any).top.next;
    assert.deepEqual(say.inputs.MESSAGE, { kind: 'literal', value: '10', litType: 10 });
    assert.deepEqual(say.next.inputs.MESSAGE, { kind: 'literal', value: 10, litType: 10 });
    const move = say.next.next;
    assert.deepEqual(move.inputs.STEPS, { kind: 'literal', value: 10, litType: 4 });
    assert.deepEqual(move.next.inputs.STEPS, { kind: 'literal', value: '10', litType: 4 });
    assert.deepEqual(move.next.next.inputs.STEPS, { kind: 'literal', value: 10, litType: 6 });
});

test('raw ! escape round-trips unknown blocks', () => {
    const text = 'when clicked\n!{"opcode":"foo_bar","inputs":{"X":[1,[4,1]]},"fields":{}}\nmove (1) steps\n';
    const r = parse(text);
    assert.deepEqual(
        r.diagnostics.filter((d) => d.severity === 'error'),
        [],
    );
    const top = (r.scripts[0] as any).top;
    assert.equal(top.next.opcode, 'foo_bar');
    assert.equal(top.next.next.opcode, 'motion_movesteps');
    const out = scratchblocks.print(r.scripts, CTX as any);
    const r2 = parse(out);
    assert.deepEqual(
        r2.diagnostics.filter((d) => d.severity === 'error'),
        [],
    );
    assert.equal(scratchblocks.print(r2.scripts, CTX as any), out);
});

test('unknown procedure call is an error, known call parses', () => {    const ds = errors('when clicked\nfrobnicate (1)\n');
    assert.ok(ds.some((d) => /unknown block "frobnicate/.test(d.message)), JSON.stringify(ds));
    const r = parse('define jump (height)\nchange y by (height)\n\nwhen clicked\njump ("5")\n');
    assert.deepEqual(
        r.diagnostics.filter((d) => d.severity === 'error'),
        [],
        JSON.stringify(r.diagnostics),
    );
    const call = (r.scripts[1] as any).top.next;
    assert.equal(call.opcode, 'procedures_call');
    assert.deepEqual(Object.keys(call.inputs), ['height']);
});
