/**
 * generateDts + tsc: printed scripts type-check, and typos are tsc errors.
 * Required set: scrolltutorial + all tools/vmrun/test-fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { unpackSb3 } from '../../../packages/core/project-dir.ts';
import { tsFormat } from '../index.ts';
import { generateDts } from '../dts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const TSC = join(here, '..', 'node_modules', '.bin', 'tsc');

function targetDirs(dir: string): string[] {
    return readdirSync(dir).filter(
        (e) => e !== '.agentwarp' && e !== 'agentwarp.json' && statSync(join(dir, e)).isDirectory() && existsSync(join(dir, e, 'scripts.ts')),
    );
}

function typeCheck(dir: string): string[] {
    const errors: string[] = [];
    for (const t of targetDirs(dir)) {
        try {
            execFileSync(TSC, ['--noEmit', '--target', 'es2020', '--skipLibCheck', join(dir, t, 'scripts.ts'), join(dir, '.agentwarp', 'types', `${t}.d.ts`)], {
                stdio: 'pipe',
            });
        } catch (e: any) {
            errors.push(`${t}: ${(e.stdout?.toString() ?? e.message).split('\n').filter((l: string) => l.includes('error')).join(' | ').slice(0, 400)}`);
        }
    }
    return errors;
}

test('dts: scrolltutorial + vmrun fixtures type-check clean', async () => {
    const srcs = [join(root, 'eval', 'fixtures', 'scrolltutorial-378587848.sb3')];
    for (const e of readdirSync(join(root, 'tools', 'vmrun', 'test-fixtures'))) {
        if (e.endsWith('.sb3')) srcs.push(join(root, 'tools', 'vmrun', 'test-fixtures', e));
    }
    for (const src of srcs) {
        const dir = await mkdtemp(join(tmpdir(), 'aw-ts-dts-'));
        try {
            await unpackSb3(src, dir, tsFormat);
            const written = await generateDts(dir);
            assert.ok(written.length > 0, `no d.ts written for ${src}`);
            for (const w of written) assert.ok(existsSync(w), `missing ${w}`);
            assert.deepEqual(typeCheck(dir), [], `tsc errors for ${src}`);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
});

test('dts: typo switchCostumeTo("catt") is a tsc error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-ts-dts-'));
    try {
        await unpackSb3(join(root, 'eval', 'fixtures', 'scrolltutorial-378587848.sb3'), dir, tsFormat);
        await generateDts(dir);
        const t = targetDirs(dir).find((d) => readFileSync(join(dir, d, 'scripts.ts'), 'utf8').includes('switchCostumeTo('));
        // Fall back to the first target with a costume.
        const target = t ?? targetDirs(dir)[0];
        const scriptsPath = join(dir, target, 'scripts.ts');
        const before = await readFile(scriptsPath, 'utf8');
        const m = before.match(/switchCostumeTo\("([^"]+)"\)/);
        assert.ok(m, 'fixture has no switchCostumeTo call to typo');
        await writeFile(scriptsPath, before.replace(m[0], 'switchCostumeTo("catt")'));
        const errors = typeCheck(dir);
        assert.ok(errors.some((e) => e.includes('"catt"')), `expected a tsc error for "catt", got: ${errors.join('; ')}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('dts: unknown vars.cost typo is a tsc error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-ts-dts-'));
    try {
        await unpackSb3(join(root, 'tools', 'vmrun', 'test-fixtures', 'click.sb3'), dir, tsFormat);
        await generateDts(dir);
        const scriptsPath = join(dir, 'Cookie', 'scripts.ts');
        const before = await readFile(scriptsPath, 'utf8');
        assert.ok(before.includes('vars.score'));
        await writeFile(scriptsPath, before.replace('vars.score', 'vars.scroe'));
        const errors = typeCheck(dir);
        assert.ok(errors.some((e) => e.includes('scroe')), `expected a tsc error for vars.scroe, got: ${errors.join('; ')}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
