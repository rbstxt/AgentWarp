/**
 * Safe re-unpack: print a project back into the text dir WITHOUT deleting
 * anything the agent may hold open beyond what unpack rewrites.
 *
 * core's unpackProject does `rm(outDir, recursive, force)` first — fine for
 * one-shot CLI unpacks, fatal for a live bridge session (it would delete
 * .agentwarp/serve.json, .agentwarp/format, and yank files an agent process
 * has open). This instead:
 *   - reuses existing target directories (matched by target.json `name`),
 *     allocates new ones for new targets, removes dirs whose target is gone;
 *   - overwrites agentwarp.json / target.json / scripts / costume+sound
 *     bytes (exactly what unpack rewrites), prunes stale files only inside
 *     the target's own costumes/ and sounds/ subdirs;
 *   - rewrites .agentwarp/base.json + anchors.json, but NEVER touches
 *     .agentwarp/format or .agentwarp/serve.json.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostic, Format, Script } from '../core/ir.ts';
import { extractTarget } from '../core/extract.ts';
import { assetFileName, sanitizeSegment } from '../core/assets.ts';
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
     * human moves (core's fresh unpack would renumber positionally). */
    prevAnchors?: Record<string, Record<string, string>>;
}

/**
 * Rewrite one target's script anchors so ids the agent already knows keep
 * their old labels; only genuinely new ids get fresh aN/cN labels.
 */
function stabilizeAnchors(scripts: Script[], fresh: Record<string, string>, prev: Record<string, string>): { scripts: Script[]; anchors: Record<string, string> } {
    const idToOld = new Map<string, string>();
    for (const [a, id] of Object.entries(prev)) {
        if (!idToOld.has(id)) idToOld.set(id, a);
    }
    const reserved = new Set(Object.keys(prev));
    const taken = new Set<string>();
    let maxA = 0;
    let maxC = 0;
    for (const a of reserved) {
        let m = /^a(\d+)$/.exec(a);
        if (m) maxA = Math.max(maxA, Number(m[1]));
        m = /^c(\d+)$/.exec(a);
        if (m) maxC = Math.max(maxC, Number(m[1]));
    }
    const freshLabel = (kind: 'a' | 'c'): string => {
        for (;;) {
            const lab = kind === 'a' ? `a${++maxA}` : `c${++maxC}`;
            if (!reserved.has(lab) && !taken.has(lab)) {
                taken.add(lab);
                return lab;
            }
        }
    };
    const claim = (id: string, kind: 'a' | 'c'): string => {
        const old = idToOld.get(id);
        if (old !== undefined && !taken.has(old)) {
            taken.add(old);
            return old;
        }
        return freshLabel(kind);
    };
    void fresh;
    const anchors: Record<string, string> = {};
    const visitBlockComments = (b: NonNullable<Script['top']>): void => {
        let cur: typeof b | undefined = b;
        while (cur) {
            if (cur.comment?.srcId) {
                const lab = claim(cur.comment.srcId, 'c');
                cur.comment.anchor = lab;
                anchors[lab] = cur.comment.srcId;
            }
            for (const inp of Object.values(cur.inputs)) {
                if ((inp.kind === 'block' || inp.kind === 'stack') && inp.block) visitBlockComments(inp.block);
            }
            cur = cur.next;
        }
    };
    for (const s of scripts) {
        if (s.kind === 'comment') {
            if (s.comment?.srcId) {
                const lab = claim(s.comment.srcId, 'c');
                s.comment.anchor = lab;
                anchors[lab] = s.comment.srcId;
            }
            continue;
        }
        if (s.srcId) {
            const lab = claim(s.srcId, 'a');
            s.anchor = lab;
            anchors[lab] = s.srcId;
        } else {
            s.anchor = undefined;
        }
        if (s.top) visitBlockComments(s.top);
    }
    return { scripts, anchors };
}

