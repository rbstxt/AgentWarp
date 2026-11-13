/**
 * Three-way merge for the dirty-text editor-edit path.
 *
 * Situation: the text dir is dirty (agent edits not yet synced to `base`)
 * when an editor POST arrives with project E. The old agreed base is B0.
 * Per the P4 design:
 *   packDir(text) against base = E with the current anchors (the editor
 *   preserves block ids, so anchors still resolve), EXCEPT that a script
 *   changed on BOTH sides keeps the agent's version and is reported as a
 *   conflict.
 *
 * Naive "pack text against E" would silently drop human edits to scripts the
 * agent didn't touch (the text still holds the B0 version, which would
 * overwrite E). So this builds a merged IR first:
 *   - per anchored script: agent-untouched (T == B0) → take E's version
 *     (human move/edit/delete flows through); agent-changed → take T
 *     (agent wins), conflict iff E != B0 too;
 *   - agent-new scripts (no known anchor) → kept;
 *   - editor-new scripts (ids unknown to the anchors) → kept with synthetic
 *     anchors so reconcile reuses the editor's ids verbatim;
 *   - target declarations + scalars merged per-name/per-key with the same
 *     "agent wins if changed, else editor" rule.
 * The merged IR is then packed against E by packTextAgainstBase (overrides).
 */
import { extractTarget, type AnchorMap } from '../core/extract.ts';
import { irScriptEqual, type TargetDecls } from '../core/reconcile.ts';
import type { Script } from '../core/ir.ts';
import type { PackOverrides, TextState } from './pack-text.ts';

export interface MergeConflict {
    target: string;
    anchor: string;
    message: string;
}

const COLL_KEYS = new Set(['variables', 'lists', 'broadcasts', 'costumes', 'sounds', 'blocks', 'comments']);

function scriptEq(a: Script | undefined, b: Script | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return irScriptEqual(a, b);
}

/** project.json variable/list entry [name, ...rest] -> decl entry. */
function declEntries(obj: any): Array<{ name: string; id: string; raw: any }> {
    const out: Array<{ name: string; id: string; raw: any }> = [];
    for (const [id, v] of Object.entries<any>(obj ?? {})) {
        const arr = Array.isArray(v) ? v : [v];
        out.push({ name: String(arr[0] ?? id), id, raw: arr });
    }
    return out;
}

function toVarDecl(e: { name: string; id: string; raw: any }): TargetDecls['variables'][number] {
    return { name: e.name, id: e.id, value: e.raw[1], ...(e.raw[2] === true ? { cloud: true as const } : {}) };
}

function toListDecl(e: { name: string; id: string; raw: any }): TargetDecls['lists'][number] {
    return { name: e.name, id: e.id, items: Array.isArray(e.raw) ? e.raw.slice(1) : [] };
}

/** Three-way pick per name: agent wins when changed, else editor. */
function threeWayByName<T>(b: Array<{ name: string } & T>, t: Array<{ name: string } & T>, e: Array<{ name: string } & T>): T[] {
    const byName = (arr: Array<{ name: string } & T>): Map<string, Array<{ name: string } & T>> => {
        const m = new Map<string, Array<{ name: string } & T>>();
        for (const x of arr) {
            const l = m.get(x.name) ?? [];
            l.push(x);
            m.set(x.name, l);
        }
        return m;
    };
    const bm = byName(b);
    const tm = byName(t);
    const em = byName(e);
    const out: T[] = [];
    for (const name of new Set([...bm.keys(), ...tm.keys(), ...em.keys()])) {
        const bJ = JSON.stringify(bm.get(name) ?? null);
        const tJ = JSON.stringify(tm.get(name) ?? null);
        if (tJ === bJ) out.push(...((em.get(name) ?? []) as T[]));
        else out.push(...((tm.get(name) ?? []) as T[]));
    }
    return out;
}

function assetDeclsFromTarget(t: any): { costumes: TargetDecls['costumes']; sounds: TargetDecls['sounds'] } {
    const costumes = (t?.costumes ?? []).map((c: any) => ({ ...c }));
    const sounds = (t?.sounds ?? []).map((s: any) => ({ ...s }));
    return { costumes, sounds };
}

function declsFromProjectTarget(t: any): TargetDecls {
    const variables = declEntries(t?.variables).map(toVarDecl);
    const lists = declEntries(t?.lists).map(toListDecl);
    const broadcasts = Object.entries<any>(t?.broadcasts ?? {}).map(([id, name]) => ({ name: String(name), id }));
    const { costumes, sounds } = assetDeclsFromTarget(t);
    const scalars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t ?? {})) {
        if (!COLL_KEYS.has(k)) scalars[k] = v;
    }
    return { variables, lists, broadcasts, costumes, sounds, scalars };
}

