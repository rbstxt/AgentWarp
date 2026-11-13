/**
 * Semantic validation of a packed project.json.
 *
 * Unlike tools/vmrun/lib/validate.mjs (which must pass human-made projects
 * and therefore warns on unknowns), this runs on agent-packed output where a
 * wrong input name or a dangling reference is always a bug: most findings are
 * errors. Every diagnostic carries a stable `rule` id and, when the pack
 * wrote `.agentwarp/sourcemap.json`, a file:line:col location.
 *
 * Usage: validateProject(project, sourcemap?) -> Diagnostic[] (with `rule`).
 *
 * Run: node --test packages/core/test/  (from the repo root)
 */
import { getBlockSpec } from './catalog/index.ts';
import type { Diagnostic, Loc } from './ir.ts';

/** Sourcemap block id -> location, as written by packDir. */
export type Sourcemap = Record<string, Loc>;

interface Ctx {
    project: any;
    sourcemap: Sourcemap;
    out: Diagnostic[];
    /** target name -> own variable ids. */
    vars: Map<string, Set<string>>;
    /** target name -> own list ids. */
    lists: Map<string, Set<string>>;
    /** variable id -> owner target name. */
    varOwner: Map<string, string>;
    /** list id -> owner target name. */
    listOwner: Map<string, string>;
    /** broadcast id -> {name, target}. */
    broadcasts: Map<string, { name: string; target: string }>;
    /** All sprite (non-stage) target names. */
    sprites: Set<string>;
    /** stage costume names (= backdrops). */
    backdrops: Set<string>;
    /** target name -> costume names. */
    costumes: Map<string, Set<string>>;
    /** target name -> sound names. */
    sounds: Map<string, Set<string>>;
    /** target name -> proccode -> {argIds, blockId}. */
    defs: Map<string, Map<string, { argIds: string[]; blockId: string }>>;
    stageName: string | null;
}

function locOf(ctx: Ctx, blockId: string | null): { file?: string; line?: number; col?: number } {
    if (!blockId) return {};
    const l = ctx.sourcemap[blockId];
    if (!l) return {};
    return { file: l.file, line: l.line, col: l.col };
}

function push(
    ctx: Ctx,
    rule: string,
    severity: Diagnostic['severity'],
    target: string,
    blockId: string | null,
    opcode: string | null,
    message: string,
): void {
    ctx.out.push({
        rule,
        severity,
        message: `[${target}]${opcode ? ` ${opcode}` : ''}: ${message}`,
        ...locOf(ctx, blockId),
    });
}

/** Non-array legacy compact blocks ([tag, name, id, ...]) are opaque data. */
function isCompact(b: any): boolean {
    return Array.isArray(b);
}

function fieldName(fval: any): string {
    return String(Array.isArray(fval) ? (fval[0] ?? '') : (fval ?? ''));
}

function fieldId(fval: any): string | null {
    if (!Array.isArray(fval) || fval.length < 2) return null;
    const id = fval[1];
    return typeof id === 'string' ? id : null;
}

/** Parse a procedures_definition block: proccode + argument ids. */
function defInfo(blocks: Record<string, any>, id: string): { proccode: string; argIds: string[] } | null {
    const b = blocks[id];
    if (!b || isCompact(b) || b.opcode !== 'procedures_definition') return null;
    const protoRef = b.inputs?.custom_block?.[1];
    const proto = typeof protoRef === 'string' ? blocks[protoRef] : undefined;
    if (!proto || isCompact(proto) || proto.opcode !== 'procedures_prototype') return null;
    let argIds: string[] = [];
    try {
        const raw = proto.mutation?.argumentids;
        if (typeof raw === 'string') argIds = (JSON.parse(raw) as unknown[]).map(String);
    } catch {
        /* keep empty */
    }
    return { proccode: String(proto.mutation?.proccode ?? ''), argIds };
}

