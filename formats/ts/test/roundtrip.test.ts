/**
 * Round trip: unpack -> pack with no edits is byte-identical
 * (project.json bytes + every asset file) for every fixture sb3,
 * and print(parse(print(ir))) === print(ir).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { unpackSb3, packDir } from '../../../packages/core/project-dir.ts';
import { loadSb3File } from '../../../packages/core/sb3.ts';
import { extractTarget } from '../../../packages/core/extract.ts';
import { tsFormat } from '../index.ts';
import { printScripts } from '../print.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

export function listSb3(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
        const f = join(dir, e);
        if (statSync(f).isDirectory()) {
            if (e === 'node_modules') continue;
            out.push(...listSb3(f));
        } else if (e.endsWith('.sb3')) {
            out.push(f);
        }
    }
    return out;
}

export function fixtureSb3s(): string[] {
    const out: string[] = [];
    for (const f of listSb3(join(root, 'eval', 'fixtures'))) out.push(f);
    for (const f of listSb3(join(root, 'tools', 'vmrun', 'test-fixtures'))) out.push(f);
    const runs = join(root, 'eval', 'runs');
    for (const approach of readdirSync(runs)) {
        const ad = join(runs, approach);
        if (!statSync(ad).isDirectory() || approach === 'node_modules') continue;
        for (const level of readdirSync(ad)) {
            const outSb3 = join(ad, level, 'out.sb3');
            try {
                if (statSync(outSb3).isFile()) out.push(outSb3);
            } catch {
                /* no out.sb3 here */
            }
        }
    }
    return out.sort();
}

for (const src of fixtureSb3s()) {
    const name = src.slice(root.length + 1);
    test(`roundtrip byte-identical: ${name}`, async () => {
        const dir = await mkdtemp(join(tmpdir(), 'aw-ts-rt-'));
        try {
            const before = await loadSb3File(src);
            const unpacked = await unpackSb3(src, dir, tsFormat);
            assert.deepEqual(
                unpacked.diagnostics.filter((d) => d.severity === 'error'),
                [],
            );
            const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
            assert.deepEqual(
                packed.diagnostics.filter((d) => d.severity === 'error'),
                [],
            );
            assert.equal(packed.changed, false);
            const after = await loadSb3File(join(dir, 'out.sb3'));
            assert.equal(after.projectText, before.projectText);
            assert.deepEqual(new Set(after.files.keys()), new Set(before.files.keys()));
            for (const [k, v] of before.files) {
                const got = after.files.get(k);
                assert.ok(got, `missing asset ${k}`);
                assert.ok(
                    Buffer.from(v).equals(Buffer.from(got as Uint8Array)),
                    `asset bytes differ: ${k}`,
                );
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test(`print stability: ${name}`, async () => {
        const { project } = await loadSb3File(src);
        for (const target of project?.targets ?? []) {
            const file = `${target?.name}/scripts.ts`;
            const extracted = extractTarget(target, project, { file });
            const once = printScripts(extracted.scripts, { targetName: String(target?.name), file, targetJson: {} });
            const reparsed = tsFormat.parse(once, { targetName: String(target?.name), file, targetJson: {} });
            assert.deepEqual(
                reparsed.diagnostics.filter((d) => d.severity === 'error'),
                [],
                `reparse errors in ${name} ${target?.name}`,
            );
            const twice = printScripts(reparsed.scripts, { targetName: String(target?.name), file, targetJson: {} });
            assert.equal(twice, once, `print(parse(print(ir))) !== print(ir) in ${name} ${target?.name}`);
        }
    });
}

// Empty-target edge: print([]) is stable.
test('print stability: no scripts', () => {
    const ctx = { targetName: 'Stage', file: 'Stage/scripts.ts' };
    assert.equal(tsFormat.parse(printScripts([], ctx), ctx).scripts.length, 0);
    assert.equal(printScripts([], ctx), '');
});
