/**
 * Edit tests: manipulate the sbpy TEXT like an agent would (string edits on
 * the scripts file, not IR), pack, and assert with
 * tools/vmrun/lib/diff.mjs that only the edited script changed and comments
 * are kept; `node tools/vmrun/cli.mjs check` passes.
 *
 * Attached comment ids survive edits: sbpy prints comment anchors (@cN)
 * and core reconcile reuses the anchored (or same-block) comment id.
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
import { diffProjects } from '../../../tools/vmrun/lib/diff.mjs';
import { sbpy } from '../index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const PLATFORMER = join(root, 'eval', 'fixtures', 'platformer-853110869.sb3');
const SPRITE = 'いんとぅるえんぎね';
const CLI = join(root, 'tools', 'vmrun', 'cli.mjs');

async function setup(): Promise<{ dir: string; scriptsFile: string; anchors: Record<string, Record<string, string>> }> {
    const dir = await mkdtemp(join(tmpdir(), 'aw-sbpy-edit-'));
    await unpackSb3(PLATFORMER, dir, sbpy);
    const scriptsFile = join(dir, SPRITE, 'scripts.sbpy');
    const anchors = JSON.parse(await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'));
    return { dir, scriptsFile, anchors };
}

async function packOut(dir: string): Promise<{ sb3: string; placements: Array<{ target: string; newScriptIds: string[]; newCommentIds: string[] }> }> {
    const sb3 = join(dir, 'out.sb3');
    const r = await packDir(dir, sb3, sbpy);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    assert.deepEqual(errors, [], `pack diagnostics: ${JSON.stringify(errors)}`);
    return { sb3, placements: r.placements };
}

function checkPasses(sb3: string): void {
    const out = execFileSync(process.execPath, [CLI, 'check', sb3], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true, `check failed: ${out.slice(0, 1000)}`);
    assert.deepEqual(parsed.errors, []);
}

function replaceOnce(text: string, oldStr: string, newStr: string): string {
    const count = text.split(oldStr).length - 1;
    assert.equal(count, 1, `expected 1 occurrence of ${JSON.stringify(oldStr)}, found ${count}`);
    return text.replace(oldStr, newStr);
}

/** Replace inside one `@anchor` script section (up to the next script). */
function replaceInScript(text: string, anchor: string, oldStr: string, newStr: string): string {
    const start = text.indexOf(`@${anchor}\n`);
    assert.ok(start >= 0, `anchor @${anchor} found`);
    let end = text.indexOf('\n@a', start + 1);
    if (end < 0) end = text.length;
    else end += 1; // keep the blank separator with the tail
    const head = text.slice(0, start);
    const sec = text.slice(start, end);
    const tail = text.slice(end);
    const count = sec.split(oldStr).length - 1;
    assert.equal(count, 1, `expected 1 occurrence of ${JSON.stringify(oldStr)} in @${anchor}, found ${count}`);
    return head + sec.replace(oldStr, newStr) + tail;
}

function spriteOf(project: { targets: Array<{ name?: string }> }, name: string): any {
    const t = project.targets.find((t) => t?.name === name);
    assert.ok(t, `target ${name} found`);
    return t;
}

function findBlock(player: any, pred: (id: string, b: any) => boolean): { id: string; block: any } {
    for (const [id, b] of Object.entries<any>(player.blocks ?? {})) {
        if (b && typeof b === 'object' && !Array.isArray(b) && pred(id, b)) return { id, block: b };
    }
    assert.fail('block not found');
}