export function buildMerge(opts: {
    oldBase: any;
    editorProject: any;
    text: TextState;
    oldAnchors: Record<string, AnchorMap>;
    editorFiles: Map<string, Uint8Array>;
}): { overrides: PackOverrides; conflicts: MergeConflict[] } {
    const { oldBase, editorProject, text, oldAnchors, editorFiles } = opts;
    const conflicts: MergeConflict[] = [];
    const extraFiles = new Map<string, Uint8Array>();
    const baseByName = new Map<string, any>();
    for (const t of oldBase?.targets ?? []) baseByName.set(String(t?.name), t);
    const edByName = new Map<string, any>();
    for (const t of editorProject?.targets ?? []) edByName.set(String(t?.name), t);

    const perTarget: PackOverrides['perTarget'] = {};
    const declsByTarget: Record<string, TargetDecls> = {};
    let synth = 0;
    const synthAnchor = (): string => `__m${++synth}`;

    /** Adopt an editor-only target (no text dir) as virtual reconcile input. */
    const adoptEditorTarget = (name: string, eT: any): void => {
        const ext = extractTarget(eT, editorProject, {});
        const anchors: AnchorMap = {};
        for (const s of ext.scripts) {
            const a = synthAnchor();
            s.anchor = a;
            if (s.srcId) anchors[a] = s.srcId;
        }
        perTarget[name] = { scripts: ext.scripts, anchors };
        declsByTarget[name] = declsFromProjectTarget(eT);
        for (const c of [...(eT?.costumes ?? []), ...(eT?.sounds ?? [])]) {
            const buf = editorFiles.get(String(c?.md5ext ?? ''));
            if (buf) extraFiles.set(String(c.md5ext), buf);
        }
    };

    const names = new Set<string>([...baseByName.keys(), ...edByName.keys(), ...Object.keys(text.perTarget)]);
    for (const name of names) {
        const bT = baseByName.get(name);
        const eT = edByName.get(name);
        const tPer = text.perTarget[name];
        const tDecls = text.declsByTarget[name];

        if (!tPer || !tDecls) {
            // Agent deleted the target dir (packDir would keep base verbatim;
            // for the merge an agent delete vs editor edit is a conflict).
            if (!eT) continue; // gone everywhere
            if (!bT) {
                adoptEditorTarget(name, eT);
                continue;
            }
            const bExt = extractTarget(bT, oldBase, {});
            const eExt = extractTarget(eT, editorProject, {});
            const same = bExt.scripts.length === eExt.scripts.length && bExt.scripts.every((s, i) => irScriptEqual(s, eExt.scripts[i]));
            if (same) continue; // agent deletion stands, editor untouched
            adoptEditorTarget(name, eT);
            conflicts.push({ target: name, anchor: '', message: 'target deleted in text but changed in editor; editor version kept' });
            continue;
        }
        if (!eT) {
            // Editor deleted the target.
            if (!bT) {
                perTarget[name] = tPer;
                declsByTarget[name] = tDecls;
                continue;
            }
            const bExt = extractTarget(bT, oldBase, {});
            const same =
                bExt.scripts.length === tPer.scripts.length && bExt.scripts.every((s, i) => irScriptEqual(s, tPer.scripts[i]));
            if (same) continue; // editor deletion stands, agent untouched
            perTarget[name] = tPer;
            declsByTarget[name] = tDecls;
            conflicts.push({ target: name, anchor: '', message: 'target deleted in editor but changed in text; text version kept' });
            continue;
        }
        if (!bT) {
            // Brand-new on both sides with the same name: agent wins.
            perTarget[name] = tPer;
            declsByTarget[name] = tDecls;
            conflicts.push({ target: name, anchor: '', message: 'target created in both editor and text; text version kept' });
            continue;
        }
        // Three-way per script.
        const bExt = extractTarget(bT, oldBase, {});
        const eExt = extractTarget(eT, editorProject, {});
        const bById = new Map<string, Script>();
        for (const s of bExt.scripts) if (s.srcId) bById.set(s.srcId, s);
        const eById = new Map<string, Script>();
        for (const s of eExt.scripts) if (s.srcId) eById.set(s.srcId, s);
        const tByAnchor = new Map<string, Script>();
        for (const s of tPer.scripts) if (s.anchor) tByAnchor.set(s.anchor, s);
        const anchorIds = oldAnchors[name] ?? {};
        const anchorIdSet = new Set(Object.values(anchorIds));
        const consumedE = new Set<string>();
        const merged: Script[] = [];
        const mergedAnchors: AnchorMap = {};
        for (const [anchor, baseId] of Object.entries(anchorIds)) {
            const b = bById.get(baseId);
            const e = eById.get(baseId);
            const t = tByAnchor.get(anchor);
            const eqEB = scriptEq(e, b);
            const eqTB = scriptEq(t, b);
            if (eqTB) {
                consumedE.add(baseId);
                if (e) {
                    e.anchor = anchor;
                    merged.push(e);
                    mergedAnchors[anchor] = baseId;
                }
                // else: deleted in editor, agent untouched -> stays deleted
            } else {
                consumedE.add(baseId);
                if (!eqEB) {
                    conflicts.push({ target: name, anchor, message: `script ${anchor} changed in both editor and text; text wins` });
                }
                if (t) {
                    merged.push(t);
                    mergedAnchors[anchor] = baseId;
                }
                // else: agent deleted the script -> stays deleted (agent wins)
            }
        }
        // Agent-new scripts (anchor unknown to the old base).
        for (const s of tPer.scripts) {
            if (!s.anchor || !(s.anchor in anchorIds)) merged.push(s);
            // (their per.anchors entry, if any, travels via tPer below)
        }
        // Editor-new scripts (ids unknown to the old anchors).
        for (const s of eExt.scripts) {
            if (!s.srcId || anchorIdSet.has(s.srcId) || consumedE.has(s.srcId)) continue;
            const a = synthAnchor();
            s.anchor = a;
            merged.push(s);
            mergedAnchors[a] = s.srcId;
        }
        // Three-way declarations.
        const bDecls = declsFromProjectTarget(bT);
        const eDecls = declsFromProjectTarget(eT);
        const stripIds = (d: TargetDecls['variables'][number]): unknown => ({ ...d, id: undefined });
        void stripIds;
        const variables = threeWayByName(
            bDecls.variables,
            tDecls.variables,
            eDecls.variables,
        );
        const lists = threeWayByName(bDecls.lists, tDecls.lists, eDecls.lists);
        const broadcasts = threeWayByName(bDecls.broadcasts, tDecls.broadcasts, eDecls.broadcasts);
        const costumes = threeWayByName(bDecls.costumes, tDecls.costumes, eDecls.costumes);
        const sounds = threeWayByName(bDecls.sounds, tDecls.sounds, eDecls.sounds);
        for (const c of [...costumes, ...sounds]) {
            const buf = editorFiles.get(String((c as any)?.md5ext ?? ''));
            if (buf && !extraFiles.has(String((c as any).md5ext))) extraFiles.set(String((c as any).md5ext), buf);
        }
        const scalars: Record<string, unknown> = {};
        for (const k of new Set([...Object.keys(bT ?? {}), ...Object.keys(tDecls.scalars ?? {}), ...Object.keys(eT ?? {})])) {
            if (COLL_KEYS.has(k)) continue;
            const bV = (bT as any)?.[k];
            const tV = (tDecls.scalars as any)?.[k];
            const eV = (eT as any)?.[k];
            scalars[k] = JSON.stringify(tV) === JSON.stringify(bV) ? eV : tV;
        }
        const mergedDecls: TargetDecls = { variables, lists, broadcasts, costumes, sounds, scalars };
        // Preserve any text-side anchor entries for agent-new scripts.
        const textAnchors = tPer.anchors ?? {};
        const keepTextAnchors: AnchorMap = {};
        for (const [a, id] of Object.entries(textAnchors)) {
            if (!(a in anchorIds)) keepTextAnchors[a] = id;
        }
        perTarget[name] = { scripts: merged, anchors: { ...mergedAnchors, ...keepTextAnchors } };
        declsByTarget[name] = mergedDecls;
    }

    // Top-level meta three-way.
    const topOf = (p: any): unknown => ({
        meta: p?.meta,
        extensions: p?.extensions ?? [],
        monitors: p?.monitors ?? [],
        extraTopLevel: Object.fromEntries(Object.entries(p ?? {}).filter(([k]) => !['targets', 'monitors', 'extensions', 'meta'].includes(k))),
    });
    const bTop = topOf(oldBase);
    const eTop = topOf(editorProject) as { meta: any; extensions: any[]; monitors: any[]; extraTopLevel: Record<string, any> };
    const meta = JSON.stringify(text.meta) === JSON.stringify(bTop)
        ? { meta: eTop.meta, extensions: eTop.extensions, monitors: eTop.monitors, extraTopLevel: eTop.extraTopLevel }
        : text.meta;

    return { overrides: { perTarget, declsByTarget, meta, extraFiles }, conflicts };
}
