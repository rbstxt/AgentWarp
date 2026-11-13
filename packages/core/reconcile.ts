/**
 * IR + base project.json → new project.json, per the design doc's 7 rules.
 *
 * - Scripts matched by anchor; nodes matched top-down (LCS on sequences).
 * - Matched-and-identical subtrees reuse base JSON verbatim (byte-preserving).
 * - New nodes get fresh Scratch-style 20-char ids; new inputs get shadows
 *   derived from the catalog; new broadcasts are declared on the Stage.
 * - New variables/lists referenced but not declared are diagnostic ERRORS.
 */
import type { Block, Comment, Diagnostic, Input, Loc, Script } from './ir.ts';
import { getBlockSpec } from './catalog/index.ts';
import { makeId } from './ids.ts';
import { extractTarget, type AnchorMap } from './extract.ts';

/** Shadow block opcode -> inline literal tag. */
const SHADOW_TAG: Record<string, number> = {
    math_number: 4,
    math_positive_number: 5,
    math_whole_number: 6,
    math_integer: 7,
    math_angle: 8,
    colour_picker: 9,
    text: 10,
};

export interface TargetDecls {
    /** Ordered declarations; duplicate names possible in messy human projects. */
    variables: Array<{ name: string; id: string; value: unknown; cloud?: boolean }>;
    lists: Array<{ name: string; id: string; items: unknown[] }>;
    /** Newly declared broadcasts for this target. */
    broadcasts: Array<{ name: string; id: string }>;
    costumes: Array<Record<string, any>>;
    sounds: Array<Record<string, any>>;
    /** Every other scalar target field (name, x, y, size, volume, …). */
    scalars: Record<string, unknown>;
}

export interface Placement {
    target: string;
    newScriptIds: string[];
    newCommentIds: string[];
}

export interface ReconcileTargetResult {
    blocks: Record<string, any>;
    comments: Record<string, any>;
    diagnostics: Diagnostic[];
    newScriptIds: string[];
    newCommentIds: string[];
    sourcemap: Record<string, Loc>;
    changed: boolean;
    /** Rebuilt variables/lists/broadcasts/costumes/sounds/scalars (undefined = base verbatim). */
    collections?: {
        variables: Record<string, [string, unknown]>;
        lists: Record<string, [string, ...unknown[]]>;
        broadcasts: Record<string, string>;
        costumes: Array<Record<string, any>>;
        sounds: Array<Record<string, any>>;
        scalars: Record<string, unknown>;
    };
}

export interface ReconcileProjectResult {
    project: any;
    diagnostics: Diagnostic[];
    placements: Placement[];
    sourcemap: Record<string, Loc>;
    unchanged: boolean;
}

// ---------------------------------------------------------------------------
// IR equality (ignores srcId/loc/anchor)
// ---------------------------------------------------------------------------

function normMin(c: Comment | undefined): boolean {
    return c?.minimized === true;
}

export function irCommentEqual(a: Comment | undefined, b: Comment | undefined): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.text === b.text && normMin(a) === normMin(b);
}

function irInputEqual(a: Input, b: Input): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case 'literal':
            return b.kind === 'literal' && a.value === b.value && (a.litType ?? null) === (b.litType ?? null);
        case 'menu':
            return b.kind === 'menu' && a.value === b.value;
        case 'var':
        case 'list':
        case 'broadcast':
            return b.kind === a.kind && a.name === (b as typeof a).name;
        case 'block':
            return b.kind === 'block' && irBlockEqual(a.block, b.block);
        case 'stack': {
            if (b.kind !== 'stack') return false;
            if (!a.block && !b.block) return true;
            if (!a.block || !b.block) return false;
            return irBlockEqual(a.block, b.block);
        }
    }
}

export function irBlockEqual(a: Block, b: Block): boolean {
    if (a.opcode !== b.opcode) return false;
    const pa = a.proc;
    const pb = b.proc;
    if (!!pa !== !!pb) return false;
    if (pa && pb) {
        if (pa.proccode !== pb.proccode || pa.warp !== pb.warp) return false;
        if (JSON.stringify(pa.argumentnames) !== JSON.stringify(pb.argumentnames)) return false;
        if (JSON.stringify(pa.argumentdefaults) !== JSON.stringify(pb.argumentdefaults)) return false;
    }
    if (!irCommentEqual(a.comment, b.comment)) return false;
    const ka = Object.keys(a.fields).sort();
    const kb = Object.keys(b.fields).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) return false;
    for (const k of ka) if (a.fields[k].value !== b.fields[k].value) return false;
    if (JSON.stringify(a.mutation ?? null) !== JSON.stringify(b.mutation ?? null)) return false;
    const ia = Object.keys(a.inputs).sort();
    const ib = Object.keys(b.inputs).sort();
    if (JSON.stringify(ia) !== JSON.stringify(ib)) return false;
    for (const k of ia) if (!irInputEqual(a.inputs[k], b.inputs[k])) return false;
    if (!!a.next !== !!b.next) return false;
    if (a.next && b.next && !irBlockEqual(a.next, b.next)) return false;
    return true;
}

export function irScriptEqual(a: Script, b: Script): boolean {
    if (a.kind !== b.kind) return false;
    if (!!a.top !== !!b.top) return false;
    if (a.top && b.top && !irBlockEqual(a.top, b.top)) return false;
    if (!irCommentEqual(a.comment, b.comment)) return false;
    return true;
}

/**
 * Like irBlockEqual but ignores the top node's own `next` (used to detect
 * moved subtrees: wrap/unwrap changes position but not content).
 */
export function irBlockEqualIgnoreTopNext(a: Block, b: Block): boolean {
    const an = a.next;
    const bn = b.next;
    (a as { next?: Block }).next = undefined;
    (b as { next?: Block }).next = undefined;
    try {
        return irBlockEqual(a, b);
    } finally {
        (a as { next?: Block }).next = an;
        (b as { next?: Block }).next = bn;
    }
}

// ---------------------------------------------------------------------------
// LCS over statement sequences (match key: opcode + proccode)
// ---------------------------------------------------------------------------

function seqKeyOpcode(opcode: string, proccode: string | null): string {
    return proccode ? `${opcode}\n${proccode}` : opcode;
}

function editedKey(b: Block): string {
    return seqKeyOpcode(b.opcode, b.proc?.proccode ?? null);
}

function baseKey(blocks: Record<string, any>, id: string): string {
    const b = blocks[id];
    let proccode: string | null = null;
    if (b?.opcode === 'procedures_call') {
        proccode = String(b.mutation?.proccode ?? '');
    }
    return seqKeyOpcode(String(b?.opcode ?? ''), proccode);
}

function chainToList(head: Block | undefined): Block[] {
    const out: Block[] = [];
    let cur = head;
    const seen = new Set<Block>();
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        out.push(cur);
        cur = cur.next;
    }
    return out;
}

function baseChainToList(blocks: Record<string, any>, headId: string | null): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur = headId;
    while (typeof cur === 'string' && !seen.has(cur)) {
        const b = blocks[cur];
        if (!b || typeof b !== 'object' || Array.isArray(b)) break;
        seen.add(cur);
        out.push(cur);
        cur = typeof b.next === 'string' ? b.next : null;
    }
    return out;
}

/** LCS index pairs (aIdx, bIdx), increasing in both. */
function lcsKeys(akeys: string[], bkeys: string[]): Array<[number, number]> {
    const n = akeys.length;
    const m = bkeys.length;
    if (n === 0 || m === 0) return [];
    const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            len[i][j] = akeys[i] === bkeys[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
        }
    }
    const pairs: Array<[number, number]> = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (akeys[i] === bkeys[j]) {
            pairs.push([i, j]);
            i++;
            j++;
        } else if (len[i + 1][j] >= len[i][j + 1]) {
            i++;
        } else {
            j++;
        }
    }
    return pairs;
}

// ---------------------------------------------------------------------------
// Size estimator (provisional placement only; layout module refines later)
// ---------------------------------------------------------------------------

