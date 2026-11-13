/**
 * Bridge tests with a SIMULATED editor client: a Node ws client that
 * loads/saves .sb3 with packages/core and applies JSON-level edits to emulate
 * a human dragging blocks / editing literals (no real TurboWarp needed).
 *
 * Run: node --test "packages/bridge/test/*.test.ts"   (from the repo root)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import JSZip from 'jszip';
import { unpackSb3 } from '../../core/project-dir.ts';
import { loadSb3Buffer } from '../../core/sb3.ts';
import { scratchblocks } from '../../../formats/scratchblocks/index.ts';
import { startServe, type BridgeHandle } from '../server.ts';

process.env.AGENTWARP_BRIDGE_DEBOUNCE_MS = '80';
process.env.AGENTWARP_BRIDGE_VERIFY_DELAY_MS = '150';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const FIXTURE = join(root, 'eval', 'fixtures', 'scrolltutorial-378587848.sb3');
const ZIP_DATE = new Date('2020-01-01T00:00:00Z');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => boolean | Promise<boolean>, timeout: number, label: string): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        if (await fn()) return;
        await sleep(25);
    }
    throw new Error(`timeout waiting for: ${label}`);
}

async function toSb3Buffer(projectText: string, files: Map<string, Uint8Array>): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('project.json', projectText, { date: ZIP_DATE });
    for (const [k, v] of [...files.entries()].sort()) zip.file(k, v, { date: ZIP_DATE });
    return zip.generateAsync({ type: 'nodebuffer' });
}

/** A JSON-level editor: mutate the loaded project like a human would. */
class SimEditor {
    base: string;
    token: string;
    ws!: WebSocket;
    rev = -1;
    loads: number[] = [];
    statuses: any[] = [];
    hellos: any[] = [];
    project: any = null;
    files = new Map<string, Uint8Array>();
    private helloRes!: () => void;
    private helloRej!: (e: Error) => void;
    private helloP: Promise<void>;

    constructor(base: string, token: string) {
        this.base = base;
        this.token = token;
        this.helloP = new Promise<void>((res, rej) => {
            this.helloRes = res;
            this.helloRej = rej;
        });
    }

    async connect(withToken = true): Promise<void> {
        this.ws = new WebSocket(withToken ? `${this.base}/ws?token=${this.token}` : `${this.base}/ws`);
        this.ws.on('message', (d) => {
            let m: any;
            try {
                m = JSON.parse(String(d));
            } catch {
                return;
            }
            if (m.type === 'hello') {
                this.rev = m.rev;
                this.hellos.push(m);
                this.helloRes();
            } else if (m.type === 'load') {
                this.loads.push(m.rev);
            } else if (m.type === 'status') {
                this.statuses.push(m);
            }
        });
        this.ws.on('error', () => undefined);
        await this.helloP;
    }

    async fetch(): Promise<void> {
        const r = await fetch(`${this.baseHttp()}/project.sb3?token=${this.token}`);
        assert.equal(r.status, 200, 'fetch project.sb3');
        const buf = Buffer.from(await r.arrayBuffer());
        const c = await loadSb3Buffer(buf);
        this.project = c.project;
        this.files = c.files;
    }

    baseHttp(): string {
        return this.base.replace(/^ws/, 'http');
    }

