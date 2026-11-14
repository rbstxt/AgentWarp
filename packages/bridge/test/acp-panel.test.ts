/**
 * Panel v2 (P7 §5 + §6) bridge tests: checkpoints + restore, change
 * summaries (live + final), sessions, set-mode errors, /client.js fallback
 * and /file path rules — through a real bridge with the fake ACP agent.
 * (The TurnStore diff shape against stubs is covered in packages/acp/test.)
 *
 * Run: node --test "packages/bridge/test/*.test.ts"   (from the repo root)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { unpackSb3 } from '../../core/project-dir.ts';
import { scratchblocks } from '../../../formats/scratchblocks/index.ts';
import { startServe, type BridgeHandle } from '../server.ts';

process.env.AGENTWARP_BRIDGE_DEBOUNCE_MS = '80';
process.env.AGENTWARP_BRIDGE_VERIFY_DELAY_MS = '150';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const FIXTURE = join(root, 'eval', 'fixtures', 'scrolltutorial-378587848.sb3');
const FAKE_AGENT = join(root, 'packages', 'acp', 'test', 'fake-agent.ts');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean | Promise<boolean>, timeout: number, label: string): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        if (await fn()) return;
        await sleep(25);
    }
    throw new Error(`timeout waiting for: ${label}`);
}

class AcpClient {
    ws!: WebSocket;
    messages: any[] = [];
    loads: number[] = [];

    async connect(base: string, token: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.ws = new WebSocket(`${base}/ws?token=${token}`);
            this.ws.on('message', (d) => {
                let m: any;
                try {
                    m = JSON.parse(String(d));
                } catch {
                    return;
                }
                this.messages.push(m);
                if (m.type === 'load') this.loads.push(m.rev);
            });
            this.ws.on('open', () => resolve());
            this.ws.on('error', reject);
        });
        await waitFor(() => this.messages.some((m) => m.type === 'hello'), 5000, 'hello');
    }

    send(obj: unknown): void {
        this.ws.send(JSON.stringify(obj));
    }

    find(pred: (m: any) => boolean): any | undefined {
        return this.messages.find(pred);
    }

    close(): void {
        try {
            this.ws.close();
        } catch {
            /* ignore */
        }
    }
}

interface Setup {
    dir: string;
    bridge: BridgeHandle;
    client: AcpClient;
    base: string;
    scriptsFile: string;
}

async function setup(fakeEnv: Record<string, string> = {}): Promise<Setup> {
    const dir = await mkdtemp(join(tmpdir(), 'aw-bridge-panel-'));
    await unpackSb3(FIXTURE, dir, scratchblocks);
    await writeFile(join(dir, '.agentwarp', 'format'), 'scratchblocks\n');
    await writeFile(
        join(dir, '.agentwarp', 'agents.json'),
        JSON.stringify({ agents: [{ id: 'fake', label: 'Fake', command: process.execPath, args: [FAKE_AGENT], env: fakeEnv }] }),
    );
    const bridge = await startServe(dir, {});
    const base = `ws://127.0.0.1:${bridge.port}`;
    const client = new AcpClient();
    await client.connect(base, bridge.token);
    return { dir, bridge, client, base, scriptsFile: join(dir, 'player', 'scripts.sb') };
}

async function teardown(s: Setup): Promise<void> {
    s.client.close();
    await s.bridge.close();
    await rm(s.dir, { recursive: true, force: true });
}

async function startSession(s: Setup): Promise<string> {
    s.client.send({ type: 'acp/start', agentId: 'fake' });
    await waitFor(() => !!s.client.find((m) => m.type === 'acp/session'), 15000, 'acp/session');
    return s.client.find((m) => m.type === 'acp/session').sessionId;
}

function httpBase(s: Setup): string {
    return s.base.replace(/^ws/, 'http');
}