function rowWidth(b: Block): number {
    let r = 56 + b.opcode.length * 3;
    for (const inp of Object.values(b.inputs)) {
        if (inp.kind === 'literal') r += 10 + String(inp.value).length * 6;
        else if (inp.kind === 'menu') r += 10 + inp.value.length * 6;
        else if (inp.kind === 'block') r += rowWidth(inp.block) * 0.6;
        else if (inp.kind === 'var' || inp.kind === 'list' || inp.kind === 'broadcast') r += 24 + inp.name.length * 6;
    }
    return r;
}

function estimateSubSize(head: Block | undefined): { w: number; h: number } {
    let h = 0;
    let w = 0;
    const seen = new Set<Block>();
    let cur = head;
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        h += 34;
        w = Math.max(w, rowWidth(cur));
        for (const inp of Object.values(cur.inputs)) {
            if (inp.kind === 'stack' && inp.block) {
                const s = estimateSubSize(inp.block);
                h += 18 + s.h;
                w = Math.max(w, s.w + 28);
            }
        }
        cur = cur.next;
    }
    return { w, h };
}

// ---------------------------------------------------------------------------
// Reconcile context
// ---------------------------------------------------------------------------

interface RCtx {
    targetName: string;
    baseBlocks: Record<string, any>;
    baseComments: Record<string, any>;
    baseNodeById: Map<string, Block>;
    anchorMap: AnchorMap;
    claimed: Set<string>;
    variables: Map<string, string>;
    lists: Map<string, string>;
    broadcasts: Map<string, string>; // name -> id (global, mutated with creations)
    /** proccode -> ids/names/defaults from EDITED defs. */
    defs: Map<string, { argIds: string[]; argNames: string[]; argDefaults: string[]; warp: boolean }>;
    /** proccode -> base def info (fallback for calls to deleted defs). */
    baseDefs: Map<string, { argIds: string[]; argNames: string[] }>;
    usedIds: Set<string>;
    out: Record<string, any>;
    outComments: Record<string, any>;
    diagnostics: Diagnostic[];
    sourcemap: Record<string, Loc>;
    newScriptIds: string[];
    newCommentIds: string[];
    changed: boolean;
    file?: string;
    /** Position context of the script currently being reconciled. */
    curScriptX: number;
    curScriptY: number;
    curScriptEstW: number;
    /** Base ids of the current script available for move-aware reuse. */
    currentPool: string[] | null;
    /** Base id -> edited node that consumed it (prevents double reuse). */
    owner: Map<string, Block>;
}

function freshId(ctx: RCtx): string {
    const id = makeId(ctx.usedIds);
    ctx.usedIds.add(id);
    return id;
}

function rdiag(ctx: RCtx, message: string, loc?: Loc, severity: 'error' | 'warning' = 'error'): void {
    ctx.diagnostics.push({ message, file: loc?.file ?? ctx.file, line: loc?.line, col: loc?.col, severity });
}

function trackLoc(ctx: RCtx, id: string, node: { loc?: Loc }): void {
    if (node.loc) ctx.sourcemap[id] = node.loc;
}

/** Deep clone base JSON (key order preserved). */
function cloneBase(v: any): any {
    return JSON.parse(JSON.stringify(v));
}

