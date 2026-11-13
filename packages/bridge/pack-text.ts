/**
 * Pack the text project dir against an ARBITRARY base project object.
 *
 * packages/core/project-dir.ts `packDir` always reads `.agentwarp/base.json`
 * as the reconcile base. The bridge needs two extra modes:
 *   1. agent-edit cycle: pack against the in-memory base (== base.json, but
 *      without racing another writer of that file);
 *   2. editor-edit merge: pack the (three-way merged) text against the
 *      EDITOR's project with the current anchors (the editor preserves block
 *      ids, so anchors still resolve and untouched scripts reuse the
 *      editor's JSON verbatim, keeping the human's positions).
 *
 * Mode 1 delegates to core `packAgainst` (which owns readTargetDir +
 * reconcile + sprite rename/layerOrder/minting logic); this file only
 * persists minted ids back into target.json (like core `packDir`) and writes
 * the sourcemap. Mode 2 packs already-merged in-memory IR (virtual
 * editor-only targets have no dir yet, so `packAgainst` cannot read them);
 * it still reads the disk via core `readTargetDir` for parse diagnostics and
 * asset bytes.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostic, Format } from '../core/ir.ts';
import { packAgainst, readTargetDir, type MintedId } from '../core/project-dir.ts';
import { reconcileProject, type Placement, type TargetDecls } from '../core/reconcile.ts';
import { placeNew } from '../core/layout.ts';
import type { AnchorMap } from '../core/extract.ts';

export interface TextState {
    perTarget: Record<string, { scripts: any[]; anchors: AnchorMap }>;
    declsByTarget: Record<string, TargetDecls>;
    meta: { meta: any; extensions: any[]; monitors: any[]; extraTopLevel: Record<string, any> };
    /** Parse-level diagnostics (syntax errors etc.), before reconcile. */
    diagnostics: Diagnostic[];
    /** Asset bytes keyed by md5ext (from core readTargetDir). */
    files: Map<string, Uint8Array>;
    /** Ids minted for id-less declarations (persisted on pack). */
    mintedIds: MintedId[];
}

export interface PackOverrides {
    perTarget: TextState['perTarget'];
    declsByTarget: Record<string, TargetDecls>;
    meta: TextState['meta'];
    /** Asset bytes for virtual (editor-only) targets that have no dir yet. */
    extraFiles?: Map<string, Uint8Array>;
}

export interface PackTextResult {
    project: any;
    projectText: string;
    files: Map<string, Uint8Array>;
    diagnostics: Diagnostic[];
    placements: Placement[];
    changed: boolean;
    mintedIds: MintedId[];
}

const TARGET_JSON = 'target.json';

/** Persist minted ids back into their target.json files (mirrors core packDir). */
async function persistMintedIds(dir: string, mintedIds: MintedId[]): Promise<void> {
    if (mintedIds.length === 0) return;
    const byDir = new Map<string, MintedId[]>();
    for (const m of mintedIds) {
        const list = byDir.get(m.dir) ?? [];
        list.push(m);
        byDir.set(m.dir, list);
    }
    const kindKey: Record<MintedId['kind'], string> = { variable: 'variables', list: 'lists', broadcast: 'broadcasts' };
    for (const [dirEntry, list] of byDir) {
        const p = join(dir, dirEntry, TARGET_JSON);
        try {
            const tj = JSON.parse(await readFile(p, 'utf8'));
            for (const m of list) {
                const arr = (tj as any)?.[kindKey[m.kind]];
                if (Array.isArray(arr) && arr[m.index] && typeof arr[m.index] === 'object') arr[m.index].id = m.id;
            }
            await writeFile(p, JSON.stringify(tj, null, 2) + '\n');
        } catch {
            /* leave diagnostics from the pack; don't add new ones */
        }
    }
}