function isStackShape(shape: string | undefined): boolean {
    return shape === 'stack' || shape === 'c' || shape === 'c2' || shape === 'cap' || shape === 'end-c';
}

function isReporterShape(shape: string | undefined): boolean {
    return shape === 'reporter' || shape === 'boolean' || shape === 'menu' || shape === 'argument';
}

function indexProject(ctx: Ctx): void {
    const targets: any[] = Array.isArray(ctx.project?.targets) ? ctx.project.targets : [];
    for (const t of targets) {
        const name = String(t?.name ?? '(unnamed)');
        if (t?.isStage) {
            if (ctx.stageName === null) ctx.stageName = name;
            for (const c of t?.costumes ?? []) {
                if (c && typeof c === 'object' && typeof c.name === 'string') ctx.backdrops.add(c.name);
            }
        } else {
            ctx.sprites.add(name);
        }
        const v = new Set<string>();
        for (const id of Object.keys(t?.variables ?? {})) {
            v.add(id);
            if (!ctx.varOwner.has(id)) ctx.varOwner.set(id, name);
        }
        ctx.vars.set(name, v);
        const l = new Set<string>();
        for (const id of Object.keys(t?.lists ?? {})) {
            l.add(id);
            if (!ctx.listOwner.has(id)) ctx.listOwner.set(id, name);
        }
        ctx.lists.set(name, l);
        for (const [id, bname] of Object.entries<any>(t?.broadcasts ?? {})) {
            if (!ctx.broadcasts.has(id)) ctx.broadcasts.set(id, { name: String(bname), target: name });
        }
        const c = new Set<string>();
        for (const cc of t?.costumes ?? []) {
            if (cc && typeof cc === 'object' && typeof cc.name === 'string') c.add(cc.name);
        }
        ctx.costumes.set(name, c);
        const s = new Set<string>();
        for (const ss of t?.sounds ?? []) {
            if (ss && typeof ss === 'object' && typeof ss.name === 'string') s.add(ss.name);
        }
        ctx.sounds.set(name, s);
    }
    // Procedure definitions per target.
    for (const t of targets) {
        const name = String(t?.name ?? '(unnamed)');
        const blocks: Record<string, any> = t?.blocks ?? {};
        const defs = new Map<string, { argIds: string[]; blockId: string }>();
        for (const id of Object.keys(blocks)) {
            const info = defInfo(blocks, id);
            if (!info || !info.proccode) continue;
            const prev = defs.get(info.proccode);
            if (prev) {
                push(ctx, 'duplicate-procedure', 'error', name, id, 'procedures_definition',
                    `duplicate procedure definition "${info.proccode}" (first at block ${prev.blockId})`);
            } else {
                defs.set(info.proccode, { argIds: info.argIds, blockId: id });
            }
        }
        ctx.defs.set(name, defs);
    }
}

/** Value shown in a static-options dropdown: valid when it matches a label or a value. */
const EXTRA_MENU_VALUES: Record<string, Set<string>> = {
    // The editor shows "other scripts in stage" when the block lives on the Stage.
    'control_stop:STOP_OPTION': new Set(['other scripts in stage']),
};

function staticMenuOk(opcode: string, field: string, options: Array<[string, string]> | undefined, value: string): boolean {
    if (!options) return true;
    if (options.some(([label, val]) => val === value || label === value)) return true;
    return EXTRA_MENU_VALUES[`${opcode}:${field}`]?.has(value) ?? false;
}

