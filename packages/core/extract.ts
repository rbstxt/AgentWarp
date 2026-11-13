/**
 * project.json target → IR scripts (with source ids attached).
 *
 * Tolerates real-world cruft: compact top-level `[12, name, id]` variable
 * reporters, dangling refs, orphan shadows, comments pointing at deleted
 * blocks. Anything unrecognized is preserved deterministically so that an
 * unchanged re-extract compares identical (verbatim reuse in reconcile).
 */
import type {
    Block,
    Comment,
    Diagnostic,
    Input,
    NameTables,
    Script,
} from './ir.ts';
import { getBlockSpec, isMenuShadow } from './catalog/index.ts';

export type AnchorMap = Record<string, string>; // anchor -> base block id / comment id

export interface ExtractResult {
    scripts: Script[];
    anchors: AnchorMap;
    diagnostics: Diagnostic[];
    /** Base block id -> extracted IR node (used by reconcile for comparison). */
    nodeById: Map<string, Block>;
}

export interface ExtractMaps {
    /** id -> name, for the target's own + Stage variables/lists. */
    varById: Map<string, string>;
    listById: Map<string, string>;
    /** id -> name, broadcasts declared on any target. */
    broadcastById: Map<string, string>;
    tables: NameTables;
}

/** Build id->name lookup maps for one target of a project. */
export function buildExtractMaps(project: any, target: any): ExtractMaps {
    const varById = new Map<string, string>();
    const listById = new Map<string, string>();
    const broadcastById = new Map<string, string>();
    const stage = (project?.targets ?? []).find((t: any) => t?.isStage);
    if (stage) {
        for (const [id, v] of Object.entries<any>(stage.variables ?? {})) {
            if (Array.isArray(v)) varById.set(id, String(v[0]));
        }
        for (const [id, v] of Object.entries<any>(stage.lists ?? {})) {
            if (Array.isArray(v)) listById.set(id, String(v[0]));
        }
    }
    for (const [id, v] of Object.entries<any>(target?.variables ?? {})) {
        if (Array.isArray(v)) varById.set(id, String(v[0]));
    }
    for (const [id, v] of Object.entries<any>(target?.lists ?? {})) {
        if (Array.isArray(v)) listById.set(id, String(v[0]));
    }
    for (const t of project?.targets ?? []) {
        for (const [id, name] of Object.entries<any>(t?.broadcasts ?? {})) {
            if (!broadcastById.has(id)) broadcastById.set(id, String(name));
        }
    }
    const tables: NameTables = {
        variables: new Map([...varById].map(([id, name]) => [name, id])),
        lists: new Map([...listById].map(([id, name]) => [name, id])),
        broadcasts: new Map([...broadcastById].map(([id, name]) => [name, id])),
    };
    return { varById, listById, broadcastById, tables };
}

const LITERAL_TAG_MIN = 4;
const LITERAL_TAG_MAX = 13;

/** Field names (or catalog kinds) that reference variables/lists/broadcasts. */
function fieldRefKind(opcode: string, fieldName: string): 'var' | 'list' | 'broadcast' | null {
    const spec = getBlockSpec(opcode);
    const fspec = spec?.fields.find((f) => f.name === fieldName);
    if (fspec) {
        if (fspec.kind === 'variable') return 'var';
        if (fspec.kind === 'list') return 'list';
        if (fspec.kind === 'broadcast') return 'broadcast';
        return null;
    }
    // Unknown opcode: guess by conventional field name.
    if (fieldName === 'VARIABLE') return 'var';
    if (fieldName === 'LIST') return 'list';
    if (fieldName === 'BROADCAST_OPTION') return 'broadcast';
    return null;
}

interface Ctx {
    blocks: Record<string, any>;
    comments: Record<string, any>;
    maps: ExtractMaps;
    diagnostics: Diagnostic[];
    nodeById: Map<string, Block>;
    /** proccode -> { argIds, argNames } from this target's definitions. */
    defs: Map<string, { argIds: string[]; argNames: string[] }>;
    active: Set<string>;
    file?: string;
}

function diag(ctx: Ctx, message: string): void {
    ctx.diagnostics.push({ message, file: ctx.file, severity: 'warning' });
}

function parseJsonArray(s: unknown): string[] {
    if (typeof s !== 'string') return [];
    try {
        const v = JSON.parse(s);
        return Array.isArray(v) ? v.map(String) : [];
    } catch {
        return [];
    }
}

