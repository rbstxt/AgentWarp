/**
 * Round trip: unpack -> pack with sbpy and no edits is byte-identical
 * (project.json bytes + every asset file) for every fixture sb3, and
 * print(parse(print(ir))) === print(ir) for every target.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { unpackSb3, packDir } from '../../../packages/core/project-dir.ts';
import { loadSb3File } from '../../../packages/core/sb3.ts';
import { sbpy } from '../index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

function listSb3(dir: string): string[] {
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

function fixtureSb3s(): string[] {
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
        const dir = await mkdtemp(join(tmpdir(), 'aw-sbpy-rt-'));
        try {
            const before = await loadSb3File(src);
            const unpacked = await unpackSb3(src, dir, sbpy);
            assert.deepEqual(
                unpacked.diagnostics.filter((d) => d.severity === 'error'),
                [],
            );
            const packed = await packDir(dir, join(dir, 'out.sb3'), sbpy);
            assert.deepEqual(
                packed.diagnostics.filter((d) => d.severity === 'error'),
                [],
                `pack diagnostics: ${JSON.stringify(packed.diagnostics)}`,
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
}

for (const src of fixtureSb3s()) {
    const name = src.slice(root.length + 1);
    test(`print/parse idempotent: ${name}`, async () => {
        const dir = await mkdtemp(join(tmpdir(), 'aw-sbpy-idem-'));
        try {
            await unpackSb3(src, dir, sbpy);
            for (const e of (await readdir(dir)).sort()) {
                if (e === '.agentwarp' || e === 'agentwarp.json') continue;
                let text: string;
                let targetJson: unknown;
                try {
                    text = await readFile(join(dir, e, 'scripts.sbpy'), 'utf8');
                    targetJson = JSON.parse(await readFile(join(dir, e, 'target.json'), 'utf8'));
                } catch {
                    continue; // not a target dir
                }
                const file = join(dir, e, 'scripts.sbpy');
                const once = sbpy.parse(text, { targetName: e, file, targetJson: targetJson as never });
                assert.deepEqual(
                    once.diagnostics.filter((d) => d.severity === 'error'),
                    [],
                    `parse errors in ${name}/${e}: ${JSON.stringify(once.diagnostics.filter((d) => d.severity === 'error'))}`,
                );
                const twice = sbpy.print(once.scripts, { targetName: e, file, targetJson: targetJson as never });
                const reparsed = sbpy.parse(twice, { targetName: e, file, targetJson: targetJson as never });
                assert.deepEqual(
                    reparsed.diagnostics.filter((d) => d.severity === 'error'),
                    [],
                );
                const thrice = sbpy.print(reparsed.scripts, { targetName: e, file, targetJson: targetJson as never });
                assert.equal(thrice, twice, `print is not a fixed point in ${name}/${e}`);
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
}
