/**
 * Examples: L1 and L4 from the task ladder, written in the ts format,
 * packed to sb3, verified with vmrun (check + behavioral probes).
 * The .ts sources live in examples/; the built .sb3 files sit next to them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { unpackSb3, packDir } from '../../../packages/core/project-dir.ts';
import { saveSb3File } from '../../../packages/core/sb3.ts';
import { tsFormat } from '../index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const examples = join(here, '..', 'examples');

function svgRect(w: number, h: number, fill: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`;
}

function svgCircle(d: number, fill: string): string {
    const r = d / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="${fill}"/></svg>`;
}

function md5hex(buf: Uint8Array): string {
    return createHash('md5').update(buf).digest('hex');
}

interface Spec {
    name: string;
    isStage: boolean;
    variables?: Array<[string, unknown]>;
    broadcasts?: string[];
    costumes: Array<{ name: string; svg: string; cx: number; cy: number }>;
    scriptsFile?: string; // examples/ file name (without dir)
    scalars?: Record<string, unknown>;
}

function targetJson(spec: Spec, files: Map<string, Uint8Array>): any {
    const costumes = spec.costumes.map((c, i) => {
        const bytes = Buffer.from(c.svg, 'utf8');
        const md5ext = `${md5hex(bytes)}.svg`;
        files.set(md5ext, bytes);
        return { name: c.name, bitmapResolution: 1, rotationCenterX: c.cx, rotationCenterY: c.cy, assetId: md5ext.slice(0, -4), dataFormat: 'svg', md5ext };
    });
    const variables: Record<string, unknown> = {};
    for (const [n, v] of spec.variables ?? []) variables[`var-${spec.name}-${n}`] = [n, v];
    const broadcasts: Record<string, string> = {};
    for (const n of spec.broadcasts ?? []) broadcasts[`bc-${spec.name}-${n}`] = n;
    return {
        name: spec.name,
        isStage: spec.isStage,
        ...(spec.isStage
            ? { tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null }
            : { visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around', currentCostume: 0, volume: 100, layerOrder: 1 }),
        ...(spec.scalars ?? {}),
        variables,
        lists: {},
        broadcasts,
        blocks: {},
        comments: {},
        costumes,
        sounds: [],
    };
}

async function buildExample(outSb3: string, specs: Spec[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'aw-ts-ex-'));
    try {
        const files = new Map<string, Uint8Array>();
        const project = {
            targets: specs.map((s) => targetJson(s, files)),
            monitors: [],
            extensions: [],
            meta: { semver: '3.0.0', vm: '2.1.0', agent: 'format-ts-examples' },
        };
        const baseSb3 = join(dir, 'base.sb3');
        await saveSb3File(baseSb3, JSON.stringify(project), files);
        const work = join(dir, 'work');
        await unpackSb3(baseSb3, work, tsFormat);
        // Overwrite scripts + fix target.json decls (passthrough already has them).
        for (const s of specs) {
            if (s.scriptsFile) {
                await copyFile(join(examples, s.scriptsFile), join(work, s.name, 'scripts.ts'));
            }
        }
        const packed = await packDir(work, outSb3, tsFormat);
        assert.deepEqual(packed.diagnostics.filter((d) => d.severity === 'error'), [], `pack errors for ${outSb3}`);
        return work;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

function checkSb3(sb3: string): any {
    const out = execFileSync('node', [join(root, 'tools', 'vmrun', 'cli.mjs'), 'check', sb3], { encoding: 'utf8', stdio: 'pipe' });
    return JSON.parse(out);
}

function runProbes(sb3: string, frames: number, probes: string[]): Record<string, any> {
    const args = ['node', join(root, 'tools', 'vmrun', 'cli.mjs'), 'run', sb3, '--frames', String(frames)];
    for (const p of probes) args.push('--probe', p);
    const out = execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out).probes as Record<string, any>;
}

test('example L1 packs, checks, and behaves', async () => {
    const outSb3 = join(examples, 'l1.sb3');
    await buildExample(outSb3, [
        {
            name: 'Stage',
            isStage: true,
            costumes: [{ name: 'backdrop1', svg: svgRect(480, 360, '#ffffff'), cx: 240, cy: 180 }],
        },
        {
            name: 'Sprite1',
            isStage: false,
            costumes: [{ name: 'cat', svg: svgCircle(60, '#ff8c1a'), cx: 30, cy: 30 }],
            scriptsFile: 'l1.Sprite1.ts',
        },
    ]);
    const checked = checkSb3(outSb3);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors ?? checked).slice(0, 500));
    const probes = runProbes(outSb3, 30, ['Sprite1.x', 'Sprite1.bubble.text']);
    assert.equal(probes['Sprite1.x'], 10);
    assert.equal(probes['Sprite1.bubble.text'], 'Hello!');
});

test('example L4 packs, checks, and scores', async () => {
    const outSb3 = join(examples, 'l4.sb3');
    await buildExample(outSb3, [
        {
            name: 'Stage',
            isStage: true,
            variables: [['score', 0], ['lives', 3]],
            broadcasts: ['gameOver'],
            costumes: [{ name: 'backdrop1', svg: svgRect(480, 360, '#0b1020'), cx: 240, cy: 180 }],
            scriptsFile: 'l4.Stage.ts',
        },
        {
            name: 'Player',
            isStage: false,
            costumes: [{ name: 'ship', svg: svgCircle(50, '#4da3ff'), cx: 25, cy: 25 }],
            scriptsFile: 'l4.Player.ts',
        },
        {
            name: 'Bullet',
            isStage: false,
            costumes: [{ name: 'dot', svg: svgRect(8, 14, '#ffe14d'), cx: 4, cy: 7 }],
            scriptsFile: 'l4.Bullet.ts',
        },
        {
            name: 'Enemy',
            isStage: false,
            costumes: [{ name: 'bug', svg: svgCircle(44, '#ff4d5e'), cx: 22, cy: 22 }],
            scriptsFile: 'l4.Enemy.ts',
        },
    ]);
    const checked = checkSb3(outSb3);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors ?? checked).slice(0, 800));
    const probes = runProbes(outSb3, 600, ['Stage.variables.score', 'Stage.variables.lives', 'targets.length', 'clones.Bullet', 'clones.Enemy']);
    assert.ok((probes['Stage.variables.score'] as number) >= 3, `score did not increase: ${JSON.stringify(probes)}`);
    assert.equal(probes['Stage.variables.lives'], 3);
    assert.ok((probes['targets.length'] as number) <= 10, `clone count unbounded: ${JSON.stringify(probes)}`);
}, { timeout: 300000 });
