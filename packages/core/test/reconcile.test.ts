/**
 * Edit tests on eval/fixtures/scrolltutorial-378587848.sb3: apply IR-level
 * edits through the ir-json format, pack, and assert with
 * tools/vmrun/lib/diff.mjs that only the edited script changed, other
 * scripts/comments are preserved, `check` passes, and behavior-preserving
 * edits give identical run state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { unpackSb3, packDir } from '../project-dir.ts';
import { loadSb3File } from '../sb3.ts';
import { irJson } from '../../../formats/ir-json/index.ts';
import { diffProjects } from '../../../tools/vmrun/lib/diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const SCROLL = join(root, 'eval', 'fixtures', 'scrolltutorial-378587848.sb3');
const CLI = join(root, 'tools', 'vmrun', 'cli.mjs');

function playerScriptsFile(dir: string): string {
    return join(dir, 'player', 'scripts.json');
}

async function loadPlayer(dir: string): Promise<any[]> {
    return JSON.parse(await readFile(playerScriptsFile(dir), 'utf8'));
}

async function savePlayer(dir: string, scripts: any[]): Promise<void> {
    await writeFile(playerScriptsFile(dir), JSON.stringify(scripts, null, 2) + '\n');
}

async function packOut(dir: string): Promise<{ sb3: string; changed: boolean }> {
    const sb3 = join(dir, 'out.sb3');
    const r = await packDir(dir, sb3, irJson);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    assert.deepEqual(errors, [], `pack diagnostics: ${JSON.stringify(errors)}`);
    return { sb3, changed: r.changed };
}

function findScript(scripts: any[], pred: (s: any) => boolean): any {
    const s = scripts.find(pred);
    assert.ok(s, 'script not found');
    return s;
}

function checkPasses(sb3: string): void {
    const out = execFileSync(process.execPath, [CLI, 'check', sb3], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true, `check failed: ${out}`);
    assert.deepEqual(parsed.errors, []);
}

function runState(sb3: string): any {
    const out = execFileSync(process.execPath, [CLI, 'run', sb3, '--seconds', '3', '--seed', '1'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true, `run failed: ${out.slice(0, 500)}`);
    return { targets: parsed.targets, clones: parsed.clones, monitors: parsed.monitors };
}

async function originalProject(): Promise<any> {
    return (await loadSb3File(SCROLL)).project;
}

test('edit: change a literal keeps all ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        const a1 = findScript(scripts, (s) => s.top?.opcode === 'event_whenbroadcastreceived');
        const topId: string = a1.srcId;
        assert.equal(a1.top.next.opcode, 'data_setvariableto');
        assert.equal(a1.top.next.inputs.VALUE.kind, 'literal');
        a1.top.next.inputs.VALUE.value = '2';
        await savePlayer(dir, scripts);
        const { sb3 } = await packOut(dir);
        const diff = diffProjects(await originalProject(), (await loadSb3File(sb3)).project);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.deleted, 0);
        assert.equal(diff.summary.moved, 0);
        assert.equal(diff.targets.player.changed[0].id, topId);
        const [kept, total] = (diff.targets.player.changed[0].blockIdsKept as string).split('/').map(Number);
        assert.equal(kept, total);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: insert a block mid-stack keeps neighbours', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        const a1 = findScript(scripts, (s) => s.top?.opcode === 'event_whenbroadcastreceived');
        const setvar = a1.top.next;
        const after = setvar.next;
        const inserted = {
            opcode: 'looks_say',
            inputs: { MESSAGE: { kind: 'literal', value: 'hi', litType: 10 } },
            fields: {},
            next: after,
        };
        setvar.next = inserted;
        await savePlayer(dir, scripts);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(), edited);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        const [kept, total] = (diff.targets.player.changed[0].blockIdsKept as string).split('/').map(Number);
        assert.equal(kept, total);
        // The new block exists with a fresh 20-char id; neighbours kept theirs.
        const player = edited.targets.find((t: any) => t.name === 'player');
        const sayId = Object.keys(player.blocks).find((id) => player.blocks[id]?.opcode === 'looks_say');
        assert.ok(sayId);
        assert.equal(sayId.length, 20);
        assert.ok(player.blocks[setvar.srcId]);
        assert.equal(player.blocks[setvar.srcId].next, sayId);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: delete a block relinks the stack', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        const a1 = findScript(scripts, (s) => s.top?.opcode === 'event_whenbroadcastreceived');
        const setvarId: string = a1.top.next.srcId;
        const foreverId: string = a1.top.next.next.srcId;
        a1.top.next = a1.top.next.next;
        await savePlayer(dir, scripts);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(), edited);
        assert.equal(diff.summary.changed, 1);
        assert.equal(diff.summary.added, 0);
        assert.equal(diff.summary.deleted, 0);
        const player = edited.targets.find((t: any) => t.name === 'player');
        assert.ok(!player.blocks[setvarId], 'deleted block id is gone');
        assert.equal(player.blocks[a1.srcId].next, foreverId);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: wrap blocks in an if keeps the wrapped id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        const a1 = findScript(scripts, (s) => s.top?.opcode === 'event_whenbroadcastreceived');
        const setvar = a1.top.next;
        const forever = setvar.next;
        const setvarId: string = setvar.srcId;
        setvar.next = undefined;
        const wrapped = {
            opcode: 'control_if',
            inputs: {
                CONDITION: {
                    kind: 'block',
                    block: {
                        opcode: 'operator_equals',
                        inputs: {
                            OPERAND1: { kind: 'literal', value: 1, litType: 10 },
                            OPERAND2: { kind: 'literal', value: 1, litType: 10 },
                        },
                        fields: {},
                    },
                },
                SUBSTACK: { kind: 'stack', block: setvar },
            },
            fields: {},
            next: forever,
        };
        a1.top.next = wrapped;
        await savePlayer(dir, scripts);
        const { sb3 } = await packOut(dir);
        const edited = (await loadSb3File(sb3)).project;
        const diff = diffProjects(await originalProject(), edited);
        assert.equal(diff.summary.changed, 1);
        const player = edited.targets.find((t: any) => t.name === 'player');
        assert.ok(player.blocks[setvarId], 'wrapped block kept its id');
        const ifId = Object.keys(player.blocks).find(
            (id) => player.blocks[id]?.opcode === 'control_if' && player.blocks[id]?.parent === a1.srcId,
        );
        assert.ok(ifId);
        assert.equal(player.blocks[ifId].inputs.SUBSTACK[1], setvarId);
        checkPasses(sb3);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: add a new script lands in placements with a provisional position', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        scripts.push({
            kind: 'stack',
            top: {
                opcode: 'event_whenflagclicked',
                inputs: {},
                fields: {},
                next: {
                    opcode: 'motion_movesteps',
                    inputs: { STEPS: { kind: 'literal', value: 10, litType: 4 } },
                    fields: {},
                },
            },
        });
        await savePlayer(dir, scripts);
        const out = join(dir, 'out.sb3');
        const r = await packDir(dir, out, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const edited = (await loadSb3File(out)).project;
        const diff = diffProjects(await originalProject(), edited);
        assert.equal(diff.summary.added, 1);
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.deleted, 0);
        const addedId = diff.targets.player.added[0].id;
        const placement = r.placements.find((p) => p.target === 'player');
        assert.ok(placement);
        assert.deepEqual(placement.newScriptIds, [addedId]);
        const player = edited.targets.find((t: any) => t.name === 'player');
        const top = player.blocks[addedId];
        assert.equal(typeof top.x, 'number');
        assert.equal(typeof top.y, 'number');
        // Provisional: at x of the leftmost column, below the lowest script.
        const stepsRef = top.next ? player.blocks[top.next].inputs.STEPS : null;
        assert.ok(stepsRef);
        assert.deepEqual(stepsRef, [1, [4, 10]]);
        checkPasses(out);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: add a new attached comment is placed right of the script', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        const a8 = findScript(
            scripts,
            (s) => s.top?.opcode === 'event_whenflagclicked' && s.top?.next?.opcode === 'event_broadcastandwait',
        );
        // Attach to the first block of the script that has no comment yet (the hat already has one;
        // replacing that text is an edit of the existing comment, tested separately).
        let target: any = a8.top;
        while (target && target.comment) target = target.next;
        assert.ok(target, 'script has a block without comment');
        target.comment = { text: 'agent note' };
        await savePlayer(dir, scripts);
        const out = join(dir, 'out.sb3');
        const r = await packDir(dir, out, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const edited = (await loadSb3File(out)).project;
        const diff = diffProjects(await originalProject(), edited);
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.commentsAdded, 1);
        const p = diff.targets.player;
        assert.ok(!p.changed.some((c: any) => c.id === a8.srcId));
        assert.ok(!p.moved.some((c: any) => c.id === a8.srcId));
        assert.ok(!p.deleted.some((c: any) => c.id === a8.srcId));
        const player = edited.targets.find((t: any) => t.name === 'player');
        const placement = r.placements.find((p) => p.target === 'player');
        assert.ok(placement);
        assert.equal(placement.newCommentIds.length, 1);
        const cid = placement.newCommentIds[0];
        const c = player.comments[cid];
        assert.equal(c.text, 'agent note');
        assert.equal(c.blockId, target.srcId);
        const top = player.blocks[a8.srcId];
        assert.ok(c.x > top.x, `comment x ${c.x} should be right of script x ${top.x}`);
        checkPasses(out);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: new procedure definition and call are wired correctly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        scripts.push({
            kind: 'stack',
            top: {
                opcode: 'procedures_definition',
                inputs: {},
                fields: {},
                proc: { proccode: 'jump %n', argumentnames: ['height'], argumentdefaults: [''], warp: true },
                next: {
                    opcode: 'motion_changeyby',
                    inputs: {
                        DY: {
                            kind: 'block',
                            block: {
                                opcode: 'argument_reporter_string_number',
                                inputs: {},
                                fields: { VALUE: { value: 'height' } },
                            },
                        },
                    },
                    fields: {},
                },
            },
        });
        scripts.push({
            kind: 'stack',
            top: {
                opcode: 'event_whenflagclicked',
                inputs: {},
                fields: {},
                next: {
                    opcode: 'procedures_call',
                    inputs: { height: { kind: 'literal', value: 10, litType: 4 } },
                    fields: {},
                    proc: { proccode: 'jump %n', argumentnames: [], argumentdefaults: [], warp: false },
                },
            },
        });
        await savePlayer(dir, scripts);
        const out = join(dir, 'out.sb3');
        const r = await packDir(dir, out, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const edited = (await loadSb3File(out)).project;
        const diff = diffProjects(await originalProject(), edited);
        assert.equal(diff.summary.added, 2);
        assert.equal(diff.summary.changed, 0);
        const player = edited.targets.find((t: any) => t.name === 'player');
        const defTop = diff.targets.player.added.map((a: any) => a.id).map((id: string) => player.blocks[id]);
        const def = defTop.find((b: any) => b?.opcode === 'procedures_definition');
        assert.ok(def);
        const proto = player.blocks[def.inputs.custom_block[1]];
        assert.equal(proto.opcode, 'procedures_prototype');
        assert.equal(proto.mutation.warp, 'true');
        const argIds = JSON.parse(proto.mutation.argumentids);
        assert.equal(argIds.length, 1);
        assert.deepEqual(JSON.parse(proto.mutation.argumentnames), ['height']);
        const reporter = player.blocks[proto.inputs[argIds[0]][1]];
        assert.equal(reporter.opcode, 'argument_reporter_string_number');
        assert.deepEqual(reporter.fields.VALUE, ['height', null]);
        // The body references the arg by name; the call passes a value by arg id.
        const bodyY = player.blocks[def.next];
        assert.equal(player.blocks[bodyY.inputs.DY[1]].fields.VALUE[0], 'height');
        const callTop = defTop.find((b: any) => b?.next && player.blocks[b.next]?.opcode === 'procedures_call');
        const call = player.blocks[callTop.next];
        assert.deepEqual(JSON.parse(call.mutation.argumentids), argIds);
        assert.deepEqual(call.inputs[argIds[0]], [1, [4, 10]]);
        checkPasses(out);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: unknown variable is a diagnostic error; new broadcast lands on the Stage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        scripts.push({
            kind: 'stack',
            top: {
                opcode: 'event_whenflagclicked',
                inputs: {},
                fields: {},
                next: {
                    opcode: 'event_broadcast',
                    inputs: { BROADCAST_INPUT: { kind: 'broadcast', name: 'agent hello' } },
                    fields: {},
                    next: {
                        opcode: 'data_setvariableto',
                        inputs: { VALUE: { kind: 'literal', value: 0, litType: 10 } },
                        fields: { VARIABLE: { value: 'NOPE' } },
                    },
                },
            },
        });
        await savePlayer(dir, scripts);
        const out = join(dir, 'out.sb3');
        const r = await packDir(dir, out, irJson);
        const errors = r.diagnostics.filter((d) => d.severity === 'error');
        assert.ok(errors.some((d) => d.message.includes('"NOPE"')), `expected unknown-var error: ${JSON.stringify(errors)}`);
        const edited = (await loadSb3File(out)).project;
        const stage = edited.targets.find((t: any) => t.isStage);
        const entry = Object.entries<any>(stage.broadcasts ?? {}).find(([, name]) => name === 'agent hello');
        assert.ok(entry, 'new broadcast declared on the Stage');
        assert.equal(typeof entry[0], 'string');
        const player = edited.targets.find((t: any) => t.name === 'player');
        const bc = player.blocks[Object.keys(player.blocks).find((id) => player.blocks[id]?.opcode === 'event_broadcast') as string];
        assert.equal(bc.inputs.BROADCAST_INPUT[1][2], entry[0]);
        checkPasses(out);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: edit a comment text keeps the comment id and script ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-edit-'));
    try {
        await unpackSb3(SCROLL, dir, irJson);
        const scripts = await loadPlayer(dir);
        let commentAnchor: string | undefined;
        for (const s of scripts) {
            const stack: any[] = [s.top];
            while (stack.length) {
                const b = stack.pop();
                if (!b) continue;
                if (b.comment?.text === 'this makes everything run!') {
                    commentAnchor = b.comment.anchor;
                    b.comment.text = 'edited by agent';
                }
                for (const inp of Object.values<any>(b.inputs ?? {})) {
                    if ((inp.kind === 'block' || inp.kind === 'stack') && inp.block) stack.push(inp.block);
                }
                if (b.next) stack.push(b.next);
            }
        }
        assert.ok(commentAnchor, 'attached comment c-anchor found');
        await savePlayer(dir, scripts);
        const out = join(dir, 'out.sb3');
        const r = await packDir(dir, out, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const edited = (await loadSb3File(out)).project;
        const diff = diffProjects(await originalProject(), edited);
        assert.equal(diff.summary.changed, 0);
        assert.equal(diff.summary.commentsChanged, 1);
        const changed = diff.targets.player.comments.changed[0];
        assert.equal(changed.reason, 'text');
        const orig = (await loadSb3File(SCROLL)).project;
        const origPlayer = orig.targets.find((t: any) => t.name === 'player');
        assert.equal(edited.targets.find((t: any) => t.name === 'player').comments[changed.id].text, 'edited by agent');
        assert.ok(origPlayer.comments[changed.id], 'comment id preserved');
        checkPasses(out);
        // Behavior-preserving: identical run state.
        assert.deepEqual(runState(out), runState(SCROLL));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
