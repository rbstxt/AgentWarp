/**
 * Sprite lifecycle: add (new directory + minimal target.json), rename
 * (`name` change keeps blocks/ids and updates other targets' menus),
 * delete (directory removed; references warn). Costumes/sounds: derive from
 * files when the list is omitted; renames update menus.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packDir, unpackInto } from '../project-dir.ts';
import { loadSb3File } from '../sb3.ts';
import { irJson, freshDir, readJson, tinyProject, BACKDROP_SVG } from './lifecycle-helpers.ts';

async function setup(): Promise<{ dir: string; project: any }> {
    const dir = await freshDir();
    const { project, files } = tinyProject();
    await unpackInto(project, files, dir, irJson);
    await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify(project));
    return { dir, project };
}

/** Find every menu-shadow field value for a menu opcode across targets. */
function menuValues(project: any, menuOpcode: string, field: string): Array<{ target: string; value: string }> {
    const out: Array<{ target: string; value: string }> = [];
    for (const t of project?.targets ?? []) {
        for (const b of Object.values<any>(t?.blocks ?? {})) {
            if (b?.opcode === menuOpcode && Array.isArray(b?.fields?.[field])) {
                out.push({ target: t.name, value: String(b.fields[field][0]) });
            }
        }
    }
    return out;
}

