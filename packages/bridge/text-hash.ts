/**
 * Content hash of the agent-editable text project.
 *
 * Covers every file under the project dir EXCEPT `.agentwarp/` (machine
 * managed: base.json, anchors.json, sourcemap.json, serve.json must never
 * mark the text dirty). The bridge records this as `lastTextHash` right
 * after it last (re)printed the text; any difference means the agent (or a
 * human with a text editor) changed something that needs packing.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface FileSigs {
    files: string[];
    sigs: Map<string, string>; // rel -> sha1(bytes)
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return;
    }
    entries.sort();
    for (const e of entries) {
        if (dir === root && e === '.agentwarp') continue;
        const full = join(dir, e);
        let st;
        try {
            st = await stat(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) await walk(full, root, out);
        else if (st.isFile()) out.push(full);
    }
}

function sha1(buf: Buffer | Uint8Array): string {
    return createHash('sha1').update(buf).digest('hex');
}

/** Stable sha1 over sorted (relative path, bytes) pairs. */
export async function hashTextDir(dir: string): Promise<string> {
    const { files } = await snapshotSigs(dir);
    const h = createHash('sha1');
    const bufs = new Map<string, Buffer>();
    for (const full of files) {
        let buf: Buffer;
        try {
            buf = await readFile(full);
        } catch {
            continue;
        }
        bufs.set(full, buf);
    }
    for (const full of files) {
        const buf = bufs.get(full);
        if (!buf) continue;
        const rel = relative(dir, full);
        h.update(rel);
        h.update('\0');
        h.update(String(buf.length));
        h.update('\0');
        h.update(buf);
    }
    return h.digest('hex');
}

/** Per-file content sigs of the agent-editable tree (excludes .agentwarp). */
export async function snapshotSigs(dir: string): Promise<FileSigs> {
    const files: string[] = [];
    await walk(dir, dir, files);
    const sigs = new Map<string, string>();
    for (const full of files) {
        try {
            sigs.set(relative(dir, full), sha1(await readFile(full)));
        } catch {
            /* vanished mid-snapshot */
        }
    }
    return { files, sigs };
}

export function sigOfBytes(buf: Uint8Array | string): string {
    return sha1(typeof buf === 'string' ? Buffer.from(buf) : buf);
}
