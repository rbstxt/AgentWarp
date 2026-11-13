/**
 * Edit tests: manipulate the TEXT like an agent would (string edits on the
 * scripts file, not IR), pack, and assert with diffProjects that only the
 * edited script changed, comments are kept, and `check` passes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { unpackSb3, packDir } from '../../../packages/core/project-dir.ts';
import { loadSb3File } from '../../../packages/core/sb3.ts';
import { scratchblocks } from '../index.ts';
import { diffProjects } from '../../../tools/vmrun/lib/diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const SCROLL = join(root, 'eval', 'fixtures', 'scrolltutorial-378587848.sb3');
const PLATFORMER = join(root, 'eval', 'fixtures', 'platformer-853110869.sb3');
const CLI = join(root, 'tools', 'vmrun', 'cli.mjs');

async function setup(sb3: string, targetDirName: string): Promise<{ dir: string; file: string; text: () => Promise<string>; save: (t: string) => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'aw-sb-edit-'));
    await unpackSb3(sb3, dir, scratchblocks);
    const file = join(dir, targetDirName, 'scripts.sb');
    return {
        dir,
        file,
        text: () => readFile(file, 'utf8'),
        save: (t: string) => writeFile(file, t),
    };
}

async function packOut(dir: string): Promise<{ sb3: string; changed: boolean }> {
    const sb3 = join(dir, 'out.sb3');
    const r = await packDir(dir, sb3, scratchblocks);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    assert.deepEqual(errors, [], `pack diagnostics: ${JSON.stringify(errors)}`);
    return { sb3, changed: r.changed };
}

function checkPasses(sb3: string): void {
    const out = execFileSync(process.execPath, [CLI, 'check', sb3], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true, `check failed: ${out}`);
    assert.deepEqual(parsed.errors, []);
}

async function originalProject(sb3: string): Promise<any> {
    return (await loadSb3File(sb3)).project;
}

test('edit: change a literal keeps all ids', async () => {
    const s = await setup(SCROLL, 'player');
    try {
        const text = await s.text();
        // The broadcast-setup script sets a variable to "1".
        assert.ok(text.includes('set [LEVEL v] to ["1"]') || text.includes('set [LEVEL v]'), 'setup line present');
        const edited = text.replace('set [LEVEL v] to ["1"]', 'set [LEVEL v] to ["2"]');
        assert.notEqual(edited, text, 'replacement applied');
        await s.save(edited);
        const { sb3 } = await packOut(s.dir);
        const diff = diffProjects(await originalProject(SCROLL), (await loadSb3File(sb3)).project);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.deleted, 0);
        assert.equal(diff.summary.moved, 0);
        const [kept, total] = (diff.targets.player.changed[0].blockIdsKept as string).split('/').map(Number);
        assert.equal(kept, total);
        checkPasses(sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});

test('edit: insert a block mid-stack keeps neighbours', async () => {
    const s = await setup(SCROLL, 'player');
    try {
        const text = await s.text();
        const anchor = 'set [LEVEL v] to ["1"]';
        assert.ok(text.includes(anchor));
        const edited = text.replace(anchor, `${anchor}\nsay [hi]`);
        await s.save(edited);
        const { sb3 } = await packOut(s.dir);
        const editedProj = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(SCROLL), editedProj);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        const [kept, total] = (diff.targets.player.changed[0].blockIdsKept as string).split('/').map(Number);
        assert.equal(kept, total);
        const player = editedProj.targets.find((t: any) => t.name === 'player');
        const sayId = Object.keys(player.blocks).find((id) => player.blocks[id]?.opcode === 'looks_say');
        assert.ok(sayId, 'new say block exists');
        assert.equal(sayId.length, 20);
        checkPasses(sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});

test('edit: delete a block relinks the stack', async () => {
    const s = await setup(SCROLL, 'player');
    try {
        let text = await s.text();
        const lines = text.split('\n');
        const idx = lines.findIndex((l) => l.includes('set [LEVEL v] to ["1"]'));
        assert.ok(idx >= 0);
        lines.splice(idx, 1);
        await s.save(lines.join('\n'));
        const { sb3 } = await packOut(s.dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(SCROLL), edited);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.deleted, 0);
        checkPasses(sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});

test('edit: wrap blocks in an if keeps the wrapped ids', async () => {
    const s = await setup(SCROLL, 'player');
    try {
        const text = await s.text();
        const anchor = 'set [LEVEL v] to ["1"]';
        assert.ok(text.includes(anchor));
        const edited = text.replace(
            anchor,
            `if <(LEVEL) = ["1"]> then\n  ${anchor}\nend`,
        );
        await s.save(edited);
        const { sb3 } = await packOut(s.dir);
        const editedProj = (await loadSb3File(sb3)).project;
        const orig = await originalProject(SCROLL);
        const diff = diffProjects(orig, editedProj);
        assert.equal(diff.summary.changed, 1);
        // The wrapped setvariableto kept its id.
        const origPlayer = orig.targets.find((t: any) => t.name === 'player');
        const setId = Object.keys(origPlayer.blocks).find(
            (id) => origPlayer.blocks[id]?.opcode === 'data_setvariableto' && JSON.stringify(origPlayer.blocks[id]).includes('LEVEL'),
        );
        assert.ok(setId, 'original set id found');
        const player = editedProj.targets.find((t: any) => t.name === 'player');
        assert.ok(player.blocks[setId as string], 'wrapped block kept its id');
        assert.equal(player.blocks[setId as string].parent && player.blocks[player.blocks[setId as string].parent]?.opcode, 'control_if');
        checkPasses(sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});

test('edit: add a new script with an attached comment', async () => {
    const s = await setup(SCROLL, 'player');
    try {
        const text = await s.text();
        await s.save(
            text +
                '\nwhen clicked // agent note\nmove ("10") steps\n',
        );
        const { sb3 } = await packOut(s.dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(SCROLL), edited);
        assert.equal(diff.summary.added, 1);
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.commentsAdded, 1);
        checkPasses(sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});

test('edit: add a workspace comment', async () => {
    const s = await setup(SCROLL, 'player');
    try {
        const text = await s.text();
        await s.save(text + '\n@new1\n// agent workspace note\n');
        const { sb3 } = await packOut(s.dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(SCROLL), edited);
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.commentsAdded, 1);
        checkPasses(sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});

test('edit: add a custom block definition and call', async () => {
    const s = await setup(SCROLL, 'player');
    try {
        const text = await s.text();
        await s.save(text + '\ndefine hop (height)\nchange y by (height)\n\nwhen clicked\nhop ("10")\n');
        const packed = await packOut(s.dir);
        const edited = (await loadSb3File(packed.sb3)).project;
        const diff = diffProjects(await originalProject(SCROLL), edited);
        assert.equal(diff.summary.added, 2);
        const player = edited.targets.find((t: any) => t.name === 'player');
        const defId = Object.keys(player.blocks).find((id) => {
            const b = player.blocks[id];
            if (b?.opcode !== 'procedures_definition') return false;
            const proto = player.blocks[b.inputs?.custom_block?.[1]];
            return proto?.mutation?.proccode === 'hop %s';
        });
        assert.ok(defId, 'hop definition exists');
        const def = player.blocks[defId as string];
        const proto = player.blocks[def.inputs.custom_block[1]];
        assert.equal(proto.opcode, 'procedures_prototype');
        assert.deepEqual(JSON.parse(proto.mutation.argumentnames), ['height']);
        checkPasses(packed.sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});

test('edit: change a block in a Japanese-named sprite, comments kept', async () => {
    // ステージ (Stage in katakana) exists in platformer-853110869.sb3.
    const s = await setup(PLATFORMER, 'ステージ');
    try {
        const text = await s.text();
        assert.ok(text.length > 0, 'sprite has scripts');
        // Append a new script (no anchor): it must land without touching others.
        await s.save(text + '\nwhen clicked\nsay [こんにちは] // はじめまして\n');
        const { sb3 } = await packOut(s.dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(PLATFORMER), edited);
        assert.equal(diff.summary.changed, 0, `only additions expected: ${JSON.stringify(diff.summary)}`);
        assert.equal(diff.targets['ステージ'].added.length, 1);
        // No comments were dropped anywhere.
        assert.equal(diff.summary.commentsAdded, 1);
        assert.equal(diff.summary.commentsChanged ?? 0, 0);
        assert.equal(diff.summary.commentsDeleted ?? 0, 0);
        checkPasses(sb3);
    } finally {
        await rm(s.dir, { recursive: true, force: true });
    }
});
