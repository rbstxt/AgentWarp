/**
 * Pack the text project dir against an ARBITRARY base project object.
 *
 * packages/core/project-dir.ts `packDir` always reads `.agentwarp/base.json`
 * as the reconcile base. The bridge needs two extra modes core doesn't offer:
 *   1. agent-edit cycle: pack against the in-memory base (== base.json, but
 *      without racing another writer of that file);
 *   2. editor-edit merge: pack the (three-way merged) text against the
 *      EDITOR's project with the current anchors (the editor preserves block
 *      ids, so anchors still resolve and untouched scripts reuse the
 *      editor's JSON verbatim, keeping the human's positions).
 *
 * This mirrors packDir's logic (readTargetDir + reconcile + meta + placeNew)
 * but takes the base project/anchors as parameters, accepts optional
 * per-target overrides (used by the merge for editor-only additions), and
 * returns the packed project object instead of writing an .sb3.
 *
 * NOTE (core change we'd like, see final report): readTargetDir is not
 * exported from project-dir.ts so its ~90 lines are duplicated here; exporting
 * it plus a `packAgainst(baseProject, baseText, anchors, ...)` entry point
 * from core would delete most of this file.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostic, Format } from '../core/ir.ts';
import { reconcileProject, type Placement, type TargetDecls } from '../core/reconcile.ts';
import { md5extFor } from '../core/assets.ts';
import { placeNew } from '../core/layout.ts';
import type { AnchorMap } from '../core/extract.ts';

export interface TextState {
    perTarget: Record<string, { scripts: any[]; anchors: AnchorMap }>;
    declsByTarget: Record<string, TargetDecls>;
    meta: { meta: any; extensions: any[]; monitors: any[]; extraTopLevel: Record<string, any> };
    /** Parse-level diagnostics (syntax errors etc.), before reconcile. */
    diagnostics: Diagnostic[];
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
}

const TARGET_JSON = 'target.json';

async function readTargetDir(
    tdir: string,
    targetName: string,
    format: Format,
    diagnostics: Diagnostic[],
    stageJson?: any,
): Promise<{ scripts: any[]; decls: TargetDecls } | null> {
    let targetJson: any;
    try {
        targetJson = JSON.parse(await readFile(join(tdir, TARGET_JSON), 'utf8'));
    } catch (e) {
        diagnostics.push({ message: `target "${targetName}": cannot read target.json: ${(e as Error)?.message}`, severity: 'error' });
        return null;
    }
    const scriptsPath = join(tdir, `scripts.${format.ext}`);
    let text: string;
    try {
        text = await readFile(scriptsPath, 'utf8');
    } catch (e) {
        diagnostics.push({
            message: `target "${targetName}": cannot read scripts.${format.ext}: ${(e as Error)?.message}`,
            severity: 'error',
        });
        return null;
    }
    const parsed = format.parse(text, { targetName, file: scriptsPath, targetJson, isStage: targetJson?.isStage === true, stageJson });
    diagnostics.push(...parsed.diagnostics);
    const decls: TargetDecls = { variables: [], lists: [], broadcasts: [], costumes: [], sounds: [], scalars: {} };
    for (const v of Array.isArray(targetJson.variables) ? targetJson.variables : []) {
        decls.variables.push({ name: String(v?.name ?? ''), id: String(v?.id ?? ''), value: v?.value, ...(v?.cloud === true ? { cloud: true as const } : {}) });
    }
    for (const v of Array.isArray(targetJson.lists) ? targetJson.lists : []) {
        decls.lists.push({ name: String(v?.name ?? ''), id: String(v?.id ?? ''), items: Array.isArray(v?.items) ? v.items : [] });
    }
    for (const v of Array.isArray(targetJson.broadcasts) ? targetJson.broadcasts : []) {
        decls.broadcasts.push({ name: String(v?.name ?? ''), id: String(v?.id ?? '') });
    }
    for (const c of targetJson.costumes ?? []) {
        const file = String(c?.file ?? '');
        let buf: Uint8Array | null = null;
        try {
            buf = await readFile(join(tdir, file));
        } catch {
            buf = null;
        }
        if (!buf) {
            diagnostics.push({ message: `target "${targetName}": costume file "${file}" missing`, severity: 'error' });
            continue;
        }
        const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : 'svg';
        const md5ext = md5extFor(buf, ext);
        const { file: _f, ...rest } = c ?? {};
        void _f;
        decls.costumes.push({ ...rest, assetId: md5ext.slice(0, md5ext.lastIndexOf('.')), dataFormat: ext, md5ext });
    }
    for (const s of targetJson.sounds ?? []) {
        const file = String(s?.file ?? '');
        let buf: Uint8Array | null = null;
        try {
            buf = await readFile(join(tdir, file));
        } catch {
            buf = null;
        }
        if (!buf) {
            diagnostics.push({ message: `target "${targetName}": sound file "${file}" missing`, severity: 'error' });
            continue;
        }
        const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : 'wav';
        const md5ext = md5extFor(buf, ext);
        const { file: _f, ...rest } = s ?? {};
        void _f;
        decls.sounds.push({ ...rest, assetId: md5ext.slice(0, md5ext.lastIndexOf('.')), dataFormat: ext, md5ext });
    }
    for (const [k, v] of Object.entries(targetJson)) {
        if (!['variables', 'lists', 'broadcasts', 'costumes', 'sounds'].includes(k)) decls.scalars[k] = v;
    }
    return { scripts: parsed.scripts, decls };
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
    const seenNames = new Set<string>();
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
        const r = await readTargetDir(tdir, name, format, diagnostics, stageJson);
        if (!r) continue;
        perTarget[name] = { scripts: r.scripts, anchors: anchors[name] ?? {} };
        declsByTarget[name] = r.decls;
    }
    return {
        perTarget,
        declsByTarget,
        meta: { meta: meta?.meta, extensions: meta?.extensions ?? [], monitors: meta?.monitors ?? [], extraTopLevel: meta?.extraTopLevel ?? {} },
        diagnostics,
    };
}

