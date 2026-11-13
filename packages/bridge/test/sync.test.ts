/**
 * Bridge sprite-lifecycle + workspace-comment sync tests (through the bridge
 * wrappers, not core directly).
 *
 * Agent -> editor: packTextAgainstBase (no overrides) delegates to core
 * packAgainst, so an agent sprite add (new dir), rename (target.json `name`
 * change) or delete (dir removed) shows up in the packed project.
 *
 * Editor -> disk: reunpackText delegates dir/anchor bookkeeping to core
 * unpackInto, so a human sprite add/rename/delete in the editor creates,
 * renames or removes the on-disk directory. Workspace comments keep BOTH
 * their script anchor (aN) and comment anchor (cN) across human moves.
 *
 * Run: node --test "packages/bridge/test/*.test.ts" (from the repo root)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { unpackInto } from '../../core/project-dir.ts';
import { md5extFor } from '../../core/assets.ts';
import { irJson } from '../../../formats/ir-json/index.ts';
import { packTextAgainstBase } from '../pack-text.ts';
import { reunpackText } from '../unpack-safe.ts';

const CAT_SVG = '<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50" fill="red"/></svg>';
const LOOK_SVG = '<svg width="80" height="40" xmlns="http://www.w3.org/2000/svg"></svg>';

function stdBlock(opcode: string, extra: any = {}): any {
    return { opcode, next: null, parent: null, inputs: {}, fields: {}, shadow: false, ...extra };
}

/** Minimal Stage + Cat project in sb3 shape. */
function tinyProject(): { project: any; files: Map<string, Uint8Array> } {
    const catMd5 = md5extFor(Buffer.from(CAT_SVG), 'svg');
    const files = new Map<string, Uint8Array>([[catMd5, Buffer.from(CAT_SVG)]]);
    const project = {
        targets: [
            {
                name: 'Stage',
                isStage: true,
                currentCostume: 0,
                volume: 100,
                layerOrder: 0,
                tempo: 60,
                videoTransparency: 50,
                videoState: 'on',
                variables: {},
                lists: {},
                broadcasts: {},
                costumes: [],
                sounds: [],
                blocks: {},
                comments: {},
            },
            {
                name: 'Cat',
                isStage: false,
                currentCostume: 0,
                volume: 100,
                layerOrder: 1,
                visible: true,
                x: 0,
                y: 0,
                size: 100,
                direction: 90,
                draggable: false,
                rotationStyle: 'all around',
                variables: {},
                lists: {},
                broadcasts: {},
                costumes: [
                    {
                        assetId: catMd5.slice(0, catMd5.indexOf('.')),
                        name: 'cat',
                        md5ext: catMd5,
                        dataFormat: 'svg',
                        rotationCenterX: 50,
                        rotationCenterY: 25,
                    },
                ],
                sounds: [],
                blocks: {
                    'cat-top-000000000001': {
                        ...stdBlock('event_whenflagclicked'),
                        topLevel: true,
                        x: 400,
                        y: 10,
                        next: 'cat-move-00000000001',
                    },
                    'cat-move-00000000001': {
                        ...stdBlock('motion_movesteps'),
                        topLevel: false,
                        parent: 'cat-top-000000000001',
                        inputs: { STEPS: [1, [4, 10]] },
                    },
                },
                comments: {},
            },
        ],
        monitors: [],
        extensions: [],
        meta: { semver: '3.0.0', vm: '2.3.0', agent: 'me' },
    };
    return { project, files };
}

async function setupDir(): Promise<{ dir: string; project: any; files: Map<string, Uint8Array> }> {
    const dir = await mkdtemp(join(tmpdir(), 'aw-bridge-sync-'));
    const { project, files } = tinyProject();
    await unpackInto(project, files, dir, irJson);
    await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
    return { dir, project, files };
}

async function teardown(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
}

