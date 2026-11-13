/**
 * Round trip: unpack -> pack with the scratchblocks format and no edits is
 * byte-identical (project.json bytes + every asset file) for every fixture
 * sb3. Also asserts the text fixpoint print(parse(print(ir))) === print(ir)
 * with zero parse errors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { unpackSb3, packDir } from '../../../packages/core/project-dir.ts';
import { loadSb3File } from '../../../packages/core/sb3.ts';
import { extractTarget } from '../../../packages/core/extract.ts';
import { scratchblocks } from '../index.ts';

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

function targetDir(dir: string, targetName: string): string | null {
    for (const e of readdirSync(dir)) {
        try {
            const tj = JSON.parse(readFileSync(join(dir, e, 'target.json'), 'utf8'));
            if (tj?.name === targetName) return join(dir, e);
        } catch {
            /* not a target dir */
        }
    }
    return null;
}

for (const src of fixtureSb3s()) {
    const name = src.slice(root.length + 1);
    test(`roundtrip byte-identical: ${name}`, async () => {
        const dir = await mkdtemp(join(tmpdir(), 'aw-sb-rt-'));
        try {
            const before = await loadSb3File(src);
            const unpacked = await unpackSb3(src, dir, scratchblocks);
            assert.deepEqual(
                unpacked.diagnostics.filter((d) => d.severity === 'error'),
                [],
                `unpack errors: ${JSON.stringify(unpacked.diagnostics)}`,
            );
            const packed = await packDir(dir, join(dir, 'out.sb3'), scratchblocks);
            assert.deepEqual(
                packed.diagnostics.filter((d) => d.severity === 'error'),
                [],
                `pack errors: ${JSON.stringify(packed.diagnostics)}`,
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

    test(`text fixpoint: ${name}`, async () => {
        const dir = await mkdtemp(join(tmpdir(), 'aw-sb-fp-'));
        try {
            await unpackSb3(src, dir, scratchblocks);
            const { project } = await loadSb3File(src);
            for (const t of project.targets) {
                const tdir = targetDir(dir, String(t.name));
                assert.ok(tdir, `target dir for ${t.name}`);
                const tj = JSON.parse(await readFile(join(tdir as string, 'target.json'), 'utf8'));
                const file = join(tdir as string, 'scripts.sb');
                const text1 = await readFile(file, 'utf8');
                const ctx = {
                    targetName: String(t.name),
                    file,
                    targetJson: tj,
                    isStage: tj?.isStage === true,
                };
                const p1 = scratchblocks.parse(text1, ctx);
                assert.deepEqual(
                    p1.diagnostics.filter((d) => d.severity === 'error'),
                    [],
                    `parse errors in ${t.name}: ${JSON.stringify(p1.diagnostics)}`,
                );
                const text2 = scratchblocks.print(p1.scripts, ctx);
                assert.equal(text2, text1, `print(parse(print)) !== print for ${t.name}`);
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
}

test('ir-selfcheck: print(parse(print(ir))) === print(ir) on synthetic IR', () => {
    const ctx = {
        targetName: 'Sprite1',
        file: 'Sprite1/scripts.sb',
        targetJson: { variables: [{ name: 'score', id: 'v1' }], lists: [], broadcasts: [] },
        isStage: false,
    };
    const { project } = { project: null };
    void project;
    void extractTarget;
    const scripts = scratchblocks.parse(
        [
            '@a1',
            'when clicked',
            'set [score v] to (0)',
            'if <(score) > (10)> then',
            '  say [hi] // note',
            'else',
            '  say [lo]',
            'end',
            '',
            '@a2',
            'define jump (height)',
            'change y by (height)',
            '',
            '@a9',
            '// workspace note line 1',
            '// line 2',
            '',
        ].join('\n') + '\n',
        ctx,
    ).scripts;
    const once = scratchblocks.print(scripts, ctx);
    const twice = scratchblocks.print(scratchblocks.parse(once, ctx).scripts, ctx);
    assert.equal(twice, once);
});