/** Check a menu/dynamic field value that names a project asset. */
function checkDynamic(
    ctx: Ctx,
    target: string,
    blockId: string,
    opcode: string,
    fname: string,
    dynamic: string,
    staticOptions: Array<[string, string]> | undefined,
    value: string,
): void {
    if (staticMenuOk(opcode, fname, staticOptions, value)) return;
    const ownCostumes = ctx.costumes.get(target) ?? new Set();
    const ownSounds = ctx.sounds.get(target) ?? new Set();
    switch (dynamic) {
        case 'sprites':
            if (value === '_myself_' || value === 'myself' || ctx.sprites.has(value)) return;
            push(ctx, 'unknown-sprite', 'error', target, blockId, opcode,
                `menu value "${value}" names no sprite in this project`);
            return;
        case 'sprites+stage':
            if (value === '_myself_' || value === 'myself' || value === 'Stage' || value === '_stage_' ||
                ctx.sprites.has(value)) return;
            push(ctx, 'unknown-sprite', 'error', target, blockId, opcode,
                `menu value "${value}" names no sprite or the Stage`);
            return;
        case 'costumes':
            if (ownCostumes.has(value)) return;
            push(ctx, 'unknown-costume', 'error', target, blockId, opcode,
                `menu value "${value}" is not a costume of "${target}"`);
            return;
        case 'sounds':
            if (ownSounds.has(value)) return;
            push(ctx, 'unknown-sound', 'error', target, blockId, opcode,
                `menu value "${value}" is not a sound of "${target}"`);
            return;
        case 'backdrops':
            if (ctx.backdrops.has(value)) return;
            push(ctx, 'unknown-backdrop', 'error', target, blockId, opcode,
                `menu value "${value}" is not a backdrop (Stage costume)`);
            return;
        default:
            return; // variables/lists/broadcast/keys/other: checked by id, or free-form
    }
}

function visibleVar(ctx: Ctx, target: string, id: string): boolean {
    if (ctx.vars.get(target)?.has(id)) return true;
    if (ctx.stageName !== null && ctx.vars.get(ctx.stageName)?.has(id)) return true;
    return false;
}

function visibleList(ctx: Ctx, target: string, id: string): boolean {
    if (ctx.lists.get(target)?.has(id)) return true;
    if (ctx.stageName !== null && ctx.lists.get(ctx.stageName)?.has(id)) return true;
    return false;
}

function checkVarField(ctx: Ctx, target: string, blockId: string, opcode: string, id: string, name: string): void {
    if (visibleVar(ctx, target, id)) return;
    if (ctx.varOwner.has(id)) {
        push(ctx, 'cross-target-variable', 'error', target, blockId, opcode,
            `variable "${name}" is declared on "${ctx.varOwner.get(id)}" and is not visible here (only own + Stage variables carry over)`);
    } else {
        push(ctx, 'unknown-variable', 'error', target, blockId, opcode,
            `variable "${name}" (id "${id}") is not declared on "${target}" or the Stage`);
    }
}

function checkListField(ctx: Ctx, target: string, blockId: string, opcode: string, id: string, name: string): void {
    if (visibleList(ctx, target, id)) return;
    if (ctx.listOwner.has(id)) {
        push(ctx, 'cross-target-list', 'error', target, blockId, opcode,
            `list "${name}" is declared on "${ctx.listOwner.get(id)}" and is not visible here (only own + Stage lists carry over)`);
    } else {
        push(ctx, 'unknown-list', 'error', target, blockId, opcode,
            `list "${name}" (id "${id}") is not declared on "${target}" or the Stage`);
    }
}