/** Mirror of core splitTargetForUnpack (not exported there). */
function splitTargetForUnpack(target: any): { targetJson: any; assets: Array<{ file: string; md5ext: string }> } {
    const { blocks, comments, variables, lists, broadcasts, costumes, sounds, name, ...scalars } = target ?? {};
    void blocks;
    void comments;
    const targetJson: any = { name, ...scalars };
    targetJson.variables = [];
    for (const [id, v] of Object.entries<any>(variables ?? {})) {
        const arr = Array.isArray(v) ? v : [v];
        targetJson.variables.push({ name: String(arr[0] ?? id), id, value: arr[1], ...(arr[2] === true ? { cloud: true } : {}) });
    }
    targetJson.lists = [];
    for (const [id, v] of Object.entries<any>(lists ?? {})) {
        const arr = Array.isArray(v) ? v : [v];
        targetJson.lists.push({ name: String(arr[0] ?? id), id, items: arr.slice(1) });
    }
    targetJson.broadcasts = [];
    for (const [id, bname] of Object.entries<any>(broadcasts ?? {})) {
        targetJson.broadcasts.push({ name: String(bname), id });
    }
    const assets: Array<{ file: string; md5ext: string }> = [];
    const assetNames = new Set<string>();
    const claimFile = (kind: 'costumes' | 'sounds', cname: string, dataFormat: string): string => {
        let file = assetFileName(kind, cname, dataFormat);
        let i = 2;
        while (assetNames.has(file)) {
            file = `${kind}/${sanitizeSegment(cname)} ~${i}.${dataFormat}`;
            i++;
        }
        assetNames.add(file);
        return file;
    };
    targetJson.costumes = [];
    for (const c of costumes ?? []) {
        const dataFormat = String(c?.dataFormat ?? 'svg');
        const file = claimFile('costumes', String(c?.name ?? 'costume'), dataFormat);
        assets.push({ file, md5ext: String(c?.md5ext ?? '') });
        const { assetId: _a, dataFormat: _d, md5ext: _m, ...rest } = c ?? {};
        void _a;
        void _d;
        void _m;
        targetJson.costumes.push({ ...rest, name: c?.name, file });
    }
    targetJson.sounds = [];
    for (const s of sounds ?? []) {
        const dataFormat = String(s?.dataFormat ?? 'wav');
        const file = claimFile('sounds', String(s?.name ?? 'sound'), dataFormat);
        assets.push({ file, md5ext: String(s?.md5ext ?? '') });
        const { assetId: _a, dataFormat: _d, md5ext: _m, ...rest } = s ?? {};
        void _a;
        void _d;
        void _m;
        targetJson.sounds.push({ ...rest, name: s?.name, file });
    }
    return { targetJson, assets };
}

function targetDirName(name: string, taken: Set<string>): string {
    let base = sanitizeSegment(name);
    if (!taken.has(base)) {
        taken.add(base);
        return base;
    }
    let i = 2;
    while (taken.has(`${base} ~${i}`)) i++;
    const out = `${base} ~${i}`;
    taken.add(out);
    return out;
}

/** Map existing directories to target names via their target.json. */
async function scanTargetDirs(dir: string): Promise<Map<string, string>> {
    const out = new Map<string, string>(); // targetName -> dirEntry
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e === '.agentwarp' || e === 'agentwarp.json') continue;
        try {
            const tj = JSON.parse(await readFile(join(dir, e, TARGET_JSON), 'utf8'));
            if (typeof tj?.name === 'string') out.set(tj.name, e);
        } catch {
            /* not a target dir */
        }
    }
    return out;
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
    const existing = await scanTargetDirs(dir);
    const taken = new Set<string>([...existing.values(), '.agentwarp', 'agentwarp.json']);
    const unpackStart = Date.now();
    const anchors: Record<string, Record<string, string>> = {};
    const wantedDirs = new Set<string>();
    const stageTarget = (project?.targets ?? []).find((t: any) => t?.isStage === true);
    const stageJson = stageTarget ? splitTargetForUnpack(stageTarget).targetJson : undefined;

    const meta = {
        formatVersion: 1,
        meta: project?.meta,
        extensions: project?.extensions ?? [],
        monitors: project?.monitors ?? [],
        extraTopLevel: Object.fromEntries(Object.entries(project ?? {}).filter(([k]) => !['targets', 'monitors', 'extensions', 'meta'].includes(k))),
    };
    await safeWrite('agentwarp.json', JSON.stringify(meta, null, 2) + '\n');

    for (const target of project?.targets ?? []) {
        const name = String(target?.name ?? 'target');
        let dirName = existing.get(name);
        if (!dirName) dirName = targetDirName(name, taken);
        else taken.add(dirName);
        wantedDirs.add(dirName);
        const tdir = join(dir, dirName);
        await mkdir(join(tdir, 'costumes'), { recursive: true });
        await mkdir(join(tdir, 'sounds'), { recursive: true });
        const { targetJson, assets } = splitTargetForUnpack(target);
        const wantedAssetFiles = new Set<string>();
        for (const a of assets) {
            wantedAssetFiles.add(a.file);
            const buf = files.get(a.md5ext);
            if (!buf) {
                diagnostics.push({ message: `target "${name}": asset bytes "${a.md5ext}" unavailable`, severity: 'error' });
                continue;
            }
            await safeWrite(`${dirName}/${a.file}`, buf);
        }
        // Prune stale asset files only inside this target's own asset dirs.
        // Skip files the agent is actively writing (mtime within the unpack).
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
        await safeWrite(`${dirName}/${TARGET_JSON}`, JSON.stringify(targetJson, null, 2) + '\n');
        const scriptsName = `scripts.${format.ext}`;
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
        const file = `${dirName}/${scriptsName}`;
        const extracted = extractTarget(target, project, { file });
        diagnostics.push(...extracted.diagnostics.filter((d) => d.severity === 'error'));
        // Keep the agent's anchor labels stable across human moves: core
        // assigns a1..N positionally, which would renumber labels when a
        // script changes column. Reuse old labels for known ids.
        const stable = stabilizeAnchors(extracted.scripts, extracted.anchors, opts.prevAnchors?.[name] ?? {});
        anchors[name] = stable.anchors;
        await safeWrite(
            file,
            format.print(stable.scripts, { targetName: name, file, targetJson, isStage: target?.isStage === true, stageJson }),
        );
    }
    // Remove target dirs that no longer exist in the project — but never a
    // dir the agent is actively writing (mtime within the unpack window).
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
}