    async post(baseRev?: number): Promise<{ status: number; json: any }> {
        const body = await toSb3Buffer(JSON.stringify(this.project), this.files);
        const r = await fetch(`${this.baseHttp()}/editor.sb3?token=${this.token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', 'x-base-rev': String(baseRev ?? this.rev) },
            body,
        });
        return { status: r.status, json: await r.json() };
    }

    close(): void {
        try {
            this.ws.close();
        } catch {
            /* ignore */
        }
    }
}

/** Set a text-ish literal (inline or shadow) to a new value; returns hits. */
function setProjectLiteral(project: any, targetName: string, oldVal: string, newVal: string): number {
    let n = 0;
    const t = project.targets.find((x: any) => x?.name === targetName);
    assert.ok(t, `target ${targetName}`);
    for (const b of Object.values<any>(t.blocks ?? {})) {
        if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
        for (const ival of Object.values<any>(b.inputs ?? {})) {
            if (!Array.isArray(ival)) continue;
            const prim = ival[1];
            if (Array.isArray(prim) && typeof prim[0] === 'number' && prim[0] >= 4 && prim[0] <= 10 && String(prim[1]) === oldVal) {
                prim[1] = newVal;
                n++;
            } else if (typeof prim === 'string') {
                const sh = t.blocks[prim];
                if (sh && typeof sh === 'object' && !Array.isArray(sh) && sh.shadow === true) {
                    for (const f of Object.values<any>(sh.fields ?? {})) {
                        if (Array.isArray(f) && String(f[0]) === oldVal) {
                            f[0] = String(newVal);
                            n++;
                        }
                    }
                }
            }
        }
    }
    return n;
}

/** Top-level block id containing the given block id. */
function topOf(project: any, targetName: string, blockId: string): string {
    const t = project.targets.find((x: any) => x?.name === targetName);
    let cur = blockId;
    for (;;) {
        const b = t.blocks[cur];
        if (!b || typeof b !== 'object' || Array.isArray(b) || b.parent == null) return cur;
        cur = b.parent;
    }
}

/** All values occurring exactly once in a target + their block ids. */
function uniqueLiterals(project: any, targetName: string): Array<{ value: string; blockId: string }> {
    const t = project.targets.find((x: any) => x?.name === targetName);
    const hits = new Map<string, string[]>();
    for (const [id, b] of Object.entries<any>(t.blocks ?? {})) {
        if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
        for (const ival of Object.values<any>(b.inputs ?? {})) {
            if (!Array.isArray(ival)) continue;
            const prim = ival[1];
            if (Array.isArray(prim) && typeof prim[0] === 'number' && prim[0] >= 4 && prim[0] <= 10) {
                const v = String(prim[1]);
                hits.set(v, [...(hits.get(v) ?? []), id]);
            }
        }
    }
    const out: Array<{ value: string; blockId: string }> = [];
    for (const [v, ids] of hits) {
        if (ids.length === 1) out.push({ value: v, blockId: ids[0] });
    }
    if (!out.length) throw new Error('no unique literal found');
    return out;
}

/** Find a literal value occurring exactly once in a target + its block id. */
function uniqueLiteral(project: any, targetName: string): { value: string; blockId: string } {
    return uniqueLiterals(project, targetName)[0];
}

function anchorOf(anchors: Record<string, Record<string, string>>, target: string, topId: string): string | null {
    for (const [a, id] of Object.entries(anchors[target] ?? {})) {
        if (id === topId) return a;
    }
    return null;
}

/** All inline literal values of motion_movesteps STEPS inputs in an sb3 dump. */
function moveStepsValues(projectText: string): unknown[] {
    const out: unknown[] = [];
    const project = JSON.parse(projectText);
    for (const t of project.targets ?? []) {
        for (const b of Object.values<any>(t.blocks ?? {})) {
            if (!b || typeof b !== 'object' || Array.isArray(b) || b.opcode !== 'motion_movesteps') continue;
            for (const ival of Object.values<any>(b.inputs ?? {})) {
                if (Array.isArray(ival) && Array.isArray(ival[1])) out.push(ival[1][1]);
            }
        }
    }
    return out;
}

interface Setup {
    dir: string;
    bridge: BridgeHandle;
    ed: SimEditor;
    base: string;
    scriptsFile: string;
}

async function setup(): Promise<Setup> {
    const dir = await mkdtemp(join(tmpdir(), 'aw-bridge-'));
    await unpackSb3(FIXTURE, dir, scratchblocks);
    await writeFile(join(dir, '.agentwarp', 'format'), 'scratchblocks\n');
    const bridge = await startServe(dir, {});
    const base = `ws://127.0.0.1:${bridge.port}`;
    const ed = new SimEditor(base, bridge.token);
    await ed.connect();
    await ed.fetch();
    const scriptsFile = join(dir, 'player', 'scripts.sb');
    return { dir, bridge, ed, base, scriptsFile };
}

async function teardown(s: Setup): Promise<void> {
    s.ed.close();
    await s.bridge.close();
    await rm(s.dir, { recursive: true, force: true });
}

async function sb3Text(s: Setup): Promise<string> {
    const r = await fetch(`${s.base.replace(/^ws/, 'http')}/project.sb3?token=${s.bridge.token}`);
    assert.equal(r.status, 200);
    const c = await loadSb3Buffer(Buffer.from(await r.arrayBuffer()));
    return JSON.stringify(c.project);
}

test('agent edit reaches the client and the packed sb3', async () => {
    const s = await setup();
    try {
        const before = (await readFile(join(s.dir, '.agentwarp', 'serve.json'), 'utf8')).trim();
        assert.match(before, /"port"/);
        const text = await readFile(s.scriptsFile, 'utf8');
        assert.match(text, /change player x by \["10"\]/);
        await writeFile(s.scriptsFile, text.replace('change player x by ["10"]', 'change player x by ["101"]'));
        await waitFor(() => s.ed.loads.length >= 1, 8000, 'client load after agent edit');
        assert.equal(s.ed.loads[0], 1);
        const pt = await sb3Text(s);
        assert.match(pt, /"101"/, 'packed project contains the agent edit');
        // Text was re-printed (canonical) and is clean now.
        const st = await (await fetch(`${s.base.replace(/^ws/, 'http')}/status?token=${s.bridge.token}`)).json();
        assert.equal(st.clean, true);
        assert.equal(st.rev, 1);
        // format + serve.json survived the re-unpack.
        assert.equal((await readFile(join(s.dir, '.agentwarp', 'format'), 'utf8')).trim(), 'scratchblocks');
        assert.ok(JSON.parse(await readFile(join(s.dir, '.agentwarp', 'serve.json'), 'utf8')).port > 0);
    } finally {
        await teardown(s);
    }
});

test('human move + literal edit flows into text, anchors stable', async () => {
    const s = await setup();
    try {
        const anchorsBefore = await readFile(join(s.dir, '.agentwarp', 'anchors.json'), 'utf8');
        const { value, blockId } = uniqueLiteral(s.ed.project, 'player');
        const top = topOf(s.ed.project, 'player', blockId);
        const tb: any = s.ed.project.targets.find((x: any) => x?.name === 'player').blocks[top];
        tb.x = (tb.x ?? 0) + 60;
        tb.y = (tb.y ?? 0) + 20;
        assert.ok(setProjectLiteral(s.ed.project, 'player', value, '4242') >= 1);
        const res = await s.ed.post();
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.equal(res.json.ok, true);
        await waitFor(async () => (await readFile(s.scriptsFile, 'utf8')).includes('4242'), 8000, 'text picks up the human literal');
        assert.deepEqual(
            JSON.parse(await readFile(join(s.dir, '.agentwarp', 'anchors.json'), 'utf8')),
            JSON.parse(anchorsBefore),
            'anchors stable',
        );
        assert.equal(s.ed.loads.length, 0, 'no push back to the editor that sent it');
        const pt = await sb3Text(s);
        assert.match(pt, /"4242"/);
    } finally {
        await teardown(s);
    }
});

test('concurrent edits on different scripts merge', async () => {
    const s = await setup();
    try {
        // Agent edits @a3's literal in the text...
        const text = await readFile(s.scriptsFile, 'utf8');
        await writeFile(s.scriptsFile, text.replace('change player x by ["10"]', 'change player x by ["101"]'));
        await sleep(20); // inside the debounce window: text is dirty, no pack yet
        // ...while the human edits a DIFFERENT script + moves it.
        const anchors = JSON.parse(await readFile(join(s.dir, '.agentwarp', 'anchors.json'), 'utf8'));
        const picked =
            uniqueLiterals(s.ed.project, 'player')
                .map((c) => ({ ...c, top: topOf(s.ed.project, 'player', c.blockId) }))
                .find((c) => anchorOf(anchors, 'player', c.top) !== 'a3' && c.value !== '10') ?? null;
        assert.ok(picked, 'found a literal outside @a3');
        const otherTop = topOf(s.ed.project, 'player', (picked as { blockId: string }).blockId);
        const ob: any = s.ed.project.targets.find((x: any) => x?.name === 'player').blocks[otherTop];
        ob.x = (ob.x ?? 0) + 77;
        assert.ok(setProjectLiteral(s.ed.project, 'player', (picked as { value: string }).value, '777') >= 1);
        const res = await s.ed.post();
        assert.equal(res.status, 200, JSON.stringify(res.json));
        await waitFor(() => s.ed.loads.length >= 1, 8000, 'merged load pushed to client');
        const pt = await sb3Text(s);
        assert.match(pt, /"101"/, 'agent edit survived the merge');
        assert.match(pt, /"777"/, 'human edit survived the merge');
        const textAfter = await readFile(s.scriptsFile, 'utf8');
        assert.match(textAfter, /\["101"\]/, 'text has the agent edit');
        assert.match(textAfter, /777/, 'text adopted the human edit');
    } finally {
        await teardown(s);
    }
});

test('same script on both sides: agent wins + conflict reported', async () => {
    const s = await setup();
    try {
        const text = await readFile(s.scriptsFile, 'utf8');
        await writeFile(s.scriptsFile, text.replace('change player x by ["10"]', 'change player x by ["101"]'));
        await sleep(20);
        assert.ok(setProjectLiteral(s.ed.project, 'player', '10', '999') >= 1, 'human edits the same literal');
        const res = await s.ed.post();
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.ok((res.json.conflicts ?? []).length >= 1, `expected conflicts, got ${JSON.stringify(res.json)}`);
        assert.match(JSON.stringify(res.json.conflicts), /a3/, 'conflict names the @a3 script');
        await waitFor(() => s.ed.loads.length >= 1, 8000, 'load pushed after merge');
        await waitFor(async () => (await sb3Text(s)).includes('"101"'), 8000, 'agent value wins in sb3');
        const pt = await sb3Text(s);
        assert.doesNotMatch(pt, /"999"/, 'human value for the conflicted script is gone');
        await waitFor(
            () => s.ed.statuses.some((x) => (x.conflicts ?? []).length > 0),
            8000,
            'conflict status broadcast reaches the client',
        );
    } finally {
        await teardown(s);
    }
});

test('syntax error reports file:line, no push', async () => {
    const s = await setup();
    try {
        const revBefore = s.bridge.getRev();
        const text = await readFile(s.scriptsFile, 'utf8');
        const withErr = text + '\n(((broken line here\n';
        await writeFile(s.scriptsFile, withErr);
        await waitFor(() => s.ed.statuses.some((x) => x.ok === false), 8000, 'error status');
        const st = s.ed.statuses.find((x) => x.ok === false);
        assert.ok(st.diagnostics && st.diagnostics.length >= 1, 'diagnostics attached');
        assert.ok(String(st.diagnostics[0].file ?? '').endsWith('scripts.sb'), `file set: ${JSON.stringify(st.diagnostics[0])}`);
        assert.equal(typeof st.diagnostics[0].line, 'number', 'line set');
        assert.equal(s.ed.loads.length, 0, 'no load pushed on error');
        assert.equal(s.bridge.getRev(), revBefore, 'rev unchanged');
        // Fix the file with a valid edit -> sync recovers.
        await writeFile(s.scriptsFile, text.replace('change player x by ["10"]', 'change player x by ["102"]'));
        await waitFor(() => s.ed.loads.length >= 1, 8000, 'load after fixing the error');
        assert.match(await sb3Text(s), /"102"/);
    } finally {
        await teardown(s);
    }
});

test('agent write during pack is retried, not clobbered', async () => {
    const s = await setup();
    try {
        process.env.AGENTWARP_BRIDGE_PACK_DELAY_MS = '400';
        const text = await readFile(s.scriptsFile, 'utf8');
        const loadsBefore = s.ed.loads.length;
        await writeFile(s.scriptsFile, text.replace('change player x by ["10"]', 'change player x by ["101"]'));
        await sleep(150); // debounce (80ms) fired; pack is sleeping in its delay
        const mid = await readFile(s.scriptsFile, 'utf8');
        await writeFile(s.scriptsFile, mid.replace('set [speed y v] to ["17"]', 'set [speed y v] to ["1717"]'));
        await waitFor(() => s.ed.loads.length >= loadsBefore + 1, 15000, 'load after retry');
        const pt = await sb3Text(s);
        assert.match(pt, /"101"/, 'first edit present');
        assert.match(pt, /"1717"/, 'second edit present (not clobbered by stale re-unpack)');
        assert.equal(s.ed.loads.length, loadsBefore + 1, 'single commit for the coalesced edits');
    } finally {
        process.env.AGENTWARP_BRIDGE_PACK_DELAY_MS = '0';
        await teardown(s);
    }
});

test('new agent script gets an anchor; second edit does not duplicate it', async () => {
    const s = await setup();
    try {
        const anchorsBefore: Record<string, Record<string, string>> = JSON.parse(await readFile(join(s.dir, '.agentwarp', 'anchors.json'), 'utf8'));
        const nBefore = Object.keys(anchorsBefore.player ?? {}).length;
        const text = await readFile(s.scriptsFile, 'utf8');
        await writeFile(s.scriptsFile, text + '\n@tmp\nwhen [space v] key pressed\nmove (99) steps\n');
        await waitFor(() => s.ed.loads.length >= 1, 8000, 'load for the new script');
        // Wait for the re-print (with the real anchor) to land, not just the
        // load broadcast — an agent must read the fresh file before editing.
        await waitFor(async () => /@a\d+\nwhen \[space v\] key pressed\nmove \(99\) steps/.test(await readFile(s.scriptsFile, 'utf8')), 8000, 're-print with anchor');
        const printed = await readFile(s.scriptsFile, 'utf8');
        assert.match(printed, /@a\d+\nwhen \[space v\] key pressed\nmove \(99\) steps/, 'new script printed with a real anchor');
        const anchorsMid: Record<string, Record<string, string>> = JSON.parse(await readFile(join(s.dir, '.agentwarp', 'anchors.json'), 'utf8'));
        assert.equal(Object.keys(anchorsMid.player ?? {}).length, nBefore + 1, 'exactly one anchor added');
        // Second edit keeps the anchor: no duplicate, no extra script.
        const printed2 = printed.replace('move (99) steps', 'move (100) steps');
        assert.match(printed2, /@a\d+\nwhen \[space v\] key pressed/);
        await writeFile(s.scriptsFile, printed2);
        await waitFor(async () => moveStepsValues(await sb3Text(s)).includes(100), 8000, 'second edit packed');
        const pt = await sb3Text(s);
        assert.deepEqual(moveStepsValues(pt).filter((v) => v === 100 || v === '100').length, 1, 'exactly one movesteps block with 100');
        assert.equal(moveStepsValues(pt).filter((v) => v === 99 || v === '99').length, 0, 'old literal gone');
        const anchorsAfter: Record<string, Record<string, string>> = JSON.parse(await readFile(join(s.dir, '.agentwarp', 'anchors.json'), 'utf8'));
        assert.equal(Object.keys(anchorsAfter.player ?? {}).length, nBefore + 1, 'no duplicate anchor on second edit');
        assert.ok(s.ed.statuses.every((x) => x.ok !== false), 'no error statuses');
    } finally {
        await teardown(s);
    }
});

test('re-unpack never overwrites files changed since the pack snapshot', async () => {
    // Deterministic core of "no clobber during the re-unpack window": files
    // the agent touched after the pre-pack snapshot are skipped, reported,
    // and left intact for the follow-up pack to adopt.
    const { snapshotSigs } = await import('../text-hash.ts');
    const { reunpackText } = await import('../unpack-safe.ts');
    const { loadSb3File } = await import('../../core/sb3.ts');
    const dir = await mkdtemp(join(tmpdir(), 'aw-bridge-skip-'));
    try {
        await unpackSb3(FIXTURE, dir, scratchblocks);
        await writeFile(join(dir, '.agentwarp', 'format'), 'scratchblocks\n');
        const { project, projectText, files } = await loadSb3File(FIXTURE);
        const { sigs } = await snapshotSigs(dir);
        const f = join(dir, 'player', 'scripts.sb');
        const orig = await readFile(f, 'utf8');
        await writeFile(f, orig + '\n@tmp\nwhen [space v] key pressed\nmove (55) steps\n');
        const ru = await reunpackText(dir, scratchblocks, project, projectText, files, { skipChangedSince: sigs, prevAnchors: {} });
        assert.ok(ru.skipped.some((r) => r.endsWith('scripts.sb')), `expected scripts.sb skipped, got ${JSON.stringify(ru.skipped)}`);
        assert.match(await readFile(f, 'utf8'), /move \(55\) steps/, 'agent content preserved, not clobbered');
        // Untouched files are still re-printed.
        assert.ok(!ru.skipped.some((r) => r.endsWith('target.json')), 'untouched files not skipped');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('auth: missing token is rejected', async () => {
    const s = await setup();
    try {
        const httpBase = s.base.replace(/^ws/, 'http');
        const r1 = await fetch(`${httpBase}/project.sb3`);
        assert.equal(r1.status, 401, 'sb3 without token');
        const r2 = await fetch(`${httpBase}/status`);
        assert.equal(r2.status, 401, 'status without token');
        const r3 = await fetch(`${httpBase}/project.sb3?token=wrong`);
        assert.equal(r3.status, 401, 'sb3 with wrong token');
        const closed = await new Promise<{ code: number }>((resolve) => {
            const ws = new WebSocket(`${s.base}/ws`);
            ws.on('close', (code: number) => resolve({ code }));
            ws.on('error', () => undefined);
            setTimeout(() => resolve({ code: -1 }), 3000);
        });
        assert.equal(closed.code, 4401, `ws without token closed with 4401, got ${closed.code}`);
    } finally {
        await teardown(s);
    }
});