/** literal tag must be 4..13 when the primary is an inline [tag, value] pair. */
function checkInputPrimary(
    ctx: Ctx,
    target: string,
    blockId: string,
    opcode: string,
    iname: string,
    ival: any,
    blocks: Record<string, any>,
): void {
    // Procedure plumbing (definition custom_block, prototype arg shadows, call
    // args) is mutation-driven and validated by the procedure rules instead.
    if (opcode === 'procedures_definition' || opcode === 'procedures_prototype') return;
    if (!Array.isArray(ival) || ival.length < 2) {
        push(ctx, 'bad-input-shape', 'error', target, blockId, opcode, `input "${iname}" is malformed`);
        return;
    }
    const primary = ival[1];
    if (Array.isArray(primary)) {
        const [tag, val, lid] = primary;
        if (typeof tag !== 'number' || tag < 4 || tag > 13) {
            push(ctx, 'bad-literal-tag', 'warning', target, blockId, opcode,
                `input "${iname}" has unusual literal tag ${JSON.stringify(tag)}`);
            return;
        }
        if (tag === 12 && typeof lid === 'string') checkVarField(ctx, target, blockId, opcode, lid, String(val ?? ''));
        else if (tag === 13 && typeof lid === 'string') checkListField(ctx, target, blockId, opcode, lid, String(val ?? ''));
        else if (tag === 11 && typeof lid === 'string' && !ctx.broadcasts.has(lid)) {
            push(ctx, 'unknown-broadcast', 'warning', target, blockId, opcode,
                `broadcast menu references undeclared broadcast id "${lid}" (${JSON.stringify(String(val ?? ''))}); the block will silently do nothing`);
        }
        return;
    }
    if (typeof primary !== 'string') return; // null/number/boolean: empty or tolerated inline
    const child = blocks[primary];
    if (child === undefined) {
        push(ctx, 'dangling-ref', 'error', target, blockId, opcode,
            `input "${iname}" references missing block "${primary}"`);
        return;
    }
    if (isCompact(child)) {
        // Compact reporter nested in an input: [12, name, id] / [13, name, id].
        if (child[0] === 12 && typeof child[2] === 'string') checkVarField(ctx, target, blockId, opcode, child[2], String(child[1] ?? ''));
        else if (child[0] === 13 && typeof child[2] === 'string') checkListField(ctx, target, blockId, opcode, child[2], String(child[1] ?? ''));
        return;
    }
    if (typeof child !== 'object' || typeof child.opcode !== 'string') return;
    if (opcode === 'procedures_call' || child.opcode === 'procedures_call') return; // dynamic plumbing
    const tag = ival[0];
    if ((tag === 2 || tag === 3) && child.opcode !== 'procedures_call') {
        const shape = getBlockSpec(child.opcode)?.shape;
        if (shape !== undefined && !isReporterShape(shape)) {
            push(ctx, 'stack-in-reporter', 'error', target, blockId, opcode,
                `input "${iname}" holds stack block "${child.opcode}" where a reporter belongs`);
        }
    }
}

function checkFields(
    ctx: Ctx,
    target: string,
    blockId: string,
    opcode: string,
    fields: Record<string, any>,
): void {
    const spec = getBlockSpec(opcode);
    for (const [fname, fval] of Object.entries(fields ?? {})) {
        const fspec = spec?.fields.find((f) => f.name === fname);
        const id = fieldId(fval);
        const value = fieldName(fval);
        const kind = fspec?.kind ??
            (fname === 'VARIABLE' ? 'variable' : fname === 'LIST' ? 'list' : fname === 'BROADCAST_OPTION' ? 'broadcast' : null);
        if (kind === 'variable') {
            if (id !== null) checkVarField(ctx, target, blockId, opcode, id, value);
        } else if (kind === 'list') {
            if (id !== null) checkListField(ctx, target, blockId, opcode, id, value);
        } else if (kind === 'broadcast') {
            if (id !== null && !ctx.broadcasts.has(id)) {
                push(ctx, 'unknown-broadcast', 'warning', target, blockId, opcode,
                    `broadcast menu references undeclared broadcast id "${id}" (${JSON.stringify(value)}); receivers will never fire`);
            }
        } else if (fspec?.dynamic) {
            if (value === '') return; // stale editor default; the menu shows the first item
            checkDynamic(ctx, target, blockId, opcode, fname, fspec.dynamic, fspec.options, value);
        } else if (fspec?.options) {
            if (!staticMenuOk(opcode, fname, fspec.options, value)) {
                push(ctx, 'bad-menu-value', 'error', target, blockId, opcode,
                    `menu "${fname}" value "${value}" is not one of: ${fspec.options.map((o) => o[1]).join(', ')}`);
            }
        }
    }
}

