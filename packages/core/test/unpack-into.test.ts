/**
 * unpackInto: rewrite the text dir in place without rm -rf. Keeps
 * .agentwarp/format, serve.json and non-target files; prunes stale asset
 * files only inside target asset dirs; handles renamed/deleted targets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unpackInto } from '../project-dir.ts';
import { irJson, freshDir, readJson, tinyProject } from './lifecycle-helpers.ts';

async function setup(): Promise<{ dir: string; project: any; files: Map<string, Uint8Array> }> {
    const dir = await freshDir();
    const { project, files } = tinyProject();
    await unpackInto(project, files, dir, irJson);
    return { dir, project, files };
}

test('unpackInto: keeps format/serve.json and non-target files, prunes stale assets', async () => {
    const { dir, project, files } = await setup();
    try {
        await writeFile(join(dir, '.agentwarp', 'format'), 'ir-json\n');
        await writeFile(join(dir, '.agentwarp', 'serve.json'), '{"port": 1}\n');
        await writeFile(join(dir, 'notes.txt'), 'agent scratch\n');
        await mkdir(join(dir, 'Cat', 'costumes'), { recursive: true });
        await writeFile(join(dir, 'Cat', 'costumes', 'stale.svg'), '<svg></svg>');
        await writeFile(join(dir, 'Cat', 'extra.txt'), 'keep me\n');
        const r = await unpackInto(project, files, dir, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.equal((await readFile(join(dir, '.agentwarp', 'format'), 'utf8')).trim(), 'ir-json');
        assert.equal((await readFile(join(dir, '.agentwarp', 'serve.json'), 'utf8')).trim(), '{"port": 1}');
        assert.equal(await readFile(join(dir, 'notes.txt'), 'utf8'), 'agent scratch\n');
        // Stale asset inside costumes/ pruned...
        assert.ok(!(await readdir(join(dir, 'Cat', 'costumes'))).includes('stale.svg'));
        // ...but other files inside the target dir are left alone.
        assert.equal(await readFile(join(dir, 'Cat', 'extra.txt'), 'utf8'), 'keep me\n');
        // Real assets rewritten.
        assert.ok((await readdir(join(dir, 'Cat', 'costumes'))).length >= 1);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('unpackInto: renamed target gets a new dir, old dir removed', async () => {
    const { dir, project, files } = await setup();
    try {
        const renamed = structuredClone(project);
        renamed.targets.find((t: any) => t.name === 'Cat').name = 'Dog';
        const r = await unpackInto(renamed, files, dir, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const entries = await readdir(dir);
        assert.ok(entries.includes('Dog'), `Dog dir missing: ${entries}`);
        assert.ok(!entries.includes('Cat'), `Cat dir should be gone: ${entries}`);
        const dog = await readJson(join(dir, 'Dog', 'target.json'));
        assert.equal(dog.name, 'Dog');
        // Blocks/ids travel with the rename.
        const catBlocks = project.targets.find((t: any) => t.name === 'Cat').blocks;
        const dogScripts = await readJson(join(dir, 'Dog', 'scripts.json'));
        const topSrcIds = dogScripts.filter((s: any) => s.srcId).map((s: any) => s.srcId);
        assert.ok(topSrcIds.every((id: string) => id in catBlocks));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('unpackInto: deleted target dir removed, others kept', async () => {
    const { dir, project, files } = await setup();
    try {
        const pruned = structuredClone(project);
        pruned.targets = pruned.targets.filter((t: any) => t.name !== 'Cat');
        await unpackInto(pruned, files, dir, irJson);
        const entries = await readdir(dir);
        assert.ok(!entries.includes('Cat'));
        assert.ok(entries.includes('Stage'));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('unpackInto: fresh dir gets the full layout', async () => {
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        const r = await unpackInto(project, files, dir, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.deepEqual(new Set(await readdir(dir)), new Set(['Stage', 'Cat', 'agentwarp.json', '.agentwarp']));
        assert.ok(r.anchors.Stage && r.anchors.Cat);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