async function bridgeAnchors(dir: string): Promise<any> {
    return JSON.parse(await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'));
}

// -- agent -> editor --------------------------------------------------------

test('agent sprite add (new dir) syncs to the packed project', async () => {
    const { dir, project } = await setupDir();
    try {
        await mkdir(join(dir, 'Newbie', 'costumes'), { recursive: true });
        await mkdir(join(dir, 'Newbie', 'sounds'), { recursive: true });
        await writeFile(join(dir, 'Newbie', 'target.json'), JSON.stringify({ name: 'Newbie', isStage: false }, null, 2) + '\n');
        await writeFile(join(dir, 'Newbie', 'costumes', 'look.svg'), LOOK_SVG);
        await writeFile(join(dir, 'Newbie', 'scripts.json'), '[]\n');
        const anchors = await bridgeAnchors(dir);
        const r = await packTextAgainstBase(dir, irJson, project, JSON.stringify(project), anchors);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const added = r.project.targets.find((t: any) => t.name === 'Newbie');
        assert.ok(added, 'new sprite packed');
        assert.equal(added.x, 0);
        assert.equal(added.size, 100);
        assert.equal(added.costumes.length, 1);
        assert.equal(added.costumes[0].name, 'look');
        assert.equal(r.changed, true);
    } finally {
        await teardown(dir);
    }
});

test('agent sprite rename (target.json name) keeps ids in the packed project', async () => {
    const { dir, project } = await setupDir();
    try {
        const before = structuredClone(project.targets.find((t: any) => t.name === 'Cat').blocks);
        const tj = JSON.parse(await readFile(join(dir, 'Cat', 'target.json'), 'utf8'));
        tj.name = 'Dog';
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const anchors = await bridgeAnchors(dir);
        const r = await packTextAgainstBase(dir, irJson, project, JSON.stringify(project), anchors);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const dog = r.project.targets.find((t: any) => t.name === 'Dog');
        assert.ok(dog, 'renamed sprite packed');
        assert.ok(!r.project.targets.some((t: any) => t.name === 'Cat'));
        for (const id of Object.keys(before)) assert.ok(dog.blocks[id], `block ${id} kept`);
    } finally {
        await teardown(dir);
    }
});

test('agent sprite rename with directory move keeps ids', async () => {
    const { dir, project } = await setupDir();
    try {
        const before = structuredClone(project.targets.find((t: any) => t.name === 'Cat').blocks);
        await rename(join(dir, 'Cat'), join(dir, 'Dog'));
        const tj = JSON.parse(await readFile(join(dir, 'Dog', 'target.json'), 'utf8'));
        tj.name = 'Dog';
        await writeFile(join(dir, 'Dog', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const anchors = await bridgeAnchors(dir);
        const r = await packTextAgainstBase(dir, irJson, project, JSON.stringify(project), anchors);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const dog = r.project.targets.find((t: any) => t.name === 'Dog');
        assert.ok(dog, 'renamed sprite packed');
        for (const id of Object.keys(before)) assert.ok(dog.blocks[id], `block ${id} kept`);
    } finally {
        await teardown(dir);
    }
});

test('agent sprite delete (dir removed) drops the target from the packed project', async () => {
    const { dir, project } = await setupDir();
    try {
        await rm(join(dir, 'Cat'), { recursive: true, force: true });
        const anchors = await bridgeAnchors(dir);
        const r = await packTextAgainstBase(dir, irJson, project, JSON.stringify(project), anchors);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.ok(!r.project.targets.some((t: any) => t.name === 'Cat'));
        assert.ok(r.project.targets.some((t: any) => t.name === 'Stage'));
    } finally {
        await teardown(dir);
    }
});

test('packTextAgainstBase persists minted ids into target.json', async () => {
    const { dir, project } = await setupDir();
    try {
        const tj = JSON.parse(await readFile(join(dir, 'Cat', 'target.json'), 'utf8'));
        tj.variables = [{ name: 'lives', value: 3 }];
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const anchors = await bridgeAnchors(dir);
        const r = await packTextAgainstBase(dir, irJson, project, JSON.stringify(project), anchors);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.equal(r.mintedIds.length, 1);
        const tj2 = JSON.parse(await readFile(join(dir, 'Cat', 'target.json'), 'utf8'));
        assert.equal(tj2.variables[0].id, r.mintedIds[0].id);
        const r2 = await packTextAgainstBase(dir, irJson, r.project, r.projectText, anchors);
        assert.deepEqual(r2.mintedIds, []);
    } finally {
        await teardown(dir);
    }
});

// -- editor -> disk --------------------------------------------------------

test('editor sprite add creates the on-disk directory', async () => {
    const { dir, project, files } = await setupDir();
    try {
        const added = structuredClone(project);
        const lookMd5 = md5extFor(Buffer.from(LOOK_SVG), 'svg');
        files.set(lookMd5, Buffer.from(LOOK_SVG));
        added.targets.push({
            name: 'Newbie',
            isStage: false,
            currentCostume: 0,
            volume: 100,
            layerOrder: 2,
            visible: true,
            x: 0,
            y: 0,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around',
            variables: {},
            lists: {},
            broadcasts: {},
            costumes: [
                {
                    assetId: lookMd5.slice(0, lookMd5.indexOf('.')),
                    name: 'look',
                    md5ext: lookMd5,
                    dataFormat: 'svg',
                    rotationCenterX: 40,
                    rotationCenterY: 20,
                },
            ],
            sounds: [],
            blocks: {},
            comments: {},
        });
        const anchors = await bridgeAnchors(dir);
        const ru = await reunpackText(dir, irJson, added, JSON.stringify(added), files, { prevAnchors: anchors });
        assert.deepEqual(ru.diagnostics.filter((d) => d.severity === 'error'), []);
        const tj = JSON.parse(await readFile(join(dir, 'Newbie', 'target.json'), 'utf8'));
        assert.equal(tj.name, 'Newbie');
        assert.ok(JSON.parse(await readFile(join(dir, 'Newbie', 'scripts.json'), 'utf8')) !== undefined);
    } finally {
        await teardown(dir);
    }
});

test('editor sprite rename renames the on-disk directory, ids kept', async () => {
    const { dir, project, files } = await setupDir();
    try {
        const renamed = structuredClone(project);
        renamed.targets.find((t: any) => t.name === 'Cat').name = 'Dog';
        const catBlocks = project.targets.find((t: any) => t.name === 'Cat').blocks;
        const anchors = await bridgeAnchors(dir);
        // The delete guard spares dirs written within the unpack window; an
        // editor rename of an idle sprite is long settled, so backdate it.
        const old = new Date(Date.now() - 10_000);
        await utimes(join(dir, 'Cat', 'target.json'), old, old);
        const ru = await reunpackText(dir, irJson, renamed, JSON.stringify(renamed), files, { prevAnchors: anchors });
        assert.deepEqual(ru.diagnostics.filter((d) => d.severity === 'error'), []);
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(dir);
        assert.ok(entries.includes('Dog'), `Dog dir missing: ${entries}`);
        assert.ok(!entries.includes('Cat'), `Cat dir should be gone: ${entries}`);
        const scripts = JSON.parse(await readFile(join(dir, 'Dog', 'scripts.json'), 'utf8'));
        const topSrcIds = scripts.filter((s: any) => s.srcId).map((s: any) => s.srcId);
        assert.ok(topSrcIds.length > 0);
        assert.ok(topSrcIds.every((id: string) => id in catBlocks));
    } finally {
        await teardown(dir);
    }
});

test('editor sprite delete removes the on-disk directory', async () => {
    const { dir, project, files } = await setupDir();
    try {
        const pruned = structuredClone(project);
        pruned.targets = pruned.targets.filter((t: any) => t.name !== 'Cat');
        const anchors = await bridgeAnchors(dir);
        const old = new Date(Date.now() - 10_000);
        await utimes(join(dir, 'Cat', 'target.json'), old, old);
        const ru = await reunpackText(dir, irJson, pruned, JSON.stringify(pruned), files, { prevAnchors: anchors });
        assert.deepEqual(ru.diagnostics.filter((d) => d.severity === 'error'), []);
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(dir);
        assert.ok(!entries.includes('Cat'));
        assert.ok(entries.includes('Stage'));
    } finally {
        await teardown(dir);
    }
});

test('workspace comment keeps both its aN and cN anchors across a human move', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-bridge-wc-'));
    try {
        const { project, files } = tinyProject();
        const cat = project.targets.find((t: any) => t.name === 'Cat');
        cat.comments = {
            wc1: { blockId: null, x: 10, y: 300, width: 200, height: 200, minimized: false, text: 'note' },
        };
        await unpackInto(project, files, dir, irJson);
        await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
        const before = await bridgeAnchors(dir);
        const commentLabels = Object.entries<string>(before.Cat).filter(([, id]) => id === 'wc1');
        // The workspace comment carries both a script label and a comment label.
        assert.ok(commentLabels.some(([a]) => /^a\d+$/.test(a)), `expected an aN label for wc1: ${JSON.stringify(before.Cat)}`);
        assert.ok(commentLabels.some(([a]) => /^c\d+$/.test(a)), `expected a cN label for wc1: ${JSON.stringify(before.Cat)}`);
        // Human move: the comment jumps position; scripts keep their places.
        const moved = structuredClone(project);
        moved.targets.find((t: any) => t.name === 'Cat').comments.wc1.x = 500;
        moved.targets.find((t: any) => t.name === 'Cat').comments.wc1.y = 10;
        const ru = await reunpackText(dir, irJson, moved, JSON.stringify(moved), files, { prevAnchors: before });
        assert.deepEqual(ru.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.deepEqual(ru.anchors.Cat, before.Cat, 'both aN and cN labels stable');
    } finally {
        await teardown(dir);
    }
});
