/**
 * Catalog coverage test: every opcode used by real projects must have a spec,
 * every input/field name used in the wild must be in the spec, and every
 * shadow block found under an input must match the spec's shadowOpcode.
 *
 * Run:  node --test packages/core/catalog/   (from the repo root)
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getBlockSpec, allBlockSpecs, isMenuShadow, LITERAL_TYPES} from './index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

// procedures_*/argument_* carry mutation-driven inputs (argument ids), so the
// static spec cannot enumerate input names; only spec existence is asserted.
const MUTATION_DRIVEN = new Set([
    'procedures_definition',
    'procedures_prototype',
    'procedures_call',
]);

interface ProjectBlock {
    opcode: string;
    inputs: Record<string, unknown>;
    fields: Record<string, unknown>;
}

function globSb3(pattern: string): string[] {
    // Supports '*' segments (match any directory entry). Only *.sb3 leaves match.
    const parts = pattern.split('/');
    let dirs = [REPO];
    for (const part of parts.slice(0, -1)) {
        const next: string[] = [];
        for (const d of dirs) {
            if (!fs.existsSync(d)) continue;
            if (part === '*') {
                for (const e of fs.readdirSync(d)) {
                    if (fs.statSync(path.join(d, e)).isDirectory()) next.push(path.join(d, e));
                }
            } else if (part.endsWith('*')) {
                const prefix = part.slice(0, -1);
                for (const e of fs.readdirSync(d)) {
                    if (e.startsWith(prefix) && fs.statSync(path.join(d, e)).isDirectory()) {
                        next.push(path.join(d, e));
                    }
                }
            } else {
                next.push(path.join(d, part));
            }
        }
        dirs = next;
    }
    const leaf = parts[parts.length - 1];
    const out: string[] = [];
    for (const d of dirs) {
        if (!fs.existsSync(d)) continue;
        for (const e of fs.readdirSync(d)) {
            if (e.endsWith('.sb3') && (leaf === '*.sb3' || e === leaf)) out.push(path.join(d, e));
        }
    }
    return out.sort();
}

