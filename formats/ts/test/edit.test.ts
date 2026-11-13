/**
 * Edit tests: manipulate scripts.ts as an agent would (plain string edits),
 * then pack and verify only the edited script changed, comments are kept,
 * and `vmrun check` passes. Uses the Japanese-named sprite
 * いんとぅるえんぎね of eval/fixtures/platformer-853110869.sb3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { unpackSb3, packDir } from '../../../packages/core/project-dir.ts';
import { tsFormat } from '../index.ts';
import { diffProjects } from '../../../tools/vmrun/lib/diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const FIXTURE = join(root, 'eval', 'fixtures', 'platformer-853110869.sb3');
const TARGET = 'いんとぅるえんぎね';
const SCRIPTS = `${TARGET}/scripts.ts`;

async function freshUnpack(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'aw-ts-edit-'));
    await unpackSb3(FIXTURE, dir, tsFormat);
    return dir;
}

function readScripts(dir: string): Promise<string> {
    return readFile(join(dir, SCRIPTS), 'utf8');
}

function anchorsFor(dir: string): Promise<Record<string, string>> {
    return readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8').then((t) => JSON.parse(t)[TARGET] as Record<string, string>);
}

test('edit: change a literal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-ts-edit-'));
    try {
        await unpackSb3(FIXTURE, dir, tsFormat);
        const anchors = await anchorsFor(dir);
        const before = await readScripts(dir);
        assert.ok(before.includes('setVariableTo(vars["Cam Control?"], "1");'));
        await writeFile(join(dir, SCRIPTS), before.replace('setVariableTo(vars["Cam Control?"], "1");', 'setVariableTo(vars["Cam Control?"], "0");'));
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        const beforeJson = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
        const { loadSb3File } = await import('../../../packages/core/sb3.ts');
        const after = await loadSb3File(join(dir, 'out.sb3'));
        const diff: any = diffProjects(beforeJson, JSON.parse(after.projectText));
        const t = diff.targets[TARGET];
        assert.equal(t.changed.length, 1, JSON.stringify(t.changed));
        assert.equal(t.changed[0].id, anchors['a1']);
        assert.deepEqual(t.deleted, []);
        assert.deepEqual(t.added, []);
        assert.equal(t.comments.lost.length, 0);
        assert.equal(t.comments.changed.length, 0);
        execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', join(dir, 'out.sb3')], { stdio: 'pipe' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: insert a block', async () => {
    const dir = await freshUnpack();
    try {
        const anchors = await anchorsFor(dir);
        const before = await readScripts(dir);
        const needle = '// @a2\nwhenBroadcastReceived("Intro start", () => {});';
        assert.ok(before.includes(needle));
        await writeFile(
            join(dir, SCRIPTS),
            before.replace(needle, '// @a2\nwhenBroadcastReceived("Intro start", () => {\n  wait("1");\n});'),
        );
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        const beforeJson = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
        const { loadSb3File } = await import('../../../packages/core/sb3.ts');
        const after = await loadSb3File(join(dir, 'out.sb3'));
        const diff: any = diffProjects(beforeJson, JSON.parse(after.projectText));
        const t = diff.targets[TARGET];
        assert.equal(t.changed.length, 1);
        assert.equal(t.changed[0].id, anchors['a2']);
        // The inserted wait block is new; the hat keeps its id.
        const kept = t.changed[0].blockIdsKept as string;
        const [a, b] = kept.split('/').map(Number);
        assert.ok(b - a <= 1, `expected at most the edited block to be new, got ${kept}`);
        execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', join(dir, 'out.sb3')], { stdio: 'pipe' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: wrap blocks in if', async () => {
    const dir = await freshUnpack();
    try {
        const anchors = await anchorsFor(dir);
        const before = await readScripts(dir);
        const needle = '      turnRight(divide(vars.加速イージング, "3"));\n    });\n    deleteThisClone();\n';
        assert.ok(before.includes(needle));
        const wrapped = '      turnRight(divide(vars.加速イージング, "3"));\n    });\n    ifThen(keyPressed("space"), () => {\n      deleteThisClone();\n    });\n';
        await writeFile(join(dir, SCRIPTS), before.replace(needle, wrapped));
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        const beforeJson = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
        const { loadSb3File } = await import('../../../packages/core/sb3.ts');
        const after = await loadSb3File(join(dir, 'out.sb3'));
        const diff: any = diffProjects(beforeJson, JSON.parse(after.projectText));
        const t = diff.targets[TARGET];
        assert.equal(t.changed.length, 1);
        assert.equal(t.changed[0].id, anchors['a26']);
        assert.equal(t.comments.lost.length, 0);
        execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', join(dir, 'out.sb3')], { stdio: 'pipe' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: delete a block', async () => {
    const dir = await freshUnpack();
    try {
        const anchors = await anchorsFor(dir);
        const before = await readScripts(dir);
        const needle = '      turnRight(divide(vars.加速イージング, "3"));\n    });\n    deleteThisClone();\n';
        assert.ok(before.includes(needle));
        await writeFile(
            join(dir, SCRIPTS),
            before.replace(needle, '      turnRight(divide(vars.加速イージング, "3"));\n    });\n'),
        );
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        const beforeJson = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
        const { loadSb3File } = await import('../../../packages/core/sb3.ts');
        const after = await loadSb3File(join(dir, 'out.sb3'));
        const diff: any = diffProjects(beforeJson, JSON.parse(after.projectText));
        const t = diff.targets[TARGET];
        assert.equal(t.changed.length, 1);
        assert.equal(t.changed[0].id, anchors['a26']);
        execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', join(dir, 'out.sb3')], { stdio: 'pipe' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: add a new script with an attached comment', async () => {
    const dir = await freshUnpack();
    try {
        const before = await readScripts(dir);
        const addition = '\n// agent note\n// a fresh stack\nscript(() => {\n  sayFor("hi", 1);\n});\n';
        await writeFile(join(dir, SCRIPTS), before + addition);
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.equal(packed.placements.find((p) => p.target === TARGET)?.newScriptIds.length, 1);
        const beforeJson = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
        const { loadSb3File } = await import('../../../packages/core/sb3.ts');
        const after = await loadSb3File(join(dir, 'out.sb3'));
        const diff: any = diffProjects(beforeJson, JSON.parse(after.projectText));
        const t = diff.targets[TARGET];
        assert.equal(t.changed.length, 0, JSON.stringify(t.changed));
        assert.equal(t.added.length, 1);
        assert.equal(t.added[0].opcode, 'looks_sayforsecs');
        assert.equal(t.comments.lost.length, 0);
        assert.equal(t.comments.changed.length, 0);
        assert.equal(t.comments.added, 1);
        execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', join(dir, 'out.sb3')], { stdio: 'pipe' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

// NOTE: blocked on a core gap (see final report): placeNewWorkspace in
// packages/core/reconcile.ts does not set ctx.changed, so a pack whose only
// change is a new workspace comment keeps the base target verbatim and drops
// the comment. The format side is verified below; the pack assertion is
// skipped until core marks the target changed.
test('edit: add a workspace comment (format side)', async () => {
    const dir = await freshUnpack();
    try {
        const before = await readScripts(dir);
        await writeFile(join(dir, SCRIPTS), before + '\ncomment("agent workspace note");\n');
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        assert.equal(packed.placements.find((p) => p.target === TARGET)?.newCommentIds.length, 1);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: add a workspace comment', async () => {
    const dir = await freshUnpack();
    try {
        const before = await readScripts(dir);
        await writeFile(join(dir, SCRIPTS), before + '\ncomment("agent workspace note");\n');
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        const beforeJson = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
        const { loadSb3File } = await import('../../../packages/core/sb3.ts');
        const after = await loadSb3File(join(dir, 'out.sb3'));
        const diff: any = diffProjects(beforeJson, JSON.parse(after.projectText));
        const t = diff.targets[TARGET];
        assert.equal(t.changed.length, 0);
        assert.deepEqual(t.added, []);
        assert.equal(t.comments.added, 1);
        assert.equal(t.comments.lost.length, 0);
        execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', join(dir, 'out.sb3')], { stdio: 'pipe' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('edit: add a custom block definition + call', async () => {
    const dir = await freshUnpack();
    try {
        const before = await readScripts(dir);
        const needle = 'define("ふぇどあ", () => {\n    setVariableTo(vars.加速イージング, "5");\n';
        assert.ok(before.includes(needle));
        const withCall = before.replace(
            needle,
            'define("ふぇどあ", () => {\n    setVariableTo(vars.加速イージング, "5");\n    call("agent hop %n", 5);\n',
        );
        const addition = '\ndefine("agent hop %n", { warp: true }, (height = 10) => {\n  changeY(height);\n});\n';
        await writeFile(join(dir, SCRIPTS), withCall + addition);
        const packed = await packDir(dir, join(dir, 'out.sb3'), tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), []);
        const beforeJson = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
        const { loadSb3File } = await import('../../../packages/core/sb3.ts');
        const after = await loadSb3File(join(dir, 'out.sb3'));
        const afterJson = JSON.parse(after.projectText);
        const t = afterJson.targets.find((x: any) => x.name === TARGET);
        const blocks = Object.values<any>(t.blocks);
        const protos = blocks.filter((b: any) => b?.opcode === 'procedures_prototype');
        assert.ok(
            protos.some((p: any) => p?.mutation?.proccode === 'agent hop %n'),
            'custom block definition kept with its proccode',
        );
        const calls = blocks.filter((b: any) => b?.opcode === 'procedures_call' && b?.mutation?.proccode === 'agent hop %n');
        assert.equal(calls.length, 1, 'custom block call kept');
        const diff: any = diffProjects(beforeJson, afterJson);
        const dt = diff.targets[TARGET];
        assert.equal(dt.comments.lost.length, 0);
        execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', join(dir, 'out.sb3')], { stdio: 'pipe' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
