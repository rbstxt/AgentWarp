/**
 * Stable anchors: re-unpacking a project whose previous anchors.json is
 * available keeps the existing label for every id that still exists (scripts
 * and comments); new ids get the next free numbers; deleted labels are never
 * reused. Reading order of the file stays spatial.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unpackInto } from '../project-dir.ts';
import { irJson, freshDir, readJson, tinyProject, nid } from './lifecycle-helpers.ts';

function srcAnchors(scripts: any[]): Map<string, string> {
    const m = new Map<string, string>();
    const visit = (b: any): void => {
        if (!b) return;
        if (b.comment?.srcId) m.set(b.comment.srcId, b.comment.anchor);
        for (const inp of Object.values<any>(b.inputs ?? {})) {
            if ((inp.kind === 'block' || inp.kind === 'stack') && inp.block) visit(inp.block);
        }
        visit(b.next);
    };
    for (const s of scripts) {
        if (s.srcId) m.set(s.srcId, s.anchor);
        if (s.comment?.srcId) m.set(s.comment.srcId, s.comment.anchor);
        visit(s.top);
    }
    return m;
}

test('stable anchors: human moves scripts around, labels unchanged', async () => {
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        // Add a workspace comment to Cat so comments are covered too.
        const catT = project.targets.find((t: any) => t.name === 'Cat');
        catT.comments = {
            wc1: { blockId: null, x: 10, y: 300, width: 200, height: 200, minimized: false, text: 'note' },
        };
        // A second script in another column, so moves change reading order.
        catT.blocks['second-top-00000001'] = {
            opcode: 'event_whenkeypressed',
            next: null,
            parent: null,
            inputs: {},
            fields: { KEY_OPTION: ['a', null] },
            shadow: false,
            topLevel: true,
            x: 10,
            y: 10,
        };
        await unpackInto(project, files, dir, irJson);
        const anchorsBefore = await readJson(join(dir, '.agentwarp', 'anchors.json'));
        const scriptsBefore = srcAnchors(await readJson(join(dir, 'Cat', 'scripts.json')));
        // Human move: swap the two scripts' columns + move the comment.
        const moved = structuredClone(project);
        const cat = moved.targets.find((t: any) => t.name === 'Cat');
        const tops = Object.entries<any>(cat.blocks).filter(([, b]) => b?.topLevel === true);
        assert.equal(tops.length, 2);
        const [idA, bA] = tops[0];
        const [idB, bB] = tops[1];
        const ax = bA.x;
        bA.x = bB.x;
        bB.x = ax;
        cat.comments.wc1.x = 500;
        cat.comments.wc1.y = 10;
        const r = await unpackInto(moved, files, dir, irJson);
        assert.deepEqual(r.diagnostics.filter((d) => d.severity === 'error'), []);
        const anchorsAfter = await readJson(join(dir, '.agentwarp', 'anchors.json'));
        assert.deepEqual(anchorsAfter.Cat, anchorsBefore.Cat);
        // The scripts file reordered spatially but anchors per id are identical.
        const scriptsAfter = srcAnchors(await readJson(join(dir, 'Cat', 'scripts.json')));
        assert.deepEqual([...scriptsAfter.entries()].sort(), [...scriptsBefore.entries()].sort());
        void idA;
        void idB;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('stable anchors: new ids get max+1, deleted labels never reused', async () => {
    const dir = await freshDir();
    try {
        const { project, files } = tinyProject();
        await unpackInto(project, files, dir, irJson);
        const anchorsBefore = await readJson(join(dir, '.agentwarp', 'anchors.json'));
        const maxA = Math.max(
            ...Object.keys(anchorsBefore.Cat)
                .map((a) => /^a(\d+)$/.exec(a)?.[1])
                .filter(Boolean)
                .map(Number),
        );
        const catAnchorOf = (id: string): string | undefined =>
            Object.entries<string>(anchorsBefore.Cat).find(([, v]) => v === id)?.[0];
        // Delete the Cat top-level script, add a brand-new one.
        const changed = structuredClone(project);
        const cat = changed.targets.find((t: any) => t.name === 'Cat');
        const topId = Object.keys(cat.blocks).find((id) => cat.blocks[id].topLevel === true);
        assert.ok(topId);
        const deletedLabel = catAnchorOf(topId);
        assert.ok(deletedLabel);
        delete cat.blocks[topId];
        for (const id of Object.keys(cat.blocks)) {
            if (cat.blocks[id].parent === topId) delete cat.blocks[id];
        }
        const newTop = nid('brand-new');
        cat.blocks[newTop] = {
            opcode: 'event_whenkeypressed',
            next: null,
            parent: null,
            inputs: {},
            fields: { KEY_OPTION: ['space', null] },
            shadow: false,
            topLevel: true,
            x: 700,
            y: 10,
        };
        await unpackInto(changed, files, dir, irJson);
        const anchorsAfter = await readJson(join(dir, '.agentwarp', 'anchors.json'));
        // Deleted label is gone and not reused...
        assert.ok(!(deletedLabel as string in anchorsAfter.Cat));
        // ...the new script got the next free number.
        assert.equal(anchorsAfter.Cat[`a${maxA + 1}`], newTop);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