test('edit text: change a literal keeps all ids', async () => {
    const { dir, scriptsFile, anchors } = await setup();
    try {
        const a1: string = anchors[SPRITE]['a1'];
        let text = await readFile(scriptsFile, 'utf8');
        text = replaceOnce(text, 'data_setvariableto(VARIABLE="ID", VALUE="rw")', 'data_setvariableto(VARIABLE="ID", VALUE="rw-edited")');
        await writeFile(scriptsFile, text);
        const { sb3 } = await packOut(dir);
        const diff = diffProjects((await loadSb3File(PLATFORMER)).project, (await loadSb3File(sb3)).project);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.deleted, 0);
        assert.equal(diff.summary.moved, 0);
        assert.equal(diff.targets[SPRITE].changed[0].id, a1);
        const [kept, total] = (diff.targets[SPRITE].changed[0].blockIdsKept as string).split('/').map(Number);
        assert.equal(kept, total);
        assert.equal(diff.summary.commentsLost, 0);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: insert a block mid-chain keeps neighbours', async () => {
    const { dir, scriptsFile, anchors } = await setup();
    try {
        const a1: string = anchors[SPRITE]['a1'];
        let text = await readFile(scriptsFile, 'utf8');
        text = replaceOnce(
            text,
            '    data_setvariableto(VARIABLE="ID", VALUE="rw")\n',
            '    data_setvariableto(VARIABLE="ID", VALUE="rw")\n    looks_say(MESSAGE="hi")\n',
        );
        await writeFile(scriptsFile, text);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects((await loadSb3File(PLATFORMER)).project, edited);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.targets[SPRITE].changed[0].id, a1);
        const [kept, total] = (diff.targets[SPRITE].changed[0].blockIdsKept as string).split('/').map(Number);
        assert.equal(kept, total);
        const player = spriteOf(edited, SPRITE);
        const say = findBlock(player, (_id, b) => b.opcode === 'looks_say');
        assert.equal(say.id.length, 20);
        const setvar = findBlock(player, (_id, b) => b.opcode === 'data_setvariableto' && b.fields?.VARIABLE?.[0] === 'ID' && String(b.inputs?.VALUE?.[1]?.[1] ?? '') === 'rw');
        assert.equal(player.blocks[setvar.id].next, say.id);
        assert.equal(diff.summary.commentsLost, 0);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: delete a block relinks the stack', async () => {
    const { dir, scriptsFile, anchors } = await setup();
    try {
        const a1: string = anchors[SPRITE]['a1'];
        const original = (await loadSb3File(PLATFORMER)).project;
        const basePlayer = spriteOf(original, SPRITE);
        const doomed = findBlock(basePlayer, (_id, b) => b.opcode === 'data_setvariableto' && b.fields?.VARIABLE?.[0] === 'ID' && String(b.inputs?.VALUE?.[1]?.[1] ?? '') === 'rw');
        const doomedNext: string | null = doomed.block.next ?? null;
        const pred = findBlock(basePlayer, (_id, b) => b.next === doomed.id);
        let text = await readFile(scriptsFile, 'utf8');
        text = replaceOnce(text, '    data_setvariableto(VARIABLE="ID", VALUE="rw")\n', '');
        await writeFile(scriptsFile, text);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(original, edited);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.targets[SPRITE].changed[0].id, a1);
        const player = spriteOf(edited, SPRITE);
        assert.ok(!player.blocks[doomed.id], 'deleted block id is gone');
        assert.equal(player.blocks[pred.id].next, doomedNext);
        assert.equal(diff.summary.commentsLost, 0);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: wrap blocks in an if keeps the wrapped ids', async () => {
    const { dir, scriptsFile, anchors } = await setup();
    try {
        const a4: string = anchors[SPRITE]['a4'];
        const original = (await loadSb3File(PLATFORMER)).project;
        const basePlayer = spriteOf(original, SPRITE);
        // Block ids reachable from script a4 (for unambiguous lookup).
        const inScript = (topId: string): Set<string> => {
            const out = new Set<string>();
            const stack = [topId];
            while (stack.length) {
                const id = stack.pop() as string;
                if (!id || out.has(id)) continue;
                const b = basePlayer.blocks[id];
                if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
                out.add(id);
                if (typeof b.next === 'string') stack.push(b.next);
                for (const v of Object.values<any>(b.inputs ?? {})) {
                    for (const x of (v as any[]).slice(1)) if (typeof x === 'string') stack.push(x);
                }
            }
            return out;
        };
        const a4ids = inScript(a4);
        const wrappedEntry = Object.entries<any>(basePlayer.blocks).find(([id, b]) => a4ids.has(id) && b?.opcode === 'looks_show');
        assert.ok(wrappedEntry, 'looks_show in script a4');
        const [wrappedId, wrappedBlock] = wrappedEntry;
        const pred = findBlock(basePlayer, (_id, b) => a4ids.has(_id) && b.next === wrappedId);
        const costume = findBlock(basePlayer, (id) => id === (wrappedBlock.next ?? null));
        assert.equal(costume.block.opcode, 'looks_switchcostumeto');
        const afterClone: string | null = costume.block.next ?? null;
        let text = await readFile(scriptsFile, 'utf8');
        text = replaceInScript(
            text,
            'a4',
            '        looks_show()\n        looks_switchcostumeto(COSTUME="Filler (Size)")\n',
            '        control_if(CONDITION=operator_equals(OPERAND1=var("clone Z"), OPERAND2="0")):\n            looks_show()\n            looks_switchcostumeto(COSTUME="Filler (Size)")\n',
        );
        await writeFile(scriptsFile, text);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(original, edited);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.targets[SPRITE].changed[0].id, a4);
        const [kept, total] = (diff.targets[SPRITE].changed[0].blockIdsKept as string).split('/').map(Number);
        assert.equal(kept, total);
        const player = spriteOf(edited, SPRITE);
        assert.ok(player.blocks[wrappedId], 'wrapped block kept its id');
        const ifId = Object.keys(player.blocks).find((id) => player.blocks[id]?.opcode === 'control_if' && player.blocks[id]?.inputs?.SUBSTACK?.[1] === wrappedId);
        assert.ok(ifId, 'new if wraps the kept block');
        assert.equal(player.blocks[ifId].parent, pred.id);
        assert.equal(player.blocks[ifId].next, afterClone);
        assert.ok(player.blocks[costume.id], 'follower kept its id');
        assert.equal(player.blocks[wrappedId].next, costume.id);
        assert.equal(player.blocks[costume.id].next, null);
        assert.equal(diff.summary.commentsLost, 0);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: add a new script with an attached comment', async () => {
    const { dir, scriptsFile } = await setup();
    try {
        const original = (await loadSb3File(PLATFORMER)).project;
        let text = await readFile(scriptsFile, 'utf8');
        if (!text.endsWith('\n')) text += '\n';
        text += '\nevent_whenflagclicked():\n    motion_movesteps(STEPS=10)  # agent note\n';
        await writeFile(scriptsFile, text);
        const out = join(dir, 'out.sb3');
        const r = await packDir(dir, out, sbpy);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const edited = (await loadSb3File(out)).project;
        const diff = diffProjects(original, edited);
        assert.equal(diff.summary.added, 1);
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.deleted, 0);
        const addedId = diff.targets[SPRITE].added[0].id;
        const placement = r.placements.find((p) => p.target === SPRITE);
        assert.ok(placement);
        assert.deepEqual(placement.newScriptIds, [addedId]);
        assert.equal(placement.newCommentIds.length, 1);
        const player = spriteOf(edited, SPRITE);
        const cid = placement.newCommentIds[0];
        assert.equal(player.comments[cid].text, 'agent note');
        const steps = findBlock(player, (_id, b) => b.opcode === 'motion_movesteps');
        assert.equal(player.comments[cid].blockId, steps.id);
        assert.ok(player.comments[cid].x > player.blocks[addedId].x);
        assert.equal(diff.summary.commentsLost, 0);
        checkPasses(out);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: add a workspace comment', async () => {
    const { dir, scriptsFile } = await setup();
    try {
        const original = (await loadSb3File(PLATFORMER)).project;
        const beforeComments = Object.keys(spriteOf(original, SPRITE).comments ?? {}).length;
        let text = await readFile(scriptsFile, 'utf8');
        if (!text.endsWith('\n')) text += '\n';
        text += '\n# agent workspace note\n# second line\n';
        await writeFile(scriptsFile, text);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(original, edited);
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.deleted, 0);
        assert.equal(diff.summary.commentsAdded, 1);
        assert.equal(diff.summary.commentsLost, 0);
        const player = spriteOf(edited, SPRITE);
        assert.equal(Object.keys(player.comments ?? {}).length, beforeComments + 1);
        const added = Object.values<any>(player.comments ?? {}).find((c) => c.text === 'agent workspace note\nsecond line');
        assert.ok(added, 'workspace comment text kept');
        assert.equal(added.blockId, null);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: new procedure definition and call are wired correctly', async () => {
    const { dir, scriptsFile } = await setup();
    try {
        const original = (await loadSb3File(PLATFORMER)).project;
        let text = await readFile(scriptsFile, 'utf8');
        if (!text.endsWith('\n')) text += '\n';
        text += '\ndefine "hop %n" (height):\n    motion_changeyby(DY=arg("height"))\n';
        text += '\nevent_whenflagclicked():\n    call("hop %n", height=5)\n';
        await writeFile(scriptsFile, text);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(original, edited);
        assert.equal(diff.summary.added, 2);
        assert.equal(diff.summary.changed, 0);
        const player = spriteOf(edited, SPRITE);
        const addedIds = diff.targets[SPRITE].added.map((a: { id: string }) => a.id);
        const defTop = addedIds.map((id: string) => player.blocks[id]).find((b: any) => b?.opcode === 'procedures_definition');
        assert.ok(defTop);
        const proto = player.blocks[defTop.inputs.custom_block[1]];
        assert.equal(proto.opcode, 'procedures_prototype');
        assert.equal(proto.mutation.warp, 'false');
        const argIds = JSON.parse(proto.mutation.argumentids);
        assert.equal(argIds.length, 1);
        assert.deepEqual(JSON.parse(proto.mutation.argumentnames), ['height']);
        const reporter = player.blocks[proto.inputs[argIds[0]][1]];
        assert.equal(reporter.opcode, 'argument_reporter_string_number');
        assert.deepEqual(reporter.fields.VALUE, ['height', null]);
        const callTop = addedIds.map((id: string) => player.blocks[id]).find((b: any) => b?.next && player.blocks[b.next]?.opcode === 'procedures_call');
        const call = player.blocks[callTop.next];
        assert.deepEqual(JSON.parse(call.mutation.argumentids), argIds);
        assert.deepEqual(call.inputs[argIds[0]], [1, [4, 5]]);
        assert.equal(diff.summary.commentsLost, 0);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: edit an attached comment keeps the comment id', async () => {
    const { dir, scriptsFile, anchors } = await setup();
    try {
        const original = (await loadSb3File(PLATFORMER)).project;
        const basePlayer = spriteOf(original, SPRITE);
        const needle = 'It uses some trigonometry';
        let text = await readFile(scriptsFile, 'utf8');
        assert.ok(text.includes(needle), 'expected comment present');
        text = replaceOnce(text, needle, 'It uses edited trigonometry');
        await writeFile(scriptsFile, text);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(original, edited);
        // Comment-only edits touch no block script.
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.deleted, 0);
        assert.equal(diff.summary.commentsChanged, 1);
        assert.equal(diff.summary.commentsLost, 0);
        assert.equal(diff.summary.commentsAdded, 0);
        const withOld = Object.entries<any>(basePlayer.comments ?? {}).filter(([, c]) => String(c.text).includes(needle));
        assert.equal(withOld.length, 1);
        const [oldId, oldComment] = withOld[0];
        const player = spriteOf(edited, SPRITE);
        assert.ok(player.comments[oldId], 'comment id preserved');
        assert.equal(player.comments[oldId].text, String(oldComment.text).replace(needle, 'It uses edited trigonometry'));
        assert.equal(player.comments[oldId].blockId, oldComment.blockId);
        // Every block id of the sprite is preserved.
        for (const id of Object.keys(basePlayer.blocks ?? {})) {
            assert.ok(player.blocks[id], `block ${id} kept`);
        }
        void anchors;
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit text: unknown variable warns; new broadcast lands on the Stage', async () => {
    const { dir, scriptsFile } = await setup();
    try {
        let text = await readFile(scriptsFile, 'utf8');
        if (!text.endsWith('\n')) text += '\n';
        text += '\nevent_whenflagclicked():\n    event_broadcast(BROADCAST_INPUT=broadcast("agent hello"))\n    data_setvariableto(VARIABLE="NOPE", VALUE="0")\n';
        await writeFile(scriptsFile, text);
        const out = join(dir, 'out.sb3');
        const r = await packDir(dir, out, sbpy);
        const warns = r.diagnostics.filter((d) => d.severity === 'warning');
        assert.ok(warns.some((d) => d.message.includes('"NOPE"')), `expected unknown-var warning: ${JSON.stringify(warns)}`);
        const errors = r.diagnostics.filter((d) => d.severity === 'error');
        assert.ok(errors.some((d) => d.message.includes('"NOPE"')), `expected reconcile unknown-var error: ${JSON.stringify(errors)}`);
        const edited = (await loadSb3File(out)).project;
        const stage = spriteOf(edited, 'Stage');
        const entry = Object.entries<any>(stage.broadcasts ?? {}).find(([, name]) => name === 'agent hello');
        assert.ok(entry, 'new broadcast declared on the Stage');
        checkPasses(out);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
