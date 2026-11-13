/**
 * packAgainst: pack the text dir against an arbitrary base (packDir is a thin
 * wrapper that reads base.json and writes the .sb3). Also covers the exported
 * readTargetDir and minted-id writeback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packAgainst, packDir, readTargetDir, unpackInto } from '../project-dir.ts';
import { loadSb3File } from '../sb3.ts';
import { irJson, freshDir, readJson, tinyProject } from './lifecycle-helpers.ts';

test('packAgainst: unedited dir packs to byte-identical projectText', async () => {
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        const baseText = JSON.stringify(project);
        await unpackInto(project, files, dir, irJson);
        await writeFile(join(dir, '.agentwarp', 'base.json'), baseText);
        const r = await packAgainst(dir, irJson, { baseProject: project, baseText });
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.equal(r.changed, false);
        assert.equal(r.projectText, baseText);
        assert.deepEqual(r.mintedIds, []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('packAgainst: custom base without touching base.json', async () => {
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        await unpackInto(project, files, dir, irJson);
        await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
        // Simulate the editor moving a script: change the base only.
        const editedBase = structuredClone(project);
        const cat = editedBase.targets.find((t: any) => t.name === 'Cat');
        const topId = Object.keys(cat.blocks).find((id) => cat.blocks[id].topLevel === true);
        cat.blocks[topId].x = 999;
        const before = await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8');
        const r = await packAgainst(dir, irJson, { baseProject: editedBase, baseText: JSON.stringify(editedBase) });
        // Untouched scripts reuse the editor's JSON verbatim (moved position
        // kept), so output equals the edited base: nothing further changed.
        assert.equal(r.changed, false);
        const outCat = r.project.targets.find((t: any) => t.name === 'Cat');
        assert.equal(outCat.blocks[topId].x, 999);
        // base.json on disk untouched (packAgainst is read-only w.r.t. the dir).
        assert.equal(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'), before);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('packDir: thin wrapper writes sb3 + sourcemap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-pa-'));
    try {
        const { project, files } = tinyProject();
        await unpackInto(project, files, dir, irJson);
        await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.equal(r.changed, false);
        const back = await loadSb3File(join(dir, 'out.sb3'));
        assert.equal(back.projectText, JSON.stringify(project));
        const sm = JSON.parse(await readFile(join(dir, '.agentwarp', 'sourcemap.json'), 'utf8'));
        assert.ok(typeof sm === 'object');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('readTargetDir is exported and returns scripts/decls/files/targetJson', async () => {
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        await unpackInto(project, files, dir, irJson);
        const diagnostics: any[] = [];
        const r = await readTargetDir(join(dir, 'Cat'), 'Cat', irJson, diagnostics, undefined, {});
        assert.ok(r);
        assert.ok(Array.isArray(r.scripts) && r.scripts.length === 1);
        assert.equal(r.decls.lists[0].name, 'things');
        assert.equal(r.targetJson.name, 'Cat');
        assert.ok(r.files.size > 0);
        assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('packDir persists minted ids into target.json; second pack is stable', async () => {
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        await unpackInto(project, files, dir, irJson);
        await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
        // Add an id-less variable declaration.
        const tj = await readJson(join(dir, 'Cat', 'target.json'));
        tj.variables = [{ name: 'lives', value: 3 }];
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out1.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.equal(r.mintedIds.length, 1);
        assert.equal(r.mintedIds[0].kind, 'variable');
        assert.equal(r.mintedIds[0].target, 'Cat');
        assert.equal(r.mintedIds[0].id.length, 20);
        // Written back into target.json.
        const tj2 = await readJson(join(dir, 'Cat', 'target.json'));
        assert.equal(tj2.variables[0].id, r.mintedIds[0].id);
        // Packed project uses the minted id.
        const packed = (await loadSb3File(join(dir, 'out1.sb3'))).project;
        const cat = packed.targets.find((t: any) => t.name === 'Cat');
        assert.ok(cat.variables[r.mintedIds[0].id]);
        // Second pack: no new mints.
        const r2 = await packDir(dir, join(dir, 'out2.sb3'), irJson);
        assert.deepEqual(r2.mintedIds, []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
