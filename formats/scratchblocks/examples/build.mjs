/**
 * Build + verify the L1/L4 examples: assemble project dirs from the authored
 * .sb sources, pack with the scratchblocks format, then vmrun check + probes.
 * Run: node formats/scratchblocks/examples/build.mjs
 */
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { unpackSb3, packDir } from '../../../packages/core/project-dir.ts';
import { loadSb3File } from '../../../packages/core/sb3.ts';
import { scratchblocks } from '../index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', '..', 'tools', 'vmrun', 'cli.mjs');

function check(sb3) {
    const out = execFileSync(process.execPath, [CLI, 'check', sb3], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    if (!parsed.ok) throw new Error(`check failed for ${sb3}: ${out}`);
}

/** Reset the reconcile base to empty blocks/comments (fresh project). */
async function freshBase(dir, dropTargets = []) {
    const basePath = join(dir, '.agentwarp', 'base.json');
    const base = JSON.parse(await readFile(basePath, 'utf8'));
    base.targets = base.targets.filter((t) => !dropTargets.includes(t.name));
    for (const t of base.targets) {
        t.blocks = {};
        t.comments = {};
    }
    await writeFile(basePath, JSON.stringify(base));
    await writeFile(join(dir, '.agentwarp', 'anchors.json'), '{}');
}

function findDir(dir, targetName) {
    for (const e of readdirSync(dir)) {
        try {
            const tj = JSON.parse(readFileSync(join(dir, e, 'target.json'), 'utf8'));
            if (tj?.name === targetName) return join(dir, e);
        } catch {
            /* not a target dir */
        }
    }
    return null;
}

async function buildL1() {
    const dir = await mkdtemp(join(tmpdir(), 'aw-ex-l1-'));
    try {
        const base = join(here, '..', '..', '..', 'tools', 'vmrun', 'test-fixtures', 'greenflag.sb3');
        await unpackSb3(base, dir, scratchblocks);
        await freshBase(dir);
        for (const [target, src] of [['Stage', 'l1-Stage.sb'], ['Sprite1', 'l1-Sprite1.sb']]) {
            const tdir = findDir(dir, target);
            if (!tdir) throw new Error(`no dir for ${target}`);
            await writeFile(join(tdir, 'scripts.sb'), await readFile(join(here, src), 'utf8'));
        }
        const out = join(here, 'l1.sb3');
        const r = await packDir(dir, out, scratchblocks);
        const errs = r.diagnostics.filter((d) => d.severity === 'error');
        if (errs.length) throw new Error(`L1 pack errors: ${JSON.stringify(errs)}`);
        check(out);
        // Probe: after 1s, Sprite1 x == 10 and bubble shows Hello!.
        const runOut = execFileSync(process.execPath, [CLI, 'run', out, '--seconds', '1'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const run = JSON.parse(runOut);
        if (!run.ok) throw new Error(`L1 run failed: ${runOut.slice(0, 500)}`);
        const sprite = run.targets.find((t) => t.name === 'Sprite1');
        if (Math.round(sprite.x) !== 10) throw new Error(`L1 probe: x == ${sprite.x}, want 10`);
        const bubble = sprite.bubble?.text;
        if (bubble !== 'Hello!') throw new Error(`L1 probe: bubble == ${JSON.stringify(bubble)}, want "Hello!"`);
        console.log('L1 ok: x=10, bubble=Hello!');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}


const SHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><path d="M15 2 L28 28 L15 21 L2 28 Z" fill="#0066ff" stroke="#003399"/></svg>`;
const BULLET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5" fill="#ff0000"/></svg>`;
const ENEMY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="18"><rect x="1" y="1" width="38" height="16" rx="4" fill="#00cc00" stroke="#006600"/><circle cx="8" cy="9" r="2" fill="#003300"/><circle cx="16" cy="9" r="2" fill="#003300"/></svg>`;

async function buildL4() {
    const dir = await mkdtemp(join(tmpdir(), 'aw-ex-l4-'));
    try {
        const base = join(here, '..', '..', '..', 'tools', 'vmrun', 'test-fixtures', 'greenflag.sb3');
        await unpackSb3(base, dir, scratchblocks);
        await freshBase(dir, ['Sprite1']);
        // Pop sound from click.sb3 (also works around a core crash on new
        // targets with zero sounds; see final report).
        const click = await loadSb3File(join(here, '..', '..', '..', 'tools', 'vmrun', 'test-fixtures', 'click.sb3'));
        const cookie = click.project.targets.find((t) => t.name === 'Cookie');
        const popEntry = (cookie.sounds || []).find((s) => s.name === 'pop');
        if (!popEntry) throw new Error('pop sound missing from click.sb3');
        const popBytes = click.files.get(popEntry.md5ext);
        const popMeta = { ...popEntry };
        delete popMeta.assetId;
        delete popMeta.dataFormat;
        delete popMeta.md5ext;
        const stageDir = findDir(dir, 'Stage');
        const spriteDir = findDir(dir, 'Sprite1');
        if (!stageDir || !spriteDir) throw new Error('base targets missing');
        // Stage: variables score/lives, L4 scripts.
        const stageTj = JSON.parse(await readFile(join(stageDir, 'target.json'), 'utf8'));
        stageTj.variables = [
            { name: 'score', id: 'var-score', value: 0 },
            { name: 'lives', id: 'var-lives', value: 3 },
        ];
        await writeFile(join(stageDir, 'target.json'), JSON.stringify(stageTj, null, 2) + '\n');
        await writeFile(join(stageDir, 'scripts.sb'), await readFile(join(here, 'l4-Stage.sb'), 'utf8'));
        // Player / Bullet / Enemy from the Sprite1 template.
        const defs = [
            ['Player', 'l4-Player.sb', 'ship', SHIP_SVG, 15, 15],
            ['Bullet', 'l4-Bullet.sb', 'bullet', BULLET_SVG, 5, 5],
            ['Enemy', 'l4-Enemy.sb', 'enemy', ENEMY_SVG, 20, 9],
        ];
        const { cp, rm: rmf } = await import('node:fs/promises');
        for (const [name, src, costume, svg, cx, cy] of defs) {
            const tdir = name === 'Player' ? spriteDir : join(dir, name);
            if (name !== 'Player') await cp(spriteDir, tdir, { recursive: true });
            const tj = JSON.parse(await readFile(join(tdir, 'target.json'), 'utf8'));
            tj.name = name;
            tj.variables = [];
            tj.lists = [];
            tj.broadcasts = [];
            tj.costumes = [{ name: costume, bitmapResolution: 1, rotationCenterX: cx, rotationCenterY: cy, file: `costumes/${costume}.svg` }];
            tj.sounds = [{ ...popMeta, name: 'pop', file: 'sounds/pop.wav' }];
            await writeFile(join(tdir, 'target.json'), JSON.stringify(tj, null, 2) + '\n');
            await writeFile(join(tdir, `costumes/${costume}.svg`), svg);
            await mkdir(join(tdir, 'sounds'), { recursive: true }).catch(() => {});
            await writeFile(join(tdir, 'sounds/pop.wav'), Buffer.from(popBytes));
            // Remove the template costume file if orphaned.
            try {
                for (const e of readdirSync(join(tdir, 'costumes'))) {
                    if (e !== `${costume}.svg`) await rmf(join(tdir, 'costumes', e));
                }
            } catch {}
            await writeFile(join(tdir, 'scripts.sb'), await readFile(join(here, src), 'utf8'));
        }
        // Drop the original Sprite1 template dir (Player took its place).
        const out = join(here, 'l4.sb3');
        const r = await packDir(dir, out, scratchblocks);
        const errs = r.diagnostics.filter((d) => d.severity === 'error');
        if (errs.length) throw new Error(`L4 pack errors: ${JSON.stringify(errs)}`);
        check(out);
        // Probe: 1800 frames holding space; score should rise, clones bounded.
        const input = join(dir, 'input.json');
        await writeFile(input, JSON.stringify([{ frame: 0, type: 'keydown', key: 'space' }]));
        const runOut = execFileSync(process.execPath, [CLI, 'run', out, '--frames', '1800', '--input', input, '--seed', '1'], {
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
        });
        const run = JSON.parse(runOut);
        if (!run.ok) throw new Error(`L4 run failed: ${runOut.slice(0, 500)}`);
        const stage = run.targets.find((t) => t.name === 'Stage');
        const score = stage.variables?.score ?? stage.variables?.['score'];
        const cloneCounts = run.clones ?? {};
        const clones = Object.values(cloneCounts).reduce((a, b) => a + b, 0);
        console.log(`L4 after 1800 frames: score=${JSON.stringify(score)} clones=${clones} byType=${JSON.stringify(cloneCounts)}`);
        if (typeof score === 'number' && score < 1) throw new Error(`L4 probe: score == ${score}, want >= 1`);
        if (clones >= 100) throw new Error(`L4 probe: clones == ${clones}, want < 100`);
        // Peak check mid-run (active play; game over clears everything later).
        const midOut = execFileSync(process.execPath, [CLI, 'run', out, '--frames', '200', '--input', input, '--seed', '1'], {
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
        });
        const mid = JSON.parse(midOut);
        const midCounts = mid.clones ?? {};
        const midTotal = Object.values(midCounts).reduce((a, b) => a + b, 0);
        console.log(`L4 at 200 frames: clones=${midTotal} byType=${JSON.stringify(midCounts)}`);
        if (midTotal >= 100) throw new Error(`L4 probe: mid-run clones == ${midTotal}, want < 100`);
        console.log('L4 ok');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

const build = process.argv[2] || 'all';
if (build === 'all' || build === 'l1') await buildL1();
if (build === 'all' || build === 'l4') await buildL4();
