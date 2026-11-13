/**
 * Parse diagnostics: file/line/col errors with "did you mean" suggestions,
 * unbalanced input, wrong input kinds, unknown names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tsFormat } from '../index.ts';

function parseErrs(text: string, targetJson: any = {}, isStage = true) {
    const r = tsFormat.parse(text, { targetName: 'Stage', file: 'Stage/scripts.ts', targetJson, isStage });
    return r.diagnostics.filter((d) => d.severity === 'error');
}

function parseAll(text: string, targetJson: any = {}, isStage = true) {
    return tsFormat.parse(text, { targetName: 'Stage', file: 'Stage/scripts.ts', targetJson, isStage });
}

test('diag: unknown block suggests the nearest name', () => {
    const errs = parseErrs('moveStepz(10);\n');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /unknown block "moveStepz"/);
    assert.match(errs[0].message, /did you mean "moveSteps"/);
    assert.equal(errs[0].line, 1);
    assert.equal(errs[0].col, 1);
});

test('diag: unbalanced braces are syntax errors with positions', () => {
    const errs = parseErrs('whenFlagClicked(() => {\n  moveSteps(10);\n');
    assert.ok(errs.length >= 1);
    assert.ok(errs.every((e) => e.line !== undefined && e.col !== undefined));
});

test('diag: wrong input kind (arrow in a value slot)', () => {
    const errs = parseErrs('moveSteps(() => {});\n');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /needs a number|string|reporter|wrong input kind|arrow/i);
});

test('diag: unknown variable on Stage suggests the nearest name', () => {
    const tj = { variables: [{ name: 'score', id: 'a' }] };
    const r = parseAll('setVariableTo(vars.scor, 0);\n', tj, true);
    const warns = r.diagnostics.filter((d) => d.severity === 'warning');
    assert.equal(warns.length, 1);
    assert.match(warns[0].message, /unknown variable "scor"/);
    assert.match(warns[0].message, /did you mean "score"/);
});

test('diag: unknown costume suggests the nearest name', () => {
    const tj = { costumes: [{ name: 'costume1' }] };
    const r = parseAll('switchCostumeTo("costume2");\n', tj, false);
    const warns = r.diagnostics.filter((d) => d.severity === 'warning');
    assert.equal(warns.length, 1);
    assert.match(warns[0].message, /unknown costume "costume2"/);
    assert.match(warns[0].message, /did you mean "costume1"/);
});

test('diag: call to an undefined procedure errors with suggestions', () => {
    const errs = parseErrs('define("jump %n", (h) => {\n  moveSteps(h);\n});\ncall("jmp %n", 1);\n');
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /doesn't match a definition/);
    assert.match(errs[0].message, /did you mean "jump %n"/);
});

test('diag: valid scripts are clean', () => {
    const tj = {
        variables: [{ name: 'score', id: 'a' }],
        costumes: [{ name: 'costume1' }],
        sounds: [{ name: 'pop' }],
        broadcasts: [{ name: 'go', id: 'b' }],
    };
    const text = [
        '// @a1',
        'whenFlagClicked(() => {',
        '  goToXY(0, 0);',
        '  setVariableTo(vars.score, add(1, 2));',
        '  switchCostumeTo("costume1");',
        '  broadcast("go");',
        '});',
        '',
        'define("jump %n", { warp: true }, (height = 5) => {',
        '  changeY(height);',
        '});',
        '',
        '// a workspace note',
        'comment("hello");',
        '',
    ].join('\n');
    const r = parseAll(text, tj, true);
    assert.deepEqual(
        r.diagnostics.filter((d) => d.severity === 'error'),
        [],
    );
    assert.equal(r.scripts.length, 3);
    assert.equal(r.scripts[0].anchor, 'a1');
});