function extractComment(ctx: Ctx, commentId: string): Comment | undefined {
    const c = ctx.comments[commentId];
    if (!c || typeof c !== 'object') {
        diag(ctx, `comment "${commentId}" not found`);
        return undefined;
    }
    return {
        text: typeof c.text === 'string' ? c.text : '',
        minimized: c.minimized === true ? true : undefined,
        srcId: commentId,
    };
}

function extractField(ctx: Ctx, opcode: string, fieldName: string, fval: any): { value: string } {
    const raw = Array.isArray(fval) ? fval[0] : fval;
    const fid = Array.isArray(fval) && fval.length > 1 ? fval[1] : null;
    const kind = fieldRefKind(opcode, fieldName);
    if (kind && typeof fid === 'string') {
        const table = kind === 'var' ? ctx.maps.varById : kind === 'list' ? ctx.maps.listById : ctx.maps.broadcastById;
        const name = table.get(fid);
        if (name !== undefined) return { value: name };
        diag(ctx, `${opcode} field "${fieldName}" references unknown ${kind} id "${fid}"`);
        return { value: String(raw ?? '') };
    }
    return { value: String(raw ?? '') };
}

/** Extract an input's primary value (block id string or inline literal). */
function extractInputValue(ctx: Ctx, ownerOpcode: string, inputName: string, primary: unknown): Input | null {
    if (primary === null || primary === undefined) return null;
    if (Array.isArray(primary)) {
        // Inline literal: [tag, value]
        const [tag, val] = primary;
        if (typeof tag !== 'number') {
            diag(ctx, `${ownerOpcode} input "${inputName}" has non-numeric literal tag`);
            return null;
        }
        if (tag === 11) return { kind: 'broadcast', name: String(val ?? '') };
        if (tag === 12) return { kind: 'var', name: String(val ?? '') };
        if (tag === 13) return { kind: 'list', name: String(val ?? '') };
        if (tag >= LITERAL_TAG_MIN && tag <= LITERAL_TAG_MAX) {
            return { kind: 'literal', value: (val ?? '') as string | number, litType: tag };
        }
        diag(ctx, `${ownerOpcode} input "${inputName}" has unusual literal tag ${tag}`);
        return { kind: 'literal', value: (val ?? '') as string | number, litType: tag };
    }
    if (typeof primary !== 'string') {
        diag(ctx, `${ownerOpcode} input "${inputName}" has unrecognised value`);
        return null;
    }
    const child = ctx.blocks[primary];
    if (child === undefined || child === null) {
        diag(ctx, `${ownerOpcode} input "${inputName}" references missing block "${primary}"`);
        return null;
    }
    if (Array.isArray(child)) {
        // Compact reporter nested in an input (e.g. [12, name, id]).
        const [tag, name] = child;
        if (tag === 12) return { kind: 'var', name: String(name ?? '') };
        if (tag === 13) return { kind: 'list', name: String(name ?? '') };
        diag(ctx, `${ownerOpcode} input "${inputName}" references compact block with tag ${tag}`);
        return null;
    }
    if (typeof child !== 'object' || typeof child.opcode !== 'string') {
        diag(ctx, `${ownerOpcode} input "${inputName}" references malformed block "${primary}"`);
        return null;
    }
    const opcode: string = child.opcode;
    if (isMenuShadow(opcode)) {
        const fields = child.fields ?? {};
        const entries = Object.entries<any>(fields);
        if (entries.length === 0) {
            diag(ctx, `menu block "${primary}" (${opcode}) has no fields`);
            return { kind: 'menu', value: '' };
        }
        // Broadcast menus resolve to broadcast references.
        for (const [fname, fval] of entries) {
            if (fieldRefKind(opcode, fname) === 'broadcast') {
                const raw = Array.isArray(fval) ? fval[0] : fval;
                const fid = Array.isArray(fval) && fval.length > 1 ? fval[1] : null;
                const name =
                    typeof fid === 'string' && ctx.maps.broadcastById.has(fid)
                        ? (ctx.maps.broadcastById.get(fid) as string)
                        : String(raw ?? '');
                return { kind: 'broadcast', name };
            }
        }
        const [, fval] = entries[0];
        const raw = Array.isArray(fval) ? fval[0] : fval;
        return { kind: 'menu', value: String(raw ?? '') };
    }
    if (opcode === 'data_variable') {
        const f = child.fields?.VARIABLE;
        const raw = Array.isArray(f) ? f[0] : f;
        const fid = Array.isArray(f) && f.length > 1 ? f[1] : null;
        const name =
            typeof fid === 'string' && ctx.maps.varById.has(fid)
                ? (ctx.maps.varById.get(fid) as string)
                : String(raw ?? '');
        return { kind: 'var', name };
    }
    if (opcode === 'data_listcontents') {
        const f = child.fields?.LIST;
        const raw = Array.isArray(f) ? f[0] : f;
        const fid = Array.isArray(f) && f.length > 1 ? f[1] : null;
        const name =
            typeof fid === 'string' && ctx.maps.listById.has(fid)
                ? (ctx.maps.listById.get(fid) as string)
                : String(raw ?? '');
        return { kind: 'list', name };
    }
    const sub = extractBlock(ctx, primary);
    if (!sub) return null;
    return { kind: 'block', block: sub };
}