/** Split scratchblocks text into per-script chunks (header + body). */
function splitChunks(text: string): string[] {
    const lines = text.split('\n');
    const chunks: string[][] = [];
    for (const line of lines) {
        if (line.startsWith('@') && (chunks.length === 0 || chunks[chunks.length - 1].length > 0)) {
            chunks.push([]);
        }
        if (chunks.length === 0) chunks.push([]);
        chunks[chunks.length - 1].push(line);
    }
    return chunks.map((c) => c.join('\n')).filter((c) => c.trim() !== '');
}

test('checkpoint + restore round trip (text restored, editor gets a load)', async () => {
    const s = await setup();
    try {
        const sessionId = await startSession(s);
        s.client.send({ type: 'acp/prompt', sessionId, text: 'hi' });
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/turn-start'), 15000, 'acp/turn-start');
        const turnId = s.client.find((m) => m.type === 'acp/turn-start').turnId;
        const snapRev = s.client.find((m) => m.type === 'acp/turn-start').rev;
        assert.equal(snapRev, 0);
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/done'), 15000, 'acp/done');
        const orig = await readFile(s.scriptsFile, 'utf8');
        assert.match(orig, /\["10"\]/);
        const revBefore = JSON.parse(await readFile(join(s.dir, '.agentwarp', 'checkpoints', sessionId, turnId, 'rev.json'), 'utf8')).rev;
        assert.equal(revBefore, 0);

        // Agent edit after the checkpoint.
        await writeFile(s.scriptsFile, orig.replace('["10"]', '["101"]'));
        await waitFor(() => s.client.loads.length >= 1, 8000, 'load after agent edit');
        assert.match(await readFile(s.scriptsFile, 'utf8'), /\["101"\]/);

        // Restore the checkpoint: text goes back, bridge cycle pushes a load.
        const loadsBefore = s.client.loads.length;
        s.client.send({ type: 'acp/restore', sessionId, turnId });
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/restored'), 15000, 'acp/restored');
        const restored = s.client.find((m) => m.type === 'acp/restored');
        assert.equal(restored.sessionId, sessionId);
        assert.equal(restored.turnId, turnId);
        assert.equal(restored.rev, 0);
        await waitFor(() => s.client.loads.length >= loadsBefore + 1, 8000, 'load after restore');
        const after = await readFile(s.scriptsFile, 'utf8');
        assert.match(after, /\["10"\]/, 'text restored');
        assert.doesNotMatch(after, /\["101"\]/, 'post-checkpoint edit gone');
    } finally {
        await teardown(s);
    }
});

test('restore refused while a turn is running', async () => {
    const s = await setup({ FAKE_ACP_MODE: 'slow' });
    try {
        const sessionId = await startSession(s);
        s.client.send({ type: 'acp/prompt', sessionId, text: 'take your time' });
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/turn-start'), 15000, 'acp/turn-start');
        s.client.send({ type: 'acp/restore', sessionId, turnId: 't1' });
        await waitFor(
            () => !!s.client.find((m) => m.type === 'acp/error' && /running/.test(String(m.message))),
            8000,
            'restore refused',
        );
        s.client.send({ type: 'acp/cancel', sessionId });
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/done'), 20000, 'cancelled done');
    } finally {
        await teardown(s);
    }
});

