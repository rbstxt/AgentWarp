/**
 * Project switching (the user opens another project in TurboWarp): POST /switch.sb3.
 * Run: node --test "packages/bridge/test/*.test.ts"   (from the repo root)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { unpackSb3 } from '../../core/project-dir.ts';
import { scratchblocks } from '../../../formats/scratchblocks/index.ts';
import { startServe } from '../server.ts';
import { projectFingerprint } from '../fingerprint.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE = join(root, 'eval', 'fixtures', 'scrolltutorial-378587848.sb3');

async function sb3With(mutate: (p: any) => void): Promise<Buffer> {
    const zip = await JSZip.loadAsync(await readFile(FIXTURE));
    const project = JSON.parse(await zip.file('project.json')!.async('string'));
    mutate(project);
    zip.file('project.json', JSON.stringify(project));
    return zip.generateAsync({ type: 'nodebuffer' });
}

test('fingerprint ignores runtime state but sees project changes', async () => {
    const zip = await JSZip.loadAsync(await readFile(FIXTURE));
    const p = JSON.parse(await zip.file('project.json')!.async('string'));
    const moved = structuredClone(p);
    for (const t of moved.targets) { if (!t.isStage) { t.x = (t.x ?? 0) + 50; t.currentCostume = 0; } }
    assert.equal(projectFingerprint(moved), projectFingerprint(p));
    const edited = structuredClone(p);
    const t = edited.targets.find((x: any) => !x.isStage);
    t.blocks.newBlockId = { opcode: 'motion_movesteps', next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0 };
    assert.notEqual(projectFingerprint(edited), projectFingerprint(p));
});

test('/switch.sb3: same project -> same:true; another project -> onSwitch; no hook -> 404', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aw-switch-'));
    let switched: { size: number; title: string } | null = null;
    await unpackSb3(FIXTURE, dir, scratchblocks);
    await writeFile(join(dir, '.agentwarp', 'format'), 'scratchblocks\n');
    const bridge = await startServe(dir, { onSwitch: (sb3, title) => { switched = { size: sb3.length, title }; } });
    const plain = await startServe(dir, {});
    try {
        const url = (b: typeof bridge, title: string) => `http://127.0.0.1:${b.port}/switch.sb3?token=${b.token}&title=${encodeURIComponent(title)}`;
        // The editor holds the workspace's project (sprite moved at runtime): no switch.
        const same = await fetch(url(bridge, 'whatever'), { method: 'POST', body: await sb3With((p) => { for (const t of p.targets) if (!t.isStage) t.x = 123; }) });
        assert.equal(same.status, 200);
        const sj: any = await same.json();
        assert.equal(sj.same, true);
        assert.equal(typeof sj.rev, 'number');
        assert.equal(switched, null);
        // A different project: the owner is asked to switch.
        const other = await fetch(url(bridge, 'My Game'), { method: 'POST', body: await sb3With((p) => { p.targets.find((t: any) => !t.isStage).name = 'Hero'; }) });
        assert.equal(other.status, 200);
        assert.equal(((await other.json()) as any).switching, true);
        for (let i = 0; i < 50 && !switched; i++) await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual((switched as any)?.title, 'My Game');
        // Not an sb3.
        assert.equal((await fetch(url(bridge, 'x'), { method: 'POST', body: 'hello' })).status, 400);
        // A bridge without the hook refuses (the client then keeps the user's project).
        assert.equal((await fetch(url(plain, 'x'), { method: 'POST', body: await sb3With(() => {}) })).status, 404);
    } finally {
        await bridge.close();
        await plain.close();
        await rm(dir, { recursive: true, force: true });
    }
});