function isStackInput(opcode: string, inputName: string): boolean {
    if (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2') return true;
    const spec = getBlockSpec(opcode);
    return spec?.inputs.some((i) => i.name === inputName && i.kind === 'stack') ?? false;
}

function extractBlock(ctx: Ctx, id: string): Block | null {
    const raw = ctx.blocks[id];
    if (raw === undefined || raw === null) {
        diag(ctx, `reference to missing block "${id}"`);
        return null;
    }
    if (Array.isArray(raw)) {
        const [tag, name] = raw;
        const opcode = tag === 12 ? 'data_variable' : tag === 13 ? 'data_listcontents' : `compact_${tag}`;
        if (tag !== 12 && tag !== 13) diag(ctx, `top-level compact block "${id}" has tag ${tag}`);
        const b: Block = {
            opcode,
            inputs: {},
            fields:
                opcode === 'data_listcontents'
                    ? { LIST: { value: String(name ?? '') } }
                    : { [opcode.startsWith('compact_') ? 'VALUE' : 'VARIABLE']: { value: String(name ?? '') } },
            srcId: id,
        };
        ctx.nodeById.set(id, b);
        return b;
    }
    if (typeof raw !== 'object' || typeof raw.opcode !== 'string') {
        diag(ctx, `block "${id}" is malformed`);
        return null;
    }
    if (ctx.active.has(id)) {
        diag(ctx, `block cycle detected at "${id}"`);
        return null;
    }
    ctx.active.add(id);
    try {
        const opcode: string = raw.opcode;
        if (opcode === 'procedures_definition') {
            const def = extractDefinition(ctx, id, raw);
            ctx.nodeById.set(id, def);
            return def;
        }
        const block: Block = { opcode, inputs: {}, fields: {}, srcId: id };
        if (opcode === 'procedures_call') {
            block.proc = { proccode: String(raw.mutation?.proccode ?? ''), argumentnames: [], argumentdefaults: [], warp: false };
        } else if (raw.mutation !== undefined && raw.mutation !== null && typeof raw.mutation === 'object') {
            block.mutation = JSON.parse(JSON.stringify(raw.mutation));
        }
        for (const [fname, fval] of Object.entries<any>(raw.fields ?? {})) {
            block.fields[fname] = extractField(ctx, opcode, fname, fval);
        }
        for (const [iname, ival] of Object.entries<any>(raw.inputs ?? {})) {
            if (!Array.isArray(ival) || ival.length < 2) {
                diag(ctx, `${opcode} input "${iname}" is malformed`);
                continue;
            }
            if (isStackInput(opcode, iname)) {
                const primary = ival[1];
                if (primary === null || primary === undefined) continue; // empty stack slot
                if (typeof primary !== 'string') {
                    diag(ctx, `${opcode} input "${iname}" has non-block value`);
                    continue;
                }
                const sub = extractBlock(ctx, primary);
                if (block.inputs[iname] !== undefined) {
                    // Duplicate key after normalization; keep first.
                    continue;
                }
                block.inputs[iname] = sub ? { kind: 'stack', block: sub } : { kind: 'stack' };
                continue;
            }
            if (opcode === 'procedures_call') {
                const def = ctx.defs.get(String(raw.mutation?.proccode ?? ''));
                const argName = def ? def.argNames[def.argIds.indexOf(iname)] : undefined;
                const value = extractInputValue(ctx, opcode, iname, ival[1]);
                if (value === null) continue;
                block.inputs[argName ?? iname] = value;
                continue;
            }
            const value = extractInputValue(ctx, opcode, iname, ival[1]);
            if (value === null) continue;
            if (block.inputs[iname] !== undefined) continue;
            block.inputs[iname] = value;
        }
        if (typeof raw.comment === 'string') {
            const c = extractComment(ctx, raw.comment);
            if (c) block.comment = c;
        }
        if (typeof raw.next === 'string') {
            const nx = extractBlock(ctx, raw.next);
            if (nx) block.next = nx;
        } else if (raw.next !== null && raw.next !== undefined) {
            diag(ctx, `${opcode} block "${id}" has malformed next`);
        }
        ctx.nodeById.set(id, block);
        return block;
    } finally {
        ctx.active.delete(id);
    }
}

function extractDefinition(ctx: Ctx, id: string, raw: any): Block {
    let proccode = '';
    let argIds: string[] = [];
    let argNames: string[] = [];
    let argDefaults: string[] = [];
    let warp = false;
    const customRef = raw.inputs?.custom_block?.[1];
    const proto = typeof customRef === 'string' ? ctx.blocks[customRef] : undefined;
    if (proto && typeof proto === 'object' && !Array.isArray(proto) && proto.opcode === 'procedures_prototype') {
        const m = proto.mutation ?? {};
        proccode = String(m.proccode ?? '');
        argIds = parseJsonArray(m.argumentids);
        argNames = parseJsonArray(m.argumentnames);
        argDefaults = parseJsonArray(m.argumentdefaults);
        warp = m.warp === true || m.warp === 'true';
    } else {
        diag(ctx, `procedures_definition "${id}" has no prototype child`);
    }
    ctx.defs.set(proccode, { argIds, argNames });
    const block: Block = {
        opcode: 'procedures_definition',
        inputs: {},
        fields: {},
        proc: { proccode, argumentnames: argNames, argumentdefaults: argDefaults, warp },
        srcId: id,
    };
    if (typeof raw.comment === 'string') {
        const c = extractComment(ctx, raw.comment);
        if (c) block.comment = c;
    }
    if (typeof raw.next === 'string') {
        const nx = extractBlock(ctx, raw.next);
        if (nx) block.next = nx;
    }
    return block;
}

interface OrderedItem {
    x: number;
    y: number;
    script: Script;
}

/**
 * Extract one target's scripts in reading order: sort by x-column (grouped
 * within 256 units, left to right), then y (top to bottom). Workspace
 * comments sort together with scripts.
 */
export function extractTarget(target: any, project: any, opts?: { file?: string }): ExtractResult {
    const maps = buildExtractMaps(project, target);
    const ctx: Ctx = {
        blocks: target?.blocks ?? {},
        comments: target?.comments ?? {},
        maps,
        diagnostics: [],
        nodeById: new Map(),
        defs: new Map(),
        active: new Set(),
        file: opts?.file,
    };
    // First pass: index procedure definitions so calls can map arg ids to names.
    for (const [id, b] of Object.entries<any>(ctx.blocks)) {
        if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
        if (b.opcode !== 'procedures_definition') continue;
        const customRef = b.inputs?.custom_block?.[1];
        const proto = typeof customRef === 'string' ? ctx.blocks[customRef] : undefined;
        if (proto && typeof proto === 'object' && !Array.isArray(proto)) {
            const m = proto.mutation ?? {};
            ctx.defs.set(String(m.proccode ?? ''), {
                argIds: parseJsonArray(m.argumentids),
                argNames: parseJsonArray(m.argumentnames),
            });
        }
    }

    const items: OrderedItem[] = [];
    for (const [id, b] of Object.entries<any>(ctx.blocks)) {
        const isTop = Array.isArray(b) || (b && typeof b === 'object' && b.topLevel === true);
        if (!isTop) continue;
        const top = extractBlock(ctx, id);
        if (!top) continue;
        let kind: Script['kind'] = 'stack';
        const shape = getBlockSpec(top.opcode)?.shape;
        if (shape === 'reporter' || shape === 'boolean' || top.opcode === 'data_variable' || top.opcode === 'data_listcontents') {
            kind = 'reporter';
        }
        let x = 0;
        let y = 0;
        if (Array.isArray(b)) {
            if (typeof b[3] === 'number') x = b[3];
            if (typeof b[4] === 'number') y = b[4];
        } else {
            if (typeof b.x === 'number') x = b.x;
            if (typeof b.y === 'number') y = b.y;
        }
        items.push({ x, y, script: { kind, top, srcId: id } });
    }
    // Comments whose blockId is null, missing, or dangling become workspace comments.
    for (const [cid, c] of Object.entries<any>(ctx.comments)) {
        if (!c || typeof c !== 'object') continue;
        const owner = typeof c.blockId === 'string' ? ctx.blocks[c.blockId] : undefined;
        const attached = typeof c.blockId === 'string' && owner !== undefined && (Array.isArray(owner) || (typeof owner === 'object' && typeof owner.opcode === 'string'));
        if (!attached) {
            if (typeof c.blockId === 'string') diag(ctx, `comment "${cid}" attached to missing block "${c.blockId}" (treated as workspace comment)`);
            const extracted = extractComment(ctx, cid);
            if (!extracted) continue;
            items.push({
                x: typeof c.x === 'number' ? c.x : 0,
                y: typeof c.y === 'number' ? c.y : 0,
                script: { kind: 'comment', comment: extracted, srcId: cid },
            });
        }
    }

    // Reading order: columns by x within 256 units, left→right; y top→down.
    const sorted = [...items].sort((a, b) => a.x - b.x);
    const columns: Array<{ x0: number; items: OrderedItem[] }> = [];
    for (const item of sorted) {
        const col = columns.find((c) => Math.abs(item.x - c.x0) <= 256);
        if (col) col.items.push(item);
        else columns.push({ x0: item.x, items: [item] });
    }
    columns.sort((a, b) => a.x0 - b.x0);
    const scripts: Script[] = [];
    for (const col of columns) {
        col.items.sort((a, b) => a.y - b.y);
        for (const item of col.items) scripts.push(item.script);
    }

    // Anchors: a1… for scripts in reading order; c1… for all comments
    // (attached in script traversal order, then workspace comments).
    const anchors: AnchorMap = {};
    scripts.forEach((s, i) => {
        if (s.srcId !== undefined) {
            s.anchor = `a${i + 1}`;
            anchors[s.anchor] = s.srcId;
        }
    });
    let ci = 0;
    const claimComment = (c: Comment | undefined) => {
        if (!c || !c.srcId) return;
        ci += 1;
        c.anchor = `c${ci}`;
        anchors[c.anchor] = c.srcId;
    };
    const visitInputs = (b: Block): void => {
        for (const inp of Object.values(b.inputs)) {
            if ((inp.kind === 'block' || inp.kind === 'stack') && inp.block) {
                claimComment(inp.block.comment);
                visitInputs(inp.block);
            }
        }
    };
    const visitChain = (b: Block | undefined): void => {
        let cur = b;
        while (cur) {
            claimComment(cur.comment);
            visitInputs(cur);
            cur = cur.next;
        }
    };
    for (const s of scripts) {
        if (s.top) visitChain(s.top);
    }
    for (const s of scripts) {
        if (s.kind === 'comment' && s.comment) claimComment(s.comment);
    }
    return { scripts, anchors, diagnostics: ctx.diagnostics, nodeById: ctx.nodeById };
}

/**
 * Re-label freshly extracted scripts so every id the agent already knows
 * keeps its old anchor label. Reading order of the file stays spatial
 * (scripts are NOT reordered); only labels are remapped.
 *
 * - ids present in `prev` reuse their old label (`a3` stays `a3` even when
 *   a human moved the script to another column);
 * - genuinely new ids get the next free numbers (`a{maxA+1}`,
 *   `c{maxC+1}` scanning both script and comment labels);
 * - deleted labels are never reused.
 *
 * When `prev` is empty the fresh labels are returned unchanged.
 */
export function stabilizeAnchors(
    scripts: Script[],
    fresh: AnchorMap,
    prev: AnchorMap,
): { scripts: Script[]; anchors: AnchorMap } {
    if (Object.keys(prev).length === 0) return { scripts, anchors: { ...fresh } };
    // One id can own several old labels (a workspace comment carries both a
    // script label and a comment label); claims prefer the matching kind.
    const oldById = new Map<string, string[]>();
    for (const [a, id] of Object.entries(prev)) {
        const list = oldById.get(id) ?? [];
        list.push(a);
        oldById.set(id, list);
    }
    let maxA = 0;
    let maxC = 0;
    for (const a of Object.keys(prev)) {
        let m = /^a(\d+)$/.exec(a);
        if (m) maxA = Math.max(maxA, Number(m[1]));
        m = /^c(\d+)$/.exec(a);
        if (m) maxC = Math.max(maxC, Number(m[1]));
    }
    const reserved = new Set(Object.keys(prev));
    const taken = new Set<string>();
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
        for (const old of oldById.get(id) ?? []) {
            if (old[0] === kind && !taken.has(old)) {
                taken.add(old);
                return old;
            }
        }
        return freshLabel(kind);
    };
    void fresh;
    const anchors: AnchorMap = {};
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
            // Workspace comments carry both a script label and a comment
            // label (both map to the comment id); keep them stable together.
            if (s.srcId) {
                const lab = claim(s.srcId, 'a');
                s.anchor = lab;
                anchors[lab] = s.srcId;
            }
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