test('change summary: added/changed/deleted, live (final:false) then final:true', async () => {
    const s = await setup({ FAKE_ACP_MODE: 'slow' });
    try {
        const sessionId = await startSession(s);
        s.client.send({ type: 'acp/prompt', sessionId, text: 'edit things' });
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/turn-start'), 15000, 'acp/turn-start');
        const turnId = s.client.find((m) => m.type === 'acp/turn-start').turnId;

        // Three edits to three different scripts: change one, delete one, add one.
        const text = await readFile(s.scriptsFile, 'utf8');
        const chunks = splitChunks(text);
        assert.ok(chunks.length >= 3, `need >= 3 scripts, got ${chunks.length}`);
        const changedIdx = chunks.findIndex((c) => c.includes('change player x by ["10"]'));
        assert.ok(changedIdx >= 0, 'found the change-player-x script');
        const deletedIdx = chunks.findIndex((c, i) => i !== changedIdx && c.split('\n').length > 3);
        assert.ok(deletedIdx >= 0, 'found a script to delete');
        const deletedFirstLine = chunks[deletedIdx].split('\n').find((l) => l.trim() !== '' && !l.startsWith('@'));
        assert.ok(deletedFirstLine, 'deleted chunk has a code line');
        const kept = chunks.filter((_, i) => i !== deletedIdx);
        kept[changedIdx > deletedIdx ? changedIdx - 1 : changedIdx] = kept[changedIdx > deletedIdx ? changedIdx - 1 : changedIdx].replace(
            'change player x by ["10"]',
            'change player x by ["101"]',
        );
        const next = `${kept.join('\n')}\n@tmp\nwhen [space v] key pressed\nmove (99) steps\n`;
        await writeFile(s.scriptsFile, next);

        // Live summary after the bridge cycle (debounced ~1 s), final:false.
        await waitFor(
            () => !!s.client.find((m) => m.type === 'acp/changes' && m.final === false),
            20000,
            'live changes',
        );
        const live = s.client.find((m) => m.type === 'acp/changes' && m.final === false);
        assert.equal(live.sessionId, sessionId);
        assert.equal(live.turnId, turnId);
        const player = live.targets.find((t: any) => t.name === 'player');
        assert.ok(player, 'player target present');
        const byStatus = new Map<string, any[]>();
        for (const sc of player.scripts) {
            const list = byStatus.get(sc.status) ?? [];
            list.push(sc);
            byStatus.set(sc.status, list);
        }
        assert.ok((byStatus.get('added') ?? []).length >= 1, 'added script');
        assert.ok((byStatus.get('changed') ?? []).length >= 1, 'changed script');
        assert.ok((byStatus.get('deleted') ?? []).length >= 1, 'deleted script');
        for (const sc of player.scripts) {
            assert.ok(typeof sc.topBlockId === 'string' && sc.topBlockId, 'topBlockId');
            assert.match(String(sc.anchor), /^a\d+$/, 'anchor');
            assert.match(sc.label, /·/, 'label has hat summary + block count');
            assert.ok(sc.scratchblocks.length > 0, 'scratchblocks printed');
            assert.ok(String(sc.file).endsWith('scripts.sb'), `file in text dir: ${sc.file}`);
            assert.equal(typeof sc.line, 'number', 'line number');
            assert.ok((sc.line as number) >= 1, 'line >= 1');
        }
        const changed = (byStatus.get('changed') ?? [])[0];
        assert.match(changed.scratchblocks, /101/, 'changed script shows the new literal');
        const deleted = (byStatus.get('deleted') ?? [])[0];
        assert.ok(
            deleted.scratchblocks.includes(String(deletedFirstLine).trim()),
            'deleted script printed from the checkpoint version',
        );
        const added = (byStatus.get('added') ?? [])[0];
        assert.match(added.scratchblocks, /move \(99\) steps/, 'added script printed');

        // End the turn: final summary (final:true).
        s.client.send({ type: 'acp/cancel', sessionId });
        await waitFor(
            () => !!s.client.find((m) => m.type === 'acp/changes' && m.final === true),
            20000,
            'final changes',
        );
        const fin = s.client.find((m) => m.type === 'acp/changes' && m.final === true);
        assert.equal(fin.turnId, turnId);
        const finPlayer = fin.targets.find((t: any) => t.name === 'player');
        const finStatuses = new Set(finPlayer.scripts.map((x: any) => x.status));
        assert.ok(finStatuses.has('added') && finStatuses.has('changed') && finStatuses.has('deleted'));
    } finally {
        await teardown(s);
    }
});