function checkStackChain(
    ctx: Ctx,
    target: string,
    blocks: Record<string, any>,
    headId: string,
    seen: Set<string>,
): void {
    let cur: string | null = headId;
    let isHead = true;
    while (typeof cur === 'string' && !seen.has(cur)) {
        seen.add(cur);
        const b = blocks[cur];
        if (!b || isCompact(b) || typeof b.opcode !== 'string') return;
        if (!isHead && b.opcode !== 'procedures_call') {
            const shape = getBlockSpec(b.opcode)?.shape;
            if (shape === 'reporter' || shape === 'boolean' || shape === 'menu' || shape === 'argument') {
                push(ctx, 'reporter-in-stack', 'error', target, cur, b.opcode,
                    `reporter "${b.opcode}" is used as a stack statement`);
            } else if (shape === 'hat' || shape === 'definition' || shape === 'prototype') {
                push(ctx, 'misplaced-block', 'error', target, cur, b.opcode,
                    `"${b.opcode}" cannot run in the middle of a stack`);
            }
        }
        isHead = false;
        for (const [iname, ival] of Object.entries<any>(b.inputs ?? {})) {
            if ((iname === 'SUBSTACK' || iname === 'SUBSTACK2') && Array.isArray(ival) && typeof ival[1] === 'string') {
                checkStackChain(ctx, target, blocks, ival[1], seen);
            }
        }
        cur = typeof b.next === 'string' ? b.next : null;
    }
}

function checkDeclarations(ctx: Ctx, target: string, t: any): void {
    for (const [id, v] of Object.entries<any>(t?.variables ?? {})) {
        if (!Array.isArray(v) || v.length < 2 || v.length > 3 || typeof v[0] !== 'string') {
            push(ctx, 'bad-variable-shape', 'error', target, null, null,
                `variable id "${id}" must be [name, value] (got ${JSON.stringify(v)?.slice(0, 80)})`);
        }
    }
    for (const [id, v] of Object.entries<any>(t?.lists ?? {})) {
        if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string' || !Array.isArray(v[1])) {
            push(ctx, 'bad-list-shape', 'error', target, null, null,
                `list id "${id}" must be [name, items-array] (got ${JSON.stringify(v)?.slice(0, 80)}); run crashes on malformed lists`);
        }
    }
    for (const [id, v] of Object.entries<any>(t?.broadcasts ?? {})) {
        if (typeof v !== 'string') {
            push(ctx, 'bad-broadcast-shape', 'error', target, null, null,
                `broadcast id "${id}" must map to a name string`);
        }
    }
}

const DYNAMIC_INPUT_OPCODES = new Set(['procedures_call', 'procedures_definition', 'procedures_prototype']);

/**
 * Validate a packed project.json. Returns diagnostics with stable `rule` ids
 * and file:line:col from `sourcemap` (block id -> Loc) where available.
 */
