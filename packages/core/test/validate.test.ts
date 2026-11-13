/**
 * Tests for packages/core/validate.ts: semantic checks on packed project.json.
 * Run: node --test packages/core/test/  (from the repo root)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProject } from '../validate.ts';

function blk(opcode: string, o: any = {}): any {
    return {
        opcode,
        next: o.next ?? null,
        parent: o.parent ?? null,
        inputs: o.inputs ?? {},
        fields: o.fields ?? {},
        shadow: o.shadow ?? false,
        topLevel: o.topLevel ?? false,
        ...(o.topLevel ? { x: 20, y: 20 } : {}),
        ...(o.mutation ? { mutation: o.mutation } : {}),
    };
}
const num = (v: string | number) => [1, [4, String(v)]];

function proj(spriteBlocks: Record<string, any>, extra: any = {}): any {
    return {
        targets: [
            {
                isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {},
                blocks: {}, comments: {}, costumes: [{ name: 'backdrop1' }], sounds: [],
                volume: 100, layerOrder: 0,
            },
            {
                isStage: false, name: 'Sprite1', variables: {}, lists: {}, broadcasts: {},
                blocks: spriteBlocks, comments: {},
                costumes: [{ name: 'costume1' }], sounds: [{ name: 'pop' }],
                volume: 100, layerOrder: 1, visible: true, x: 0, y: 0,
                ...extra,
            },
        ],
        monitors: [],
        extensions: [],
        meta: {},
    };
}

function rules(ds: ReturnType<typeof validateProject>): string[] {
    return ds.map((d) => d.rule ?? '(none)');
}

test('clean project validates with no diagnostics', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('motion_movesteps', { parent: 'a', inputs: { STEPS: num(10) } }),
    };
    assert.deepEqual(validateProject(proj(blocks)), []);
});

test('unknown opcode is an error', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('frobnicator_do_thing', { parent: 'a' }),
    };
    const ds = validateProject(proj(blocks));
    assert.ok(ds.some((d) => d.rule === 'unknown-opcode' && d.severity === 'error'), JSON.stringify(ds));
});

test('wrong input name suggests valid names', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('motion_movesteps', { parent: 'a', inputs: { OPERAND1: num(1) } }),
    };
    const ds = validateProject(proj(blocks));
    const d = ds.find((x) => x.rule === 'bad-input');
    assert.ok(d && d.severity === 'error' && /STEPS/.test(d.message), JSON.stringify(ds));
});

test('menu value outside static options is an error', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('control_stop', { parent: 'a', fields: { STOP_OPTION: ['everything', null] } }),
    };
    const ds = validateProject(proj(blocks));
    assert.ok(rules(ds).includes('bad-menu-value'), JSON.stringify(ds));
});

test('costume menu naming a missing costume errors', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('looks_switchcostumeto', { parent: 'a', inputs: { COSTUME: [1, 'm'] } }),
        m: blk('looks_costume', { parent: 'b', shadow: true, fields: { COSTUME: ['Ghost', null] } }),
    };
    const ds = validateProject(proj(blocks));
    assert.ok(rules(ds).includes('unknown-costume'), JSON.stringify(ds));
});

test('unknown and cross-sprite variable references error', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('data_setvariableto', {
            parent: 'a',
            fields: { VARIABLE: ['nope', 'v-missing'] },
            inputs: { VALUE: num(1) },
        }),
    };
    const p = proj(blocks);
    // Cross-sprite: id declared on another sprite.
    p.targets.push({
        isStage: false, name: 'Other', variables: { 'v-other': ['score', 0] }, lists: {},
        broadcasts: {}, blocks: {}, comments: {}, costumes: [], sounds: [],
        volume: 100, layerOrder: 2, visible: true, x: 0, y: 0,
    });
    const blocks2 = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('data_setvariableto', {
            parent: 'a',
            fields: { VARIABLE: ['score', 'v-other'] },
            inputs: { VALUE: num(1) },
        }),
        c: blk('event_whenflagclicked', { topLevel: true, x: 20, y: 300, next: 'd' }),
        d: blk('data_setvariableto', {
            parent: 'c',
            fields: { VARIABLE: ['nope', 'v-missing'] },
            inputs: { VALUE: num(1) },
        }),
    };
    p.targets[1].blocks = blocks2;
    const ds = validateProject(p);
    assert.ok(rules(ds).includes('unknown-variable'), JSON.stringify(rules(ds)));
    assert.ok(rules(ds).includes('cross-target-variable'), JSON.stringify(rules(ds)));
});

test('undeclared broadcast menu warns (VM silently no-ops)', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('event_broadcast', { parent: 'a', inputs: { BROADCAST_INPUT: [1, [11, 'ghost', 'b-missing']] } }),
    };
    const ds = validateProject(proj(blocks));
    const d = ds.find((x) => x.rule === 'unknown-broadcast');
    assert.ok(d && d.severity === 'warning', JSON.stringify(ds));
});

function procProject(callInputs: Record<string, any>): any {
    const blocks = {
        d: blk('procedures_definition', {
            topLevel: true, x: 20, y: 20, next: 'p',
            inputs: { custom_block: [1, 'proto'] },
        }),
        proto: {
            opcode: 'procedures_prototype', next: null, parent: 'd', inputs: {}, fields: {},
            shadow: true, topLevel: false,
            mutation: {
                tagName: 'mutation', children: [], proccode: 'jump %n',
                argumentids: JSON.stringify(['arg1']), argumentnames: JSON.stringify(['h']),
                argumentdefaults: JSON.stringify(['']), warp: 'false',
            },
        },
        p: blk('procedures_call', {
            parent: 'd',
            inputs: callInputs,
            mutation: { tagName: 'mutation', children: [], proccode: 'jump %n', argumentids: JSON.stringify(['arg1']), warp: 'false' },
        }),
    };
    return proj(blocks);
}

test('procedure call without a definition errors', () => {
    const p = procProject({});
    p.targets[1].blocks.p.mutation.proccode = 'fly %n';
    const ds = validateProject(p);
    assert.ok(rules(ds).includes('unknown-procedure'), JSON.stringify(rules(ds)));
});

test('procedure arity warns when an arg is omitted, errors on extras', () => {
    const ds = validateProject(procProject({})); // def takes 1 arg, call passes 0
    const d = ds.find((x) => x.rule === 'procedure-arity');
    assert.ok(d && d.severity === 'warning', JSON.stringify(ds));
    const ds2 = validateProject(procProject({ arg1: [1, [4, '1']], bogus: [1, [4, '2']] }));
    const d2 = ds2.find((x) => x.rule === 'procedure-arity');
    assert.ok(d2 && d2.severity === 'error', JSON.stringify(ds2));
});

test('duplicate procedure definitions error', () => {
    const p = procProject({ arg1: [1, [4, '1']] });
    p.targets[1].blocks.d2 = blk('procedures_definition', {
        topLevel: true, x: 20, y: 300,
        inputs: { custom_block: [1, 'proto2'] },
    });
    p.targets[1].blocks.proto2 = {
        ...p.targets[1].blocks.proto, parent: 'd2',
        mutation: { ...p.targets[1].blocks.proto.mutation },
    };
    const ds = validateProject(p);
    assert.ok(rules(ds).includes('duplicate-procedure'), JSON.stringify(rules(ds)));
});

test('reporter in a stack slot errors', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('motion_movesteps', { parent: 'a', next: 'c', inputs: { STEPS: num(1) } }),
        c: blk('data_variable', { parent: 'b', fields: { VARIABLE: ['x', 'v1'] } }),
    };
    const p = proj(blocks, {});
    p.targets[1].variables = { v1: ['x', 0] };
    const ds = validateProject(p);
    assert.ok(rules(ds).includes('reporter-in-stack'), JSON.stringify(rules(ds)));
});

test('stack block in a reporter slot errors', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('control_if', {
            parent: 'a', inputs: { CONDITION: [2, 'c'], SUBSTACK: [2, 'd'] },
        }),
        c: blk('motion_movesteps', { parent: 'b', inputs: { STEPS: num(1) } }),
        d: blk('motion_movesteps', { parent: 'b', inputs: { STEPS: num(1) } }),
    };
    const ds = validateProject(proj(blocks));
    assert.ok(rules(ds).includes('stack-in-reporter'), JSON.stringify(rules(ds)));
});

test('malformed list/variable declaration shapes error', () => {
    const p = proj({ a: blk('event_whenflagclicked', { topLevel: true }) });
    p.targets[1].lists = { l1: ['items'] }; // missing items array (old pack bug shape)
    p.targets[1].variables = { v1: 'oops' };
    const ds = validateProject(p);
    assert.ok(rules(ds).includes('bad-list-shape'), JSON.stringify(rules(ds)));
    assert.ok(rules(ds).includes('bad-variable-shape'), JSON.stringify(rules(ds)));
});

test('sourcemap locations are attached', () => {
    const blocks = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('frobnicator_do_thing', { parent: 'a' }),
    };
    const ds = validateProject(proj(blocks), { b: { file: 'Sprite1/scripts.ts', line: 3, col: 5 } });
    const d = ds.find((x) => x.rule === 'unknown-opcode');
    assert.equal(d?.file, 'Sprite1/scripts.ts');
    assert.equal(d?.line, 3);
    assert.equal(d?.col, 5);
});