function readProjectJson(sb3: string): any {
    try {
        const raw = execFileSync('unzip', ['-p', sb3, 'project.json'], {
            encoding: 'buffer',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return JSON.parse(raw.toString('utf8'));
    } catch {
        const raw = execFileSync(
            'python3',
            ['-c', 'import sys,zipfile;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read("project.json").decode())', sb3],
            {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
        );
        return JSON.parse(raw);
    }
}

const SB3_FILES = [
    ...globSb3('eval/fixtures/*.sb3'),
    ...globSb3('tools/vmrun/test-fixtures/*.sb3'),
    ...globSb3('eval/runs/*/L*/out.sb3'),
];

test('catalog setup finds project fixtures', () => {
    assert.ok(SB3_FILES.length > 0, 'no .sb3 fixtures found');
});

test('LITERAL_TYPES matches the Scratch serialization input types', () => {
    assert.deepEqual(LITERAL_TYPES, {
        math_number: 4,
        math_positive_number: 5,
        math_whole_number: 6,
        math_integer: 7,
        math_angle: 8,
        colour_picker: 9,
        text: 10,
        event_broadcast_menu: 11,
        data_variable: 12,
        data_listcontents: 13,
    });
});

test('specs are internally consistent', () => {
    const shapes = new Set([
        'hat', 'stack', 'c', 'c2', 'cap', 'end-c',
        'reporter', 'boolean', 'menu', 'definition', 'prototype', 'argument',
    ]);
    for (const spec of allBlockSpecs()) {
        assert.ok(spec.opcode, 'missing opcode');
        assert.ok(spec.category, `${spec.opcode}: missing category`);
        assert.ok(shapes.has(spec.shape), `${spec.opcode}: bad shape ${spec.shape}`);
        assert.ok(typeof spec.text?.en === 'string', `${spec.opcode}: missing text.en`);
        const inNames = new Set(spec.inputs.map(i => i.name));
        const fNames = new Set(spec.fields.map(f => f.name));
        assert.equal(inNames.size, spec.inputs.length, `${spec.opcode}: duplicate input names`);
        assert.equal(fNames.size, spec.fields.length, `${spec.opcode}: duplicate field names`);
        spec.args.forEach((a, i) => {
            const n = i + 1;
            assert.ok(
                spec.text.en.includes('%' + n),
                `${spec.opcode}: args[${i}] has no %${n} in text ${JSON.stringify(spec.text.en)}`,
            );
            if (a.kind === 'input') assert.ok(inNames.has(a.input), `${spec.opcode}: arg input ${a.input} missing`);
            else assert.ok(fNames.has(a.field), `${spec.opcode}: arg field ${a.field} missing`);
        });
        assert.equal(
            isMenuShadow(spec.opcode),
            spec.shape === 'menu',
            `${spec.opcode}: isMenuShadow disagrees with shape`,
        );
    }
});

test('isMenuShadow spot checks', () => {
    for (const o of ['motion_goto_menu', 'looks_costume', 'sound_sounds_menu', 'event_broadcast_menu', 'pen_menu_colorParam']) {
        assert.equal(isMenuShadow(o), true, o);
    }
    for (const o of ['math_number', 'text', 'colour_picker', 'data_variable', 'operator_add', 'control_if', 'event_broadcast']) {
        assert.equal(isMenuShadow(o), false, o);
    }
    assert.equal(isMenuShadow('no_such_opcode'), false);
});

test('coverage against real projects', () => {
    const opcodes = new Map<string, number>();
    const inputNames = new Map<string, Set<string>>();
    const fieldNames = new Map<string, Set<string>>();
    const shadowSeen = new Map<string, Map<string, number>>(); // "opcode.input" -> shadowOpcode -> count
    const shadowMismatch: string[] = [];
    let files = 0;
    for (const sb3 of SB3_FILES) {
        let project: any;
        try {
            project = readProjectJson(sb3);
        } catch {
            continue;
        }
        if (!project?.targets) continue;
        files++;
        for (const target of project.targets) {
            const blocks = target.blocks ?? {};
            for (const block of Object.values(blocks) as ProjectBlock[]) {
                if (!block || typeof block !== 'object' || typeof block.opcode !== 'string') continue;
                opcodes.set(block.opcode, (opcodes.get(block.opcode) ?? 0) + 1);
                const ins = block.inputs ?? {};
                const flds = block.fields ?? {};
                for (const k of Object.keys(ins)) {
                    if (!inputNames.has(block.opcode)) inputNames.set(block.opcode, new Set());
                    inputNames.get(block.opcode)!.add(k);
                }
                for (const k of Object.keys(flds)) {
                    if (!fieldNames.has(block.opcode)) fieldNames.set(block.opcode, new Set());
                    fieldNames.get(block.opcode)!.add(k);
                }
                for (const [iname, iv] of Object.entries(ins)) {
                    if (!Array.isArray(iv) || iv.length < 2) continue;
                    // Only input type 1 carries a shadow: [1, blockId] (unobscured)
                    // or [1, blockId, shadowId] (reporter covers the shadow).
                    if (iv[0] !== 1) continue;
                    const a = iv[1];
                    const b = iv.length >= 3 ? iv[2] : undefined;
                    let shadowId: string | null = null;
                    if (typeof b === 'string' && blocks[b]) shadowId = b;
                    else if (typeof a === 'string' && blocks[a]) shadowId = a;
                    if (!shadowId || !(blocks[shadowId] as any)?.shadow) continue;
                    const shadowOpcode = (blocks[shadowId] as any).opcode;
                    const key = block.opcode + '.' + iname;
                    if (!shadowSeen.has(key)) shadowSeen.set(key, new Map());
                    const m = shadowSeen.get(key)!;
                    m.set(shadowOpcode, (m.get(shadowOpcode) ?? 0) + 1);
                    if (MUTATION_DRIVEN.has(block.opcode)) continue;
                    const spec = getBlockSpec(block.opcode);
                    if (spec && shadowOpcode !== 'data_variable' && shadowOpcode !== 'data_listcontents') {
                        const expected = spec.inputs.find(i => i.name === iname)?.shadowOpcode;
                        if (expected !== undefined && expected !== shadowOpcode) {
                            shadowMismatch.push(
                                `${key}: real shadow ${shadowOpcode} != spec shadowOpcode ${expected}`,
                            );
                        }
                    }
                }
            }
        }
    }

    const missing = [...opcodes.keys()].filter(o => getBlockSpec(o) === undefined);
    const inputMismatch: string[] = [];
    const fieldMismatch: string[] = [];
    for (const [opcode, names] of inputNames) {
        if (MUTATION_DRIVEN.has(opcode)) continue;
        const spec = getBlockSpec(opcode);
        if (!spec) continue;
        const have = new Set(spec.inputs.map(i => i.name));
        for (const n of names) {
            if (!have.has(n)) inputMismatch.push(`${opcode}: input ${n}`);
        }
    }
    for (const [opcode, names] of fieldNames) {
        if (MUTATION_DRIVEN.has(opcode)) continue;
        const spec = getBlockSpec(opcode);
        if (!spec) continue;
        const have = new Set(spec.fields.map(f => f.name));
        for (const n of names) {
            if (!have.has(n)) fieldMismatch.push(`${opcode}: field ${n}`);
        }
    }

    // Coverage stats (visible in the test output).
    const all = allBlockSpecs();
    const withJa = all.filter(s => s.text.ja !== undefined).length;
    const byCat = new Map<string, number>();
    for (const s of all) byCat.set(s.category, (byCat.get(s.category) ?? 0) + 1);
    console.log(`files: ${files}, project opcodes: ${opcodes.size}, catalog opcodes: ${all.length}, with ja: ${withJa}`);
    console.log('by category: ' + [...byCat.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' '));
    console.log(`input names seen: ${[...inputNames.values()].reduce((a, s) => a + s.size, 0)}, ` +
        `field names seen: ${[...fieldNames.values()].reduce((a, s) => a + s.size, 0)}, ` +
        `input slots with shadows: ${shadowSeen.size}`);

    assert.deepEqual(missing, [], `opcodes without spec: ${missing.join(', ')}`);
    assert.deepEqual(inputMismatch, [], `input mismatches:\n${inputMismatch.join('\n')}`);
    assert.deepEqual(fieldMismatch, [], `field mismatches:\n${fieldMismatch.join('\n')}`);
    assert.deepEqual(
        [...new Set(shadowMismatch)],
        [],
        `shadow mismatches:\n${[...new Set(shadowMismatch)].join('\n')}`,
    );
});
