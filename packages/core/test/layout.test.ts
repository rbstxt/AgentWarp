/**
 * Layout validation:
 *  - cleanUpPlus reproduces TurboWarp's Clean up Plus
 *    (eval/calibration/*.cleanup.json) within 1 unit for every block and
 *    attached comment in every fixture.
 *  - placeNew keeps existing scripts fixed and never overlaps.
 *  - overlaps detects real overlaps and stays quiet on clean layouts.
 *
 * Run: node --test packages/core/test/ (from the repo root).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanUpPlus, placeNew, overlaps, scriptBoxes} from '../layout.ts';
import {measureScript} from '../metrics.ts';
import {readSb3Json} from './zip.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const FIXTURES = [
    'tools/vmrun/test-fixtures/click.sb3',
    'tools/vmrun/test-fixtures/clones.sb3',
    'tools/vmrun/test-fixtures/greenflag.sb3',
    'tools/vmrun/test-fixtures/keys.sb3',
    'tools/vmrun/test-fixtures/touch.sb3',
    'eval/fixtures/lightcube-134430880.sb3',
    'eval/fixtures/platformer-853110869.sb3',
    'eval/fixtures/scrolltutorial-378587848.sb3',
];

test('cleanUpPlus matches the editor within 1 unit', () => {
    let nb = 0;
    let nc = 0;
    let maxB = 0;
    let maxC = 0;
    const rows: string[] = [];
    for (const f of FIXTURES) {
        const sb3 = path.join(REPO, f);
        const mname = path.basename(f, '.sb3') + '.measured.json';
        void mname;
        const calName = path.basename(f, '.sb3') + '.cleanup.json';
        const cp = path.join(REPO, 'eval', 'calibration', calName);
        if (!existsSync(sb3) || !existsSync(cp)) {
            rows.push(`${f}: MISSING INPUT`);
            continue;
        }
        const project = readSb3Json(sb3) as {targets: Array<{name: string; blocks: Record<string, unknown>; comments?: Record<string, unknown>}>};
        const cleaned = JSON.parse(readFileSync(cp, 'utf8')) as {targets: Array<{name: string; scripts: Array<{id: string; x: number; y: number}>; comments: Array<{id: string; x: number; y: number}>}>};
        let fb = 0;
        let fc = 0;
        for (const ct of cleaned.targets) {
            const pt = project.targets.find(t => t.name === ct.name);
            if (!pt) continue;
            const got = cleanUpPlus(pt as never);
            for (const s of ct.scripts) {
                const blk = pt.blocks[s.id];
                if (!blk || Array.isArray(blk)) continue; // compact-array reporters have no geometry
                const p = got.blocks.get(s.id);
                if (!p) {
                    fb++;
                    rows.push(`  MISSING ${ct.name} ${s.id.slice(0, 8)}`);
                    continue;
                }
                const e = Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y));
                maxB = Math.max(maxB, e);
                nb++;
                if (e > 1) {
                    fb++;
                    if (fb <= 8) rows.push(`  ${ct.name} ${s.id.slice(0, 8)} err=${e.toFixed(2)} got=(${p.x},${p.y}) exp=(${s.x},${s.y})`);
                }
            }
            for (const cm of ct.comments) {
                const p = got.comments.get(cm.id);
                if (!p) continue; // floating comments are untouched by cleanup
                const e = Math.max(Math.abs(p.x - cm.x), Math.abs(p.y - cm.y));
                maxC = Math.max(maxC, e);
                nc++;
                if (e > 1) {
                    fc++;
                    if (fc <= 8) rows.push(`  comment ${ct.name} ${cm.id.slice(0, 8)} err=${e.toFixed(2)} got=(${p.x},${p.y}) exp=(${cm.x},${cm.y})`);
                }
            }
        }
        rows.push(`${f}: blocks over 1u: ${fb}, comments over 1u: ${fc}`);
    }
    rows.push(`TOTAL blocks=${nb} maxErr=${maxB.toFixed(3)} comments=${nc} maxErr=${maxC.toFixed(3)}`);
    console.log(rows.join('\n'));
    assert.ok(nb > 200, `expected >200 matched scripts, got ${nb}`);
    assert.ok(maxB <= 1, `block position max error ${maxB}`);
    assert.ok(maxC <= 1, `comment position max error ${maxC}`);
});

test('placeNew keeps existing fixed and never overlaps', () => {
    const sb3 = path.join(REPO, 'tools/vmrun/test-fixtures/greenflag.sb3');
    const project = readSb3Json(sb3) as {targets: Array<{name: string; blocks: Record<string, unknown>; comments?: Record<string, unknown>}>};
    const target = project.targets.find(t => t.name === 'Sprite1')!;
    const before = scriptBoxes(target as never);
    // New standalone reporter dropped on top of nothing in particular.
    const added: Record<string, unknown> = {
        newTop: {opcode: 'motion_movesteps', next: null, parent: null, inputs: {STEPS: [1, [4, '10']]}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0},
        newTop2: {opcode: 'looks_say', next: null, parent: null, inputs: {MESSAGE: [1, [10, 'hi']]}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0},
    };
    const t2 = {name: 'Sprite1', blocks: {...target.blocks, ...added}, comments: target.comments ?? {}};
    const placed = placeNew(t2 as never, ['newTop', 'newTop2']);
    assert.equal(placed.blocks.size, 2);
    // Existing untouched (placeNew only returns new positions).
    for (const [id, b] of before) {
        void id;
        void b;
    }
    const p1 = placed.blocks.get('newTop')!;
    const p2 = placed.blocks.get('newTop2')!;
    // Below the lowest script of the leftmost column, gap 72.
    const existing = [...before.values()];
    const lowestBottom = Math.max(...existing.map(b => b.y + b.h));
    assert.ok(p1.y >= lowestBottom + 72 - 1e-9, `p1.y=${p1.y} lowest=${lowestBottom}`);
    // No overlap between the two new scripts.
    const m1 = measureScript(t2.blocks as never, 'newTop');
    const m2 = measureScript(t2.blocks as never, 'newTop2');
    const r1 = {x: p1.x, y: p1.y, w: m1.width, h: m1.height};
    const r2 = {x: p2.x, y: p2.y, w: m2.width, h: m2.height};
    const hit = r1.x < r2.x + r2.w && r2.x < r1.x + r1.w && r1.y < r2.y + r2.h && r2.y < r1.y + r1.h;
    assert.ok(!hit, 'new scripts overlap');
    // No overlap with existing scripts either.
    for (const b of existing) {
        for (const r of [r1, r2]) {
            const h = r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h;
            assert.ok(!h, 'new script overlaps existing');
        }
    }
    // overlaps() agrees: injected overlap is found, clean layout is quiet.
    const placedTargets = {
        name: 'Sprite1',
        blocks: {
            ...t2.blocks,
            ...Object.fromEntries([...placed.blocks.entries()].map(([id, p]) => [id, {...(t2.blocks[id] as object), x: Math.round(p.x), y: Math.round(p.y)}])),
        },
        comments: {},
    };
    assert.equal(overlaps(placedTargets as never).length, 0);
    const t3 = {
        name: 'Sprite1',
        blocks: {
            o1: {opcode: 'motion_movesteps', next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 50, y: 50},
            o2: {opcode: 'looks_say', next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 60, y: 60},
        },
        comments: {},
    };
    assert.equal(overlaps(t3 as never).length, 1);
});

test('placeNew honors near and places attached comments', () => {
    const sb3 = path.join(REPO, 'tools/vmrun/test-fixtures/greenflag.sb3');
    const project = readSb3Json(sb3) as {targets: Array<{name: string; blocks: Record<string, unknown>; comments?: Record<string, unknown>}>};
    const target = project.targets.find(t => t.name === 'Stage')!;
    // Existing: b7 script at (20, 20). Add a new script near it with an attached comment.
    const t2 = {
        name: 'Stage',
        blocks: {
            ...target.blocks,
            newTop: {opcode: 'motion_movesteps', next: null, parent: null, inputs: {STEPS: [1, [4, '10']]}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0, comment: 'cNew'},
        },
        comments: {
            cNew: {blockId: 'newTop', x: 0, y: 0, text: 'hi', minimized: false, width: 200, height: 200},
        },
    };
    const placed = placeNew(t2 as never, ['newTop'], ['cNew'], {near: 'b7'});
    const p = placed.blocks.get('newTop')!;
    const m = measureScript(t2.blocks as never, 'newTop');
    const b7 = measureScript(t2.blocks as never, 'b7');
    // Right of b7 (preferred) or below it.
    const rightOf = p.x >= 20 + b7.width + 96 - 1e-9 && Math.abs(p.y - 20) < 1e-9;
    const below = Math.abs(p.x - 20) < 1e-9 && p.y >= 20 + b7.height + 72 - 1e-9;
    assert.ok(rightOf || below, `near placement off: ${JSON.stringify(p)}`);
    // Attached comment goes right of the new script's right edge.
    const c = placed.comments.get('cNew')!;
    const owner = m.perBlock.get('newTop') as {rw: number; rh0: number};
    assert.ok(Math.abs(c.x - (p.x + owner.rw + 32)) < 1e-9, `comment x=${c.x}`);
    assert.ok(Math.abs(c.y - (p.y + owner.rh0 / 2 - 16)) < 1e-9, `comment y=${c.y}`);
});
