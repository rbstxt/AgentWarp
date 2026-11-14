/**
 * agentwarp bridge: live sync between the text project dir and TurboWarp.
 *
 *   agentwarp serve <dir> [--port N]   (see packages/cli/agentwarp.ts)
 *
 * HTTP + WebSocket server on 127.0.0.1. Owns `rev` (integer) and `base`
 * (the agreed project.json). Sync rules per docs/P4-DESIGN.md:
 *
 * Agent-edit cycle (file watcher, debounce 300 ms):
 *   hash != lastTextHash -> packDir(text) against base.
 *   errors -> broadcast {status ok:false} (with file:line), no push.
 *   success -> base := result, rev++, push {load}, then re-unpack the text
 *   ONLY if the text hash is still the one we packed (else retry; never
 *   clobber an edit that landed meanwhile). Update lastTextHash.
 *   A forced re-pack is scheduled after every sync to close the blind window
 *   where an agent write lands inside our own unpack writes.
 *
 * Editor-edit cycle (client POSTs sb3, X-Base-Rev header):
 *   clean text -> base := editor project, rev++, re-unpack, no push back.
 *   dirty text -> three-way merge (pack merged text against the editor
 *   project with current anchors; same-script changes on both sides keep
 *   the agent's text + conflict report), rev++, push load, re-unpack.
 *
 * Protocol (WebSocket JSON, ws://127.0.0.1:<port>/ws?token=...):
 *   server->client: hello {rev, name}, load {rev},
 *                   status {ok, diagnostics?, conflicts?, message?}
 *   client->server: hello {client, version}, ack {rev}, log {level, message}
 * HTTP: GET /project.sb3?token=..., POST /editor.sb3?token=...,
 *   GET /status?token=.... Every request needs the token (query ?token= or
 *   header x-bridge-token). CORS allows the TurboWarp origins.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import JSZip from 'jszip';
import { loadSb3Buffer } from '../core/sb3.ts';
import type { AnchorMap } from '../core/extract.ts';
import type { Diagnostic, Format } from '../core/ir.ts';
import { hashTextDir, snapshotSigs } from './text-hash.ts';
import { collectAssetFiles, packTextAgainstBase, readTextState } from './pack-text.ts';
import { reunpackText } from './unpack-safe.ts';
import { buildMerge } from './merge.ts';
import { createFsTurnStore } from './checkpoints.ts';
import { createAcpHost } from '../acp/src/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORMATS = ['ts', 'sbpy', 'scratchblocks', 'ir-json'];
const ZIP_DATE = new Date('2020-01-01T00:00:00Z');

export interface ServeOptions {
    port?: number;
    token?: string;
    name?: string;
}

export interface BridgeHandle {
    dir: string;
    port: number;
    token: string;
    url: string;
    getRev(): number;
    close(): Promise<void>;
}

interface StatusMsg {
    type: 'status';
    ok: boolean;
    rev?: number;
    diagnostics?: Array<{ file?: string; line?: number; col?: number; message: string }>;
    conflicts?: Array<{ target: string; anchor: string; message: string }>;
    message?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const debounceMs = (): number => Number(process.env.AGENTWARP_BRIDGE_DEBOUNCE_MS ?? 300);
const packDelayMs = (): number => Number(process.env.AGENTWARP_BRIDGE_PACK_DELAY_MS ?? 0);
const verifyDelayMs = (): number => Number(process.env.AGENTWARP_BRIDGE_VERIFY_DELAY_MS ?? 400);

async function loadFormat(name: string): Promise<Format> {
    if (!FORMATS.includes(name)) throw new Error(`unknown format "${name}" (choose: ${FORMATS.join(', ')})`);
    const m: any = await import(join(ROOT, 'formats', name, 'index.ts'));
    const f = m.default ?? m.format ?? Object.values(m).find((v: any) => v && typeof v === 'object' && 'print' in v && 'parse' in v);
    if (!f) throw new Error(`format "${name}" exports no Format`);
    return f as Format;
}

function diagToWire(d: Diagnostic): { file?: string; line?: number; col?: number; message: string } {
    return { ...(d.file ? { file: d.file } : {}), ...(d.line != null ? { line: d.line } : {}), ...(d.col != null ? { col: d.col } : {}), message: d.message };
}

export async function startServe(dirArg: string, opts: ServeOptions = {}): Promise<BridgeHandle> {
    const dir = resolve(dirArg);
    const formatName = (await readFile(join(dir, '.agentwarp', 'format'), 'utf8')).trim();
    const format = await loadFormat(formatName);
    let baseText = await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8');
    let base: any = JSON.parse(baseText);
    let anchors: Record<string, AnchorMap> = {};
    try {
        anchors = JSON.parse(await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'));
    } catch {
        /* none yet */
    }
    const assets = await collectAssetFiles(dir, format);
    let lastTextHash = await hashTextDir(dir);
    let rev = 0;
    const history = new Map<number, { base: any; anchors: Record<string, AnchorMap> }>();
    const rememberRevision = (): void => {
        history.set(rev, { base, anchors });
        if (history.size > 100) history.delete(history.keys().next().value!);
    };
    const name = opts.name ?? basename(dir);
    const token = opts.token ?? randomBytes(16).toString('hex');
    // Revisions restart at 0 on every serve; clients reset their rev when this changes.
    const session = randomBytes(8).toString('hex');
    const logs: string[] = [];
    const log = (msg: string): void => {
        logs.push(msg);
        if (logs.length > 100) logs.shift();
        process.stderr.write(`[bridge] ${msg}\n`);
    };
    let lastStatusKey = '';
    let closed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, fn: () => void): void => {
        const t = setTimeout(() => {
            timers.delete(t);
            if (!closed) fn();
        }, ms);
        timers.add(t);
    };

    // -- client set ---------------------------------------------------------
    const clients = new Set<WebSocket>();
    const broadcast = (obj: unknown): void => {
        const s = JSON.stringify(obj);
        for (const c of clients) {
            if (c.readyState === WebSocket.OPEN) {
                try {
                    c.send(s);
                } catch {
                    /* drop */
                }
            }
        }
    };
    const acp = createAcpHost({
        projectDir: dir,
        send: broadcast,
        log,
        turnStore: createFsTurnStore({ dir, format, getRev: () => rev, getBase: () => base }),
    });
    const sendStatus = (s: Omit<StatusMsg, 'type'>): void => {
        const key = JSON.stringify(s);
        if (key === lastStatusKey) return;
        lastStatusKey = key;
        broadcast({ type: 'status', ...s });
    };

    // -- tiny promise-chain mutex (agent cycle + editor POSTs serialize) ----
    let tail: Promise<void> = Promise.resolve();
    const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
        const prev = tail;
        let release!: () => void;
        tail = new Promise<void>((r) => (release = r));
        return prev.then(async () => {
            try {
                return await fn();
            } finally {
                release();
            }
        });
    };

    // -- agent-edit cycle ----------------------------------------------------
    // skipSigs: per-file content sigs captured right before packing. Files
    // the agent touches afterwards are OURS to skip during re-unpack (never
    // clobber newer agent work); a forced follow-up pack then adopts them.
    const commitPack = async (project: any, projectText: string, files: Map<string, Uint8Array>, skipSigs?: Map<string, string>): Promise<void> => {
        rememberRevision();
        base = project;
        baseText = projectText;
        for (const [k, v] of files) {
            if (!assets.has(k)) assets.set(k, v);
        }
        rev += 1;
        broadcast({ type: 'load', rev });
        const ru = await reunpackText(dir, format, base, baseText, assets, { skipChangedSince: skipSigs, prevAnchors: anchors });
        anchors = ru.anchors;
        lastTextHash = await hashTextDir(dir);
        sendStatus({ ok: true, rev, message: 'synced' });
        acp.onBaseUpdated();
        const raced = [...ru.skipped, ...ru.raced];
        if (raced.length > 0) {
            // Agent writes landed inside our unpack window: their files are
            // intact (skipped or still newer) — adopt them with a forced
            // re-pack instead of trusting the hash.
            log(`re-unpack raced with agent writes (${raced.join(', ')}); re-packing`);
            later(0, () => {
                void withLock(() => agentCycle(true)).catch((e) => log(`follow-up cycle failed: ${(e as Error)?.message}`));
            });
            return;
        }
        // Blind-window guard: an agent write that lands between our last
        // file write and the hash above would be marked clean. Force a
        // semantic re-pack after things settle (no rev bump when unchanged).
        const vd = verifyDelayMs();
        later(vd, () => {
            void withLock(() => agentCycle(true)).catch((e) => log(`verify cycle failed: ${(e as Error)?.message}`));
        });
    };

    const agentCycle = async (force: boolean): Promise<void> => {
        for (let i = 0; i < 10; i++) {
            const h = await hashTextDir(dir);
            if (h === lastTextHash && !force) {
                sendStatus({ ok: true, rev, message: 'synced' });
                return;
            }
            force = false;
            const { sigs } = await snapshotSigs(dir);
            const r = await packTextAgainstBase(dir, format, base, baseText, anchors);
            const errs = r.diagnostics.filter((d) => d.severity === 'error');
            if (errs.length) {
                sendStatus({ ok: false, rev, diagnostics: errs.map(diagToWire), message: `${errs.length} error(s); editor not updated` });
                return;
            }
            if (packDelayMs() > 0) await sleep(packDelayMs());
            // Never clobber an edit that landed while packing: only proceed
            // when the text is still exactly what we packed.
            const h2 = await hashTextDir(dir);
            if (h2 !== h) continue; // retry with the newer text
            if (!r.changed) {
                // Semantically identical (e.g. whitespace-only edit): adopt
                // the hash quietly, no rev bump, no push.
                lastTextHash = h2;
                sendStatus({ ok: true, rev, message: 'synced' });
                return;
            }
            await commitPack(r.project, r.projectText, r.files, sigs);
            return;
        }
        log('agent cycle: text kept changing, will retry on next event');
    };

    // -- editor POST ---------------------------------------------------------
    const handleEditorPost = async (body: Uint8Array, baseRevHeader: string | null): Promise<{ status: number; json: unknown }> => {
        let contents;
        try {
            contents = await loadSb3Buffer(body);
        } catch (e) {
            return { status: 400, json: { ok: false, message: `cannot parse editor sb3: ${(e as Error)?.message}` } };
        }
        return withLock(async () => {
            for (const [k, v] of contents.files) {
                if (!assets.has(k)) assets.set(k, v);
            }
            const editorProject = contents.project;
            if (baseRevHeader != null && baseRevHeader !== '' && Number(baseRevHeader) !== rev) {
                log(`stale X-Base-Rev ${baseRevHeader} (current rev ${rev}); merge path handles it`);
            }
            const postedRev = baseRevHeader == null || baseRevHeader === '' ? rev : Number(baseRevHeader);
            const stale = postedRev !== rev;
            const ancestor = stale ? history.get(postedRev) : { base, anchors };
            if (!ancestor) return { status: 409, json: { ok: false, rev, message: 'base revision no longer available; cannot safely merge editor state' } };
            const h = await hashTextDir(dir);
            if (h === lastTextHash && !stale) {
                // Clean: adopt the editor state wholesale, no push back.
                const { sigs } = await snapshotSigs(dir);
                rememberRevision();
                base = editorProject;
                baseText = contents.projectText;
                rev += 1;
                const ru = await reunpackText(dir, format, base, baseText, assets, { skipChangedSince: sigs, prevAnchors: anchors });
                anchors = ru.anchors;
                lastTextHash = await hashTextDir(dir);
                acp.onBaseUpdated();
                if ([...ru.skipped, ...ru.raced].length > 0) {
                    // Agent wrote mid-unpack; their files are intact — adopt.
                    later(0, () => {
                        void withLock(() => agentCycle(true)).catch((e) => log(`follow-up cycle failed: ${(e as Error)?.message}`));
                    });
                }
                return { status: 200, json: { ok: true, rev } };
            }
            // Dirty: three-way merge, agent wins per-script conflicts.
            for (let attempt = 0; attempt < 3; attempt++) {
                const ha = await hashTextDir(dir);
                const { sigs } = await snapshotSigs(dir);
                const text = await readTextState(dir, format);
                const { overrides, conflicts } = buildMerge({ oldBase: ancestor.base, editorProject, text, oldAnchors: ancestor.anchors, editorFiles: contents.files });
                const r = await packTextAgainstBase(dir, format, editorProject, JSON.stringify(editorProject), anchors, overrides);
                const errs = r.diagnostics.filter((d) => d.severity === 'error');
                if (errs.length) {
                    sendStatus({ ok: false, rev, diagnostics: errs.map(diagToWire), message: 'merge blocked by text errors; editor state kept, fix text and re-send' });
                    return { status: 422, json: { ok: false, rev, diagnostics: errs.map(diagToWire), message: 'text has errors; fix and re-send' } };
                }
                if (packDelayMs() > 0) await sleep(packDelayMs());
                const hb = await hashTextDir(dir);
                if (hb !== ha) continue; // text moved under us; rebuild the merge
                await commitPack(r.project, r.projectText, r.files, sigs);
                if (conflicts.length) {
                    sendStatus({ ok: true, rev, conflicts, message: `${conflicts.length} conflict(s); text won` });
                }
                return { status: 200, json: { ok: true, rev, conflicts } };
            }
            return { status: 409, json: { ok: false, rev, message: 'text changed during merge; please re-send editor state' } };
        });
    };

    const buildSb3 = async (): Promise<Buffer> => {
        const zip = new JSZip();
        zip.file('project.json', baseText, { date: ZIP_DATE, compression: 'DEFLATE' });
        const refs = new Set<string>();
        for (const t of base?.targets ?? []) {
            for (const c of [...(t?.costumes ?? []), ...(t?.sounds ?? [])]) refs.add(String(c?.md5ext ?? ''));
        }
        for (const m of [...refs].sort()) {
            const buf = assets.get(m);
            if (buf) zip.file(m, buf, { date: ZIP_DATE, compression: 'STORE' });
            else log(`warning: asset ${m} referenced by base but bytes unavailable`);
        }
        return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    };

    // -- HTTP ----------------------------------------------------------------
    const checkAuth = (req: IncomingMessage, url: URL): boolean => {
        if (url.searchParams.get('token') === token) return true;
        if (req.headers['x-bridge-token'] === token) return true;
        return false;
    };
    const cors = (req: IncomingMessage, res: ServerResponse): void => {
        res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
        res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        res.setHeader('access-control-allow-headers', 'content-type, x-base-rev, x-bridge-token');
    };
    const json = (res: ServerResponse, status: number, obj: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
    };

    const IMAGE_TYPES: Record<string, string> = {
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
    };

    /**
     * Serve one project image for panel thumbnails (P7 §5: GET /file).
     * Only image files whose real path is inside the project dir; rejects
     * `..`, absolute paths and symlink escapes with null (→ 404).
     */
    const serveImageFile = async (root: string, rel: string): Promise<{ buf: Buffer; contentType: string } | null> => {
        if (!rel || rel.includes('\0') || isAbsolute(rel) || rel.includes('\\')) return null;
        if (rel.split('/').some((p) => p === '..' || p === '' || p === '.')) return null;
        const dot = rel.lastIndexOf('.');
        const ext = (dot >= 0 ? rel.slice(dot) : '').toLowerCase();
        const contentType = IMAGE_TYPES[ext];
        if (!contentType) return null;
        let rootReal: string;
        let fileReal: string;
        try {
            rootReal = await realpath(root);
            fileReal = await realpath(join(root, rel));
        } catch {
            return null;
        }
        if (fileReal !== rootReal && !fileReal.startsWith(rootReal + sep)) return null;
        try {
            const st = await stat(fileReal);
            if (!st.isFile()) return null;
            return { buf: await readFile(fileReal), contentType };
        } catch {
            return null;
        }
    };

    const server = createServer(async (req, res) => {
        try {
            cors(req, res);
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            if (!checkAuth(req as IncomingMessage, url)) {
                json(res, 401, { ok: false, message: 'unauthorized: valid ?token= required' });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/project.sb3') {
                const buf = await withLock(buildSb3);
                res.writeHead(200, { 'content-type': 'application/octet-stream' });
                res.end(buf);
                return;
            }
            if (req.method === 'POST' && url.pathname === '/editor.sb3') {
                const chunks: Buffer[] = [];
                let size = 0;
                for await (const c of req) {
                    chunks.push(c as Buffer);
                    size += (c as Buffer).length;
                    if (size > 50 * 1024 * 1024) {
                        json(res, 413, { ok: false, message: 'sb3 too large' });
                        return;
                    }
                }
                const { status, json: out } = await handleEditorPost(Buffer.concat(chunks), req.headers['x-base-rev'] as string ?? null);
                json(res, status, out);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/status') {
                const h = await hashTextDir(dir);
                json(res, 200, { ok: true, rev, name, format: formatName, clean: h === lastTextHash, textHash: h.slice(0, 12), log: logs.slice(-20) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/client.js') {
                // Panel bundle built by packages/panel (another agent); fall
                // back to the plain sync client when it is not built yet.
                let file = join(ROOT, 'packages', 'panel', 'dist', 'agentwarp-client.js');
                try {
                    await stat(file);
                } catch {
                    file = join(ROOT, 'packages', 'bridge', 'client', 'agentwarp-client.js');
                }
                let buf: Buffer;
                try {
                    buf = await readFile(file);
                } catch {
                    json(res, 404, { ok: false, message: 'panel bundle not available' });
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
                res.end(buf);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/file') {
                const served = await serveImageFile(dir, url.searchParams.get('path') ?? '');
                if (!served) {
                    json(res, 404, { ok: false, message: 'not found' });
                    return;
                }
                // Project SVGs come from untrusted sb3s: never let one run script on
                // the bridge origin if it is opened directly (the URL carries the token).
                res.writeHead(200, {
                    'content-type': served.contentType,
                    'cache-control': 'no-store',
                    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                    'x-content-type-options': 'nosniff',
                });
                res.end(served.buf);
                return;
            }
            json(res, 404, { ok: false, message: `unknown route ${url.pathname}` });
        } catch (e) {
            log(`http error: ${(e as Error)?.message}`);
            try {
                json(res, 500, { ok: false, message: (e as Error)?.message });
            } catch {
                /* already sent */
            }
        }
    });

    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.searchParams.get('token') !== token && req.headers['x-bridge-token'] !== token) {
            try {
                ws.close(4401, 'unauthorized');
            } catch {
                /* ignore */
            }
            return;
        }
        clients.add(ws);
        try {
            ws.send(JSON.stringify({ type: 'hello', rev, name, session }));
        } catch {
            /* ignore */
        }
        ws.on('message', (data) => {
            let msg: any;
            try {
                msg = JSON.parse(String(data));
            } catch {
                return;
            }
            if (typeof msg?.type === 'string' && msg.type.startsWith('acp/')) {
                void acp.handle(msg, (reply) => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
                }).catch((e) => log(`acp error: ${(e as Error)?.message}`));
            } else if (msg?.type === 'hello') {
                try {
                    ws.send(JSON.stringify({ type: 'hello', rev, name, session }));
                } catch {
                    /* ignore */
                }
            } else if (msg?.type === 'log') {
                log(`client: [${msg.level ?? 'info'}] ${msg.message ?? ''}`);
            }
            // ack {rev} needs no action: POSTs already carry the editor state.
        });
        ws.on('close', () => {
            clients.delete(ws);
        });
    });

    // -- watcher (per-directory fs.watch: portable, no recursive needed) -----
    const watchers = new Map<string, FSWatcher>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleAgentCycle = (): void => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void withLock(() => agentCycle(false)).catch((e) => log(`agent cycle failed: ${(e as Error)?.message}`));
        }, debounceMs());
    };
    const isIgnored = (rel: string): boolean => rel === '.agentwarp' || rel.startsWith(`.agentwarp${sep}`) || rel.startsWith('.agentwarp/');
    const syncWatchers = async (): Promise<void> => {
        const dirs: string[] = [];
        const stack = [dir];
        while (stack.length) {
            const d = stack.pop() as string;
            dirs.push(d);
            let entries;
            try {
                entries = await readdir(d, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const e of entries) {
                if (!e.isDirectory()) continue;
                if (d === dir && e.name === '.agentwarp') continue;
                if (e.name.startsWith('.')) continue;
                stack.push(join(d, e.name));
            }
        }
        const want = new Set(dirs);
        for (const d of dirs) {
            if (watchers.has(d)) continue;
            try {
                const w = watch(d, (_event, filename) => {
                    const rel = relative(dir, join(d, String(filename ?? '')));
                    if (isIgnored(rel)) return;
                    if (_event === 'rename') void syncWatchers().catch(() => undefined);
                    scheduleAgentCycle();
                });
                w.on('error', () => {
                    watchers.delete(d);
                });
                watchers.set(d, w);
            } catch {
                /* e.g. transiently missing dir */
            }
        }
        for (const [d, w] of watchers) {
            if (!want.has(d)) {
                try {
                    w.close();
                } catch {
                    /* ignore */
                }
                watchers.delete(d);
            }
        }
    };
    await syncWatchers();

    const port = await new Promise<number>((resolvePort, reject) => {
        server.on('error', reject);
        server.listen(opts.port ?? 0, '127.0.0.1', () => {
            resolvePort((server.address() as any)?.port);
        });
    });
    await writeFile(join(dir, '.agentwarp', 'serve.json'), JSON.stringify({ port, token, pid: process.pid }, null, 2) + '\n');
    const url = `ws://127.0.0.1:${port}/ws?token=${token}`;
    log(`serving ${dir} rev=${rev} at ${url}`);

    return {
        dir,
        port,
        token,
        url,
        getRev: () => rev,
        close: async () => {
            closed = true;
            await acp.dispose();
            if (debounceTimer) clearTimeout(debounceTimer);
            for (const t of timers) clearTimeout(t);
            timers.clear();
            for (const [, w] of watchers) {
                try {
                    w.close();
                } catch {
                    /* ignore */
                }
            }
            watchers.clear();
            for (const c of clients) {
                try {
                    c.close();
                } catch {
                    /* ignore */
                }
            }
            clients.clear();
            wss.close();
            await new Promise<void>((r) => server.close(() => r()));
            try {
                await rm(join(dir, '.agentwarp', 'serve.json'), { force: true });
            } catch {
                /* best effort */
            }
        },
    };
}
