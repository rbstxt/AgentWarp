/**
 * IR -> scratchblocks text.
 *
 * One block per line, 2-space indent for C bodies, anchors as `@aN` header
 * lines, attached comments as trailing `//` (+ `[cN]` anchor / `minimized`
 * flag), workspace comments as @-sections of `//` lines.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Block, Comment, FormatCtx, Input, Script } from '../../packages/core/ir.ts';
import { getBlockSpec } from '../../packages/core/catalog/index.ts';
import { getPatterns, matchParts, splitProccode, type Pattern } from './syntax.ts';

export interface NameSets {
    vars: Set<string>;
    lists: Set<string>;
}

const SHADOW_TAG: Record<string, number> = {
    math_number: 4,
    math_positive_number: 5,
    math_whole_number: 6,
    math_integer: 7,
    math_angle: 8,
    colour_picker: 9,
    text: 10,
};

function numDefault(kind: string): number | undefined {
    if (kind === 'number') return 4;
    if (kind === 'positive_number') return 5;
    if (kind === 'whole_number') return 6;
    if (kind === 'integer') return 7;
    if (kind === 'angle') return 8;
    return undefined;
}

/** Default literal tag for an input slot (catalog shadow, else kind-based). */
export function slotDefaultTag(opcode: string, inputName: string): number | undefined {
    const spec = getBlockSpec(opcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    if (!ispec) return undefined;
    if (ispec.shadowOpcode && SHADOW_TAG[ispec.shadowOpcode] !== undefined) return SHADOW_TAG[ispec.shadowOpcode];
    if (ispec.kind === 'color') return 9;
    if (ispec.kind === 'text') return 10;
    return numDefault(ispec.kind);
}

/** Load variable/list names: own targetJson plus the Stage's (sibling dirs). */
export function loadNameSets(ctx: FormatCtx): NameSets {
    const vars = new Set<string>();
    const lists = new Set<string>();
    const grab = (tj: any): void => {
        for (const v of Array.isArray(tj?.variables) ? tj.variables : []) {
            if (typeof v?.name === 'string') vars.add(v.name);
        }
        for (const v of Array.isArray(tj?.lists) ? tj.lists : []) {
            if (typeof v?.name === 'string') lists.add(v.name);
        }
    };
    grab(ctx.targetJson);
    // Sibling Stage target (absolute ctx.file only; unpack passes a relative one).
    try {
        if (ctx.file && !ctx.isStage) {
            const projDir = dirname(dirname(ctx.file));
            for (const e of readdirSync(projDir)) {
                if (e === '.agentwarp' || e === 'node_modules') continue;
                try {
                    const tj = JSON.parse(readFileSync(join(projDir, e, 'target.json'), 'utf8'));
                    if (tj?.isStage === true) grab(tj);
                } catch {
                    /* not a target dir */
                }
            }
        }
    } catch {
        /* best effort */
    }
    return { vars, lists };
}

export interface ProcInfo {
    proccode: string;
    argNames: string[];
    placeholders: string[]; // %s/%n/%b in order
}



export interface PrintState {
    vars: Set<string>;
    lists: Set<string>;
    /** proccode -> def info (this target's definitions, for calls). */
    defs: Map<string, ProcInfo>;
    /** Stack of enclosing definition arg names -> placeholder kinds. */
    argScope: Array<Map<string, string>>;
}

/** Escape names/literal text for (...) and [...] (quote-aware scanners). */
export function escName(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Escape for "..." quoted strings. */
export function escQuoted(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"');
}

/** Escape boolean-arg names for <...>. */
function escBoolName(s: string): string {
    return escName(s).replace(/</g, '\\<').replace(/>/g, '\\>');
}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

function collectDefs(scripts: Script[]): Map<string, ProcInfo> {
    const defs = new Map<string, ProcInfo>();
    const visit = (b: Block | undefined): void => {
        let cur = b;
        while (cur) {
            if (cur.opcode === 'procedures_definition' && cur.proc && !defs.has(cur.proc.proccode)) {
                const { placeholders } = splitProccode(cur.proc.proccode);
                defs.set(cur.proc.proccode, { proccode: cur.proc.proccode, argNames: [...cur.proc.argumentnames], placeholders });
            }
            for (const inp of Object.values(cur.inputs)) {
                if ((inp.kind === 'block' || inp.kind === 'stack') && inp.block) visit(inp.block);
            }
            cur = cur.next;
        }
    };
    for (const s of scripts) {
        if (s.top) visit(s.top);
    }
    return defs;
}

/** Check whether text reads as some catalog reporter/boolean expression. */
export function textMatchesCatalogExpr(text: string, shapes: Array<'reporter' | 'boolean'>): Pattern | null {
    for (const p of getPatterns()) {
        if (!shapes.includes(p.shape as 'reporter' | 'boolean')) continue;
        if (!p.hasStatic) continue;
        const m = matchParts(p.parts, text, 0);
        if (m && text.slice(m.end).trim() === '') return p;
    }
    return null;
}

/** Check whether text reads as a catalog statement (or C header). */
function textMatchesCatalogStmt(text: string): boolean {
    for (const p of getPatterns()) {
        if (p.shape !== 'stack' && p.shape !== 'hat' && p.shape !== 'cap' && p.shape !== 'c' && p.shape !== 'c2' && p.shape !== 'end-c') continue;
        const parts = p.shape === 'c' || p.shape === 'c2' || p.shape === 'end-c' ? p.header : p.parts;
        const m = matchParts(parts, text, 0);
        if (m && text.slice(m.end).trim() === '') return true;
    }
    return false;
}

/** Rendered call text (labels + arg exprs). */
function renderCallText(proccode: string, argExprs: string[]): string {
    const { labels } = splitProccode(proccode);
    let out = labels[0] ?? '';
    for (let i = 0; i < argExprs.length; i++) {
        out += argExprs[i] + (labels[i + 1] ?? '');
    }
    return out.replace(/\s+/g, ' ').trim();
}

/** A bare name needs an explicit hint when it would parse as something else. */
function nameNeedsHint(name: string, st: PrintState): boolean {
    if (name === 'true' || name === 'false') return true;
    if (textMatchesCatalogExpr(name, ['reporter', 'boolean'])) return true;
    for (const def of st.defs.values()) {
        if (def.placeholders.length === 0) {
            const { labels } = splitProccode(def.proccode);
            if ((labels[0] ?? '').trim() === name) return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Fields and menus
// ---------------------------------------------------------------------------

function fieldOptions(opcode: string, fieldName: string): { values: string[]; labels: string[]; dynamic: boolean } {
    const spec = getBlockSpec(opcode);
    const fspec = spec?.fields.find((f) => f.name === fieldName);
    const opts = fspec?.options ?? [];
    return { values: opts.map((o) => o[1]), labels: opts.map((o) => o[0]), dynamic: !!fspec?.dynamic };
}

/** Render a dropdown/field slot: `[label v]`. */
function renderField(opcode: string, fieldName: string, value: string): string {
    const { values, labels, dynamic } = fieldOptions(opcode, fieldName);
    if (!dynamic && !values.includes(value)) {
        // Non-canonical value (old projects): quote so it parses back verbatim.
        return `["${escQuoted(value)}" v]`;
    }
    // Dynamic menus map only underscore specials (e.g. _mouse_); real names print verbatim.
    let label = value;
    const i = values.indexOf(value);
    if (i >= 0) label = labels[i];
    else if (!dynamic) {
        const j = labels.indexOf(value);
        if (j >= 0) label = labels[j];
    }
    return `[${escName(label)} v]`;
}

/** Render a menu input value: `[label v]` (label mapping, else verbatim). */
function renderMenu(opcode: string, inputName: string, value: string): string {
    const spec = getBlockSpec(opcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    const menuSpec = ispec?.shadowOpcode ? getBlockSpec(ispec.shadowOpcode) : undefined;
    const fspec = menuSpec?.fields[0];
    const opts = fspec?.options ?? [];
    if (opts.length === 0) return `[${escName(value)} v]`;
    const values = opts.map((o) => o[1]);
    const labels = opts.map((o) => o[0]);
    const dynamic = !!fspec?.dynamic;
    if (!dynamic && !values.includes(value)) {
        // Non-canonical value (old projects): quote so it parses back verbatim.
        return `["${escQuoted(value)}" v]`;
    }
    let label = value;
    const i = values.indexOf(value);
    if (i >= 0) label = labels[i];
    else if (!dynamic) {
        const j = labels.indexOf(value);
        if (j >= 0) label = labels[j];
    }
    return `[${escName(label)} v]`;
}

// ---------------------------------------------------------------------------
// Literals: value type and litType both survive exactly.
// (10)/(10.5) numbers; ("10") numeric strings; [x]/["10"] text-slot forms;
// (lit :: tag) only when the tag differs from the slot default.
// ---------------------------------------------------------------------------

function renderLiteral(value: string | number | boolean, litType: number | undefined, defTag: number | undefined): string {
    const t = litType ?? defTag ?? (typeof value === 'number' ? 4 : 10);
    const annotated = defTag !== undefined && t !== defTag;
    const tagSuffix = annotated ? ` :: ${t}` : '';
    if (t >= 4 && t <= 8) {
        if (typeof value === 'number' || typeof value === 'boolean') return `(${String(value)}${tagSuffix})`;
        if (value === '') return `(""${tagSuffix})`;
        return `("${escQuoted(String(value))}"${tagSuffix})`;
    }
    if (t === 9) return `[${escName(String(value))}${tagSuffix}]`;
    // `[]` is the missing-input marker, so empty text prints quoted.
    if (value === '') return `[""${tagSuffix}]`;
    if (typeof value === 'number' || typeof value === 'boolean') return `[${String(value)}${tagSuffix}]`;
    const s = String(value);
    if (s !== '' && NUM_RE.test(s)) return `["${escQuoted(s)}"${tagSuffix}]`;
    if (HEX_RE.test(s) && defTag === 9) return `["${escQuoted(s)}"${tagSuffix}]`;
    return `[${escName(s)}${tagSuffix}]`;
}

const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

type PartT = { label: string } | { slot: { kind: 'input' | 'field'; name: string } };

function partsOf(opcode: string): PartT[] {
    return ((getPatterns().find((x) => x.opcode === opcode)?.parts ?? []) as PartT[]);
}

function headerOf(opcode: string): PartT[] {
    return ((getPatterns().find((x) => x.opcode === opcode)?.header ?? []) as PartT[]);
}

/** Render an Input in an input-slot position. */
export function renderInput(ownerOpcode: string, inputName: string, inp: Input, st: PrintState, callPh?: string): string {
    void callPh;
    const spec = getBlockSpec(ownerOpcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    const menuish = ispec && (ispec.kind === 'menu' || ispec.kind === 'broadcast' || ispec.kind === 'costume' || ispec.kind === 'sound');
    switch (inp.kind) {
        case 'literal': {
            const tag = slotDefaultTag(ownerOpcode, inputName);
            // In menu-ish slots a bare string would read as a menu value;
            // quote string literals so they parse back as literals.
            if (menuish && typeof inp.value === 'string') {
                const t = inp.litType ?? 10;
                const suffix = t !== 10 ? ` :: ${t}` : '';
                return `["${escQuoted(inp.value)}"${suffix}]`;
            }
            return renderLiteral(inp.value, inp.litType, tag);
        }
        case 'menu':
            return renderMenu(ownerOpcode, inputName, inp.value);
        case 'broadcast':
            return `[${escName(inp.name)} v]`;
        case 'var': {
            const hint = st.lists.has(inp.name) || nameNeedsHint(inp.name, st) || inArgScope(st, inp.name) ? ' :: variables' : '';
            return `(${escName(inp.name)}${hint})`;
        }
        case 'list': {
            const hint = st.vars.has(inp.name) || nameNeedsHint(inp.name, st) ? ' :: list' : '';
            return `(${escName(inp.name)}${hint})`;
        }
        case 'block':
            return renderExpr(inp.block, st);
        case 'stack':
            return inp.block ? renderExpr(inp.block, st) : '';
    }
}

/** Names shadowed by enclosing custom-block args force a :: variables hint. */
function inArgScope(st: PrintState, name: string): boolean {
    for (const scope of st.argScope) {
        if (scope.has(name)) return true;
    }
    return false;
}

/** Render a Block used in expression position (with star comment). */
export function renderExpr(b: Block, st: PrintState): string {
    const text = renderExprInner(b, st);
    if (b.comment) {
        const c = b.comment;
        let head = '/*';
        if (c.anchor) head += ` [${c.anchor}${c.minimized === true ? ' minimized' : ''}]`;
        else if (c.minimized === true) head += ' [minimized]';
        head += c.text === '' ? '' : ` ${c.text}`;
        return `${text} ${head} */`;
    }
    return text;
}

/** Render a Block used in expression position. */
function renderExprInner(b: Block, st: PrintState): string {
    if (b.opcode === 'data_variable') {
        const name = b.fields['VARIABLE']?.value ?? '';
        if (name === '') return `(:: variables)`;
        const hint = st.lists.has(name) || nameNeedsHint(name, st) || inArgScope(st, name) ? ' :: variables' : '';
        return `(${escName(name)}${hint})`;
    }
    if (b.opcode === 'data_listcontents') {
        const name = b.fields['LIST']?.value ?? '';
        if (name === '') return `(:: list)`;
        const hint = st.vars.has(name) || nameNeedsHint(name, st) ? ' :: list' : '';
        return `(${escName(name)}${hint})`;
    }
    if (b.opcode === 'argument_reporter_string_number' || b.opcode === 'argument_reporter_boolean') {
        const name = b.fields['VALUE']?.value ?? '';
        const isBool = b.opcode === 'argument_reporter_boolean';
        const hint = st.vars.has(name) || st.lists.has(name) || nameNeedsHint(name, st) ? ' :: args' : '';
        if (name === '') return isBool ? `<:: args>` : `(:: args)`;
        if (isBool) return `<${escBoolName(name)}${hint}>`;
        return `(${escName(name)}${hint})`;
    }
    if (b.opcode === 'procedures_call' && b.proc) return renderCallInline(b, st);
    const spec = getBlockSpec(b.opcode);
    if (!spec || (spec.shape !== 'reporter' && spec.shape !== 'boolean')) return `(!${rawJson(b)})`;
    const parts = partsOf(b.opcode);
    const hasStatic = parts.some((p) => 'label' in p && (p as { label: string }).label.trim() !== '');
    if (!hasStatic) {
        // Static-less single-field reporters (note/matrix/listindex): explicit form.
        const field = spec.fields[0];
        const value = field ? (b.fields[field.name]?.value ?? '') : '';
        return `(${escName(value)} :: ${b.opcode})`;
    }
    const text = renderParts(parts, b, st);
    if (spec.shape === 'boolean') return `<${text}>`;
    return `(${text})`;
}

/** Render a call in expression position; escapes to raw when colliding with catalog. */
function renderCallInline(b: Block, st: PrintState): string {
    const proc = b.proc!;
    const def = st.defs.get(proc.proccode);
    const argNames = def ? def.argNames : proc.argumentnames;
    const placeholders = def ? def.placeholders : splitProccode(proc.proccode).placeholders;
    if (def && Object.keys(b.inputs).some((k) => !def.argNames.includes(k))) return `(!${rawJson(b)})`;
    const exprs = argNames.map((n) => {
        const inp = b.inputs[n];
        if (!inp) return '()';
        return renderCallArg(inp, st);
    });
    const text = renderCallText(proc.proccode, exprs);
    void placeholders;
    if (hasBracketLabel(proc.proccode) || textMatchesCatalogExpr(text, ['reporter', 'boolean'])) return `(!${rawJson(b)})`;
    return `(${text})`;
}

function renderCallArg(inp: Input, st: PrintState): string {
    if (inp.kind === 'literal') {
        const defTag = typeof inp.value === 'number' ? 4 : 10;
        return renderLiteral(inp.value, inp.litType, defTag);
    }
    if (inp.kind === 'menu') return `[${escName(inp.value)} v]`;
    if (inp.kind === 'broadcast') return `[${escName(inp.value)} v]`;
    if (inp.kind === 'var') {
        if (inp.name === '') return `(:: variables)`;
        const hint = st.lists.has(inp.name) || nameNeedsHint(inp.name, st) || inArgScope(st, inp.name) ? ' :: variables' : '';
        return `(${escName(inp.name)}${hint})`;
    }
    if (inp.kind === 'list') {
        if (inp.name === '') return `(:: list)`;
        const hint = st.vars.has(inp.name) || nameNeedsHint(inp.name, st) ? ' :: list' : '';
        return `(${escName(inp.name)}${hint})`;
    }
    if (inp.kind === 'block') return renderExpr(inp.block, st);
    return '';
}

/** Raw escape for blocks with unknown opcodes (whole subtree as IR JSON). */
function rawJson(b: Block): string {
    const o: Record<string, unknown> = { opcode: b.opcode, inputs: b.inputs, fields: b.fields };
    if (b.mutation !== undefined) o['mutation'] = b.mutation;
    if (b.proc !== undefined) o['proc'] = b.proc;
    if (b.comment) {
        const c: Record<string, unknown> = { text: b.comment.text };
        if (b.comment.anchor) c['anchor'] = b.comment.anchor;
        if (b.comment.minimized === true) c['minimized'] = true;
        o['comment'] = c;
    }
    return JSON.stringify(o);
}

function renderParts(parts: PartT[], b: Block, st: PrintState): string {
    let out = '';
    for (const part of parts) {
        if ('label' in part) {
            out += (part as { label: string }).label;
        } else {
            const s = (part as { slot: { kind: 'input' | 'field'; name: string } }).slot;
            let rendered: string;
            if (s.kind === 'field') {
                rendered = renderField(b.opcode, s.name, b.fields[s.name]?.value ?? '');
            } else {
                const inp = b.inputs[s.name];
                if (!inp) rendered = missingSlot(b.opcode, s.name);
                else if (inp.kind === 'stack') rendered = '';
                else rendered = renderInput(b.opcode, s.name, inp, st);
            }
            out += rendered;
        }
        out += ' ';
    }
    return out.replace(/\s+/g, ' ').trim();
}

function missingSlot(opcode: string, name: string): string {
    const spec = getBlockSpec(opcode);
    const ispec = spec?.inputs.find((i) => i.name === name);
    if (ispec?.kind === 'boolean') return '<>';
    if (ispec?.kind === 'menu' || ispec?.kind === 'broadcast') return '[]';
    return '()';
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function commentLines(c: Comment, indent: string): string[] {
    const lines = c.text.split('\n');
    let first = `${indent}//`;
    if (c.anchor) first += ` [${c.anchor}${c.minimized === true ? ' minimized' : ''}]`;
    else if (c.minimized === true) first += ' [minimized]';
    first += lines[0] === '' ? '' : ` ${lines[0]}`;
    const out = [first];
    for (const l of lines.slice(1)) out.push(`${indent}//${l === '' ? '' : ` ${l}`}`);
    return out;
}

function mutationSuffix(b: Block): string {
    if (b.mutation === undefined) return '';
    if (b.opcode === 'procedures_definition' || b.opcode === 'procedures_call' || b.opcode === 'procedures_prototype') return '';
    return ` :: ${JSON.stringify(b.mutation)}`;
}

/** Labels containing brackets cannot survive `define`/`call` syntax; escape raw. */
function hasBracketLabel(proccode: string): boolean {
    const { labels } = splitProccode(proccode);
    return labels.some((l) => /[()\[\]<>"]/.test(l));
}

function renderDefine(b: Block): string {
    const proc = b.proc ?? { proccode: '', argumentnames: [], argumentdefaults: [], warp: false };
    if (hasBracketLabel(proc.proccode)) return `!${rawJson(b)}`;
    const { labels, placeholders } = splitProccode(proc.proccode);
    let out = 'define ' + (labels[0] ?? '');
    for (let i = 0; i < proc.argumentnames.length; i++) {
        const name = proc.argumentnames[i] ?? '';
        const def = proc.argumentdefaults[i] ?? '';
        const ph = placeholders[i] ?? '%s';
        let arg: string;
        if (ph === '%b') arg = `<${escBoolName(name)}>`;
        else if (ph === '%n') arg = `(${escName(name)}: number${def !== '' ? `=${escName(def)}` : ''})`;
        else arg = def !== '' ? `(${escName(name)}=${escName(def)})` : name === '' ? '("")' : `(${escName(name)})`;
        out += arg + (labels[i + 1] ?? '');
    }
    out = out.replace(/\s+/g, ' ').trim();
    if (proc.argumentdefaults.length !== proc.argumentnames.length) {
        out += ` :: ${JSON.stringify({ argumentdefaults: proc.argumentdefaults })}`;
    }
    if (proc.warp) out += ' :: warp';
    return out;
}

const NO_TEXT_RENDER = new Set(['extension_pen_down']);

function renderStackLine(b: Block, st: PrintState): string {
    if (b.opcode === 'procedures_definition') return renderDefine(b);
    if (NO_TEXT_RENDER.has(b.opcode)) return `!${rawJson(b)}`;
    if (b.opcode === 'procedures_call' && b.proc) {
        const def = st.defs.get(b.proc.proccode);
        if (!def) return `!${rawJson(b)}`;
        // Stale arg ids (not in the definition) cannot render positionally.
        if (Object.keys(b.inputs).some((k) => !def.argNames.includes(k))) return `!${rawJson(b)}`;
        const exprs = def.argNames.map((n) => {
            const inp = b.inputs[n];
            if (!inp) return '()';
            return renderCallArg(inp, st);
        });
        const text = renderCallText(b.proc.proccode, exprs);
        // A call whose text also reads as a builtin must not silently flip.
        if (hasBracketLabel(b.proc.proccode) || textMatchesCatalogStmt(text)) return `!${rawJson(b)}`;
        return text;
    }
    const spec = getBlockSpec(b.opcode);
    if (!spec) return `!${rawJson(b)}`;
    if (b.opcode === 'motion_turnright' || b.opcode === 'motion_turnleft') {
        const dir = b.opcode === 'motion_turnright' ? 'cw' : 'ccw';
        const inp = b.inputs['DEGREES'];
        const val = inp && inp.kind !== 'stack' ? renderInput(b.opcode, 'DEGREES', inp, st) : missingSlot(b.opcode, 'DEGREES');
        return `turn ${dir} ${val} degrees` + mutationSuffix(b);
    }
    const use = spec.shape === 'c' || spec.shape === 'c2' || spec.shape === 'end-c' ? headerOf(b.opcode) : partsOf(b.opcode);
    return renderParts(use, b, st) + mutationSuffix(b);
}

function pushWithComment(lines: string[], indent: string, text: string, c: Comment | undefined): void {
    if (!c) {
        lines.push(indent + text);
        return;
    }
    const rendered = commentLines(c, '');
    lines.push(indent + text + ' ' + rendered[0]);
    for (const l of rendered.slice(1)) lines.push(indent + l);
}

function renderChain(top: Block, indent: string, lines: string[], st: PrintState): void {
    let cur: Block | undefined = top;
    while (cur) {
        const spec = getBlockSpec(cur.opcode);
        const shape = spec?.shape;
        const isC = shape === 'c' || shape === 'c2' || shape === 'end-c';
        if (cur.opcode === 'procedures_definition') {
            pushWithComment(lines, indent, renderDefine(cur), cur.comment);
            const scope = new Map<string, string>();
            if (cur.proc) {
                const { placeholders } = splitProccode(cur.proc.proccode);
                cur.proc.argumentnames.forEach((n, i) => scope.set(n, placeholders[i] ?? '%s'));
            }
            st.argScope.push(scope);
            if (cur.next) renderChain(cur.next, indent, lines, st);
            st.argScope.pop();
            return;
        }
        if (isC && spec) {
            const pp = getPatterns().find((x) => x.opcode === cur!.opcode);
            pushWithComment(lines, indent, renderParts(headerOf(cur.opcode), cur, st) + mutationSuffix(cur), cur.comment);
            const sub = indent + '  ';
            const slots = pp?.stackSlots ?? [];
            for (let i = 0; i < slots.length; i++) {
                if (i === 1) lines.push(indent + 'else');
                const inp = cur.inputs[slots[i]];
                if (inp && inp.kind === 'stack' && inp.block) renderChain(inp.block, sub, lines, st);
            }
            lines.push(indent + 'end');
        } else {
            pushWithComment(lines, indent, renderStackLine(cur, st), cur.comment);
            // NOTE: no `return` for cap blocks: dead code after stop/delete-clone
            // is preserved verbatim (Scratch stores it).
        }
        cur = cur.next;
    }
}

/** Print scripts for one target. */
export function printScripts(scripts: Script[], ctx: FormatCtx): string {
    const names = loadNameSets(ctx);
    const st: PrintState = {
        vars: names.vars,
        lists: names.lists,
        defs: collectDefs(scripts),
        argScope: [],
    };
    const out: string[] = [];
    scripts.forEach((s, si) => {
        if (si > 0) out.push('');
        if (s.anchor) out.push(`@${s.anchor}`);
        if (s.kind === 'comment' && s.comment) {
            out.push(...commentLines(s.comment, ''));
            return;
        }
        if (!s.top) return;
        if (s.kind === 'reporter') {
            out.push(renderExpr(s.top, st));
            return;
        }
        renderChain(s.top, '', out, st);
    });
    return out.join('\n') + '\n';
}
