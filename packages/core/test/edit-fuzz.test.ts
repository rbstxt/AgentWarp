// For every script of real projects: make a one-block edit inside it (as a text format would deliver it:
// no srcIds), pack, and require that exactly that script changed, nothing else moved/changed/vanished,
// and no comment was lost.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packDir, unpackSb3} from '../project-dir.ts';
import {loadSb3File} from '../sb3.ts';
import {irJson} from '../../../formats/ir-json/index.ts';
// @ts-ignore plain JS helper
import {diffProjects} from '../../../tools/vmrun/lib/diff.mjs';

const ROOT = join(import.meta.dirname, '../../..');
const FIXTURES = ['scrolltutorial-378587848', 'platformer-853110869', 'lightcube-134430880'];

function strip(o: any): any {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') {
        const r: any = {};
        for (const [k, v] of Object.entries(o)) if (k !== 'srcId' && k !== 'loc') r[k] = strip(v);
        return r;
    }
    return o;
}

/** Insert `move (0) steps` after the deepest-first statement that has a next, to touch nested structure. */
function editScript(script: any): boolean {
    let target: any = null;
    const visit = (b: any): void => {
        if (!b) return;
        if (b.next && b.opcode !== 'procedures_prototype') target = b;
        for (const inp of Object.values<any>(b.inputs ?? {})) if (inp?.kind === 'stack') visit(inp.block);
        visit(b.next);
    };
    visit(script.top);
    if (!target) {
        if (!script.top || script.kind !== 'stack' || !script.top.next) return false;
        target = script.top;
    }
    target.next = {opcode: 'motion_movesteps', inputs: {STEPS: {kind: 'literal', value: 0}}, fields: {}, next: target.next};
    return true;
}

for (const fx of FIXTURES) {
    test(`edit fuzz: ${fx}`, async () => {
        const src = join(ROOT, 'eval/fixtures', fx + '.sb3');
        const orig = (await loadSb3File(src)).project;
        const dir = await mkdtemp(join(tmpdir(), 'aw-fuzz-'));
        let edits = 0;
        try {
            await unpackSb3(src, dir, irJson);
            const targets = (await readdir(dir, {withFileTypes: true})).filter(e => e.isDirectory() && !e.name.startsWith('.'));
            // Pristine stripped copies of every scripts file.
            const pristine = new Map<string, any[]>();
            for (const t of targets) pristine.set(t.name, strip(JSON.parse(await readFile(join(dir, t.name, 'scripts.json'), 'utf8'))));
            for (const t of targets) await writeFile(join(dir, t.name, 'scripts.json'), JSON.stringify(pristine.get(t.name)));
            for (const t of targets) {
                const scripts = pristine.get(t.name)!;
                for (let i = 0; i < scripts.length; i++) {
                    const edited = structuredClone(scripts);
                    if (!editScript(edited[i])) continue;
                    await writeFile(join(dir, t.name, 'scripts.json'), JSON.stringify(edited));
                    const out = join(dir, 'out.sb3');
                    const r = await packDir(dir, out, irJson);
                    await writeFile(join(dir, t.name, 'scripts.json'), JSON.stringify(scripts));
                    const errs = r.diagnostics.filter(d => d.severity === 'error');
                    assert.deepEqual(errs, [], `${t.name} script ${i}: pack errors`);
                    const d = diffProjects(orig, (await loadSb3File(out)).project).summary;
                    const ctx = `${fx} / ${t.name} / script ${i} (${edited[i].anchor ?? '?'})`;
                    assert.equal(d.changed, 1, `${ctx}: changed=${d.changed}`);
                    assert.equal(d.moved + d.deleted + d.added, 0, `${ctx}: moved/deleted/added ${JSON.stringify(d)}`);
                    assert.equal(d.commentsLost + d.commentsChanged, 0, `${ctx}: comments ${JSON.stringify(d)}`);
                    edits++;
                }
            }
            assert.ok(edits > 5, `only ${edits} scripts edited`);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
}

for (const fx of FIXTURES) {
    test(`new script inserted at file start does not disturb others: ${fx}`, async () => {
        const src = join(ROOT, 'eval/fixtures', fx + '.sb3');
        const orig = (await loadSb3File(src)).project;
        const dir = await mkdtemp(join(tmpdir(), 'aw-fuzz-'));
        try {
            await unpackSb3(src, dir, irJson);
            const targets = (await readdir(dir, {withFileTypes: true})).filter(e => e.isDirectory() && !e.name.startsWith('.'));
            for (const t of targets) {
                const p = join(dir, t.name, 'scripts.json');
                const scripts = strip(JSON.parse(await readFile(p, 'utf8')));
                scripts.unshift({kind: 'stack', top: {opcode: 'event_whenkeypressed', inputs: {}, fields: {KEY_OPTION: {value: 'z'}},
                    next: {opcode: 'looks_say', inputs: {MESSAGE: {kind: 'literal', value: 'new'}}, fields: {}}}});
                // also reverse the order of the remaining scripts: order in the file must not matter
                const rest = scripts.splice(1).reverse();
                await writeFile(p, JSON.stringify([scripts[0], ...rest]));
            }
            const out = join(dir, 'out.sb3');
            const r = await packDir(dir, out, irJson);
            assert.deepEqual(r.diagnostics.filter(d => d.severity === 'error'), []);
            const d = diffProjects(orig, (await loadSb3File(out)).project).summary;
            assert.equal(d.changed + d.moved + d.deleted + d.commentsLost + d.commentsChanged, 0, JSON.stringify(d));
            assert.equal(d.added, targets.length);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
}
