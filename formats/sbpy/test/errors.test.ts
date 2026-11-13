/**
 * Error quality: sbpy parse diagnostics carry file/line/col, name the
 * problem, and suggest fixes (nearest opcode, nearest argument/variable).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sbpy } from '../index.ts';

function parse(text: string, targetJson: unknown = { variables: [], lists: [], broadcasts: [], costumes: [], sounds: [] }): ReturnType<typeof sbpy.parse> {
    return sbpy.parse(text, { targetName: 'Sprite1', file: 'Sprite1/scripts.sbpy', targetJson: targetJson as never });
}

function errorsOf(text: string, targetJson?: unknown): string[] {
    return parse(text, targetJson).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
}

function warnsOf(text: string, targetJson?: unknown): string[] {
    return parse(text, targetJson).diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);
}

test('unknown block suggests the nearest opcode', () => {
    const errs = errorsOf('event_whenflagclicked():\n    move_stepz(STEPS=10)\n');
    assert.equal(errs.length, 1);
    assert.match(errs[0], /unknown block "move_stepz"/);
    assert.match(errs[0], /movesteps/);
});

test('unknown block suggests English template too', () => {
    const errs = errorsOf('event_whenflagclicked():\n    turn_degrees(DEGREES=15)\n');
    assert.equal(errs.length, 1);
    assert.match(errs[0], /did you mean/);
});

test('short aliases work and full opcodes print canonically', () => {
    const { scripts, diagnostics } = parse('event_whenflagclicked():\n    movesteps(10)\n    say("hi")\n');
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
    assert.equal(scripts[0].top?.opcode, 'event_whenflagclicked');
    assert.equal(scripts[0].top?.next?.opcode, 'motion_movesteps');
    assert.equal(scripts[0].top?.next?.next?.opcode, 'looks_say');
    const out = sbpy.print(scripts, { targetName: 'S', file: 'f', targetJson: {} as never });
    assert.match(out, /motion_movesteps\(STEPS=10\)/);
});

test('unknown argument names suggest catalog names', () => {
    const errs = errorsOf('event_whenflagclicked():\n    motion_movesteps(STEPZ=10)\n');
    assert.equal(errs.length, 1);
    assert.match(errs[0], /unknown argument "STEPZ"/);
    assert.match(errs[0], /"STEPS"/);
});

test('indentation errors carry line numbers', () => {
    const errs = errorsOf('event_whenflagclicked():\n        motion_movesteps(STEPS=10)\n            looks_say(MESSAGE="x")\n');
    assert.ok(errs.some((m) => /unexpected indent/.test(m) && /line 3/.test(m)), JSON.stringify(errs));
});

test('tabs are rejected with a line number', () => {
    const errs = errorsOf('event_whenflagclicked():\n\tmotion_movesteps(STEPS=10)\n');
    assert.ok(errs.some((m) => /tabs are not allowed/.test(m) && /line 2/.test(m)), JSON.stringify(errs));
});

test('else without if is an error', () => {
    const errs = errorsOf('event_whenflagclicked():\n    motion_movesteps(STEPS=10)\nelse:\n    pass\n');
    assert.ok(errs.some((m) => /else without a matching/.test(m)), JSON.stringify(errs));
});

test('reporter used as a stack statement is an error but kept', () => {
    const { scripts, diagnostics } = parse('event_whenflagclicked():\n    operator_add(NUM1="1", NUM2="2")\n');
    assert.ok(diagnostics.some((d) => /cannot be used as a stack statement/.test(d.message)));
    assert.equal(scripts[0].top?.next?.opcode, 'operator_add');
});

test('hat in the middle of a script starts a new script', () => {
    const { scripts, diagnostics } = parse('motion_movesteps(STEPS=1)\nevent_whenflagclicked():\n    motion_movesteps(STEPS=2)\n');
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
    assert.equal(scripts.length, 2);
    assert.equal(scripts[0].top?.opcode, 'motion_movesteps');
    assert.equal(scripts[1].top?.opcode, 'event_whenflagclicked');
});

test('unknown variables warn with nearest names, not errors', () => {
    const tj = { variables: [{ name: 'score' }], lists: [], broadcasts: [], costumes: [], sounds: [] };
    const warns = warnsOf('event_whenflagclicked():\n    data_setvariableto(VARIABLE="socre", VALUE="0")\n', tj);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /unknown variable "socre"/);
    assert.match(warns[0], /"score"/);
    assert.deepEqual(errorsOf('event_whenflagclicked():\n    data_setvariableto(VARIABLE="socre", VALUE="0")\n', tj), []);
});

test('var() references are expressions, not statements', () => {
    const { scripts, diagnostics } = parse('var("score")\n');
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].kind, 'reporter');
    assert.equal(scripts[0].top?.opcode, 'data_variable');
});

test('define with a bad parameter shape errors clearly', () => {
    const errs = errorsOf('define "jump"\n    pass\n');
    assert.ok(errs.some((m) => /define needs the form/.test(m)), JSON.stringify(errs));
});

test('define placeholder/parameter mismatch warns', () => {
    const { diagnostics } = parse('define "jump %n %n" (height) [warp]:\n    pass\n');
    assert.ok(diagnostics.some((d) => /placeholder/.test(d.message) && d.severity === 'warning'));
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
});

test('bad anchors are reported', () => {
    const errs = errorsOf('@zzz\nevent_whenflagclicked():\n    pass\n');
    assert.ok(errs.some((m) => /bad anchor/.test(m)), JSON.stringify(errs));
});

test('unbalanced parentheses error', () => {
    const errs = errorsOf('event_whenflagclicked():\n    motion_movesteps(STEPS=10\n');
    assert.ok(errs.some((m) => /unbalanced parentheses/.test(m)), JSON.stringify(errs));
});

test('duplicate anchors are reported', () => {
    const errs = errorsOf('@a1\n@a1\nevent_whenflagclicked():\n    pass\n');
    assert.ok(errs.some((m) => /duplicate script anchor @a1/.test(m)), JSON.stringify(errs));
});

test('dangling comment anchor is reported', () => {
    const errs = errorsOf('@c9\nevent_whenflagclicked():\n    pass\n');
    assert.ok(errs.some((m) => /has no comment text/.test(m)), JSON.stringify(errs));
});
