/**
 * Filesystem TurnStore for agent-panel turns (P7 §6).
 *
 * Layout: `.agentwarp/checkpoints/<sessionId>/<turnId>/` holds a copy of
 * the text state (every top-level entry except `.agentwarp/`, i.e. all
 * `<Target>/` dirs + `agentwarp.json`), plus `.agentwarp/anchors.json`,
 * `.agentwarp/sourcemap.json` and `.agentwarp/base.json` copies (needed to
 * restore anchor identity and to diff), plus `rev.json` (the bridge rev the
 * snapshot was taken at). The last 50 checkpoints per session are kept.
 *
 * Diffing packs the snapshot text (in memory, against the snapshot base)
 * and compares top-level scripts with the current base by top-block id,
 * reusing the preservation-diff identity idea from tools/vmrun/lib/diff.mjs
 * (script identity by top block id / anchors).
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { extractTarget } from '../core/extract.ts';
import { irScriptEqual } from '../core/reconcile.ts';
import { packAgainst } from '../core/project-dir.ts';
import type { Block, Format, Loc, Script } from '../core/ir.ts';
import type { ChangeScript, ChangeTarget, TurnStore } from '../acp/src/index.ts';

const MAX_PER_SESSION = 50;

export interface FsTurnStoreDeps {
    dir: string;
    format: Format;
    getRev(): number;
    getBase(): any;
}

const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

function ckptDir(dir: string, sessionId: string, turnId: string): string {
    // Both ids arrive from the client: never let them address paths outside checkpoints/.
    if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(turnId) || sessionId.includes('..') || turnId.includes('..')) {
        throw new Error(`invalid checkpoint id ${JSON.stringify(sessionId)}/${JSON.stringify(turnId)}`);
    }
    return join(dir, '.agentwarp', 'checkpoints', sessionId, turnId);
}

/** Project text state = target dirs (they hold target.json) + agentwarp.json. Never .git, tests, notes. */
async function isProjectEntry(dir: string, e: string): Promise<boolean> {
    if (e.startsWith('.')) return false;
    if (e === 'agentwarp.json') return true;
    try {
        return (await stat(join(dir, e, 'target.json'))).isFile();
    } catch {
        return false;
    }
}

async function readJson(file: string): Promise<any | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    } catch {
        return null;
    }
}

/** Invert anchor maps (anchor -> id) into id -> anchor (first label wins). */
function invertAnchors(anchors: Record<string, Record<string, string>>): Map<string, string> {
    const out = new Map<string, string>();
    for (const perTarget of Object.values(anchors ?? {})) {
        for (const [anchor, id] of Object.entries(perTarget ?? {})) {
            if (typeof id === 'string' && !out.has(id)) out.set(id, anchor);
        }
    }
    return out;
}

/** Map target names to their on-disk directory entries via target.json. */
async function scanTargetDirs(root: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let entries: string[];
    try {
        entries = await readdir(root);
    } catch {
        return out;
    }
    for (const e of entries.sort()) {
        if (e === '.agentwarp' || e === 'agentwarp.json') continue;
        try {
            const tj = JSON.parse(await readFile(join(root, e, 'target.json'), 'utf8'));
            if (typeof tj?.name === 'string' && !out.has(tj.name)) out.set(tj.name, e);
        } catch {
            /* not a target dir */
        }
    }
    return out;
}

async function readTargetJsons(root: string, dirs: Map<string, string>): Promise<Map<string, any>> {
    const out = new Map<string, any>();
    for (const [name, entry] of dirs) {
        out.set(name, await readJson(join(root, entry, 'target.json')));
    }
    return out;
}

function countBlocks(top: Block | undefined): number {
    if (!top) return 0;
    let n = 0;
    const seen = new Set<Block>();
    const stack: Block[] = [top];
    while (stack.length > 0) {
        const b = stack.pop() as Block;
        if (seen.has(b)) continue;
        seen.add(b);
        n += 1;
        if (b.next) stack.push(b.next);
        for (const inp of Object.values(b.inputs)) {
            if ((inp.kind === 'block' || inp.kind === 'stack') && inp.block) stack.push(inp.block);
        }
    }
    return n;
}

function oneLineLabel(script: Script, printed: string): string {
    if (script.kind === 'comment') {
        const text = (script.comment?.text ?? '').split('\n')[0] ?? '';
        return text.slice(0, 80) || '(comment)';
    }
    const first = printed
        .split('\n')
        .map((l) => l.trimEnd())
        .find((l) => l.trim() !== '' && !l.startsWith('@'));
    const head = (first ?? '(script)').slice(0, 80);
    const n = countBlocks(script.top);
    return `${head} · ${n} block${n === 1 ? '' : 's'}`;
}

function relFile(dir: string, absFile: string | undefined, fallback: string): string {
    if (typeof absFile === 'string' && absFile) {
        const rel = relative(dir, absFile);
        if (rel && !rel.startsWith('..')) return rel;
    }
    return fallback;
}