/** All asset bytes under per-target costumes and sounds dirs, keyed by md5ext. */
export async function collectAssetFiles(dir: string): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    const entries = (await readdir(dir)).filter((e) => e !== '.agentwarp' && e !== 'agentwarp.json');
    for (const e of entries) {
        for (const sub of ['costumes', 'sounds']) {
            let names: string[] = [];
            try {
                names = await readdir(join(dir, e, sub));
            } catch {
                continue;
            }
            for (const n of names.sort()) {
                let buf: Uint8Array;
                try {
                    buf = await readFile(join(dir, e, sub, n));
                } catch {
                    continue;
                }
                const ext = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : 'bin';
                out.set(md5extFor(buf, ext), buf);
            }
        }
    }
    return out;
}

export async function packTextAgainstBase(
    dir: string,
    format: Format,
    baseProject: any,
    baseText: string,
    anchors: Record<string, AnchorMap>,
    overrides?: PackOverrides,
): Promise<PackTextResult> {
    let perTarget: TextState['perTarget'];
    let declsByTarget: Record<string, TargetDecls>;
    let meta: TextState['meta'];
    const diagnostics: Diagnostic[] = [];
    if (overrides) {
        perTarget = overrides.perTarget;
        declsByTarget = overrides.declsByTarget;
        meta = overrides.meta;
        // Surface parse-level diagnostics for overridden text targets (the
        // merge reuses already-parsed scripts, so re-read text for diags).
        const ts = await readTextState(dir, format);
        diagnostics.push(...ts.diagnostics);
    } else {
        const ts = await readTextState(dir, format);
        diagnostics.push(...ts.diagnostics);
        perTarget = ts.perTarget;
        declsByTarget = ts.declsByTarget;
        meta = ts.meta;
    }
    const files = await collectAssetFiles(dir);
    if (overrides?.extraFiles) {
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
    await mkdir(join(dir, '.agentwarp'), { recursive: true });
    await writeFile(join(dir, '.agentwarp', 'sourcemap.json'), JSON.stringify(reconciled.sourcemap, null, 2) + '\n');
    return { project, projectText, files, diagnostics, placements: reconciled.placements, changed };
}
