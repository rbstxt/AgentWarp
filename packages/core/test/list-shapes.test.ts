/**
 * List shapes: target.json variables must hold scalars, lists must hold
 * arrays of scalars. Violations are error diagnostics with file + json path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packDir, unpackInto } from '../project-dir.ts';
import { irJson, freshDir, readJson, tinyProject } from './lifecycle-helpers.ts';

async function setup(): Promise<string> {
    const dir = await freshDir();
    const { project, files } = tinyProject();
    await unpackInto(project, files, dir, irJson);
    await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
    return dir;
}

test('list shapes: bad variables/lists produce file + json-path errors', async () => {
    const dir = await setup();
    try {
        const tj = await readJson(join(dir, 'Cat', 'target.json'));
        tj.variables = [{ name: 'weird', value: { nested: true }, id: 'v1' }];
        tj.lists = [
            { name: 'ok', items: ['a', 1], id: 'l1' },
            { name: 'bad-items', items: 'nope', id: 'l2' },
            { name: 'bad-item', items: ['fine', { no: true }], id: 'l3' },
        ];
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        const errors = r.diagnostics.filter((d) => d.severity === 'error');
        assert.equal(errors.length, 3);
        assert.ok(errors.some((d) => d.file?.endsWith('Cat/target.json') && /variables\[0\]\.value/.test(d.message)), JSON.stringify(errors));
        assert.ok(errors.some((d) => d.file?.endsWith('Cat/target.json') && /lists\[1\]\.items must be an array/.test(d.message)), JSON.stringify(errors));
        assert.ok(errors.some((d) => d.file?.endsWith('Cat/target.json') && /lists\[2\]\.items\[1\]/.test(d.message)), JSON.stringify(errors));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('list shapes: scalars (string/number/boolean) pass', async () => {
    const dir = await setup();
    try {
        const tj = await readJson(join(dir, 'Cat', 'target.json'));
        tj.variables = [
            { name: 's', value: 'hi', id: 'v1' },
            { name: 'n', value: 42, id: 'v2' },
            { name: 'b', value: true, id: 'v3' },
        ];
        tj.lists = [{ name: 'mix', items: ['a', 1, false], id: 'l1' }];
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
