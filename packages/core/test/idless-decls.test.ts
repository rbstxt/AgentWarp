/**
 * Id-less declarations: target.json variables/lists/broadcasts entries
 * without `id` (or with a duplicate id) get Scratch-style ids minted at pack;
 * minted ids are written back into target.json. Broadcasts may be declared
 * on any target but are always emitted on the Stage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packDir, unpackInto } from '../project-dir.ts';
import { loadSb3File } from '../sb3.ts';
import { irJson, freshDir, readJson, tinyProject } from './lifecycle-helpers.ts';

async function setup(): Promise<{ dir: string; project: any }> {
    const dir = await freshDir();
    const { project, files } = tinyProject();
    await unpackInto(project, files, dir, irJson);
    await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
    return { dir, project };
}

test('idless: variable/list/broadcast without id get minted ids, written back', async () => {
    const { dir } = await setup();
    try {
        const tj = await readJson(join(dir, 'Cat', 'target.json'));
        tj.variables = [{ name: 'lives', value: 3 }];
        tj.lists = [{ name: 'bag', items: ['x'] }];
        tj.broadcasts = [{ name: 'spawned' }];
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.equal(r.mintedIds.length, 3);
        for (const m of r.mintedIds) {
            assert.equal(m.id.length, 20);
            assert.equal(m.target, 'Cat');
        }
        // Written back into target.json...
        const tj2 = await readJson(join(dir, 'Cat', 'target.json'));
        assert.equal(tj2.variables[0].id, r.mintedIds.find((m) => m.kind === 'variable')!.id);
        assert.equal(tj2.lists[0].id, r.mintedIds.find((m) => m.kind === 'list')!.id);
        assert.equal(tj2.broadcasts[0].id, r.mintedIds.find((m) => m.kind === 'broadcast')!.id);
        // ...and the packed project uses them.
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        const cat = packed.targets.find((t: any) => t.name === 'Cat');
        const varId = r.mintedIds.find((m) => m.kind === 'variable')!.id;
        assert.deepEqual(cat.variables[varId], ['lives', 3]);
        const listId = r.mintedIds.find((m) => m.kind === 'list')!.id;
        assert.deepEqual(cat.lists[listId], ['bag', ['x']]);
        // Broadcast declared on the sprite is emitted on the Stage instead.
        const bcId = r.mintedIds.find((m) => m.kind === 'broadcast')!.id;
        const stage = packed.targets.find((t: any) => t.isStage);
        assert.equal(stage.broadcasts[bcId], 'spawned');
        assert.ok(!(bcId in (cat.broadcasts ?? {})));
        // Second pack mints nothing new.
        const r2 = await packDir(dir, join(dir, 'out2.sb3'), irJson);
        assert.deepEqual(r2.mintedIds, []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('idless: duplicate id mints a fresh one with a warning', async () => {
    const { dir } = await setup();
    try {
        const tj = await readJson(join(dir, 'Cat', 'target.json'));
        tj.variables = [
            { name: 'a', value: 1, id: 'dup-id-dup-id-dup-01' },
            { name: 'b', value: 2, id: 'dup-id-dup-id-dup-01' },
        ];
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.ok(r.diagnostics.some((d) => /duplicate id/.test(d.message) && d.severity === 'warning'));
        assert.equal(r.mintedIds.length, 1);
        assert.equal(r.mintedIds[0].name, 'b');
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        const cat = packed.targets.find((t: any) => t.name === 'Cat');
        assert.deepEqual(cat.variables['dup-id-dup-id-dup-01'], ['a', 1]);
        assert.deepEqual(cat.variables[r.mintedIds[0].id], ['b', 2]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('idless: same broadcast id on two targets is kept, not a duplicate', async () => {
    // Real projects declare one broadcast id on several targets (lists.sb3).
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        project.targets.find((t: any) => t.name === 'Cat').broadcasts = { bc1: 'go' };
        await unpackInto(project, files, dir, irJson);
        await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.deepEqual(r.mintedIds, []);
        assert.equal(r.changed, false);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