/** Line of an `@anchor` header inside a scripts file (fallback when the sourcemap lacks an id). */
async function findAnchorLine(root: string, entry: string, ext: string, anchor: string): Promise<number | null> {
    let text: string;
    try {
        text = await readFile(join(root, entry, `scripts.${ext}`), 'utf8');
    } catch {
        return null;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === `@${anchor}`) return i + 1;
    }
    return null;
}

export function createFsTurnStore(deps: FsTurnStoreDeps): TurnStore {
    const { dir, format } = deps;

    async function snapshot(sessionId: string, turnId: string): Promise<void> {
        const ckpt = ckptDir(dir, sessionId, turnId);
        await mkdir(join(ckpt, '.agentwarp'), { recursive: true });
        const entries = await readdir(dir);
        for (const e of entries.sort()) {
            if (!(await isProjectEntry(dir, e))) continue;
            await cp(join(dir, e), join(ckpt, e), { recursive: true });
        }
        for (const f of ['anchors.json', 'sourcemap.json', 'base.json']) {
            try {
                await cp(join(dir, '.agentwarp', f), join(ckpt, '.agentwarp', f));
            } catch {
                /* anchors/sourcemap may not exist on a fresh project */
            }
        }
        await writeFile(join(ckpt, 'rev.json'), JSON.stringify({ rev: deps.getRev() }) + '\n');
        // Keep the last 50 checkpoints per session (oldest mtime first).
        const sessDir = join(dir, '.agentwarp', 'checkpoints', sessionId);
        const turns = await readdir(sessDir);
        if (turns.length > MAX_PER_SESSION) {
            const withTime = await Promise.all(
                turns.map(async (t) => {
                    try {
                        return { t, mtime: (await stat(join(sessDir, t))).mtimeMs };
                    } catch {
                        return { t, mtime: 0 };
                    }
                }),
            );
            withTime.sort((a, b) => a.mtime - b.mtime);
            for (const { t } of withTime.slice(0, withTime.length - MAX_PER_SESSION)) {
                await rm(join(sessDir, t), { recursive: true, force: true });
            }
        }
    }

    async function restore(sessionId: string, turnId: string): Promise<number> {
        const ckpt = ckptDir(dir, sessionId, turnId);
        try {
            await stat(ckpt);
        } catch {
            throw new Error(`unknown checkpoint ${sessionId}/${turnId}`);
        }
        const revDoc = await readJson(join(ckpt, 'rev.json'));
        const ckptEntries = new Set(await readdir(ckpt));
        // Write the snapshot text back: full-replace each snapshotted entry.
        for (const e of [...ckptEntries].sort()) {
            if (e === '.agentwarp' || e === 'rev.json') continue;
            await rm(join(dir, e), { recursive: true, force: true });
            await cp(join(ckpt, e), join(dir, e), { recursive: true });
        }
        // Remove target dirs created after the snapshot.
        const liveEntries = await readdir(dir);
        for (const e of liveEntries) {
            if (e === 'agentwarp.json' || ckptEntries.has(e)) continue;
            if (await isProjectEntry(dir, e)) await rm(join(dir, e), { recursive: true, force: true });
        }
        if (typeof revDoc?.rev !== 'number') throw new Error(`checkpoint ${sessionId}/${turnId} has no rev`);
        return revDoc.rev;
    }

    async function diff(sessionId: string, turnId: string): Promise<ChangeTarget[]> {
        const ckpt = ckptDir(dir, sessionId, turnId);
        try {
            await stat(ckpt);
        } catch {
            throw new Error(`unknown checkpoint ${sessionId}/${turnId}`);
        }
        const snapshotBase = await readJson(join(ckpt, '.agentwarp', 'base.json'));
        if (!snapshotBase) throw new Error(`checkpoint ${sessionId}/${turnId} has no base`);
        const snapshotAnchors = (await readJson(join(ckpt, '.agentwarp', 'anchors.json'))) ?? {};
        let checkpointProject: any = snapshotBase;
        try {
            const packed = await packAgainst(ckpt, format, {
                baseProject: snapshotBase,
                baseText: JSON.stringify(snapshotBase),
                anchors: snapshotAnchors,
            });
            if (packed.diagnostics.filter((d) => d.severity === 'error').length === 0) {
                checkpointProject = packed.project;
            }
        } catch {
            /* fall back to the snapshot base (e.g. syntax errors in flight) */
        }
        const base = deps.getBase();
        const liveAnchors = (await readJson(join(dir, '.agentwarp', 'anchors.json'))) ?? {};
        const liveSourcemap = (await readJson(join(dir, '.agentwarp', 'sourcemap.json'))) ?? {};
        const snapshotSourcemap = (await readJson(join(ckpt, '.agentwarp', 'sourcemap.json'))) ?? {};
        const liveDirs = await scanTargetDirs(dir);
        const snapshotDirs = await scanTargetDirs(ckpt);
        const liveTargetJsons = await readTargetJsons(dir, liveDirs);
        const snapshotTargetJsons = await readTargetJsons(ckpt, snapshotDirs);
        const liveAnchorsInv = invertAnchors(liveAnchors);
        const snapshotAnchorsInv = invertAnchors(snapshotAnchors);

        const targetsByName = new Map<string, any>();
        for (const t of checkpointProject?.targets ?? []) targetsByName.set(String(t?.name), t);
        const baseByName = new Map<string, any>();
        for (const t of base?.targets ?? []) baseByName.set(String(t?.name), t);

        const renderOne = async (
            name: string,
            target: any,
            project: any,
            script: Script,
            rootDir: string,
            dirs: Map<string, string>,
            targetJsons: Map<string, any>,
            sourcemap: Record<string, Loc>,
            anchorsInv: Map<string, string>,
            status: ChangeScript['status'],
        ): Promise<ChangeScript> => {
            const entry = dirs.get(name) ?? name;
            const file = `${entry}/scripts.${format.ext}`;
            const printed = format.print([script], {
                targetName: name,
                file,
                targetJson: targetJsons.get(name),
                isStage: target?.isStage === true,
            });
            const loc = (script.srcId ? (sourcemap as Record<string, Loc>)[script.srcId] : undefined) as Loc | undefined;
            const anchor = script.srcId ? anchorsInv.get(script.srcId) : undefined;
            let line = typeof loc?.line === 'number' ? loc.line : undefined;
            if (line === undefined && anchor) {
                line = (await findAnchorLine(rootDir, entry, format.ext, anchor)) ?? undefined;
            }
            return {
                status,
                topBlockId: script.srcId ?? '',
                ...(anchor ? { anchor } : {}),
                label: oneLineLabel(script, printed),
                scratchblocks: printed,
                file: relFile(rootDir, loc?.file, file),
                ...(line !== undefined ? { line } : {}),
            };
        };

        const renderAll = async (
            name: string,
            target: any,
            project: any,
            rootDir: string,
            dirs: Map<string, string>,
            targetJsons: Map<string, any>,
            sourcemap: Record<string, Loc>,
            anchorsInv: Map<string, string>,
            status: ChangeScript['status'],
        ): Promise<ChangeScript[]> => {
            const ext = extractTarget(target, project, {});
            const out: ChangeScript[] = [];
            for (const s of ext.scripts) {
                if (s.srcId) out.push(await renderOne(name, target, project, s, rootDir, dirs, targetJsons, sourcemap, anchorsInv, status));
            }
            return out;
        };

        const out: ChangeTarget[] = [];
        const order = [...baseByName.keys(), ...[...targetsByName.keys()].filter((n) => !baseByName.has(n))];
        for (const name of order) {
            const tC = targetsByName.get(name);
            const tB = baseByName.get(name);
            if (!tC) {
                out.push({
                    name,
                    isStage: tB?.isStage === true,
                    scripts: await renderAll(name, tB, base, dir, liveDirs, liveTargetJsons, liveSourcemap, liveAnchorsInv, 'added'),
                });
                continue;
            }
            if (!tB) {
                out.push({
                    name,
                    isStage: tC?.isStage === true,
                    scripts: await renderAll(name, tC, checkpointProject, ckpt, snapshotDirs, snapshotTargetJsons, snapshotSourcemap, snapshotAnchorsInv, 'deleted'),
                });
                continue;
            }
            const extC = extractTarget(tC, checkpointProject, {});
            const extB = extractTarget(tB, base, {});
            const byC = new Map<string, Script>();
            for (const s of extC.scripts) if (s.srcId) byC.set(s.srcId, s);
            const byB = new Map<string, Script>();
            for (const s of extB.scripts) if (s.srcId) byB.set(s.srcId, s);
            const scripts: ChangeScript[] = [];
            for (const s of extB.scripts) {
                if (!s.srcId || !byC.has(s.srcId)) {
                    scripts.push(await renderOne(name, tB, base, s, dir, liveDirs, liveTargetJsons, liveSourcemap, liveAnchorsInv, 'added'));
                } else if (!irScriptEqual(byC.get(s.srcId) as Script, s)) {
                    scripts.push(await renderOne(name, tB, base, s, dir, liveDirs, liveTargetJsons, liveSourcemap, liveAnchorsInv, 'changed'));
                }
            }
            for (const s of extC.scripts) {
                if (s.srcId && !byB.has(s.srcId)) {
                    scripts.push(await renderOne(name, tC, checkpointProject, s, ckpt, snapshotDirs, snapshotTargetJsons, snapshotSourcemap, snapshotAnchorsInv, 'deleted'));
                }
            }
            out.push({ name, isStage: tB?.isStage === true, scripts });
        }
        return out;
    }

    return { getRev: () => deps.getRev(), snapshot, restore, diff };
}