test('sessions list over the bridge', async () => {
    const s = await setup();
    try {
        const sessionId = await startSession(s);
        s.client.send({ type: 'acp/prompt', sessionId, text: 'bridge history check' });
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/done'), 15000, 'acp/done');
        s.client.send({ type: 'acp/sessions' });
        await waitFor(() => !!s.client.find((m) => m.type === 'acp/sessions'), 8000, 'acp/sessions');
        const list = s.client.find((m) => m.type === 'acp/sessions').list;
        assert.equal(list.length, 1);
        assert.equal(list[0].sessionId, sessionId);
        assert.equal(list[0].agentId, 'fake');
        assert.match(list[0].title, /bridge history check/);
    } finally {
        await teardown(s);
    }
});

test('/client.js falls back to the plain sync client', async () => {
    const s = await setup();
    try {
        const r = await fetch(`${httpBase(s)}/client.js?token=${s.bridge.token}`);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('content-type'), 'text/javascript');
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const body = await r.text();
        assert.ok(body.length > 1000, 'serves a real bundle');
        // The panel bundle (built in parallel by another agent) wins when it
        // exists; otherwise the bridge serves the plain sync client verbatim.
        let panelDistExists = false;
        try {
            await stat(join(root, 'packages', 'panel', 'dist', 'agentwarp-client.js'));
            panelDistExists = true;
        } catch {
            /* not built yet */
        }
        if (!panelDistExists) {
            const fallback = await readFile(join(root, 'packages', 'bridge', 'client', 'agentwarp-client.js'), 'utf8');
            assert.equal(body, fallback);
        }
    } finally {
        await teardown(s);
    }
});