/** Read the text dir into reconcile inputs (no base needed). */
export async function readTextState(dir: string, format: Format): Promise<TextState> {
    const diagnostics: Diagnostic[] = [];
    let anchors: Record<string, Record<string, string>> = {};
    try {
        anchors = JSON.parse(await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'));
    } catch {
        /* fresh project; no anchors yet */
    }
    const meta = JSON.parse(await readFile(join(dir, 'agentwarp.json'), 'utf8'));
    const entries = (await readdir(dir)).filter((e) => e !== '.agentwarp' && e !== 'agentwarp.json');
    const perTarget: TextState['perTarget'] = {};
    const declsByTarget: Record<string, TargetDecls> = {};
    const files = new Map<string, Uint8Array>();
    const seenNames = new Set<string>();
    const usedIds = new Set<string>();
    const seenIds = new Set<string>();
    const seenDetail = new Map<string, { kind: string; name: string }>();
    const mintedIds: MintedId[] = [];
    let stageJson: any = undefined;
    for (const e of entries) {
        try {
            const tj = JSON.parse(await readFile(join(dir, e, TARGET_JSON), 'utf8'));
            if (tj?.isStage === true) stageJson = tj;
        } catch {
            /* not a target dir */
        }
    }
    for (const e of entries.sort()) {
        const tdir = join(dir, e);
        let tj: any = null;
        try {
            tj = JSON.parse(await readFile(join(tdir, TARGET_JSON), 'utf8'));
        } catch {
            continue;
        }
        const name = String(tj?.name ?? e);
        if (seenNames.has(name)) {
            diagnostics.push({ message: `duplicate target "${name}" (directory "${e}"); only one kept`, severity: 'error' });
            continue;
        }
        seenNames.add(name);
        const r = await readTargetDir(tdir, name, format, diagnostics, stageJson, {
            usedIds,
            seenIds,
            seenDetail,
            mintedIds,
        });
        if (!r) continue;
        perTarget[name] = { scripts: r.scripts, anchors: anchors[name] ?? {} };
        declsByTarget[name] = r.decls;
        for (const [k, v] of r.files) {
            if (!files.has(k)) files.set(k, v);
        }
    }
    return {
        perTarget,
        declsByTarget,
        meta: { meta: meta?.meta, extensions: meta?.extensions ?? [], monitors: meta?.monitors ?? [], extraTopLevel: meta?.extraTopLevel ?? {} },
        diagnostics,
        files,
        mintedIds,
    };
}

/**
 * Asset bytes keyed by md5ext, via core readTargetDir (no duplicated hashing
 * walk). Kept for the server's startup asset load.
 */
export async function collectAssetFiles(dir: string, format: Format): Promise<Map<string, Uint8Array>> {
    const ts = await readTextState(dir, format);
    return ts.files;
}

export async function packTextAgainstBase(
    dir: string,
    format: Format,
    baseProject: any,
    baseText: string,
    anchors: Record<string, AnchorMap>,
    overrides?: PackOverrides,
): Promise<PackTextResult> {
    if (!overrides) {
        const r = await packAgainst(dir, format, { baseProject, baseText, anchors });
        await persistMintedIds(dir, r.mintedIds);
        await mkdir(join(dir, '.agentwarp'), { recursive: true });
        await writeFile(join(dir, '.agentwarp', 'sourcemap.json'), JSON.stringify(r.sourcemap, null, 2) + '\n');
        return {
            project: r.project,
            projectText: r.projectText,
            files: r.files,
            diagnostics: r.diagnostics,
            placements: r.placements,
            changed: r.changed,
            mintedIds: r.mintedIds,
        };
    }
    // Merge path: the caller already built merged IR (including virtual
    // editor-only targets with no dir), so pack it in memory. Disk is only
    // re-read for parse-level diagnostics and asset bytes.
    const perTarget = overrides.perTarget;
    const declsByTarget = overrides.declsByTarget;
    const meta = overrides.meta;
    const ts = await readTextState(dir, format);
    const diagnostics: Diagnostic[] = [...ts.diagnostics];
    const files = new Map<string, Uint8Array>(ts.files);
    if (overrides.extraFiles) {
        for (const [k, v] of overrides.extraFiles) {
            if (!files.has(k)) files.set(k, v);
        }
    }
    // Per-target anchors: text state's own anchor maps, overlaid with the
    // passed-in anchors (the merge extends them with synthetic entries for
    // editor-only scripts, which must reach reconcile).
    const mergedPerTarget: TextState['perTarget'] = {};
    for (const [name, per] of Object.entries(perTarget)) {
        mergedPerTarget[name] = { scripts: per.scripts, anchors: { ...(anchors[name] ?? {}), ...per.anchors } };
    }
    for (const [name, am] of Object.entries(anchors)) {
        if (!mergedPerTarget[name]) continue;
        mergedPerTarget[name] = { scripts: mergedPerTarget[name].scripts, anchors: { ...am, ...mergedPerTarget[name].anchors } };
    }

    const reconciled = reconcileProject(baseProject, mergedPerTarget, declsByTarget, { file: undefined });
    diagnostics.push(...reconciled.diagnostics);
    const baseTop = {
        meta: baseProject?.meta,
        extensions: baseProject?.extensions ?? [],
        monitors: baseProject?.monitors ?? [],
        extraTopLevel: Object.fromEntries(Object.entries(baseProject ?? {}).filter(([k]) => !['targets', 'monitors', 'extensions', 'meta'].includes(k))),
    };
    const newTop = { meta: meta?.meta, extensions: meta?.extensions ?? [], monitors: meta?.monitors ?? [], extraTopLevel: meta?.extraTopLevel ?? {} };
    const metaSame = JSON.stringify(baseTop) === JSON.stringify(newTop);
    let project = reconciled.project;
    let changed = !reconciled.unchanged;
    for (const pl of reconciled.placements) {
        if (!pl.newScriptIds.length && !pl.newCommentIds.length) continue;
        const target = project?.targets?.find((t: any) => t?.name === pl.target);
        if (!target) continue;
        const pos = placeNew(target, pl.newScriptIds, pl.newCommentIds);
        for (const [id, p] of pos.blocks) {
            const b = target.blocks?.[id];
            if (b && !Array.isArray(b)) { b.x = Math.round(p.x); b.y = Math.round(p.y); }
        }
        for (const [id, p] of pos.comments) {
            const c = target.comments?.[id];
            if (c) { c.x = Math.round(p.x); c.y = Math.round(p.y); }
        }
    }
    if (!metaSame) {
        project = { ...project, meta: newTop.meta, extensions: newTop.extensions, monitors: newTop.monitors, ...newTop.extraTopLevel };
        changed = true;
    }
    const projectText = changed ? JSON.stringify(project) : baseText;
    await persistMintedIds(dir, ts.mintedIds);
    await mkdir(join(dir, '.agentwarp'), { recursive: true });
    await writeFile(join(dir, '.agentwarp', 'sourcemap.json'), JSON.stringify(reconciled.sourcemap, null, 2) + '\n');
    return { project, projectText, files, diagnostics, placements: reconciled.placements, changed, mintedIds: ts.mintedIds };
}
