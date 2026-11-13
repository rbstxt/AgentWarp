/**
 * Tests for packages/core/lint.ts: Scratch-semantics warnings.
 * Run: node --test packages/core/test/  (from the repo root)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintProject } from '../lint.ts';

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
const txt = (v: string) => [1, [10, v]];

function proj(targets: any[]): any {
    return { targets, monitors: [], extensions: [], meta: {} };
}

function stage(extra: any = {}): any {
    return {
        isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {},
        blocks: {}, comments: {}, costumes: [{ name: 'backdrop1' }], sounds: [],
        volume: 100, layerOrder: 0, ...extra,
    };
}

function sprite(name: string, blocks: Record<string, any>, extra: any = {}): any {
    return {
        isStage: false, name, variables: {}, lists: {}, broadcasts: {},
        blocks, comments: {},
        costumes: [{ name: `${name}-a` }], sounds: [],
        volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90,
        ...extra,
    };
}

function rules(ds: ReturnType<typeof lintProject>): string[] {
    return ds.map((d) => d.rule ?? '(none)');
}

test('say before stop-all warns with a fix hint', () => {
    const p = proj([stage(), sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('looks_say', { parent: 'a', next: 'c', inputs: { MESSAGE: txt('hi') } }),
        c: blk('control_stop', { parent: 'b', fields: { STOP_OPTION: ['all', null] } }),
    })]);
    const ds = lintProject(p);
    const d = ds.find((x) => x.rule === 'say-before-stop');
    assert.ok(d && d.severity === 'warning' && d.hint, JSON.stringify(ds));
});

test('say before stop-all is silenced by an ignore comment', () => {
    const s = sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('looks_say', { parent: 'a', next: 'c', inputs: { MESSAGE: txt('hi') } }),
        c: blk('control_stop', { parent: 'b', fields: { STOP_OPTION: ['all', null] } }),
    });
    s.comments = { c1: { blockId: 'b', text: 'agentwarp-ignore say-before-stop', x: 0, y: 0 } };
    const ds = lintProject(proj([stage(), s]));
    assert.ok(!rules(ds).includes('say-before-stop'), JSON.stringify(rules(ds)));
});

test('key hat in a self-cloning sprite warns', () => {
    const p = proj([stage(), sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('control_create_clone_of', { parent: 'a', inputs: { CLONE_OPTION: [1, 'm'] } }),
        m: blk('control_create_clone_of_menu', { parent: 'b', shadow: true, fields: { CLONE_OPTION: ['_myself_', null] } }),
        k: blk('event_whenkeypressed', { topLevel: true, x: 20, y: 300, fields: { KEY_OPTION: ['space', null] } }),
    })]);
    const ds = lintProject(p);
    assert.ok(rules(ds).includes('clone-hat-explosion'), JSON.stringify(rules(ds)));
});

test('self-clone in forever without delete-this-clone warns; with delete it is quiet', () => {
    const mk = (withDelete: boolean) => {
        const blocks: Record<string, any> = {
            a: blk('event_whenflagclicked', { topLevel: true, next: 'f' }),
            f: blk('control_forever', { parent: 'a', inputs: { SUBSTACK: [2, 'c'] } }),
            c: blk('control_create_clone_of', { parent: 'f', inputs: { CLONE_OPTION: [1, 'm'] } }),
            m: blk('control_create_clone_of_menu', { parent: 'c', shadow: true, fields: { CLONE_OPTION: ['_myself_', null] } }),
            s: blk('control_start_as_clone', { topLevel: true, x: 20, y: 300 }),
        };
        if (withDelete) {
            blocks.s.next = 'd';
            blocks.d = blk('control_delete_this_clone', { parent: 's' });
        }
        return proj([stage(), sprite('S', blocks)]);
    };
    assert.ok(rules(lintProject(mk(false))).includes('clone-without-delete'));
    assert.ok(!rules(lintProject(mk(true))).includes('clone-without-delete'));
});

test('broadcast sent but never received warns, and vice versa', () => {
    const p = proj([stage(), sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('event_broadcast', { parent: 'a', inputs: { BROADCAST_INPUT: [1, [11, 'go', 'b1']] } }),
        h: blk('event_whenbroadcastreceived', { topLevel: true, x: 20, y: 300, fields: { BROADCAST_OPTION: ['stop', 'b2'] } }),
    })]);
    const ds = lintProject(p);
    assert.ok(rules(ds).includes('broadcast-sent-never-received'), JSON.stringify(rules(ds)));
    assert.ok(rules(ds).includes('broadcast-received-never-sent'), JSON.stringify(rules(ds)));
});

test('matched broadcast send/receive is quiet', () => {
    const p = proj([stage(), sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('event_broadcast', { parent: 'a', inputs: { BROADCAST_INPUT: [1, [11, 'go', 'b1']] } }),
        h: blk('event_whenbroadcastreceived', { topLevel: true, x: 20, y: 300, fields: { BROADCAST_OPTION: ['go', 'b1'] } }),
    })]);
    const ds = lintProject(p);
    assert.ok(!rules(ds).includes('broadcast-sent-never-received'), JSON.stringify(rules(ds)));
    assert.ok(!rules(ds).includes('broadcast-received-never-sent'), JSON.stringify(rules(ds)));
});

test('= 0 on a decremented counter warns, even with a set-to init', () => {
    const mk = (withWaitUntil: boolean) => {
        const blocks: Record<string, any> = {
            a: blk('event_whenflagclicked', { topLevel: true, next: 's' }),
            // Typical game init: set lives to 3 first. The set fixes the start
            // value but cannot guarantee the counter lands exactly on 0, so
            // the rule must still fire (regression: set-to used to silence it).
            s: blk('data_setvariableto', {
                parent: 'a', next: 'b',
                fields: { VARIABLE: ['hp', 'v1'] }, inputs: { VALUE: num(3) },
            }),
            b: blk('data_changevariableby', {
                parent: 's', next: withWaitUntil ? 'w' : 'c',
                fields: { VARIABLE: ['hp', 'v1'] }, inputs: { VALUE: num(-1) },
            }),
            ...(withWaitUntil ? {
                w: blk('control_wait_until', { parent: 'b', inputs: { CONDITION: [2, 'e'] } }),
                e: blk('operator_equals', {
                    parent: 'w',
                    inputs: { OPERAND1: [2, 'v'], OPERAND2: num(0) },
                }),
            } : {
                c: blk('control_if', {
                    parent: 'b', inputs: { CONDITION: [2, 'e'], SUBSTACK: [2, 'd'] },
                }),
                e: blk('operator_equals', {
                    parent: 'c',
                    inputs: { OPERAND1: [2, 'v'], OPERAND2: num(0) },
                }),
            }),
            v: blk('data_variable', { parent: 'e', fields: { VARIABLE: ['hp', 'v1'] } }),
            d: blk('looks_say', { parent: withWaitUntil ? 'w' : 'c', inputs: { MESSAGE: txt('dead') } }),
        };
        const s = sprite('S', blocks);
        s.variables = { v1: ['hp', 3] };
        return proj([stage(), s]);
    };
    for (const withWaitUntil of [false, true]) {
        const ds = lintProject(mk(withWaitUntil));
        const d = ds.find((x) => x.rule === 'zero-equals-decrement');
        assert.ok(d && /< 1/.test(d.hint ?? ''), `waitUntil=${withWaitUntil}: ${JSON.stringify(ds)}`);
    }
});

test('= 0 stays quiet when the counter can go up', () => {
    const blocks: Record<string, any> = {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('data_changevariableby', {
            parent: 'a', next: 'c',
            fields: { VARIABLE: ['hp', 'v1'] }, inputs: { VALUE: num(-1) },
        }),
        c: blk('data_changevariableby', {
            parent: 'b', next: 'd',
            fields: { VARIABLE: ['hp', 'v1'] }, inputs: { VALUE: num(1) },
        }),
        d: blk('operator_equals', { parent: 'c', inputs: { OPERAND1: [2, 'v'], OPERAND2: num(0) } }),
        v: blk('data_variable', { parent: 'd', fields: { VARIABLE: ['hp', 'v1'] } }),
    };
    const s = sprite('S', blocks);
    s.variables = { v1: ['hp', 3] };
    assert.ok(!rules(lintProject(proj([stage(), s]))).includes('zero-equals-decrement'));
});

test('touching a hidden sprite warns', () => {
    const ghost = sprite('Ghost', {}, { visible: false });
    const p = proj([stage(), ghost, sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('sensing_touchingobject', { parent: 'a', inputs: { TOUCHINGOBJECTMENU: [1, 'm'] } }),
        m: blk('sensing_touchingobjectmenu', { parent: 'b', shadow: true, fields: { TOUCHINGOBJECTMENU: ['Ghost', null] } }),
    })]);
    const ds = lintProject(p);
    const d = ds.find((x) => x.rule === 'touching-hidden-sprite');
    assert.ok(d && /hidden/.test(d.message), JSON.stringify(ds));
});

test('wait 0 inside run-without-screen-refresh warns', () => {
    const p = proj([stage(), sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'w' }),
        w: blk('control_all_at_once', { parent: 'a', inputs: { SUBSTACK: [2, 'v'] } }),
        v: blk('control_wait', { parent: 'w', inputs: { DURATION: num(0) } }),
    })]);
    const ds = lintProject(p);
    assert.ok(rules(ds).includes('wait-zero-no-refresh'), JSON.stringify(rules(ds)));
});

test('length of a never-filled list is info; filled is quiet', () => {
    const mk = (filled: boolean) => {
        const s = sprite('S', {
            a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
            b: blk('data_lengthoflist', { parent: 'a', fields: { LIST: ['items', 'l1'] } }),
        });
        s.lists = { l1: filled ? ['items', ['x']] : ['items', []] };
        return proj([stage(), s]);
    };
    const ds = lintProject(mk(false));
    const d = ds.find((x) => x.rule === 'length-of-empty-list');
    assert.ok(d && d.severity === 'info', JSON.stringify(ds));
    assert.ok(!rules(lintProject(mk(true))).includes('length-of-empty-list'));
});

test('sourcemap locations are attached', () => {
    const p = proj([stage(), sprite('S', {
        a: blk('event_whenflagclicked', { topLevel: true, next: 'b' }),
        b: blk('looks_say', { parent: 'a', next: 'c', inputs: { MESSAGE: txt('hi') } }),
        c: blk('control_stop', { parent: 'b', fields: { STOP_OPTION: ['all', null] } }),
    })]);
    const ds = lintProject(p, { b: { file: 'S/scripts.ts', line: 7, col: 2 } });
    const d = ds.find((x) => x.rule === 'say-before-stop');
    assert.equal(d?.file, 'S/scripts.ts');
    assert.equal(d?.line, 7);
});