test('turn store: snapshot/restore round trip and last-50 pruning (unit)', async () => {
    const { createFsTurnStore } = await import('../checkpoints.ts');
    const { irJson } = await import('../../../formats/ir-json/index.ts');
    const dir = await mkdtemp(join(tmpdir(), 'aw-turnstore-'));
    try {
        await mkdir(join(dir, 'Cat'), { recursive: true });
        await writeFile(join(dir, 'agentwarp.json'), JSON.stringify({ formatVersion: 1 }) + '\n');
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify({ name: 'Cat' }) + '\n');
        await writeFile(join(dir, 'Cat', 'scripts.json'), '[]\n');
        await mkdir(join(dir, '.agentwarp'), { recursive: true });
        await writeFile(join(dir, '.agentwarp', 'base.json'), JSON.stringify({ targets: [] }));
        let rev = 3;
        const store = createFsTurnStore({ dir, format: irJson, getRev: () => rev, getBase: () => ({ targets: [] }) });
        await store.snapshot('s1', 't1');
        await writeFile(join(dir, 'Cat', 'scripts.json'), '[{"x":1}]\n');
        assert.equal(await store.restore('s1', 't1'), 3);
        assert.equal(await readFile(join(dir, 'Cat', 'scripts.json'), 'utf8'), '[]\n');
        // Unknown turn rejects.
        await assert.rejects(() => store.restore('s1', 'nope'), /unknown checkpoint/);
        await assert.rejects(() => store.diff('s1', 'nope'), /unknown checkpoint/);
        // 52 snapshots keep the last 50.
        for (let i = 0; i < 52; i++) {
            rev = 10 + i;
            await store.snapshot('s1', `t${i}`);
            await sleep(2);
        }
        const { readdir } = await import('node:fs/promises');
        const turns = await readdir(join(dir, '.agentwarp', 'checkpoints', 's1'));
        assert.equal(turns.length, 50);
        assert.ok(!turns.includes('t1'), 'oldest pruned');
        assert.ok(turns.includes('t51'), 'newest kept');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('turn store: only project text is snapshotted/restored; ids are validated (unit)', async () => {
    const { createFsTurnStore } = await import('../checkpoints.ts');
    const { irJson } = await import('../../../formats/ir-json/index.ts');
    const dir = await mkdtemp(join(tmpdir(), 'aw-turnstore2-'));
    try {
        await mkdir(join(dir, 'Cat'), { recursive: true });
        await writeFile(join(dir, 'agentwarp.json'), '{}\n');
        await writeFile(join(dir, 'Cat', 'target.json'), JSON.stringify({ name: 'Cat' }) + '\n');
        await writeFile(join(dir, 'Cat', 'scripts.json'), '[]\n');
        await mkdir(join(dir, '.git'), { recursive: true });
        await writeFile(join(dir, '.git', 'HEAD'), 'ref: a\n');
        await mkdir(join(dir, 'tests'), { recursive: true });
        await writeFile(join(dir, 'tests', 'a.test.json'), 'v1');
        await mkdir(join(dir, '.agentwarp'), { recursive: true });
        const store = createFsTurnStore({ dir, format: irJson, getRev: () => 1, getBase: () => ({ targets: [] }) });
        await store.snapshot('s1', 't1');
        const { readdir } = await import('node:fs/promises');
        const snap = await readdir(join(dir, '.agentwarp', 'checkpoints', 's1', 't1'));
        assert.ok(!snap.includes('.git') && !snap.includes('tests'), `snapshot holds only project text: ${snap}`);
        // Work after the checkpoint: git moves on, a test is edited, a sprite is added.
        await writeFile(join(dir, '.git', 'HEAD'), 'ref: b\n');
        await writeFile(join(dir, 'tests', 'a.test.json'), 'v2');
        await mkdir(join(dir, 'Dog'), { recursive: true });
        await writeFile(join(dir, 'Dog', 'target.json'), JSON.stringify({ name: 'Dog' }) + '\n');
        await store.restore('s1', 't1');
        assert.equal(await readFile(join(dir, '.git', 'HEAD'), 'utf8'), 'ref: b\n', '.git untouched');
        assert.equal(await readFile(join(dir, 'tests', 'a.test.json'), 'utf8'), 'v2', 'tests untouched');
        await assert.rejects(() => readFile(join(dir, 'Dog', 'target.json'), 'utf8'), 'sprite added after the checkpoint is removed');
        for (const [sid, tid] of [['..', 't1'], ['s1', '../../x'], ['a/b', 't1'], ['s1', '']]) {
            await assert.rejects(() => store.restore(sid, tid), /invalid checkpoint id/);
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('/file serves project images and rejects escapes', async () => {

    const s = await setup();
    try {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await writeFile(join(s.dir, 'shot.png'), png);
        const okRes = await fetch(`${httpBase(s)}/file?path=shot.png&token=${s.bridge.token}`);
        assert.equal(okRes.status, 200);
        assert.equal(okRes.headers.get('content-type'), 'image/png');
        assert.match(okRes.headers.get('content-security-policy') ?? '', /sandbox/);
        assert.equal(okRes.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await okRes.arrayBuffer()), png);
        // Extension matching is case-insensitive.
        await writeFile(join(s.dir, 'UP.PNG'), png);
        const upper2 = await fetch(`${httpBase(s)}/file?path=${encodeURIComponent('UP.PNG')}&token=${s.bridge.token}`);
        assert.equal(upper2.status, 200);
        assert.equal(upper2.headers.get('content-type'), 'image/png');

        for (const bad of [
            '../package.json',
            '..%2Fpackage.json',
            '/etc/hosts',
            'agentwarp.json',
            'player/scripts.sb',
            'nope.png',
            'shot.png%00.png',
        ]) {
            const r = await fetch(`${httpBase(s)}/file?path=${bad}&token=${s.bridge.token}`);
            assert.equal(r.status, 404, `rejected: ${bad}`);
        }
        // Symlink escape: evil.png points outside the project dir.
        await symlink('/etc/hosts', join(s.dir, 'evil.png'));
        const evil = await fetch(`${httpBase(s)}/file?path=evil.png&token=${s.bridge.token}`);
        assert.equal(evil.status, 404, 'symlink escape rejected');
    } finally {
        await teardown(s);
    }
});
