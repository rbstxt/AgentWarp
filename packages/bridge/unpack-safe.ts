/**
 * Safe re-unpack: print a project back into the text dir WITHOUT deleting
 * anything the agent may hold open beyond what unpack rewrites.
 *
 * Dir/anchor bookkeeping is delegated to core `unpackInto` (which owns
 * splitTargetForUnpack, target-dir matching, stale pruning, and the fixed
 * `stabilizeAnchors` that keeps BOTH the script label aN and the comment
 * label cN of workspace comments stable across human moves). Because core
 * writes directly, we unpack into a staging dir first and then copy each
 * file over with the bridge-only race protocol:
 *   - `skipChangedSince`: per-file sigs captured before packing; files the
 *     agent touched afterwards are OURS to skip (never clobber newer agent
 *     work), reported in `skipped` for the follow-up pack to adopt;
 *   - `raced`: post-write verification; bytes that no longer match what we
 *     wrote mean the agent won a race mid-unpack and need a follow-up pack;
 *   - prune/delete steps skip files the agent is actively writing (mtime
 *     within the unpack window).
 * Rewrites `.agentwarp/base.json` + anchors.json, but NEVER touches
 * `.agentwarp/format` or `.agentwarp/serve.json`.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Diagnostic, Format } from '../core/ir.ts';
import { unpackInto } from '../core/project-dir.ts';
import { sigOfBytes } from './text-hash.ts';

const TARGET_JSON = 'target.json';

export interface ReunpackResult {
    diagnostics: Diagnostic[];
    anchors: Record<string, Record<string, string>>;
    /** Relative paths we refused to overwrite (agent touched them mid-unpack). */
    skipped: string[];
    /** Relative paths whose bytes differ from what we wrote (agent won a race). */
    raced: string[];
}

export interface ReunpackOptions {
    /** Per-file sigs captured before packing: files that changed since are
     * the agent's newer work — skip them instead of clobbering. */
    skipChangedSince?: Map<string, string>;
    /** Previously published anchors per target: known block/comment ids keep
     * their old labels so agent-held `@aN` references stay valid across
     * human moves. */
    prevAnchors?: Record<string, Record<string, string>>;
}

export async function reunpackText(
    dir: string,
    format: Format,
    project: any,
    projectText: string,
    files: Map<string, Uint8Array>,
    opts: ReunpackOptions = {},
): Promise<ReunpackResult> {
    const diagnostics: Diagnostic[] = [];
    const skipped: string[] = [];
    const raced: string[] = [];
    const written = new Map<string, string>(); // rel -> sig of bytes we wrote
    const skipSigs = opts.skipChangedSince;
    /** Write unless the agent changed this file since the pack snapshot. */
    const safeWrite = async (rel: string, data: Uint8Array | string): Promise<void> => {
        if (skipSigs?.has(rel)) {
            let cur: string | null = null;
            try {
                cur = sigOfBytes(await readFile(join(dir, rel)));
            } catch {
                cur = null; // deleted by the agent: treat as changed, skip
            }
            if (cur !== skipSigs.get(rel)) {
                skipped.push(rel);
                return;
            }
        }
        await writeFile(join(dir, rel), data);
        written.set(rel, sigOfBytes(data));
    };
    const unpackStart = Date.now();
    const stage = await mkdtemp(join(tmpdir(), 'aw-reunpack-'));
    try {
        // Core owns all dir/anchor bookkeeping; the staging dir keeps its
        // direct writes off the live tree so the race protocol below holds.
        const core = await unpackInto(project, files, stage, format, { prevAnchors: opts.prevAnchors });
        diagnostics.push(...core.diagnostics.filter((d) => d.severity === 'error'));
        const anchors = core.anchors;

        const meta = await readFile(join(stage, 'agentwarp.json'), 'utf8');
        await safeWrite('agentwarp.json', meta);

        const stageEntries = (await readdir(stage)).filter((e) => e !== '.agentwarp' && e !== 'agentwarp.json');
        const wantedDirs = new Set<string>(stageEntries);
        const scriptsName = `scripts.${format.ext}`;
        for (const e of stageEntries.sort()) {
            const sdir = join(stage, e);
            const tdir = join(dir, e);
            await mkdir(join(tdir, 'costumes'), { recursive: true });
            await mkdir(join(tdir, 'sounds'), { recursive: true });
            // target.json + scripts.
            await safeWrite(`${e}/${TARGET_JSON}`, await readFile(join(sdir, TARGET_JSON)));
            await safeWrite(`${e}/${scriptsName}`, await readFile(join(sdir, scriptsName)));
            // Remove a stale scripts file from a previous format, if any.
            try {
                for (const n of await readdir(tdir)) {
                    if (n !== scriptsName && n.startsWith('scripts.')) {
                        try {
                            await rm(join(tdir, n));
                        } catch {
                            /* ignore */
                        }
                    }
                }
            } catch {
                /* ignore */
            }
            // Asset bytes; prune stale files only inside the target's own
            // asset dirs, skipping files the agent is actively writing.
            const wantedAssetFiles = new Set<string>();
            for (const sub of ['costumes', 'sounds']) {
                let names: string[] = [];
                try {
                    names = await readdir(join(sdir, sub));
                } catch {
                    continue;
                }
                for (const n of names) {
                    wantedAssetFiles.add(`${sub}/${n}`);
                    await safeWrite(`${e}/${sub}/${n}`, await readFile(join(sdir, sub, n)));
                }
            }
            for (const sub of ['costumes', 'sounds']) {
                let names: string[] = [];
                try {
                    names = await readdir(join(tdir, sub));
                } catch {
                    continue;
                }
                for (const n of names) {
                    const rel = `${sub}/${n}`;
                    if (!wantedAssetFiles.has(rel)) {
                        try {
                            const st = await stat(join(tdir, rel));
                            if (st.mtimeMs >= unpackStart - 1000) continue;
                            await rm(join(tdir, rel));
                        } catch {
                            /* already gone */
                        }
                    }
                }
            }
        }
        // Remove target dirs that no longer exist in the project — but never
        // a dir the agent is actively writing (mtime within the unpack
        // window), and never non-target files (agent scratch).
        for (const e of await readdir(dir)) {
            if (e === '.agentwarp' || e === 'agentwarp.json' || wantedDirs.has(e)) continue;
            try {
                const st = await stat(join(dir, e, TARGET_JSON));
                if (st.mtimeMs >= unpackStart - 1000) continue;
                await readFile(join(dir, e, TARGET_JSON), 'utf8');
                await rm(join(dir, e), { recursive: true, force: true });
            } catch {
                /* not a target dir (agent scratch files): leave alone */
            }
        }
        await mkdir(join(dir, '.agentwarp'), { recursive: true });
        await writeFile(join(dir, '.agentwarp', 'anchors.json'), JSON.stringify(anchors, null, 2) + '\n');
        await writeFile(join(dir, '.agentwarp', 'base.json'), projectText);
        // Detect agent writes that won the race against our per-file writes:
        // anything whose bytes no longer match what we wrote needs a follow-up.
        for (const [rel, sig] of written) {
            try {
                if (sigOfBytes(await readFile(join(dir, rel))) !== sig) raced.push(rel);
            } catch {
                raced.push(rel);
            }
        }
        // Deliberately NOT touching .agentwarp/format or .agentwarp/serve.json.
        return { diagnostics, anchors, skipped, raced };
    } finally {
        await rm(stage, { recursive: true, force: true });
    }
}