function collectReachable(blocks: Record<string, any>, headId: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const stack: string[] = [headId];
    while (stack.length) {
        const id = stack.pop() as string;
        if (seen.has(id)) continue;
        const b = blocks[id];
        if (!b) continue;
        seen.add(id);
        out.push(id);
        if (typeof b !== 'object' || Array.isArray(b)) continue;
        if (typeof b.next === 'string') stack.push(b.next);
        for (const ival of Object.values<any>(b.inputs ?? {})) {
            if (Array.isArray(ival) && typeof ival[1] === 'string') stack.push(ival[1]);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Procedure helpers
// ---------------------------------------------------------------------------

function baseDefInfo(
    blocks: Record<string, any>,
    defId: string,
): {
    proccode: string;
    argIds: string[];
    argNames: string[];
    argDefaults: string[];
    warp: boolean;
    protoId: string | null;
} | null {
    const b = blocks[defId];
    if (!b || typeof b !== 'object' || Array.isArray(b) || b.opcode !== 'procedures_definition') return null;
    const protoRef = b.inputs?.custom_block?.[1];
    const proto = typeof protoRef === 'string' ? blocks[protoRef] : undefined;
    if (!proto || typeof proto !== 'object' || Array.isArray(proto)) return null;
    const m = proto.mutation ?? {};
    let argIds: string[] = [];
    let argNames: string[] = [];
    let argDefaults: string[] = [];
    try {
        if (typeof m.argumentids === 'string') argIds = JSON.parse(m.argumentids).map(String);
        if (typeof m.argumentnames === 'string') argNames = JSON.parse(m.argumentnames).map(String);
        if (typeof m.argumentdefaults === 'string') argDefaults = JSON.parse(m.argumentdefaults).map(String);
    } catch {
        /* keep empty */
    }
    return {
        proccode: String(m.proccode ?? ''),
        argIds,
        argNames,
        argDefaults,
        warp: m.warp === true || m.warp === 'true',
        protoId: typeof protoRef === 'string' ? protoRef : null,
    };
}

/** Placeholder (%s/%n/%b) at position i of a proccode. */
function placeholderAt(proccode: string, i: number): string {
    const holders = proccode.match(/%[snb]/g) ?? [];
    return holders[i] ?? '%s';
}

function argReporterOpcode(proccode: string, i: number): string {
    return placeholderAt(proccode, i) === '%b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number';
}

function callProccode(b: any): string {
    return String(b?.mutation?.proccode ?? '');
}

// ---------------------------------------------------------------------------
// Verbatim copy with parallel sourcemap walk
// ---------------------------------------------------------------------------

function pairWalk(ctx: RCtx, baseId: string, eNode: Block): void {
    trackLoc(ctx, baseId, eNode);
    const base = ctx.baseBlocks[baseId];
    if (!base || typeof base !== 'object' || Array.isArray(base)) return;
    if (typeof base.comment === 'string' && eNode.comment?.loc) {
        ctx.sourcemap[base.comment] = eNode.comment.loc;
    }
    for (const [iname, einput] of Object.entries(eNode.inputs)) {
        const binput = base.inputs?.[iname];
        const bref = Array.isArray(binput) ? binput[1] : undefined;
        if (typeof bref !== 'string') continue;
        if ((einput.kind === 'block' || einput.kind === 'stack') && einput.block) {
            pairWalk(ctx, bref, einput.block);
        }
    }
    if (eNode.next && typeof base.next === 'string') pairWalk(ctx, base.next, eNode.next);
}

function copyVerbatim(ctx: RCtx, baseTopId: string, eScript: Script): void {
    const reachable = collectReachable(ctx.baseBlocks, baseTopId);
    for (const id of reachable) {
        if (!(id in ctx.out)) ctx.out[id] = cloneBase(ctx.baseBlocks[id]);
    }
    // Attached comments of this script travel with it.
    const reachSet = new Set(reachable);
    for (const [cid, c] of Object.entries<any>(ctx.baseComments)) {
        if (typeof c?.blockId === 'string' && reachSet.has(c.blockId) && !(cid in ctx.outComments)) {
            ctx.outComments[cid] = cloneBase(c);
        }
    }
    if (eScript.top) pairWalk(ctx, baseTopId, eScript.top);
}

// ---------------------------------------------------------------------------
// Input values
// ---------------------------------------------------------------------------

function shadowTagFor(ownerOpcode: string, inputName: string, litType?: number): number {
    const spec = getBlockSpec(ownerOpcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    if (ispec?.shadowOpcode && SHADOW_TAG[ispec.shadowOpcode] !== undefined) return SHADOW_TAG[ispec.shadowOpcode];
    if (typeof litType === 'number') return litType;
    return 10;
}

function shadowDefaultFor(ownerOpcode: string, inputName: string): string | number {
    const spec = getBlockSpec(ownerOpcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    return ispec?.default ?? '';
}

function menuFieldName(menuOpcode: string, inputName: string, ownerOpcode: string): string {
    const ownerSpec = getBlockSpec(ownerOpcode);
    const ispec = ownerSpec?.inputs.find((i) => i.name === inputName);
    if (ispec?.shadowField) return ispec.shadowField;
    const menuSpec = getBlockSpec(menuOpcode);
    if (menuSpec && menuSpec.fields.length > 0) return menuSpec.fields[0].name;
    return 'VALUE';
}

function resolveBroadcast(ctx: RCtx, name: string): string {
    const existing = ctx.broadcasts.get(name);
    if (existing) return existing;
    const id = freshId(ctx);
    ctx.broadcasts.set(name, id);
    return id;
}

function buildMenuBlock(
    ctx: RCtx,
    ownerId: string,
    ownerOpcode: string,
    inputName: string,
    value: string,
    loc?: Loc,
): string {
    const spec = getBlockSpec(ownerOpcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    const opcode = ispec?.shadowOpcode;
    if (!opcode || !getBlockSpec(opcode)) {
        rdiag(ctx, `${ownerOpcode} input "${inputName}": no menu block in catalog, using text literal`, loc, 'warning');
        return '';
    }
    const id = freshId(ctx);
    const field = menuFieldName(opcode, inputName, ownerOpcode);
    ctx.out[id] = {
        opcode,
        next: null,
        parent: ownerId,
        inputs: {},
        fields: { [field]: [value, null] },
        shadow: true,
        topLevel: false,
    };
    return id;
}

/**
 * Reconcile a single (non-stack) input value. Returns the raw project.json
 * input array, or null to omit the input.
 */
function reconcileValue(
    ctx: RCtx,
    ownerId: string,
    ownerOpcode: string,
    inputName: string,
    einput: Input,
    baseInput: any,
    loc?: Loc,
    depth?: number,
): any[] | null {
    const baseTag = Array.isArray(baseInput) ? baseInput[0] : undefined;
    const basePrimary = Array.isArray(baseInput) ? baseInput[1] : undefined;
    const baseObscured = Array.isArray(baseInput) ? baseInput[2] : undefined;
    switch (einput.kind) {
        case 'literal': {
            if (typeof basePrimary !== 'string') {
                // Base is an inline literal (or nothing): keep tag, update value.
                const tag =
                    Array.isArray(basePrimary) && typeof basePrimary[0] === 'number'
                        ? basePrimary[0]
                        : shadowTagFor(ownerOpcode, inputName, einput.litType);
                const v = tag === 10 ? String(einput.value) : einput.value;
                const out: any[] = [1, [tag, v]];
                if (Array.isArray(baseInput)) {
                    for (let i = 2; i < baseInput.length; i++) out.push(cloneBase(baseInput[i]));
                }
                return out;
            }
            // Base references a block: update a real shadow in place, but a
            // dropped reporter resolves to its obscured shadow (visible again).
            const shadow = ctx.baseBlocks[basePrimary];
            if (
                shadow &&
                typeof shadow === 'object' &&
                !Array.isArray(shadow) &&
                shadow.opcode !== undefined &&
                shadow.shadow === true &&
                getBlockSpec(String(shadow.opcode))?.shape !== 'menu'
            ) {
                const spec = getBlockSpec(ownerOpcode);
                const ispec = spec?.inputs.find((i) => i.name === inputName);
                const field = ispec?.shadowField ?? Object.keys(shadow.fields ?? {})[0];
                const fresh = cloneBase(shadow);
                if (field && fresh.fields) fresh.fields[field] = [String(einput.value), null];
                fresh.parent = ownerId;
                ctx.out[basePrimary] = fresh;
                return [typeof baseTag === 'number' ? baseTag : 1, basePrimary];
            }
            if (Array.isArray(baseObscured) && typeof baseObscured[0] === 'number') {
                const tag = baseObscured[0];
                return [1, [tag, tag === 10 ? String(einput.value) : einput.value]];
            }
            // Shadow is a menu or missing: fall back to inline literal.
            const tag = shadowTagFor(ownerOpcode, inputName, einput.litType);
            return [1, [tag, tag === 10 ? String(einput.value) : einput.value]];
        }
        case 'menu': {
            if (typeof basePrimary === 'string') {
                const menu = ctx.baseBlocks[basePrimary];
                if (menu && typeof menu === 'object' && !Array.isArray(menu) && getBlockSpec(menu.opcode)?.shape === 'menu') {
                    const field = Object.keys(menu.fields ?? {})[0];
                    const curVal = field
                        ? Array.isArray(menu.fields[field])
                            ? menu.fields[field][0]
                            : menu.fields[field]
                        : undefined;
                    if (String(curVal ?? '') === einput.value) {
                        // Reusing the id: the menu block itself must be emitted too.
                        if (!ctx.out[basePrimary]) {
                            const kept = cloneBase(menu);
                            kept.parent = ownerId;
                            ctx.out[basePrimary] = kept;
                        }
                        return [typeof baseTag === 'number' ? baseTag : 1, basePrimary];
                    }
                    const fresh = cloneBase(menu);
                    if (field) fresh.fields[field] = [einput.value, null];
                    fresh.parent = ownerId;
                    ctx.out[basePrimary] = fresh;
                    return [typeof baseTag === 'number' ? baseTag : 1, basePrimary];
                }
            } else if (basePrimary !== undefined && basePrimary !== null) {
                const curVal = Array.isArray(basePrimary) ? basePrimary[1] : basePrimary;
                if (String(curVal ?? '') === einput.value) return cloneBase(baseInput);
            }
            const menuId = buildMenuBlock(ctx, ownerId, ownerOpcode, inputName, einput.value, loc);
            if (!menuId) {
                const tag = shadowTagFor(ownerOpcode, inputName, 10);
                return [1, [tag, einput.value]];
            }
            return [1, menuId];
        }
        case 'broadcast': {
            const id = resolveBroadcast(ctx, einput.name);
            return [1, [11, einput.name, id]];
        }
        case 'var':
        case 'list': {
            const table = einput.kind === 'var' ? ctx.variables : ctx.lists;
            const id = table.get(einput.name);
            if (!id) {
                rdiag(ctx, `unknown ${einput.kind} "${einput.name}" (declare it in target.json first)`, loc);
                const tag = einput.kind === 'var' ? 12 : 13;
                return [1, [tag, einput.name, '']];
            }
            const tag = einput.kind === 'var' ? 12 : 13;
            const obscured =
                baseObscured !== undefined
                    ? cloneBase(baseObscured)
                    : [shadowTagFor(ownerOpcode, inputName), shadowDefaultFor(ownerOpcode, inputName)];
            if (Array.isArray(baseInput) && baseTag === 1 && typeof basePrimary !== 'string') {
                return [1, [tag, einput.name, id]];
            }
            return [3, [tag, einput.name, id], obscured];
        }
        case 'block': {
            let childId: string | null = null;
            if (typeof basePrimary === 'string') {
                const bchild = ctx.baseBlocks[basePrimary];
                if (
                    bchild &&
                    typeof bchild === 'object' &&
                    !Array.isArray(bchild) &&
                    bchild.opcode === einput.block.opcode &&
                    (einput.block.opcode !== 'procedures_call' || callProccode(bchild) === (einput.block.proc?.proccode ?? ''))
                ) {
                    childId = reconcileSingle(ctx, einput.block, basePrimary, ownerId, depth ?? 0);
                }
            }
            if (!childId) {
                const moved = findMovedMatch(ctx, einput.block, new Set());
                if (moved) childId = reconcileSingle(ctx, einput.block, moved, ownerId, depth ?? 0);
            }
            if (!childId) childId = reconcileSingle(ctx, einput.block, null, ownerId, depth ?? 0);
            if (baseObscured !== undefined) return [3, childId, cloneBase(baseObscured)];
            if (basePrimary !== undefined && basePrimary !== null && typeof basePrimary !== 'string') {
                // Reporter dropped over a former literal: keep it as the obscured shadow.
                return [3, childId, cloneBase(basePrimary)];
            }
            if (typeof baseTag === 'number' && (baseTag === 1 || baseTag === 2)) return [baseTag, childId];
            const hasShadow = getBlockSpec(ownerOpcode)?.inputs.some((i) => i.name === inputName && i.shadowOpcode);
            if (hasShadow) {
                return [3, childId, [shadowTagFor(ownerOpcode, inputName), shadowDefaultFor(ownerOpcode, inputName)]];
            }
            return [2, childId];
        }
        case 'stack':
            return null; // handled by the caller (sequence matching)
    }
}

function baseTopXY(baseTop: any): { x: number; y: number } {
    if (Array.isArray(baseTop)) {
        return {
            x: typeof baseTop[3] === 'number' ? baseTop[3] : 0,
            y: typeof baseTop[4] === 'number' ? baseTop[4] : 0,
        };
    }
    return {
        x: typeof baseTop?.x === 'number' ? baseTop.x : 0,
        y: typeof baseTop?.y === 'number' ? baseTop.y : 0,
    };
}

/**
 * Find an unmatched base node in the current script with the same content
 * (ignoring its own next) so moved subtrees (wrap/unwrap) keep their ids.
 */
function findMovedMatch(ctx: RCtx, eNode: Block, exclude: Set<string>): string | null {
    if (!ctx.currentPool) return null;
    for (const bid of ctx.currentPool) {
        if (exclude.has(bid) || bid in ctx.out) continue;
        if (ctx.owner.has(bid)) continue;
        const raw = ctx.baseBlocks[bid];
        // Never steal shadow ids (menus, prototypes, default args).
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.shadow === true) continue;
        const bn = ctx.baseNodeById.get(bid);
        if (bn && bn.opcode === eNode.opcode && irBlockEqualIgnoreTopNext(eNode, bn)) return bid;
    }
    return null;
}

/**
 * Reconcile an edited next-chain (or substack) against a base chain.
 * Returns the list of new block ids, stitched via next/parent.
 */
function reconcileChain(
    ctx: RCtx,
    editedHead: Block | undefined,
    baseHeadId: string | null,
    ownerId: string | null,
    depth: number,
): string[] {
    const edited = chainToList(editedHead);
    const base = baseChainToList(ctx.baseBlocks, baseHeadId);
    const pairs = lcsKeys(
        edited.map(editedKey),
        base.map((id) => baseKey(ctx.baseBlocks, id)),
    );
    const baseFor = new Map<number, string>();
    for (const [ei, bi] of pairs) baseFor.set(ei, base[bi]);
    const matchedBase = new Set(baseFor.values());
    const ids: string[] = [];
    for (let i = 0; i < edited.length; i++) {
        const prevId = ids.length > 0 ? ids[ids.length - 1] : ownerId;
        let mid = baseFor.get(i) ?? null;
        if (!mid) mid = findMovedMatch(ctx, edited[i], matchedBase);
        ids.push(reconcileSingle(ctx, edited[i], mid, prevId, depth + i));
    }
    for (let i = 0; i < ids.length; i++) {
        const entry = ctx.out[ids[i]];
        entry.next = i + 1 < ids.length ? ids[i + 1] : null;
        entry.parent = i === 0 ? ownerId : ids[i - 1];
    }
    return ids;
}

/**
 * Reconcile one edited block against an optional base block.
 * Builds exactly ONE node (chains are stitched by the caller).
 */
function reconcileSingle(ctx: RCtx, eNode: Block, baseId: string | null, parentId: string | null, depth: number): string {
    if (baseId) {
        const owner = ctx.owner.get(baseId);
        if (owner && owner !== eNode) {
            baseId = null; // already consumed by another edited node
        } else {
            ctx.owner.set(baseId, eNode);
        }
    }
    const base = baseId ? ctx.baseBlocks[baseId] : undefined;
    const baseOk =
        baseId !== null &&
        base !== undefined &&
        typeof base === 'object' &&
        !Array.isArray(base) &&
        base.opcode === eNode.opcode &&
        (eNode.opcode !== 'procedures_call' || callProccode(base) === (eNode.proc?.proccode ?? ''));
    if (baseOk && baseId) {
        const baseNode = ctx.baseNodeById.get(baseId);
        const parentSame = (base.parent ?? null) === parentId;
        if (baseNode && irBlockEqual(eNode, baseNode) && parentSame) {
            for (const id of collectReachable(ctx.baseBlocks, baseId)) {
                if (!(id in ctx.out)) ctx.out[id] = cloneBase(ctx.baseBlocks[id]);
            }
            pairWalk(ctx, baseId, eNode);
            return baseId;
        }
    }
    ctx.changed = true;
    if (eNode.opcode === 'procedures_definition') return buildDefinition(ctx, eNode, baseOk ? baseId : null, parentId, depth);
    if (eNode.opcode === 'procedures_call') return buildCall(ctx, eNode, baseOk ? baseId : null, parentId, depth);
    return buildGeneric(ctx, eNode, baseOk ? baseId : null, parentId, depth);
}

function fieldRefKindOf(opcode: string, fieldName: string): 'var' | 'list' | 'broadcast' | null {
    const spec = getBlockSpec(opcode);
    const fs = spec?.fields.find((x) => x.name === fieldName);
    if (fs) {
        if (fs.kind === 'variable') return 'var';
        if (fs.kind === 'list') return 'list';
        if (fs.kind === 'broadcast') return 'broadcast';
        return null;
    }
    if (fieldName === 'VARIABLE') return 'var';
    if (fieldName === 'LIST') return 'list';
    if (fieldName === 'BROADCAST_OPTION') return 'broadcast';
    return null;
}

function buildGeneric(ctx: RCtx, eNode: Block, baseId: string | null, parentId: string | null, depth: number): string {
    const id = baseId ?? freshId(ctx);
    trackLoc(ctx, id, eNode);
    const base = baseId ? ctx.baseBlocks[baseId] : undefined;
    const baseObj = base && typeof base === 'object' && !Array.isArray(base) ? base : undefined;
    const entry: any = {
        opcode: eNode.opcode,
        next: null,
        parent: parentId,
        inputs: {},
        fields: {},
        shadow: typeof baseObj?.shadow === 'boolean' ? baseObj.shadow : false,
        topLevel: false,
    };
    ctx.out[id] = entry;
    for (const [fname, f] of Object.entries(eNode.fields)) {
        const kind = fieldRefKindOf(eNode.opcode, fname);
        if (kind === 'broadcast') {
            const bid = resolveBroadcast(ctx, f.value);
            entry.fields[fname] = [f.value, bid];
        } else if (kind === 'var' || kind === 'list') {
            const table = kind === 'var' ? ctx.variables : ctx.lists;
            const rid = table.get(f.value);
            if (!rid) {
                rdiag(ctx, `unknown ${kind} "${f.value}" (declare it in target.json first)`, eNode.loc);
                entry.fields[fname] = [f.value, null];
            } else {
                entry.fields[fname] = [f.value, rid];
            }
        } else {
            entry.fields[fname] = [f.value, null];
        }
    }
    if (eNode.mutation !== undefined) entry.mutation = cloneBase(eNode.mutation);
    else if (baseObj?.mutation !== undefined) entry.mutation = cloneBase(baseObj.mutation);
    for (const [iname, einput] of Object.entries(eNode.inputs)) {
        if (einput.kind === 'stack') {
            const binput = baseObj?.inputs?.[iname];
            const bHead = Array.isArray(binput) && typeof binput[1] === 'string' ? binput[1] : null;
            const ids = reconcileChain(ctx, einput.block, bHead, id, depth + 1);
            if (ids.length > 0) entry.inputs[iname] = [2, ids[0]];
            continue;
        }
        const binput = baseObj?.inputs?.[iname];
        const built = reconcileValue(ctx, id, eNode.opcode, iname, einput, binput, eNode.loc, depth);
        if (built) entry.inputs[iname] = built;
    }
    const cid = reconcileAttachedComment(
        ctx,
        eNode.comment,
        baseId,
        id,
        ctx.curScriptX,
        ctx.curScriptEstW,
        ctx.curScriptY + depth * 36,
    );
    if (cid) entry.comment = cid;
    else delete entry.comment;
    return id;
}

function buildDefinition(ctx: RCtx, eNode: Block, baseId: string | null, parentId: string | null, depth: number): string {
    const proc = eNode.proc ?? { proccode: '', argumentnames: [], argumentdefaults: [], warp: false };
    const id = baseId ?? freshId(ctx);
    trackLoc(ctx, id, eNode);
    const baseInfo = baseId ? baseDefInfo(ctx.baseBlocks, baseId) : null;
    if (baseInfo && baseInfo.proccode !== proc.proccode) {
        // Proccode changed: treat as brand-new definition.
        return buildDefinition(ctx, eNode, null, parentId, depth);
    }
    let rec = ctx.defs.get(proc.proccode);
    if (!rec) {
        const argIds = proc.argumentnames.map((n) => {
            const bi = baseInfo?.argNames.indexOf(n) ?? -1;
            if (bi >= 0 && baseInfo) return baseInfo.argIds[bi];
            return freshId(ctx);
        });
        rec = { argIds, argNames: [...proc.argumentnames], argDefaults: [...proc.argumentdefaults], warp: proc.warp };
        ctx.defs.set(proc.proccode, rec);
    }
    while (rec.argDefaults.length < rec.argNames.length) rec.argDefaults.push('');
    // Prototype shadow.
    let protoId: string | null = null;
    if (baseInfo?.protoId && ctx.baseBlocks[baseInfo.protoId]) {
        protoId = baseInfo.protoId;
    } else {
        protoId = freshId(ctx);
    }
    trackLoc(ctx, protoId, eNode);
    const protoInputs: Record<string, any> = {};
    for (let i = 0; i < rec.argNames.length; i++) {
        const argId = rec.argIds[i];
        const argName = rec.argNames[i];
        let repId: string | null = null;
        if (baseInfo?.protoId) {
            const protoInputsBase = ctx.baseBlocks[baseInfo.protoId]?.inputs ?? {};
            // Prefer the input keyed by the (possibly reused) arg id, else by old name.
            const bi = baseInfo.argNames.indexOf(argName);
            const candidates: Array<unknown> = [];
            if (argId in protoInputsBase) candidates.push(protoInputsBase[argId]?.[1]);
            if (bi >= 0) candidates.push(protoInputsBase[baseInfo.argIds[bi]]?.[1]);
            for (const cand of candidates) {
                if (typeof cand !== 'string') continue;
                const candBlock = ctx.baseBlocks[cand];
                if (candBlock && typeof candBlock === 'object' && !Array.isArray(candBlock)) {
                    repId = cand;
                    const fresh = cloneBase(candBlock);
                    fresh.fields = { VALUE: [argName, null] };
                    fresh.parent = protoId;
                    ctx.out[cand] = fresh;
                    break;
                }
            }
        }
        if (!repId) {
            repId = freshId(ctx);
            ctx.out[repId] = {
                opcode: argReporterOpcode(proc.proccode, i),
                next: null,
                parent: protoId,
                inputs: {},
                fields: { VALUE: [argName, null] },
                shadow: true,
                topLevel: false,
            };
        }
        protoInputs[argId] = [1, repId];
    }
    ctx.out[protoId] = {
        opcode: 'procedures_prototype',
        next: null,
        parent: id,
        inputs: protoInputs,
        fields: {},
        shadow: true,
        topLevel: false,
        mutation: {
            tagName: 'mutation',
            children: [],
            proccode: proc.proccode,
            argumentids: JSON.stringify(rec.argIds),
            argumentnames: JSON.stringify(rec.argNames),
            argumentdefaults: JSON.stringify(rec.argDefaults),
            warp: proc.warp ? 'true' : 'false',
        },
    };
    const entry: any = {
        opcode: 'procedures_definition',
        next: null,
        parent: parentId,
        inputs: { custom_block: [1, protoId] },
        fields: {},
        shadow: false,
        topLevel: false,
    };
    ctx.out[id] = entry;
    // The body (eNode.next) is stitched by the caller's chain; attach our comment.
    const cid = reconcileAttachedComment(
        ctx,
        eNode.comment,
        baseId,
        id,
        ctx.curScriptX,
        ctx.curScriptEstW,
        ctx.curScriptY + depth * 36,
    );
    if (cid) entry.comment = cid;
    else delete entry.comment;
    return id;
}

function buildCall(ctx: RCtx, eNode: Block, baseId: string | null, parentId: string | null, depth: number): string {
    const proccode = eNode.proc?.proccode ?? '';
    const id = baseId ?? freshId(ctx);
    trackLoc(ctx, id, eNode);
    let def = ctx.defs.get(proccode);
    if (!def) {
        const bd = ctx.baseDefs.get(proccode);
        if (bd) {
            def = { argIds: [...bd.argIds], argNames: [...bd.argNames], argDefaults: [], warp: false };
        } else {
            rdiag(ctx, `procedure call "${proccode}" doesn't match a definition`, eNode.loc);
            def = { argIds: [], argNames: [], argDefaults: [], warp: false };
        }
    }
    const base = baseId ? ctx.baseBlocks[baseId] : undefined;
    const baseObj = base && typeof base === 'object' && !Array.isArray(base) ? base : undefined;
    const entry: any = {
        opcode: 'procedures_call',
        next: null,
        parent: parentId,
        inputs: {},
        fields: {},
        shadow: typeof baseObj?.shadow === 'boolean' ? baseObj.shadow : false,
        topLevel: false,
        mutation: {
            tagName: 'mutation',
            children: [],
            proccode,
            argumentids: JSON.stringify(def.argIds),
            warp: 'false',
        },
    };
    ctx.out[id] = entry;
    for (const [argName, einput] of Object.entries(eNode.inputs)) {
        const ai = def.argNames.indexOf(argName);
        if (ai < 0) {
            rdiag(ctx, `procedure call "${proccode}" has no argument "${argName}"`, eNode.loc);
            continue;
        }
        const argId = def.argIds[ai];
        const binput = baseObj?.inputs?.[argId];
        if (einput.kind === 'stack') continue;
        if (einput.kind === 'literal') {
            const lit = einput.value;
            entry.inputs[argId] = [1, [typeof lit === 'number' ? 4 : 10, lit]];
            continue;
        }
        if (einput.kind === 'menu') {
            entry.inputs[argId] = [1, [10, einput.value]];
            continue;
        }
        if (einput.kind === 'var' || einput.kind === 'list' || einput.kind === 'broadcast') {
            const built = reconcileValue(ctx, id, 'procedures_call', argId, einput, binput, eNode.loc, depth);
            if (built) entry.inputs[argId] = built;
            continue;
        }
        let childId: string | null = null;
        const bref = Array.isArray(binput) ? binput[1] : undefined;
        if (typeof bref === 'string') {
            const bchild = ctx.baseBlocks[bref];
            if (bchild && typeof bchild === 'object' && !Array.isArray(bchild) && bchild.opcode === einput.block.opcode) {
                childId = reconcileSingle(ctx, einput.block, bref, id, depth);
            }
        }
        if (!childId) {
            const moved = findMovedMatch(ctx, einput.block, new Set());
            if (moved) childId = reconcileSingle(ctx, einput.block, moved, id, depth);
        }
        if (!childId) childId = reconcileSingle(ctx, einput.block, null, id, depth);
        const bObscured = Array.isArray(binput) ? binput[2] : undefined;
        if (bObscured !== undefined) entry.inputs[argId] = [3, childId, cloneBase(bObscured)];
        else entry.inputs[argId] = [2, childId];
    }
    // Calls are single nodes (chains stitch next); attach our comment.
    const cid = reconcileAttachedComment(
        ctx,
        eNode.comment,
        baseId,
        id,
        ctx.curScriptX,
        ctx.curScriptEstW,
        ctx.curScriptY + depth * 36,
    );
    if (cid) entry.comment = cid;
    else delete entry.comment;
    return id;
}

function reconcileAttachedComment(
    ctx: RCtx,
    eComment: Comment | undefined,
    baseId: string | null,
    ownerId: string,
    scriptX: number,
    scriptEstW: number,
    ownerY: number,
): string | undefined {
    // Find the base comment this one continues: by srcId (ir-json), by anchor (text formats that print
    // comment anchors), or as the unclaimed comment already attached to the same base block.
    let matchId: string | undefined;
    if (eComment && baseId) {
        const free = (cid: string | undefined): boolean =>
            !!cid && !!ctx.baseComments[cid] && !(cid in ctx.outComments) && ctx.baseComments[cid].blockId === baseId;
        if (free(eComment.srcId)) matchId = eComment.srcId;
        else if (eComment.anchor && free(ctx.anchorMap[eComment.anchor])) matchId = ctx.anchorMap[eComment.anchor];
        else {
            for (const [cid, bc] of Object.entries<any>(ctx.baseComments)) {
                if (bc?.blockId === baseId && !(cid in ctx.outComments)) {
                    matchId = cid;
                    break;
                }
            }
        }
    }
    if (eComment && matchId) {
        eComment = { ...eComment, srcId: matchId };
        const bc = ctx.baseComments[matchId];
        {
            const minimized = eComment.minimized === true;
            if (bc.text === eComment.text && (bc.minimized === true) === minimized) {
                ctx.outComments[eComment.srcId] = cloneBase(bc);
                ctx.outComments[eComment.srcId].blockId = ownerId;
            } else {
                ctx.changed = true;
                ctx.outComments[eComment.srcId] = { ...cloneBase(bc), blockId: ownerId, text: eComment.text, minimized };
            }
            if (eComment.loc) ctx.sourcemap[eComment.srcId] = eComment.loc;
            return eComment.srcId;
        }
    }
    if (eComment) {
        // New attached comment: right of the owning script's bbox, at the block's y.
        const id = freshId(ctx);
        ctx.outComments[id] = {
            blockId: ownerId,
            x: Math.round((scriptX + scriptEstW + 32) * 100) / 100,
            y: Math.round(ownerY * 100) / 100,
            width: 200,
            height: 200,
            minimized: eComment.minimized === true,
            text: eComment.text,
        };
        if (eComment.loc) ctx.sourcemap[id] = eComment.loc;
        ctx.newCommentIds.push(id);
        ctx.changed = true;
        return id;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Target + project
// ---------------------------------------------------------------------------

function matchKeyForAnchor(ctx: RCtx, anchor: string | undefined, kind: Script['kind']): string | null {
    if (!anchor) return null;
    const id = ctx.anchorMap[anchor];
    if (!id || ctx.claimed.has(id)) return null;
    if (kind === 'comment') {
        if (ctx.baseComments[id]) {
            ctx.claimed.add(id);
            return id;
        }
        return null;
    }
    const b = ctx.baseBlocks[id];
    if (b !== undefined && (Array.isArray(b) || (typeof b === 'object' && b.topLevel === true))) {
        ctx.claimed.add(id);
        return id;
    }
    return null;
}

function isTopReporterOpcode(opcode: string): boolean {
    return opcode === 'data_variable' || opcode === 'data_listcontents';
}

function reconcileTopReporter(
    ctx: RCtx,
    script: Script,
    baseId: string | null,
    x: number,
    y: number,
): string {
    const top = script.top as Block;
    const isVar = top.opcode === 'data_variable';
    const table = isVar ? ctx.variables : ctx.lists;
    const fieldName = isVar ? 'VARIABLE' : 'LIST';
    const name = top.fields[fieldName]?.value ?? '';
    const rid = table.get(name);
    if (!rid) {
        rdiag(ctx, `unknown ${isVar ? 'var' : 'list'} "${name}" (declare it in target.json first)`, top.loc);
    }
    const id = baseId ?? freshId(ctx);
    trackLoc(ctx, id, top);
    ctx.out[id] = {
        opcode: top.opcode,
        next: null,
        parent: null,
        inputs: {},
        fields: { [fieldName]: [name, rid ?? null] },
        shadow: false,
        topLevel: true,
        x,
        y,
    };
    const cid = reconcileAttachedComment(ctx, top.comment, baseId, id, x, 200, y);
    if (cid) ctx.out[id].comment = cid;
    return id;
}

export function reconcileTarget(
    baseTarget: any,
    scripts: Script[],
    anchorMap: AnchorMap,
    decls: TargetDecls,
    shared: {
        usedIds: Set<string>;
        broadcasts: Map<string, string>;
        /** Stage-level declarations (target's own take precedence). */
        stageVariables: Map<string, string>;
        stageLists: Map<string, string>;
        file?: string;
    },
    targetName: string,
): ReconcileTargetResult {
    const baseBlocks: Record<string, any> = baseTarget?.blocks ?? {};
    const baseComments: Record<string, any> = baseTarget?.comments ?? {};
    const ctx: RCtx = {
        targetName,
        baseBlocks,
        baseComments,
        baseNodeById: new Map(),
        anchorMap,
        claimed: new Set(),
        variables: new Map(),
        lists: new Map(),
        broadcasts: shared.broadcasts,
        defs: new Map(),
        baseDefs: new Map(),
        usedIds: shared.usedIds,
        out: {},
        outComments: {},
        diagnostics: [],
        sourcemap: {},
        newScriptIds: [],
        newCommentIds: [],
        changed: false,
        file: shared.file,
        curScriptX: 0,
        curScriptY: 0,
        curScriptEstW: 240,
        currentPool: null,
        owner: new Map(),
    };
    // Name -> id tables: Stage tables first, then the target's own
    // declarations (own shadows Stage; first own declaration wins).
    for (const [name, id] of shared.stageVariables) ctx.variables.set(name, id);
    for (const [name, id] of shared.stageLists) ctx.lists.set(name, id);
    const seenOwnVars = new Set<string>();
    for (const d of decls.variables) {
        if (seenOwnVars.has(d.name)) continue;
        seenOwnVars.add(d.name);
        ctx.variables.set(d.name, d.id);
    }
    const seenOwnLists = new Set<string>();
    for (const d of decls.lists) {
        if (seenOwnLists.has(d.name)) continue;
        seenOwnLists.add(d.name);
        ctx.lists.set(d.name, d.id);
    }
    // Base IR for comparison.
    const baseExtracted = extractTarget(baseTarget, { targets: [baseTarget] }, {});
    ctx.baseNodeById = baseExtracted.nodeById;
    const baseScriptsById = new Map<string, Script>();
    for (const s of baseExtracted.scripts) {
        if (s.srcId) baseScriptsById.set(s.srcId, s);
    }
    // Base defs fallback (calls to deleted defs).
    for (const [bid] of Object.entries<any>(baseBlocks)) {
        const info = baseDefInfo(baseBlocks, bid);
        if (info && !ctx.baseDefs.has(info.proccode)) ctx.baseDefs.set(info.proccode, { argIds: info.argIds, argNames: info.argNames });
    }

    // Duplicate anchors: first wins, rest treated as new.
    const seenAnchors = new Set<string>();
    const matched: Array<{ script: Script; baseId: string | null }> = [];
    for (const s of scripts) {
        if (s.anchor && seenAnchors.has(s.anchor)) {
            rdiag(ctx, `duplicate anchor ${s.anchor}: treated as new`, s.loc, 'warning');
            matched.push({ script: { ...s, anchor: undefined }, baseId: null });
            continue;
        }
        if (s.anchor) seenAnchors.add(s.anchor);
        matched.push({ script: s, baseId: matchKeyForAnchor(ctx, s.anchor, s.kind) });
    }

    // Pre-assign definition arg ids from edited defs (anchor-matched reuse base ids).
    for (const { script } of matched) {
        if (script.kind !== 'stack' || !script.top || script.top.opcode !== 'procedures_definition' || !script.top.proc) continue;
        const proc = script.top.proc;
        if (ctx.defs.has(proc.proccode)) {
            rdiag(ctx, `duplicate procedure definition "${proc.proccode}"`, script.top.loc);
            continue;
        }
        let baseInfo: ReturnType<typeof baseDefInfo> = null;
        const am = script.anchor ? anchorMap[script.anchor] : undefined;
        if (am && baseBlocks[am]?.opcode === 'procedures_definition') baseInfo = baseDefInfo(baseBlocks, am);
        if ((!baseInfo || baseInfo.proccode !== proc.proccode) && script.top.srcId) {
            const bySrc = baseDefInfo(baseBlocks, script.top.srcId);
            if (bySrc && bySrc.proccode === proc.proccode) baseInfo = bySrc;
        }
        const argIds = proc.argumentnames.map((n) => {
            const bi = baseInfo?.argNames.indexOf(n) ?? -1;
            if (bi >= 0 && baseInfo) return baseInfo.argIds[bi];
            return freshId(ctx);
        });
        if (argIds.some((a) => !baseInfo?.argIds.includes(a))) ctx.changed = true;
        ctx.defs.set(proc.proccode, {
            argIds,
            argNames: [...proc.argumentnames],
            argDefaults: [...proc.argumentdefaults],
            warp: proc.warp,
        });
    }

    // Script placement extents (stacks/reporters only; comments don't define columns).
    let minX = Infinity;
    let maxBottom = -Infinity;
    const noteScript = (x: number, estH: number, y: number): void => {
        if (x < minX) minX = x;
        if (y + estH > maxBottom) maxBottom = y + estH;
    };

    const finishTop = (id: string, x: number, y: number): void => {
        const e = ctx.out[id];
        e.topLevel = true;
        e.parent = null;
        e.x = x;
        e.y = y;
    };

    const reconcileStackOrReporter = (script: Script, baseId: string | null, x: number, y: number): string => {
        const top = script.top as Block;
        ctx.curScriptX = x;
        ctx.curScriptY = y;
        ctx.curScriptEstW = Math.max(estimateSubSize(top).w, 120);
        if (isTopReporterOpcode(top.opcode)) return reconcileTopReporter(ctx, script, baseId, x, y);
        const ids = reconcileChain(ctx, top, baseId, null, 0);
        return ids[0];
    };

    interface NewItem {
        script: Script;
    }
    const pending: NewItem[] = [];
    // Provisional placement cursor shared by new scripts and new workspace comments.
    const cursor = { x: 0, y: 0 };
    const placeNewWorkspace = (script: Script): void => {
        const c = script.comment;
        if (!c) return;
        const id = freshId(ctx);
        ctx.outComments[id] = {
            blockId: null,
            x: cursor.x,
            y: cursor.y,
            width: 200,
            height: 200,
            minimized: c.minimized === true,
            text: c.text,
        };
        if (c.loc) ctx.sourcemap[id] = c.loc;
        ctx.newCommentIds.push(id);
        ctx.changed = true;
        cursor.y += 200 + 72;
    };
    for (const { script, baseId } of matched) {
        if (script.kind === 'comment') {
            if (baseId) {
                reconcileWorkspaceComment(ctx, script, baseId);
            } else {
                pending.push({ script });
            }
            continue;
        }
        if (!script.top) {
            rdiag(ctx, 'script has no top block', script.loc);
            continue;
        }
        if (!baseId) {
            pending.push({ script });
            continue;
        }
        const baseScript = baseScriptsById.get(baseId);
        const baseTop = baseBlocks[baseId];
        if (!baseScript || baseTop === undefined) {
            pending.push({ script });
            continue;
        }
        if (irScriptEqual(script, baseScript)) {
            copyVerbatim(ctx, baseId, script);
            if (!Array.isArray(baseTop)) {
                const { x, y } = baseTopXY(baseTop);
                noteScript(x, Math.max(estimateSubSize(script.top).h, 40), y);
            } else {
                const { x, y } = baseTopXY(baseTop);
                noteScript(x, 40, y);
            }
            continue;
        }
        ctx.changed = true;
        const { x, y } = baseTopXY(baseTop);
        ctx.currentPool = collectReachable(baseBlocks, baseId);
        const id = reconcileStackOrReporter(script, baseId, x, y);
        const est = estimateSubSize(script.top);
        finishTop(id, x, y);
        noteScript(x, Math.max(est.h, 40), y);
    }

    // Provisional positions for new items: below the lowest script at x of
    // the leftmost column, gap 72.
    if (!isFinite(minX)) minX = 0;
    const hasPlaced = maxBottom > -Infinity;
    if (!hasPlaced) maxBottom = 0;
    cursor.x = hasPlaced ? minX : 0;
    cursor.y = maxBottom + (hasPlaced ? 72 : 0);
    const placeNew = (script: Script): void => {
        if (script.kind === 'comment') {
            placeNewWorkspace(script);
            return;
        }
        if (!script.top) return;
        const est = estimateSubSize(script.top);
        ctx.currentPool = [];
        const id = reconcileStackOrReporter(script, null, cursor.x, cursor.y);
        finishTop(id, cursor.x, cursor.y);
        ctx.newScriptIds.push(id);
        noteScript(cursor.x, Math.max(est.h, 40), cursor.y);
        cursor.y += Math.max(est.h, 40) + 72;
    };
    for (const { script } of pending) placeNew(script);

    // Carry over orphan base blocks (unreachable cruft) so changed targets
    // don't lose data the IR never sees; repair dangling links.
    const claimedReachable = new Set<string>();
    for (const bid of ctx.claimed) {
        for (const rid of collectReachable(baseBlocks, bid)) claimedReachable.add(rid);
    }
    let deletedCount = 0;
    for (const [bid, b] of Object.entries<any>(baseBlocks)) {
        // Compact `[12, ...]` array blocks only ever occur as top-level scripts.
        const isTop = Array.isArray(b) || (b && typeof b === 'object' && b.topLevel === true);
        if (isTop && !ctx.claimed.has(bid)) {
            deletedCount++;
        }
    }
    if (deletedCount > 0) ctx.changed = true;
    for (const [bid, b] of Object.entries<any>(baseBlocks)) {
        if (bid in ctx.out) continue;
        if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
        if (b.topLevel === true) continue; // deleted script tops stay deleted
        if (claimedReachable.has(bid)) continue; // already handled
        // Orphan cruft: carry verbatim, repair dangling parent/next.
        const cp = cloneBase(b);
        if (typeof cp.parent === 'string' && !(cp.parent in ctx.out) && !claimedReachable.has(cp.parent)) {
            cp.parent = null;
        }
        if (typeof cp.next === 'string' && !(cp.next in ctx.out) && !(cp.next in baseBlocks)) {
            cp.next = null;
        }
        ctx.out[bid] = cp;
    }
    // Base comments never emitted: deleted (or dropped attached comments).
    for (const [cid] of Object.entries<any>(baseComments)) {
        if (cid in ctx.outComments) continue;
        ctx.changed = true;
    }

    const collections = buildCollections(ctx, baseTarget, decls);
    return {
        blocks: orderLikeBase(ctx.out, baseBlocks),
        comments: orderLikeBase(ctx.outComments, baseComments),
        diagnostics: ctx.diagnostics,
        newScriptIds: ctx.newScriptIds,
        newCommentIds: ctx.newCommentIds,
        sourcemap: ctx.sourcemap,
        changed: ctx.changed || collections.changed,
        collections: collections.changed ? collections.value : undefined,
    };
}

function reconcileWorkspaceComment(ctx: RCtx, script: Script, baseId: string | null): void {
    const c = script.comment;
    if (!c) return;
    if (baseId && ctx.baseComments[baseId]) {
        const bc = ctx.baseComments[baseId];
        if (irCommentEqual(c, { text: String(bc.text ?? ''), minimized: bc.minimized === true })) {
            ctx.outComments[baseId] = cloneBase(bc);
        } else {
            ctx.changed = true;
            ctx.outComments[baseId] = { ...cloneBase(bc), blockId: null, text: c.text, minimized: c.minimized === true };
        }
        if (c.loc) ctx.sourcemap[baseId] = c.loc;
        return;
    }
    ctx.changed = true;
    const id = freshId(ctx);
    ctx.outComments[id] = {
        blockId: null,
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        minimized: c.minimized === true,
        text: c.text,
    };
    if (c.loc) ctx.sourcemap[id] = c.loc;
    ctx.newCommentIds.push(id);
}

/** Order-insensitive JSON normalization for comparisons. */
function normDeep(v: any): string {
    if (Array.isArray(v)) return `[${v.map(normDeep).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${normDeep(v[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
}

function buildCollections(
    ctx: RCtx,
    baseTarget: any,
    decls: TargetDecls,
): { changed: boolean; value: NonNullable<ReconcileTargetResult['collections']> } {
    void ctx;
    const variables: Record<string, unknown[]> = {};
    for (const d of decls.variables) {
        variables[d.id] = d.cloud ? [d.name, d.value, true] : [d.name, d.value];
    }
    const lists: Record<string, unknown[]> = {};
    for (const d of decls.lists) lists[d.id] = [d.name, ...d.items];
    // Broadcasts: base dict overlaid with target.json declarations.
    const broadcasts: Record<string, string> = { ...(baseTarget?.broadcasts ?? {}) };
    for (const { name, id } of decls.broadcasts) {
        for (const [k, v] of Object.entries(broadcasts)) {
            if (v === name && k !== id) delete broadcasts[k];
        }
        broadcasts[id] = name;
    }
    const value = {
        variables,
        lists,
        broadcasts,
        // Key order in asset entries is cosmetic: reuse base verbatim when equal.
        costumes: normDeep(decls.costumes) === normDeep(baseTarget?.costumes ?? []) ? cloneBase(baseTarget.costumes ?? []) : decls.costumes,
        sounds: normDeep(decls.sounds) === normDeep(baseTarget?.sounds ?? []) ? cloneBase(baseTarget.sounds ?? []) : decls.sounds,
        scalars: decls.scalars,
    };
    const norm = (v: any): string => JSON.stringify(v);
    const changed =
        norm(variables) !== norm(baseTarget?.variables ?? {}) ||
        norm(lists) !== norm(baseTarget?.lists ?? {}) ||
        norm(broadcasts) !== norm(baseTarget?.broadcasts ?? {}) ||
        normDeep(decls.costumes) !== normDeep(baseTarget?.costumes ?? []) ||
        normDeep(decls.sounds) !== normDeep(baseTarget?.sounds ?? []) ||
        normDeep(decls.scalars) !== normDeep(baseScalars(baseTarget));
    return { changed, value };
}

const TARGET_META_KEYS = new Set(['blocks', 'comments', 'variables', 'lists', 'broadcasts', 'costumes', 'sounds']);

function baseScalars(baseTarget: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(baseTarget ?? {})) {
        if (!TARGET_META_KEYS.has(k)) out[k] = v;
    }
    return out;
}

/** Reorder entries to base key order (base keys first), new keys appended. */
function orderLikeBase(out: Record<string, any>, base: Record<string, any>): Record<string, any> {
    const ordered: Record<string, any> = {};
    for (const k of Object.keys(base)) {
        if (k in out) ordered[k] = out[k];
    }
    for (const k of Object.keys(out)) {
        if (!(k in ordered)) ordered[k] = out[k];
    }
    return ordered;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export function reconcileProject(
    baseProject: any,
    perTarget: Record<string, { scripts: Script[]; anchors: AnchorMap }>,
    declsByTarget: Record<string, TargetDecls>,
    opts?: { file?: string },
): ReconcileProjectResult {
    const diagnostics: Diagnostic[] = [];
    const sourcemap: Record<string, Loc> = {};
    const placements: Placement[] = [];
    const usedIds = new Set<string>();
    for (const t of baseProject?.targets ?? []) {
        for (const id of Object.keys(t?.blocks ?? {})) usedIds.add(id);
        for (const id of Object.keys(t?.comments ?? {})) usedIds.add(id);
    }
    // Global broadcast table seeded from base declarations (all targets).
    const broadcasts = new Map<string, string>();
    for (const t of baseProject?.targets ?? []) {
        for (const [id, name] of Object.entries<any>(t?.broadcasts ?? {})) {
            if (!broadcasts.has(String(name))) broadcasts.set(String(name), id);
        }
    }
    // Overlay target.json-declared broadcasts.
    for (const decls of Object.values(declsByTarget)) {
        for (const { name, id } of decls.broadcasts) {
            broadcasts.set(name, id);
            usedIds.add(id);
        }
    }
    const shared = {
        usedIds,
        broadcasts,
        stageVariables: new Map<string, string>(),
        stageLists: new Map<string, string>(),
        file: opts?.file,
    };
    const stageName = baseProject?.targets?.find((t: any) => t?.isStage)?.name;
    {
        const stageDecls = stageName ? declsByTarget[stageName] : undefined;
        if (stageDecls) {
            for (const d of stageDecls.variables) {
                if (!shared.stageVariables.has(d.name)) shared.stageVariables.set(d.name, d.id);
            }
            for (const d of stageDecls.lists) {
                if (!shared.stageLists.has(d.name)) shared.stageLists.set(d.name, d.id);
            }
        }
    }
    let changed = false;
    const newTargets: any[] = [];
    const seen = new Set<string>();
    for (const baseTarget of baseProject?.targets ?? []) {
        const name = baseTarget?.name;
        seen.add(name);
        const per = perTarget[name];
        const decls = declsByTarget[name];
        if (!per || !decls) {
            // Target directory missing: keep base verbatim.
            diagnostics.push({ message: `target "${name}" not in directory; kept verbatim`, severity: 'warning' });
            newTargets.push(baseTarget);
            continue;
        }
        const r = reconcileTarget(baseTarget, per.scripts, per.anchors, decls, shared, name);
        diagnostics.push(...r.diagnostics);
        Object.assign(sourcemap, r.sourcemap);
        placements.push({ target: name, newScriptIds: r.newScriptIds, newCommentIds: r.newCommentIds });
        if (!r.changed && !r.collections) {
            newTargets.push(baseTarget);
            continue;
        }
        changed = true;
        const rebuilt: any = { ...baseTarget };
        rebuilt.blocks = r.blocks;
        rebuilt.comments = r.comments;
        if (r.collections) {
            rebuilt.variables = r.collections.variables;
            rebuilt.lists = r.collections.lists;
            rebuilt.broadcasts = r.collections.broadcasts;
            rebuilt.costumes = r.collections.costumes;
            rebuilt.sounds = r.collections.sounds;
            for (const [k, v] of Object.entries(r.collections.scalars)) rebuilt[k] = v;
            for (const k of Object.keys(rebuilt)) {
                if (!TARGET_META_KEYS.has(k) && !(k in r.collections.scalars)) delete rebuilt[k];
            }
        }
        newTargets.push(rebuilt);
    }
    // New targets (directories not in base): append.
    for (const [name, per] of Object.entries(perTarget)) {
        if (seen.has(name)) continue;
        const decls = declsByTarget[name];
        if (!decls) continue;
        changed = true;
        const fakeBase = { name, blocks: {}, comments: {}, variables: {}, lists: {}, broadcasts: {} };
        const r = reconcileTarget(fakeBase, per.scripts, per.anchors, decls, shared, name);
        diagnostics.push(...r.diagnostics);
        Object.assign(sourcemap, r.sourcemap);
        placements.push({ target: name, newScriptIds: r.newScriptIds, newCommentIds: r.newCommentIds });
        newTargets.push({
            ...decls.scalars,
            name,
            variables: r.collections?.variables ?? {},
            lists: r.collections?.lists ?? {},
            broadcasts: r.collections?.broadcasts ?? {},
            costumes: r.collections?.costumes ?? [],
            sounds: r.collections?.sounds ?? [],
            blocks: r.blocks,
            comments: r.comments,
        });
    }
    // Flush auto-created broadcasts onto the Stage.
    const created: Array<[string, string]> = [];
    for (const [name, id] of shared.broadcasts) {
        let found = false;
        for (const t of newTargets) {
            if (t.broadcasts && id in t.broadcasts) {
                found = true;
                break;
            }
        }
        if (!found) created.push([name, id]);
    }
    if (created.length > 0) {
        const idx = newTargets.findIndex((t) => t?.name === stageName);
        const si = idx >= 0 ? idx : 0;
        if (newTargets[si]) {
            newTargets[si] = {
                ...newTargets[si],
                broadcasts: { ...newTargets[si].broadcasts },
            };
            for (const [name, id] of created) newTargets[si].broadcasts[id] = name;
            changed = true;
        }
    }
    if (!changed) {
        return { project: baseProject, diagnostics, placements, sourcemap, unchanged: true };
    }
    const project = { ...baseProject, targets: newTargets };
    return { project, diagnostics, placements, sourcemap, unchanged: false };
}
