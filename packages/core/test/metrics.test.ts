/**
 * Metrics validation: every top-level script in every calibration fixture is
 * measured with metrics.ts and compared against the editor ground truth
 * (eval/calibration/*.measured.json, getHeightWidth per script).
 *
 * Thresholds: height exact (err < 0.005) for >= 95% of scripts, and width
 * mean absolute error < 3 units.
 *
 * Run: node --test packages/core/test/ (from the repo root).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {measureScript} from '../metrics.ts';
import {readSb3Json} from './zip.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const FIXTURES: Array<{sb3: string; measured: string}> = [
    {sb3: 'tools/vmrun/test-fixtures/click.sb3', measured: 'eval/calibration/click.measured.json'},
    {sb3: 'tools/vmrun/test-fixtures/clones.sb3', measured: 'eval/calibration/clones.measured.json'},
    {sb3: 'tools/vmrun/test-fixtures/greenflag.sb3', measured: 'eval/calibration/greenflag.measured.json'},
    {sb3: 'tools/vmrun/test-fixtures/keys.sb3', measured: 'eval/calibration/keys.measured.json'},
    {sb3: 'tools/vmrun/test-fixtures/touch.sb3', measured: 'eval/calibration/touch.measured.json'},
    {sb3: 'eval/fixtures/lightcube-134430880.sb3', measured: 'eval/calibration/lightcube-134430880.measured.json'},
    {sb3: 'eval/fixtures/platformer-853110869.sb3', measured: 'eval/calibration/platformer-853110869.measured.json'},
    {sb3: 'eval/fixtures/scrolltutorial-378587848.sb3', measured: 'eval/calibration/scrolltutorial-378587848.measured.json'},
];

interface MeasuredScript {id: string; opcode: string; w: number; h: number}

test('script sizes match editor ground truth', () => {
    const widthErrs: number[] = [];
    const heightErrs: number[] = [];
    let heightExact = 0;
    let total = 0;
    let missing = 0;
    const rows: string[] = [];
    for (const f of FIXTURES) {
        const sb3 = path.join(REPO, f.sb3);
        const mpath = path.join(REPO, f.measured);
        if (!existsSync(sb3) || !existsSync(mpath)) {
            rows.push(`${f.sb3}: MISSING INPUT`);
            continue;
        }
        const project = readSb3Json(sb3) as {targets: Array<{name: string; blocks: Record<string, unknown>; comments?: unknown}>};
        const measured = JSON.parse(readFileSync(mpath, 'utf8')) as {targets: Array<{name: string; scripts: MeasuredScript[]}>};
        const fw: number[] = [];
        const fh: number[] = [];
        const fmiss: string[] = [];
        for (const mt of measured.targets) {
            const pt = project.targets.find(t => t.name === mt.name);
            if (!pt) {
                fmiss.push(`target ${mt.name}`);
                continue;
            }
            for (const s of mt.scripts) {
                const blk = pt.blocks[s.id] as Record<string, unknown> | undefined;
                if (!blk || Array.isArray(blk) || (blk['parent'] as unknown) !== null && (blk['parent'] as unknown) !== undefined) {
                    // Compact-array reporters (data_variable stored as [name,...])
                    // have no geometry in project.json; skip like analyze.mjs.
                    if (!blk || Array.isArray(blk)) {
                        missing++;
                        continue;
                    }
                }
                const m = measureScript(pt.blocks as Record<string, Record<string, unknown>>, s.id);
                const we = Math.abs(m.width - s.w);
                const he = Math.abs(m.height - s.h);
                fw.push(we);
                fh.push(he);
                widthErrs.push(we);
                heightErrs.push(he);
                total++;
                if (he < 0.005) heightExact++;
                if (he >= 0.005 || we >= 3) fmiss.push(`${mt.name}:${s.id.slice(0, 8)} ${s.opcode} werr=${we.toFixed(2)} herr=${he.toFixed(2)} est=${m.width.toFixed(1)}x${m.height.toFixed(1)} exp=${s.w.toFixed(1)}x${s.h.toFixed(1)}`);
            }
        }
        const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        const max = (a: number[]) => (a.length ? Math.max(...a) : 0);
        rows.push(`${f.sb3}: n=${fw.length} width mean/max=${mean(fw).toFixed(2)}/${max(fw).toFixed(2)} height mean/max=${mean(fh).toFixed(2)}/${max(fh).toFixed(2)}`);
        for (const m of fmiss.slice(0, 12)) rows.push(`    MISS/ERR ${m}`);
    }
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const max = (a: number[]) => (a.length ? Math.max(...a) : 0);
    rows.push(`TOTAL n=${total} missing=${missing} heightExact=${heightExact} (${(100 * heightExact / Math.max(1, total)).toFixed(1)}%) width mean/max=${mean(widthErrs).toFixed(2)}/${max(widthErrs).toFixed(2)} height mean/max=${mean(heightErrs).toFixed(2)}/${max(heightErrs).toFixed(2)}`);
    console.log(rows.join('\n'));
    assert.ok(total > 200, `expected >200 matched scripts, got ${total}`);
    assert.ok(heightExact / total >= 0.95, `height exact fraction ${heightExact / total}`);
    assert.ok(mean(widthErrs) < 3, `width mean abs error ${mean(widthErrs)}`);
});