test('sprite add: minimal target.json gets Scratch defaults + derived costumes', async () => {
    const { dir } = await setup();
    try {
        await mkdir(join(dir, 'Newbie', 'costumes'), { recursive: true });
        await mkdir(join(dir, 'Newbie', 'sounds'), { recursive: true });
        await writeFile(join(dir, 'Newbie', 'target.json'), JSON.stringify({ name: 'Newbie', isStage: false }, null, 2) + '\n');
        await writeFile(
            join(dir, 'Newbie', 'costumes', 'look.svg'),
            '<svg width="80" height="40" xmlns="http://www.w3.org/2000/svg"></svg>',
        );
        await writeFile(join(dir, 'Newbie', 'sounds', 'pop.mp3'), Buffer.from([0x49, 0x44, 0x33, 0x00]));
        await writeFile(join(dir, 'Newbie', 'scripts.json'), '[]\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        const added = packed.targets.find((t: any) => t.name === 'Newbie');
        assert.ok(added, 'new sprite packed');
        assert.equal(added.x, 0);
        assert.equal(added.y, 0);
        assert.equal(added.size, 100);
        assert.equal(added.direction, 90);
        assert.equal(added.visible, true);
        assert.equal(added.draggable, false);
        assert.equal(added.rotationStyle, 'all around');
        assert.equal(added.currentCostume, 0);
        assert.equal(added.volume, 100);
        assert.equal(added.layerOrder, 2);
        // Costume derived from the file, rotation center = image center.
        assert.equal(added.costumes.length, 1);
        assert.equal(added.costumes[0].name, 'look');
        assert.equal(added.costumes[0].rotationCenterX, 40);
        assert.equal(added.costumes[0].rotationCenterY, 20);
        assert.equal(added.costumes[0].bitmapResolution, 1);
        // Sounds derived from files too.
        assert.equal(added.sounds.length, 1);
        assert.equal(added.sounds[0].name, 'pop');
        assert.ok(String(added.sounds[0].md5ext).endsWith('.mp3'));
        assert.equal(added.sounds[0].rate, 44100);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('sprite rename: ids kept, menus in other targets updated', async () => {
    const { dir, project } = await setup();
    try {
        const catBlocksBefore = structuredClone(project.targets.find((t: any) => t.name === 'Cat').blocks);
        const tj = await readJson(join(dir, 'Cat', 'target.json'));
        tj.name = 'Dog';
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.ok(!r.diagnostics.some((d) => /removed|deleted/.test(d.message)), JSON.stringify(r.diagnostics));
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        const dog = packed.targets.find((t: any) => t.name === 'Dog');
        assert.ok(dog, 'renamed target present');
        assert.ok(!packed.targets.some((t: any) => t.name === 'Cat'));
        // Blocks/ids kept: every old block id still exists on the renamed target.
        for (const id of Object.keys(catBlocksBefore)) assert.ok(dog.blocks[id], `block ${id} kept`);
        // The Stage `go to [Cat]` menu now says Dog.
        assert.deepEqual(menuValues(packed, 'motion_goto_menu', 'TO'), [{ target: 'Stage', value: 'Dog' }]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('sprite rename with directory move: ids kept, menus updated', async () => {
    const { dir, project } = await setup();
    try {
        const catBlocksBefore = structuredClone(project.targets.find((t: any) => t.name === 'Cat').blocks);
        await rename(join(dir, 'Cat'), join(dir, 'Dog'));
        const tj = await readJson(join(dir, 'Dog', 'target.json'));
        tj.name = 'Dog';
        await writeFile(join(dir, 'Dog', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.ok(!r.diagnostics.some((d) => /removed|deleted/.test(d.message)), JSON.stringify(r.diagnostics));
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        const dog = packed.targets.find((t: any) => t.name === 'Dog');
        assert.ok(dog, 'renamed target present');
        for (const id of Object.keys(catBlocksBefore)) assert.ok(dog.blocks[id], `block ${id} kept`);
        assert.deepEqual(menuValues(packed, 'motion_goto_menu', 'TO'), [{ target: 'Stage', value: 'Dog' }]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('sprite delete: target removed, references warn', async () => {
    const { dir } = await setup();
    try {
        await rm(join(dir, 'Cat'), { recursive: true, force: true });
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        assert.ok(!packed.targets.some((t: any) => t.name === 'Cat'));
        assert.ok(
            r.diagnostics.some((d) => d.severity === 'warning' && /target "Cat" removed/.test(d.message)),
            JSON.stringify(r.diagnostics),
        );
        assert.ok(
            r.diagnostics.some((d) => d.severity === 'warning' && /deleted sprite "Cat"/.test(d.message)),
            JSON.stringify(r.diagnostics),
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('costume rename (same file): menus referencing it updated', async () => {
    const { dir } = await setup();
    try {
        // Add a `switch costume` script to Cat referencing costume "cat"...
        const scripts = await readJson(join(dir, 'Cat', 'scripts.json'));
        const topId = scripts[0].srcId;
        assert.ok(topId);
        scripts.push({
            anchor: undefined,
            kind: 'stack',
            top: {
                opcode: 'event_whenkeypressed',
                inputs: {},
                fields: { KEY_OPTION: { value: 'space' } },
                next: {
                    opcode: 'looks_switchcostumeto',
                    inputs: { COSTUME: { kind: 'menu', value: 'cat' } },
                    fields: {},
                },
            },
        });
        await writeFile(join(dir, 'Cat', 'scripts.json'), JSON.stringify(scripts, null, 2) + '\n');
        // ...then rename the costume in target.json (bytes unchanged).
        const tj = await readJson(join(dir, 'Cat', 'target.json'));
        assert.equal(tj.costumes[0].name, 'cat');
        tj.costumes[0].name = 'kitty';
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        const cat = packed.targets.find((t: any) => t.name === 'Cat');
        assert.equal(cat.costumes[0].name, 'kitty');
        assert.deepEqual(menuValues(packed, 'looks_costume', 'COSTUME'), [{ target: 'Cat', value: 'kitty' }]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('backdrop rename: switch-backdrop menus everywhere updated', async () => {
    const { dir } = await setup();
    try {
        const tj = await readJson(join(dir, 'Stage', 'target.json'));
        tj.costumes[0].name = 'bg2';
        await writeFile(join(dir, 'Stage', 'target.json'), JSON.stringify(tj, null, 2) + '\n');
        // Stage script switching to the old backdrop name.
        const scripts = await readJson(join(dir, 'Stage', 'scripts.json'));
        scripts.push({
            kind: 'stack',
            top: {
                opcode: 'event_whenkeypressed',
                inputs: {},
                fields: { KEY_OPTION: { value: 'b' } },
                next: {
                    opcode: 'looks_switchbackdropto',
                    inputs: { BACKDROP: { kind: 'menu', value: 'backdrop1' } },
                    fields: {},
                },
            },
        });
        await writeFile(join(dir, 'Stage', 'scripts.json'), JSON.stringify(scripts, null, 2) + '\n');
        const r = await packDir(dir, join(dir, 'out.sb3'), irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const packed = (await loadSb3File(join(dir, 'out.sb3'))).project;
        assert.deepEqual(menuValues(packed, 'looks_backdrops', 'BACKDROP'), [{ target: 'Stage', value: 'bg2' }]);
        void BACKDROP_SVG;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
