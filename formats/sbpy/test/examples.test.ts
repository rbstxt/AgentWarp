/**
 * Examples: L1 and L4 authored in sbpy, packed, and verified with vmrun.
 * Packs each formats/sbpy/examples/<n>/ directory to a temp sb3 (fresh base
 * synthesized from target.json files, same as a new project), then runs
 * `check` and behavior probes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, writeFile, readdir, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { packDir } from '../../../packages/core/project-dir.ts';
import { sbpy } from '../index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const CLI = join(root, 'tools', 'vmrun', 'cli.mjs');

/** Copy an example dir to temp, synthesize .agentwarp, pack. */
async function packExample(name: string): Promise<{ sb3: string; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), `aw-sbpy-ex-`));
    await cp(join(here, '..', 'examples', name), dir, { recursive: true });
    const meta = JSON.parse(await readFile(join(dir, 'agentwarp.json'), 'utf8'));
    const entries = (await readdir(dir)).filter((e) => e !== '.agentwarp' && e !== 'agentwarp.json');
    const targets: any[] = [];
    const anchors: Record<string, Record<string, string>> = {};
    for (const e of entries.sort()) {
        let tj: any = null;
        try {
            tj = JSON.parse(await readFile(join(dir, e, 'target.json'), 'utf8'));
        } catch {
            continue;
        }
        anchors[String(tj.name)] = {};
        targets.push({
            name: tj.name,
            isStage: tj.isStage === true,
            blocks: {},
            comments: {},
            variables: {},
            lists: {},
            broadcasts: {},
            costumes: [],
            sounds: [],
        });
    }
    await mkdir(join(dir, '.agentwarp'), { recursive: true });
    await writeFile(
        join(dir, '.agentwarp', 'base.json'),
        JSON.stringify({ targets, meta: meta.meta, extensions: meta.extensions ?? [], monitors: meta.monitors ?? [] }),
    );
    await writeFile(join(dir, '.agentwarp', 'anchors.json'), JSON.stringify(anchors, null, 2));
    const sb3 = join(dir, `${name}.sb3`);
    const r = await packDir(dir, sb3, sbpy);
    assert.deepEqual(
        r.diagnostics.filter((d) => d.severity === 'error'),
        [],
        `pack ${name}: ${JSON.stringify(r.diagnostics.filter((d) => d.severity === 'error'))}`,
    );
    return { sb3, dir };
}

function check(sb3: string): void {
    const out = execFileSync(process.execPath, [CLI, 'check', sb3], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true, `check failed: ${out.slice(0, 1000)}`);
    assert.deepEqual(parsed.errors, []);
}

function run(sb3: string, args: string[]): any {
    const out = execFileSync(process.execPath, [CLI, 'run', sb3, ...args], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(out);
}

function targetOf(state: any, name: string): any {
    const t = (state.targets as any[]).find((t) => t.name === name && !t.isClone);
    assert.ok(t, `target ${name} present`);
    return t;
}

test('example L1 packs, checks, and behaves (x == 10, bubble)', async () => {
    const { sb3, dir } = await packExample('l1');
    try {
        check(sb3);
        const st = run(sb3, ['--seconds', '1', '--probe', 'Sprite1.x']);
        assert.equal(st.ok, true);
        assert.equal(st.probes['Sprite1.x'], 10);
        const s1 = targetOf(st, 'Sprite1');
        assert.equal(s1.x, 10);
        assert.deepEqual(s1.bubble, { type: 'say', text: 'Hello!' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('example L4 packs, checks, and plays (score rises, clones bounded)', async () => {
    const { sb3, dir } = await packExample('l4');
    try {
        check(sb3);
        // Scripted play: sweep left/right while tapping space (Scratch key names).
        const inputs: Array<Record<string, unknown>> = [];
        let d = 'left arrow';
        for (let t = 5; t < 1100; t += 30) {
            inputs.push({ frame: t, type: 'keydown', key: d });
            inputs.push({ frame: t + 28, type: 'keyup', key: d });
            d = d === 'left arrow' ? 'right arrow' : 'left arrow';
        }
        for (let f = 10; f < 1100; f += 12) {
            inputs.push({ frame: f, type: 'keydown', key: 'space' });
            inputs.push({ frame: f + 2, type: 'keyup', key: 'space' });
        }
        const inputFile = join(dir, 'inputs.json');
        await writeFile(inputFile, JSON.stringify(inputs));
        const st = run(sb3, ['--frames', '1200', '--input', inputFile, '--probe', 'Stage.variables.score', '--probe', 'Stage.variables.lives']);
        assert.equal(st.ok, true);
        assert.ok(st.probes['Stage.variables.score'] > 0, `score rises, got ${st.probes['Stage.variables.score']}`);
        // Game over reached, everything cleaned up: bounded clones.
        assert.equal(st.probes['Stage.variables.lives'], 0);
        assert.deepEqual(st.clones, {});
        const player = targetOf(st, 'Player');
        assert.deepEqual(player.bubble, { type: 'say', text: 'Game Over' });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('example L4 with no input ends in game over', async () => {
    const { sb3, dir } = await packExample('l4');
    try {
        const st = run(sb3, ['--frames', '300', '--probe', 'Stage.variables.score', '--probe', 'Stage.variables.lives', '--probe', 'Player.bubble']);
        assert.equal(st.ok, true);
        assert.equal(st.probes['Stage.variables.score'], 0);
        assert.equal(st.probes['Stage.variables.lives'], 0);
        assert.deepEqual(st.probes['Player.bubble'], { type: 'say', text: 'Game Over' });
        const nClones = Object.values(st.clones as Record<string, number>).reduce((a, b) => a + b, 0);
        assert.ok(nClones < 100, `clones bounded, got ${nClones}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
