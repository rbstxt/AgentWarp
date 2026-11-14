/**
 * Adopt mode for `agentwarp serve <empty dir>`: instead of pushing a project INTO the editor
 * (which would replace whatever the user has open), wait for the editor to send its current
 * project, unpack it into the dir, then hand over to the normal bridge on the same port.
 *
 * Speaks just enough of the bridge protocol for the loader and the sync client:
 *   GET  /status            -> {ok, adopt: true, name}
 *   GET  /client.js         -> the panel bundle (same files as the bridge)
 *   WS   /ws                -> {type: 'hello', adopt: true, rev: null, name}
 *   POST /adopt.sb3?title=&key= -> body = editor sb3; resolves waitForAdopt with it
 * Every request needs the token (query ?token= or header x-bridge-token).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_SB3 = 200 * 1024 * 1024;

export interface AdoptOptions {
    port: number;
    token: string;
    name: string;
    log?: (line: string) => void;
}

export interface Adopted {
    sb3: Buffer;
    /** TurboWarp's project title (may be empty) */
    title: string;
    /** desktop app: path of the file open in the editor ('' for an unsaved project) */
    key: string;
}

/** Resolves with the editor's project once an editor posts it. The port is free again on return. */
export async function waitForAdopt(opts: AdoptOptions): Promise<Adopted> {
    const log = opts.log ?? ((line: string) => process.stderr.write(`[adopt] ${line}\n`));
    const authed = (req: IncomingMessage, url: URL): boolean =>
        url.searchParams.get('token') === opts.token || req.headers['x-bridge-token'] === opts.token;
    const json = (res: ServerResponse, status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
    };
    let resolveDone!: (a: Adopted) => void;
    const done = new Promise<Adopted>((r) => (resolveDone = r));
    const sockets = new Set<WebSocket>();

    const server = createServer(async (req, res) => {
        res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
        res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        res.setHeader('access-control-allow-headers', 'content-type, x-base-rev, x-bridge-token');
        res.setHeader('access-control-allow-private-network', 'true');
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (!authed(req, url)) { json(res, 401, { ok: false, message: 'unauthorized: valid ?token= required' }); return; }
        try {
            if (req.method === 'GET' && url.pathname === '/status') {
                json(res, 200, { ok: true, adopt: true, name: opts.name, rev: null });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/client.js') {
                let file = join(ROOT, 'packages', 'panel', 'dist', 'agentwarp-client.js');
                if (!existsSync(file)) file = join(ROOT, 'packages', 'bridge', 'client', 'agentwarp-client.js');
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end(await readFile(file));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/adopt.sb3') {
                const chunks: Buffer[] = [];
                let size = 0;
                for await (const c of req) {
                    size += (c as Buffer).length;
                    if (size > MAX_SB3) { json(res, 413, { ok: false, message: 'project too large' }); return; }
                    chunks.push(c as Buffer);
                }
                const buf = Buffer.concat(chunks);
                if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) { json(res, 400, { ok: false, message: 'not an sb3 (zip) file' }); return; }
                json(res, 200, { ok: true, adopted: true });
                log(`received the editor project (${buf.length} bytes)`);
                resolveDone({
                    sb3: buf,
                    title: (url.searchParams.get('title') ?? '').slice(0, 200),
                    key: (url.searchParams.get('key') ?? '').slice(0, 4096),
                });
                return;
            }
            json(res, 404, { ok: false, message: `adopt mode: unknown route ${url.pathname}` });
        } catch (e) {
            json(res, 500, { ok: false, message: (e as Error)?.message });
        }
    });
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (!authed(req, url)) { ws.close(4401, 'unauthorized'); return; }
        sockets.add(ws);
        ws.on('close', () => sockets.delete(ws));
        ws.send(JSON.stringify({ type: 'hello', adopt: true, rev: null, name: opts.name }));
    });
    await new Promise<void>((ok, fail) => {
        server.once('error', fail);
        server.listen(opts.port, '127.0.0.1', () => ok());
    });
    log(`waiting for TurboWarp on http://127.0.0.1:${opts.port}: the project open in the editor will be adopted`);
    const adopted = await done;
    // Free the port for the real bridge: drop sockets (clients reconnect), close the listener.
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ignore */ } }
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
    return adopted;
}