export function validateProject(project: any, sourcemap: Sourcemap = {}): Diagnostic[] {
    const ctx: Ctx = {
        project,
        sourcemap,
        out: [],
        vars: new Map(),
        lists: new Map(),
        varOwner: new Map(),
        listOwner: new Map(),
        broadcasts: new Map(),
        sprites: new Set(),
        backdrops: new Set(),
        costumes: new Map(),
        sounds: new Map(),
        defs: new Map(),
        stageName: null,
    };
    const targets: any[] = Array.isArray(project?.targets) ? project.targets : [];
    if (targets.length === 0) {
        ctx.out.push({ rule: 'bad-project', severity: 'error', message: 'project.targets must be a non-empty array' });
        return ctx.out;
    }
    indexProject(ctx);

    for (const t of targets) {
        const name = String(t?.name ?? '(unnamed)');
        const blocks: Record<string, any> = t?.blocks ?? {};
        checkDeclarations(ctx, name, t);
        for (const [id, b] of Object.entries<any>(blocks)) {
            if (isCompact(b)) continue;
            const opcode = typeof b?.opcode === 'string' ? b.opcode : null;
            if (!opcode) {
                push(ctx, 'bad-opcode', 'error', name, id, null, `block "${id}" has no opcode`);
                continue;
            }
            const spec = getBlockSpec(opcode);
            if (!spec) {
                push(ctx, 'unknown-opcode', 'error', name, id, opcode, `unknown opcode "${opcode}"`);
                continue;
            }
            if (b.parent !== null && b.parent !== undefined && !(typeof b.parent === 'string' && b.parent in blocks)) {
                push(ctx, 'dangling-ref', 'error', name, id, opcode, `dangling parent reference "${b.parent}"`);
            }
            if (b.next !== null && b.next !== undefined && !(typeof b.next === 'string' && b.next in blocks)) {
                push(ctx, 'dangling-ref', 'error', name, id, opcode, `dangling next reference "${b.next}"`);
            }
            if (b.topLevel && (typeof b.x !== 'number' || typeof b.y !== 'number')) {
                push(ctx, 'bad-position', 'error', name, id, opcode, 'topLevel block needs numeric x/y');
            }
            if (!DYNAMIC_INPUT_OPCODES.has(opcode)) {
                for (const iname of Object.keys(b.inputs ?? {})) {
                    const known = spec.inputs.some((i) => i.name === iname);
                    if (!known && iname !== 'SUBSTACK' && iname !== 'SUBSTACK2') {
                        push(ctx, 'bad-input', 'error', name, id, opcode,
                            `input "${iname}" is not valid for "${opcode}" (expected: ${spec.inputs.map((i) => i.name).join(', ') || '(none)'})`);
                    }
                }
            }
            for (const [iname, ival] of Object.entries<any>(b.inputs ?? {})) {
                if (iname === 'SUBSTACK' || iname === 'SUBSTACK2') continue; // stack slots, checked by checkStackChain
                checkInputPrimary(ctx, name, id, opcode, iname, ival, blocks);
            }
            checkFields(ctx, name, id, opcode, b.fields ?? {});
            if (opcode === 'procedures_call') {
                const proccode = String(b.mutation?.proccode ?? '');
                const def = ctx.defs.get(name)?.get(proccode);
                if (!proccode || !def) {
                    push(ctx, 'unknown-procedure', 'error', name, id, opcode,
                        `procedure call "${proccode || '(empty)'}" matches no definition in "${name}"`);
                } else {
                    const argc = Object.keys(b.inputs ?? {}).length;
                    if (argc > def.argIds.length) {
                        push(ctx, 'procedure-arity', 'error', name, id, opcode,
                            `procedure "${proccode}" takes ${def.argIds.length} argument(s) but the call passes ${argc}`);
                    } else if (argc < def.argIds.length) {
                        // The VM fills missing args from defaults, so this runs —
                        // but a forgotten argument is the usual cause.
                        push(ctx, 'procedure-arity', 'warning', name, id, opcode,
                            `procedure "${proccode}" takes ${def.argIds.length} argument(s) but the call passes ${argc} (missing args use defaults)`);
                    }
                }
            }
        }
        // Stack-slot shape check: walk every topLevel stack script.
        const seen = new Set<string>();
        for (const [id, b] of Object.entries<any>(blocks)) {
            if (!isCompact(b) && b?.topLevel === true) {
                const shape = getBlockSpec(b.opcode)?.shape;
                if (shape !== 'reporter' && shape !== 'boolean') {
                    checkStackChain(ctx, name, blocks, id, seen);
                }
            }
        }
    }

    for (const m of project?.monitors ?? []) {
        if (m?.opcode && !getBlockSpec(m.opcode)) {
            ctx.out.push({ rule: 'unknown-monitor-opcode', severity: 'warning', message: `monitor "${m.id}" uses unknown opcode "${m.opcode}"` });
        }
    }
    return ctx.out;
}
