/**
 * scratchblocks text -> IR + diagnostics.
 *
 * Anchor handling: `@aN` selects the base script with that anchor (core
 * matches via anchors.json). Attached `[cN]` anchors are resolved to base
 * comment ids by reading the sibling `.agentwarp/anchors.json` (best
 * effort; without it comments still parse, only the id link is lost).
 * Variable/list names resolve against target.json plus the Stage target's
 * names (custom-block args take precedence inside their own definition).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Block, Comment, Diagnostic, FormatCtx, Input, Script } from '../../packages/core/ir.ts';
import { getBlockSpec } from '../../packages/core/catalog/index.ts';
import {
    getPatterns,
    matchParts,
    matchPartsAll,
    readGroup,
    asSingleGroup,
    splitHint,
    unesc,
    nearest,
    didYouMean,
    lineSkeleton,
    NUMERIC_RE,
    splitProccode,
    type Part,
} from './syntax.ts';
import { slotDefaultTag } from './print.ts';

type Slot = { kind: 'input' | 'field'; name: string };
type PartT = { label: string } | { slot: Slot };

interface Tables {
    vars: Set<string>;
    lists: Set<string>;
    anchors: Map<string, string>; // anchor -> base id
}

function loadTables(ctx: FormatCtx): Tables {
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
    const anchors = new Map<string, string>();
    try {
        if (ctx.file) {
            const projDir = dirname(dirname(ctx.file));
            for (const e of readdirSync(projDir)) {
                if (e === '.agentwarp' || e === 'node_modules') continue;
                try {
                    const tj = JSON.parse(readFileSync(join(projDir, e, 'target.json'), 'utf8'));
                    if (tj?.isStage === true && !ctx.isStage) grab(tj);
                } catch {
                    /* not a target dir */
                }
            }
            const am = JSON.parse(readFileSync(join(projDir, '.agentwarp', 'anchors.json'), 'utf8'));
            const perTarget = am?.[ctx.targetName];
            if (perTarget && typeof perTarget === 'object') {
                for (const [a, id] of Object.entries<any>(perTarget)) {
                    if (typeof id === 'string') anchors.set(a, id);
                }
            }
        }
    } catch {
        /* best effort: anchors/names stay local */
    }
    return { vars, lists, anchors };
}

// ---------------------------------------------------------------------------
// Define headers
// ---------------------------------------------------------------------------

export interface DefHeader {
    proccode: string;
    argNames: string[];
    argDefaults: string[];
    placeholders: string[];
    warp: boolean;
    error?: string;
}

const TYPE_RE = /^(.*?)(?::\s*(number|string))?\s*(?:=(.*))?$/s;

function parseArgGroup(raw: string, isBool: boolean): { name: string; ph: string; def: string; error?: string } {
    const inner = raw.trim();
    if (!isBool && inner.startsWith('"') && inner.length >= 2) {
        // Quoted name, possibly with : type and = default after the closing quote.
        let i = 1;
        let name = '';
        let closed = false;
        while (i < inner.length) {
            const c = inner[i];
            if (c === '\\' && i + 1 < inner.length) {
                name += inner[i] + inner[i + 1];
                i += 2;
                continue;
            }
            if (c === '"') {
                closed = true;
                i++;
                break;
            }
            name += c;
            i++;
        }
        if (!closed) return { name: unesc(inner), ph: '%s', def: '' };
        const rest = inner.slice(i).trim();
        if (rest === '') return { name: unesc(name), ph: '%s', def: '' };
        const m = rest.match(/^(?::\s*(number|string))?\s*(?:=(.*))?$/s);
        if (!m) return { name: unesc(name), ph: '%s', def: '', error: `cannot parse argument ${raw}` };
        const type = m[1] ?? '';
        let def = m[2] ?? '';
        def = def.trim();
        if (def.startsWith('"') && def.endsWith('"') && def.length >= 2) def = unesc(def.slice(1, -1));
        return { name: unesc(name), ph: type === 'number' ? '%n' : '%s', def };
    }
    if (isBool) {
        if (inner.includes('=')) return { name: unesc(inner), ph: '%b', def: '', error: `boolean argument ${raw} takes no default` };
        return { name: unesc(inner), ph: '%b', def: '' };
    }
    const m = inner.match(TYPE_RE);
    if (!m) return { name: unesc(inner), ph: '%s', def: '' };
    let name = (m[1] ?? '').trim();
    const type = m[2] ?? '';
    let def = m[3] ?? '';
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) name = unesc(name.slice(1, -1));
    else name = unesc(name);
    def = def.trim();
    if (def.startsWith('"') && def.endsWith('"') && def.length >= 2) def = unesc(def.slice(1, -1));
    else def = unesc(def);
    return { name, ph: type === 'number' ? '%n' : '%s', def };
}

/** Parse `define ...` header rest (after the `define` keyword). */
export function parseDefineHeader(rest: string): DefHeader {
    let warp = false;
    let text = rest.trim();
    const warpM = text.match(/::\s*warp\s*$/);
    if (warpM) {
        warp = true;
        text = text.slice(0, warpM.index).trim();
    }
    let defaultsOverride: string[] | null = null;
    const mutM = text.match(/::\s*(\{.*\})\s*$/s);
    if (mutM) {
        try {
            const o = JSON.parse(mutM[1]);
            if (Array.isArray(o?.argumentdefaults)) defaultsOverride = o.argumentdefaults.map(String);
        } catch {
            /* reported by caller */
        }
        text = text.slice(0, mutM.index).trim();
    }
    const labels: string[] = [];
    const argNames: string[] = [];
    const argDefaults: string[] = [];
    const placeholders: string[] = [];
    let cur = '';
    let i = 0;
    let error: string | undefined;
    const flushLabel = (): void => {
        // Preserve spacing exactly (proccodes are byte-compared).
        if (cur.trim() !== '') labels.push(cur);
        else if (cur === '') {
            // Empty gap: keep positional (an arg follows or precedes).
            if (labels.length <= argNames.length) labels.push('');
        } else if (labels.length > 0 || argNames.length > 0) {
            // Whitespace-only gap between parts: keep it.
            labels.push(cur);
        }
        // Else: leading whitespace of the whole header: drop it.
        cur = '';
    };
    while (i < text.length) {
        const c = text[i];
        if (c === '(' || c === '<') {
            const g = readGroup(text, i);
            if (!g) {
                error = `unbalanced brackets in define header`;
                break;
            }
            flushLabel();
            const a = parseArgGroup(g.inner, g.kind === 'bool');
            if (a.error && !error) error = a.error;
            argNames.push(a.name);
            argDefaults.push(a.def);
            placeholders.push(a.ph);
            i = g.end;
        } else if (/\s/.test(c)) {
            cur += c;
            i++;
        } else {
            cur += c;
            i++;
        }
    }
    if (cur.trim() !== '') labels.push(cur);
    else if (cur === '') {
        if (labels.length <= argNames.length) labels.push('');
    } else if (labels.length > 0 || argNames.length > 0) {
        labels.push(cur);
    }
    while (labels.length < placeholders.length + 1) labels.push('');
    // Trim only the outer ends; interior spacing is significant.
    if (labels.length > 0) {
        labels[0] = labels[0].replace(/^\s+/, '');
        labels[labels.length - 1] = labels[labels.length - 1].replace(/\s+$/, '');
    }
    let proccode = labels[0] ?? '';
    for (let k = 0; k < placeholders.length; k++) proccode += placeholders[k] + (labels[k + 1] ?? '');
    if (defaultsOverride) {
        while (defaultsOverride.length < argNames.length) defaultsOverride.push('');
        return { proccode, argNames, argDefaults: defaultsOverride, placeholders, warp, error };
    }
    return { proccode, argNames, argDefaults, placeholders, warp, error };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface CFrame {
    block: Block;
    slots: string[];
    idx: number;
    tails: Array<Block | undefined>;
}

interface Builder {
    anchor?: string;
    top?: Block;
    tail?: Block;
    frames: CFrame[];
    comment?: Comment; // workspace comment (no blocks yet)
    pendingLead: Array<{ text: string; anchor?: string; minimized?: boolean }>;
    openComment: { owner: Block; } | null;
    lineNo: number;
}

interface PState {
    ctx: FormatCtx;
    tables: Tables;
    diags: Diagnostic[];
    scripts: Script[];
    cur: Builder;
    defs: Array<{ proccode: string; placeholders: string[]; argNames: string[]; line: number }>;
    defArgs: Map<string, string> | null; // enclosing definition args
    seenAnchors: Set<string>;
    file: string;
}

function err(st: PState, line: number, col: number, message: string): void {
    st.diags.push({ message, file: st.file, line, col, severity: 'error' });
}

function newBuilder(): Builder {
    return { frames: [], pendingLead: [], openComment: null, lineNo: 0 };
}

function currentTail(st: PState): Block | undefined {
    const b = st.cur;
    if (b.frames.length > 0) {
        const f = b.frames[b.frames.length - 1];
        return f.tails[f.idx];
    }
    return b.tail;
}

function appendBlock(st: PState, node: Block): void {
    const b = st.cur;
    if (b.frames.length > 0) {
        const f = b.frames[b.frames.length - 1];
        const slotName = f.slots[f.idx];
        const cur = f.tails[f.idx];
        if (!cur) {
            f.block.inputs[slotName] = { kind: 'stack', block: node };
        } else {
            cur.next = node;
        }
        f.tails[f.idx] = lastInChain(node);
        return;
    }
    if (!b.top) b.top = node;
    else if (b.tail) b.tail.next = node;
    b.tail = lastInChain(node);
}

function lastInChain(node: Block): Block {
    let cur = node;
    while (cur.next) cur = cur.next;
    return cur;
}

/** A hat/define always starts a new script; a cap ends chaining. */
function isHatOpcode(opcode: string): boolean {
    return getBlockSpec(opcode)?.shape === 'hat';
}

function isCapOpcode(opcode: string): boolean {
    return getBlockSpec(opcode)?.shape === 'cap';
}

function startScript(st: PState, anchor?: string): void {
    finishScript(st);
    st.cur = newBuilder();
    if (anchor) {
        if (st.seenAnchors.has(anchor)) {
            // Duplicate: core warns too; keep text but drop the link.
            st.diags.push({ message: `${st.file}:${st.cur.lineNo}: duplicate anchor @${anchor}: treated as new`, file: st.file, severity: 'warning' });
            st.cur.anchor = undefined;
            st.cur.lineNo = 0;
        } else {
            st.seenAnchors.add(anchor);
            st.cur.anchor = anchor;
        }
    }
    st.defArgs = null;
}

function finishScript(st: PState): void {
    const b = st.cur;
    if (b.frames.length > 0) {
        for (const f of b.frames) {
            err(st, b.lineNo || 1, 1, `unclosed block "${describeBlock(f.block)}": missing "end"`);
        }
        b.frames = [];
    }
    if (!b.top && !b.comment) {
        if (b.pendingLead.length > 0) {
            // Section of only comments -> workspace comment.
            const first = b.pendingLead[0];
            const text = b.pendingLead.map((l) => l.text).join('\n');
            b.comment = { text, anchor: first.anchor, minimized: first.minimized };
            resolveCommentAnchor(st, b.comment);
        } else if (b.anchor) {
            // Bare @-section: keep an empty anchor link? Drop it (no script).
            return;
        } else {
            return;
        }
    }
    if (!b.top && b.comment) {
        const s: Script = { kind: 'comment', comment: b.comment };
        if (b.anchor) s.anchor = b.anchor;
        st.scripts.push(s);
        return;
    }
    if (b.top && b.pendingLead.length > 0 && !b.top.comment) {
        const first = b.pendingLead[0];
        const c: Comment = { text: b.pendingLead.map((l) => l.text).join('\n'), anchor: first.anchor, minimized: first.minimized };
        resolveCommentAnchor(st, c);
        b.top.comment = c;
    }
    if (b.top) {
        // Reporter-shaped single block -> reporter script (mirrors extract).
        const shape = getBlockSpec(b.top.opcode)?.shape;
        let kind: Script['kind'] = 'stack';
        if (!b.top.next && (shape === 'reporter' || shape === 'boolean' || b.top.opcode === 'data_variable' || b.top.opcode === 'data_listcontents')) {
            kind = 'reporter';
        }
        const s: Script = { kind, top: b.top };
        if (b.anchor) s.anchor = b.anchor;
        st.scripts.push(s);
    }
}

function describeBlock(b: Block): string {
    return b.opcode;
}

function resolveCommentAnchor(st: PState, c: Comment): void {
    if (!c.anchor) return;
    const id = st.tables.anchors.get(c.anchor);
    if (id) {
        if (c.srcId && c.srcId !== id) {
            st.diags.push({ message: `duplicate comment anchor [${c.anchor}]: treated as new`, file: st.file, severity: 'warning' });
            c.srcId = undefined;
            return;
        }
        c.srcId = id;
    }
}

/** Parse a star comment's content (separator space before the closer removed). */
function parseStarContent(content: string): { text: string; anchor?: string; minimized?: boolean } {
    const pc = parseCommentRemainder(content);
    if (pc.text.endsWith(' ')) pc.text = pc.text.slice(0, -1);
    return pc;
}

/** Parse a `//` comment remainder (after the slashes): [cN] / [cN minimized] prefix. */
function parseCommentRemainder(rest: string): { text: string; anchor?: string; minimized?: boolean } {
    let t = rest.startsWith(' ') ? rest.slice(1) : rest;
    const m = t.match(/^\[c(\d+)( minimiz\w*)?\]\s?/);
    // Accept "[c3]" or "[c3 minimized]" (also accept "minimised" prefix leniently).
    const m2 = t.match(/^\[(c\d+)((?:\s+minimiz\w+)?)\]\s?/);
    if (m2) {
        const anchor = m2[1];
        const minimized = /minimiz/i.test(m2[2]) ? true : undefined;
        return { text: t.slice(m2[0].length), anchor, minimized };
    }
    // Bare "[minimized]" without anchor (printer emits this for new minimized comments).
    const m3 = t.match(/^\[(minimiz\w+)\]\s?/i);
    if (m3) return { text: t.slice(m3[0].length), minimized: true };
    return { text: t };
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

type SlotCtx =
    | { kind: 'catalog'; opcode: string; name: string; isField: boolean }
    | { kind: 'callarg'; ph: string }
    | { kind: 'bool' }
    | { kind: 'any' };

function slotTagFor(slot: SlotCtx): number | undefined {
    if (slot.kind === 'catalog' && !slot.isField) return slotDefaultTag(slot.opcode, slot.name);
    if (slot.kind === 'callarg') return undefined;
    return undefined;
}

function isMenuInput(opcode: string, name: string): 'menu' | 'broadcast' | 'costume' | 'sound' | 'plain' {
    const spec = getBlockSpec(opcode);
    const ispec = spec?.inputs.find((i) => i.name === name);
    if (!ispec) return 'plain';
    if (ispec.kind === 'broadcast') return 'broadcast';
    if (ispec.kind === 'menu') return 'menu';
    if (ispec.kind === 'costume' || ispec.kind === 'sound') return ispec.kind;
    return 'plain';
}

/** Strip one trailing ` v` dropdown marker. */
function stripV(content: string): string {
    if (content.endsWith(' v') || content === 'v') return content === 'v' ? '' : content.slice(0, -2);
    return content;
}

function hasV(content: string): boolean {
    return content.endsWith(' v') || content === 'v';
}

function menuValueFromRaw(opcode: string, inputName: string, raw: string, st: PState, line: number, col: number): string {
    const spec = getBlockSpec(opcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    const menuSpec = ispec?.shadowOpcode ? getBlockSpec(ispec.shadowOpcode) : undefined;
    const fspec = menuSpec?.fields[0];
    const opts = fspec?.options ?? [];
    if (opts.length === 0) return raw;
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        return unesc(raw.slice(1, -1)); // quoted: verbatim, no mapping
    }
    const values = opts.map((o) => o[1]);
    const labels = opts.map((o) => o[0]);
    const dynamic = !!fspec?.dynamic;
    if (values.includes(raw)) return raw;
    const li = labels.indexOf(raw);
    if (li >= 0) {
        if (!dynamic || values[li].startsWith('_')) return values[li];
        return raw; // dynamic real name that equals a placeholder label
    }
    if (!dynamic) {
        const sug = nearest(raw, labels, (x) => x);
        err(st, line, col, `unknown menu value "${raw}"${didYouMean(sug)}`);
    }
    return raw;
}

function fieldValueFromRaw(opcode: string, fieldName: string, raw: string, st: PState, line: number, col: number): string {
    const spec = getBlockSpec(opcode);
    const fspec = spec?.fields.find((f) => f.name === fieldName);
    const kind = fspec?.kind;
    if (kind === 'variable' || kind === 'list') {
        const table = kind === 'variable' ? st.tables.vars : st.tables.lists;
        if (!table.has(raw)) {
            const sug = nearest(raw, [...table], (x) => x);
            err(st, line, col, `unknown ${kind} "${raw}" (declare it in target.json first)${didYouMean(sug)}`);
        }
        return raw;
    }
    if (kind === 'broadcast') return raw;
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        return unesc(raw.slice(1, -1)); // quoted: verbatim, no mapping
    }
    const opts = fspec?.options ?? [];
    const values = opts.map((o) => o[1]);
    const labels = opts.map((o) => o[0]);
    if (values.includes(raw)) return raw;
    const li = labels.indexOf(raw);
    if (li >= 0) return values[li];
    const sug = nearest(raw, [...labels, ...values], (x) => x);
    st.diags.push({ message: `unknown value "${raw}"${didYouMean(sug)}`, file: st.file, line, col, severity: 'warning' });
    return raw;
}

const HINTS = new Set(['variables', 'list', 'args']);

function isExplicitOpcode(hint: string): boolean {
    const spec = getBlockSpec(hint);
    return !!spec && (spec.shape === 'reporter' || spec.shape === 'boolean');
}

/** `()` / `[]` / `<>`: the missing-input marker. For `[]` the match is
 * exact (a space inside, `[ ]`, is a literal space); parens/bools trim. */
export function isEmptyGroup(raw: string): boolean {
    const t = raw.trim();
    if (t === '()' || t === '<>') return true;
    if (t.length >= 2 && t[0] === '[') {
        const g = asSingleGroup(t);
        if (!g || g.kind !== 'square') return false;
        return g.inner === '';
    }
    const g = asSingleGroup(t);
    if (!g) return false;
    return g.inner.trim() === '';
}

/** Parse one slot group (with brackets) into an IR Input. Boundaries are
 * pre-validated by the caller (matchParts / asSingleGroup); bool groups are
 * stripped directly since they may contain operator `>`. A trailing /* *​/
 * comment attaches to the resulting block (errors on non-blocks). */
function parseSlot(group: string, slot: SlotCtx, st: PState, line: number, col: number, ownerOpcode = ''): Input | null {
    const t = group.trim();
    // Split a trailing [star] star comment (bound to the preceding group).
    let star: { text: string; anchor?: string; minimized?: boolean } | null = null;
    let core = t;
    const starM = t.match(/\/\*([\s\S]*)\*\/\s*$/);
    if (starM) {
        // The [star] must follow the closing bracket (possibly after spaces).
        const before = t.slice(0, starM.index).trimEnd();
        const last = before[before.length - 1];
        if (last === ')' || last === ']' || last === '>') {
            core = before;
            star = parseStarContent(starM[1]);
        }
    }
    const c = core[0];
    let inp: Input | null = null;
    if (c === '(' || c === '[') {
        const g = asSingleGroup(core);
        if (!g) {
            err(st, line, col, `expected a (...) [...] or <...> value, got "${group}"`);
            return null;
        }
        if (g.kind === 'square') inp = parseSquare(g.inner, slot, st, line, col, ownerOpcode);
        else {
            if (slot.kind === 'catalog' && slot.isField) {
                err(st, line, col, `wrong input kind: a field cannot hold (...)`);
                return null;
            }
            inp = parseParenInner(g.inner, slot, st, line, col, ownerOpcode);
        }
    } else if (c === '<') {
        if (slot.kind === 'catalog' && slot.isField) {
            err(st, line, col, `wrong input kind: a field cannot hold <...>`);
            return null;
        }
        if (!core.endsWith('>')) {
            err(st, line, col, `unbalanced <...> in "${group}"`);
            return null;
        }
        inp = parseBoolInner(core.slice(1, -1), st, line, col);
    } else {
        err(st, line, col, `expected a (...) [...] or <...> value, got "${group}"`);
        return null;
    }
    if (star && inp) {
        if (inp.kind === 'block') {
            const cm: Comment = { text: star.text, loc: { file: st.file, line, col } };
            if (star.anchor) cm.anchor = star.anchor;
            if (star.minimized === true) cm.minimized = true;
            resolveCommentAnchor(st, cm);
            if (inp.block.comment) inp.block.comment.text += '\n' + cm.text;
            else inp.block.comment = cm;
        } else {
            err(st, line, col, `stray /* comment */ after a value (attach comments to blocks, or use // at line end)`);
        }
    }
    return inp;
}

function tagForLiteral(slot: SlotCtx, numeric: boolean): number {
    const base = slotTagFor(slot);
    if (base !== undefined) return base;
    if (slot.kind === 'callarg') return numeric ? 4 : 10;
    return numeric ? 4 : 10;
}

function parseParenInner(inner: string, slot: SlotCtx, st: PState, line: number, col: number, ownerOpcode: string): Input | null {
    void ownerOpcode;
    const t = inner.trim();
    // Inline raw escape `(!{...})`.
    if (t.startsWith('!')) {
        const b = parseRawJson(t.slice(1).trim(), st, line, col);
        if (!b) return null;
        return { kind: 'block', block: b };
    }
    // Explicit hint first.
    const h = splitHint(inner);
    if (h) {
        const hint = h.hint.trim();
        if (HINTS.has(hint) || /^\d+$/.test(hint) || isExplicitOpcode(hint)) {
            return parseHinted(h.content, hint, slot, st, line, col);
        }
    }
    if (t === '') return null; // `()` is the missing-input marker
    if (NUMERIC_RE.test(t)) return { kind: 'literal', value: Number(t), litType: tagForLiteral(slot, true) };
    if (t === 'true' || t === 'false') return { kind: 'literal', value: t === 'true', litType: tagForLiteral(slot, false) };
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        const innerQ = t.slice(1, -1);
        // Must be a clean quoted string (no stray unescaped quote).
        return { kind: 'literal', value: unesc(innerQ), litType: tagForLiteral(slot, false) };
    }
    const single = asSingleGroup(t);
    if (single) {
        if (single.kind === 'bool') return parseBoolInner(single.inner, st, line, col);
        return parseSlot(t, slot, st, line, col, ownerOpcode);
    }
    // Catalog reporters/booleans.
    const boolFirst = slot.kind === 'bool';
    const orders: Array<'reporter' | 'boolean'> = boolFirst ? ['boolean', 'reporter'] : ['reporter', 'boolean'];
    for (const shape of orders) {
        const found = matchCatalogExpr(shape, t, st, line, col, slot);
        if (found) return found;
    }
    // Procedure calls.
    const call = matchCall(t, st, line, col);
    if (call) return call;
    // Enclosing definition args.
    const name = unesc(t);
    if (st.defArgs && st.defArgs.has(name)) {
        const ph = st.defArgs.get(name);
        if (ph === '%b') {
            err(st, line, col, `boolean argument "${name}" must use <${name}>`);
            return { kind: 'block', block: { opcode: 'argument_reporter_boolean', inputs: {}, fields: { VALUE: { value: name } } } };
        }
        return { kind: 'block', block: { opcode: 'argument_reporter_string_number', inputs: {}, fields: { VALUE: { value: name } } } };
    }
    // Variables / lists.
    const inVars = st.tables.vars.has(name);
    const inLists = st.tables.lists.has(name);
    if (inVars && inLists) {
        err(st, line, col, `ambiguous "${name}": both a variable and a list; write (${name} :: variables) or (${name} :: list)`);
        return { kind: 'var', name };
    }
    if (inVars) return { kind: 'var', name };
    if (inLists) return { kind: 'list', name };
    const sug = [...nearest(name, [...st.tables.vars, ...st.tables.lists], (x) => x), ...nearest(name, catalogSkeletons(), (x) => x.text).map((x) => x.text)];
    err(st, line, col, `unknown reporter or variable "${name}"${didYouMean(sug.slice(0, 3))}`);
    return { kind: 'var', name };
}

function parseSquareInner(inner: string, slot: SlotCtx, st: PState, line: number, col: number, ownerOpcode: string): Input | null {
    // Catalog field slots.
    if (slot.kind === 'catalog' && slot.isField) {
        const raw = unesc(hasV(inner) ? stripV(inner) : inner);
        return { kind: '__field', value: raw } as unknown as Input;
    }
    // Menu / broadcast / costume / sound inputs: quoted or numeric content is
    // a literal (printer quotes string literals here); otherwise a menu value.
    if (slot.kind === 'catalog' && !slot.isField) {
        const mso = isMenuInput(slot.opcode, slot.name);
        if (mso !== 'plain') {
            const raw = hasV(inner) ? stripV(inner) : inner;
            const t = raw.trim();
            if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
                return { kind: 'literal', value: unesc(t.slice(1, -1)), litType: 10 };
            }
            if (NUMERIC_RE.test(t)) return { kind: 'literal', value: Number(t), litType: 10 };
            if (mso === 'broadcast') return { kind: 'broadcast', name: unesc(raw) };
            return { kind: 'menu', value: menuValueFromRaw(slot.opcode, slot.name, unesc(raw), st, line, col) };
        }
    }
    // `[]` is the missing-input marker (printer emits `[""]` for empty text).
    if (inner === '') return null;
    // Value slots: hint, nested, or literal.
    const h = splitHint(inner);
    if (h) {
        const hint = h.hint.trim();
        if (HINTS.has(hint) || /^\d+$/.test(hint) || isExplicitOpcode(hint)) {
            return parseHinted(h.content, hint, slot, st, line, col);
        }
    }
    const single = asSingleGroup(inner.trim());
    if (single) {
        if (single.kind === 'bool') return parseBoolInner(single.inner, st, line, col);
        return parseSlot(inner.trim(), slot, st, line, col, ownerOpcode);
    }
    const t = inner.trim();
    const base = slotTagFor(slot) ?? 10;
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        return { kind: 'literal', value: unesc(t.slice(1, -1)), litType: 10 };
    }
    if (NUMERIC_RE.test(t)) return { kind: 'literal', value: Number(t), litType: base };
    if (t === 'true' || t === 'false') return { kind: 'literal', value: t === 'true', litType: base };
    return { kind: 'literal', value: unesc(inner), litType: base };
}

function parseSquare(inner: string, slot: SlotCtx, st: PState, line: number, col: number, ownerOpcode: string): Input | null {
    const r = parseSquareInner(inner, slot, st, line, col, ownerOpcode);
    if (!r) return null;
    if ((r as unknown as { kind: string }).kind === '__field') {
        err(st, line, col, `internal error: field in value position`);
        return { kind: 'literal', value: (r as unknown as { value: string }).value, litType: 10 };
    }
    return r;
}

function parseHinted(content: string, hint: string, slot: SlotCtx, st: PState, line: number, col: number): Input | null {
    const c = content.trim();
    if (hint === 'variables') return { kind: 'var', name: unesc(c) };
    if (hint === 'list') return { kind: 'list', name: unesc(c) };
    if (hint === 'args') {
        const name = unesc(c);
        if (st.defArgs && st.defArgs.has(name)) {
            const ph = st.defArgs.get(name);
            return {
                kind: 'block',
                block: {
                    opcode: ph === '%b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
                    inputs: {},
                    fields: { VALUE: { value: name } },
                },
            };
        }
        err(st, line, col, `unknown argument "${name}" (no enclosing define with that argument)`);
        return { kind: 'block', block: { opcode: 'argument_reporter_string_number', inputs: {}, fields: { VALUE: { value: name } } } };
    }
    if (/^\d+$/.test(hint)) {
        const tag = Number(hint);
        if (c.length >= 2 && c.startsWith('"') && c.endsWith('"')) return { kind: 'literal', value: unesc(c.slice(1, -1)), litType: tag };
        if (NUMERIC_RE.test(c)) return { kind: 'literal', value: Number(c), litType: tag };
        return { kind: 'literal', value: unesc(c), litType: tag };
    }
    // Explicit opcode.
    return buildExplicit(c, hint, st, line, col);
}

/** Build `(content :: opcode)` for reporter/boolean opcodes (incl. static-less). */
function buildExplicit(content: string, opcode: string, st: PState, line: number, col: number): Input | null {
    const spec = getBlockSpec(opcode);
    if (!spec) {
        err(st, line, col, `unknown opcode "${opcode}"`);
        return null;
    }
    const hasStatic = splitTemplateText(spec.text.en);
    if (!hasStatic && spec.fields.length === 1) {
        // Static-less single-field (note/matrix/listindex...): whole content is the field.
        return { kind: 'block', block: { opcode, inputs: {}, fields: { [spec.fields[0].name]: { value: unesc(content.trim()) } } } };
    }
    if (!hasStatic) {
        err(st, line, col, `cannot write ${opcode} explicitly`);
        return null;
    }
    const found = matchCatalogParts(opcode, content.trim(), st, line, col);
    if (!found) {
        err(st, line, col, `"${content.trim()}" does not match ${opcode}`);
        return null;
    }
    return { kind: 'block', block: found.block };
}

function splitTemplateText(en: string): boolean {
    return en.replace(/%\d+/g, '').trim() !== '';
}

function parseBoolInner(inner: string, st: PState, line: number, col: number): Input | null {
    const t = inner.trim();
    if (t === '') return null; // `<>` is the missing-input marker
    const h = splitHint(inner);
    if (h) {
        const hint = h.hint.trim();
        if (HINTS.has(hint) || /^\d+$/.test(hint) || isExplicitOpcode(hint)) {
            return parseHinted(h.content, hint, { kind: 'bool' }, st, line, col);
        }
    }
    const single = asSingleGroup(t);
    // Catalog first: `<C> and <D>` balances as one group (C's `<`), but is an
    // `and` expression, not a nested single. Single-unwrap is the fallback.
    const b = matchCatalogExpr('boolean', t, st, line, col, { kind: 'bool' });
    if (b) return b;
    const r = matchCatalogExpr('reporter', t, st, line, col, { kind: 'bool' });
    if (r) return r;
    if (single) return parseSlot(t, { kind: 'bool' }, st, line, col);
    const call = matchCall(t, st, line, col);
    if (call) return call;
    // Bare names: enclosing args, then variables/lists (leniently).
    const name = unesc(t);
    if (st.defArgs && st.defArgs.has(name)) {
        const ph = st.defArgs.get(name);
        return {
            kind: 'block',
            block: {
                opcode: ph === '%b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
                inputs: {},
                fields: { VALUE: { value: name } },
            },
        };
    }
    if (st.tables.vars.has(name)) return { kind: 'var', name };
    if (st.tables.lists.has(name)) return { kind: 'list', name };
    // Truly unknown: fail so enclosing matches backtrack. (A var/boolean
    // recovery here would validate wrong `and`/`or` split points.)
    return null;
}

// ---------------------------------------------------------------------------
// Template matching -> Block
// ---------------------------------------------------------------------------

function specInputKind(opcode: string, name: string): string | undefined {
    return getBlockSpec(opcode)?.inputs.find((i) => i.name === name)?.kind;
}

/** Match one catalog pattern's parts at full text; build the Block. Allows trailing `//` comment. */
/** Cap on structural splits tried per block (safety vs pathological lines). */
const SPLIT_CAP = 100;

function matchCatalogParts(opcode: string, text: string, st: PState, line: number, col: number): { block: Block; end: number } | null {
    const pat = getPatterns().find((p) => p.opcode === opcode);
    if (!pat) return null;
    const restOk = (end: number): boolean => {
        const rest = text.slice(end).trim();
        return rest === '' || rest.startsWith('//');
    };
    const slotNames = pat.parts.filter((p) => 'slot' in p).map((p) => (p as { slot: Slot }).slot);
    let best: { block: Block; end: number; errs: Diagnostic[] } | null = null;
    let splits = 0;
    for (const m of matchPartsAll(pat.parts as Part[], text, 0, restOk)) {
        if (++splits > SPLIT_CAP) break;
        if (slotNames.length !== m.slots.length) continue;
        const n = st.diags.length;
        const b = buildFromSlots(opcode, slotNames, m.slots, st, line, col);
        const errs = st.diags.slice(n);
        st.diags.length = n;
        if (!b) continue;
        if (errs.length === 0) return { block: b, end: m.end };
        if (!best || errs.length < best.errs.length) best = { block: b, end: m.end, errs };
    }
    if (!best) return null;
    st.diags.push(...best.errs);
    return { block: best.block, end: best.end };
}

function buildFromSlots(opcode: string, slotNames: Slot[], slotTexts: string[], st: PState, line: number, col: number): Block | null {
    const b: Block = { opcode, inputs: {}, fields: {}, loc: { file: st.file, line, col } };
    for (let i = 0; i < slotNames.length; i++) {
        const s = slotNames[i];
        if (s.kind === 'field') {
            const g = asSingleGroup(slotTexts[i]);
            if (!g || g.kind !== 'square') {
                err(st, line, col, `wrong input kind: field "${s.name}" needs [value v]`);
                b.fields[s.name] = { value: '' };
                continue;
            }
            const raw = unesc(hasV(g.inner) ? stripV(g.inner) : g.inner);
            b.fields[s.name] = { value: fieldValueFromRaw(opcode, s.name, raw, st, line, col) };
        } else {
            const kind = specInputKind(opcode, s.name);
            if (kind === 'stack') continue; // handled structurally
            if (isEmptyGroup(slotTexts[i])) continue; // missing stays missing
            const inp = parseSlot(slotTexts[i], { kind: 'catalog', opcode, name: s.name, isField: false }, st, line, col + slotTexts[i].length, opcode);
            if (!inp) return null; // slot parse failed: reject this split
            if ((inp as unknown as { kind: string }).kind === '__field') {
                b.fields[s.name] = { value: (inp as unknown as { value: string }).value };
                continue;
            }
            b.inputs[s.name] = inp;
        }
    }
    return b;
}

function matchCatalogExpr(shape: 'reporter' | 'boolean', text: string, st: PState, line: number, col: number, _slot: SlotCtx): Input | null {
    void _slot;
    let best: { block: Block; errs: Diagnostic[]; order: number; fields: number } | null = null;
    let pi = 0;
    for (const p of getPatterns()) {
        pi++;
        if (p.shape !== shape || !p.hasStatic) continue;
        const n = st.diags.length;
        const found = matchCatalogParts(p.opcode, text, st, line, col);
        const errs = st.diags.slice(n);
        st.diags.length = n;
        if (!found) continue;
        const fields = Object.keys(found.block.fields).length;
        if (!best || errs.length < best.errs.length || (errs.length === best.errs.length && (fields > best.fields || (fields === best.fields && pi < best.order)))) {
            best = { block: found.block, errs, order: pi, fields };
        }
    }
    if (!best) return null;
    st.diags.push(...best.errs);
    return { kind: 'block', block: best.block };
}

function matchCall(text: string, st: PState, line: number, col: number): Input | null {
    for (const def of st.defs) {
        const parts: Part[] = [];
        const { labels } = splitProccode(def.proccode);
        for (let i = 0; i < def.placeholders.length; i++) {
            if ((labels[i] ?? '') !== '') parts.push({ label: labels[i] });
            parts.push({ slot: { kind: 'input', name: def.argNames[i] ?? `arg${i + 1}` } });
        }
        if ((labels[def.placeholders.length] ?? '') !== '') parts.push({ label: labels[def.placeholders.length] });
        const restOk = (end: number): boolean => text.slice(end).trim() === '';
        let best: { block: Block; errs: Diagnostic[] } | null = null;
        let splits = 0;
        for (const m of matchPartsAll(parts, text, 0, restOk)) {
            if (++splits > SPLIT_CAP) break;
            if (m.slots.length !== def.placeholders.length) continue;
            const n = st.diags.length;
            const b: Block = {
                opcode: 'procedures_call',
                inputs: {},
                fields: {},
                proc: { proccode: def.proccode, argumentnames: [], argumentdefaults: [], warp: false },
                loc: { file: st.file, line, col },
            };
            let ok = true;
            for (let i = 0; i < def.placeholders.length; i++) {
                if (isEmptyGroup(m.slots[i])) continue; // missing stays missing
                const inp = parseSlot(m.slots[i], { kind: 'callarg', ph: def.placeholders[i] }, st, line, col, 'procedures_call');
                if (!inp || (inp as unknown as { kind: string }).kind === '__field') {
                    ok = false;
                    break;
                }
                b.inputs[def.argNames[i]] = inp;
            }
            const errs = st.diags.slice(n);
            st.diags.length = n;
            if (!ok) continue;
            if (errs.length === 0) return { kind: 'block', block: b };
            if (!best || errs.length < best.errs.length) best = { block: b, errs };
        }
        if (best) {
            st.diags.push(...best.errs);
            return { kind: 'block', block: best.block };
        }
    }
    return null;
}



function catalogSkeletons(): Array<{ text: string; example: string }> {
    return getPatterns()
        .filter((p) => p.hasStatic)
        .map((p) => ({ text: p.skeleton, example: exampleFor(p.opcode) }));
}

function exampleFor(opcode: string): string {
    // Render the template with slot placeholders (for did-you-mean).
    const pat = getPatterns().find((p) => p.opcode === opcode);
    if (!pat) return opcode;
    return pat.parts
        .map((p) => {
            if ('label' in p) return (p as { label: string }).label;
            const s = (p as { slot: Slot }).slot;
            if (s.kind === 'field') return '[... v]';
            return '(...)';
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

function checkTrailing(line: string, end: number, st: PState, lineNo: number, what: string): { slash: string | null; star: { text: string; anchor?: string; minimized?: boolean } | null } {
    const after = line.slice(end);
    if (after.trim() === '') return { slash: null, star: null };
    // Optional [star] (line-end star comment) before an optional // comment.
    let rest = after;
    let star: { text: string; anchor?: string; minimized?: boolean } | null = null;
    const sm = rest.match(/^[ \t]*\/\*([\s\S]*?)\*\//);
    if (sm) {
        const pc = parseStarContent(sm[1]);
        star = { text: pc.text, anchor: pc.anchor, minimized: pc.minimized };
        rest = rest.slice(sm[0].length);
    }
    if (rest.trim() === '') return { slash: null, star };
    const m = rest.match(/^[ \t]*\/\//);
    if (m) return { slash: rest.slice(m[0].length), star }; // keep trailing spaces
    err(st, lineNo, end + 1, `unexpected text after ${what}: "${after.trim()}"`);
    return { slash: null, star };
}

function attachTrailingComment(
    st: PState,
    owner: Block,
    rest: string | null,
    lineNo: number,
    star?: { text: string; anchor?: string; minimized?: boolean } | null,
): void {
    if (rest === null && !star) {
        st.cur.openComment = null;
        return;
    }
    const pc = rest !== null ? parseCommentRemainder(rest) : { text: '', anchor: star?.anchor, minimized: star?.minimized };
    const c: Comment = { text: pc.text, loc: { file: st.file, line: lineNo, col: 1 } };
    if (pc.anchor) c.anchor = pc.anchor;
    if (pc.minimized === true) c.minimized = true;
    if (star && star.text !== '') c.text = c.text === '' ? star.text : `${star.text}\n${c.text}`;
    if (star && !c.anchor && star.anchor) c.anchor = star.anchor;
    if (star && star.minimized === true) c.minimized = true;
    resolveCommentAnchor(st, c);
    if (owner.comment) {
        // Both // and [star] present: merge (base never has both).
        owner.comment.text += '\n' + c.text;
    } else {
        owner.comment = c;
    }
    st.cur.openComment = { owner };
}

/** Strip a trailing top-level `:: {...}` opaque-mutation suffix. */
function stripMutationSuffix(text: string): { text: string; mutation: unknown } {
    const h = splitHint(text);
    if (!h) return { text, mutation: undefined };
    if (!/^\s*\{.*\}\s*$/s.test(h.hint)) return { text, mutation: undefined };
    try {
        const o = JSON.parse(h.hint.trim());
        if (o && typeof o === 'object' && !Array.isArray(o)) return { text: h.content, mutation: o };
    } catch {
        /* not JSON: leave alone */
    }
    return { text, mutation: undefined };
}

// Opcodes whose catalog template collides exactly with another block's.
const NO_TEXT_MATCH = new Set(['motion_turnleft', 'motion_turnright', 'extension_pen_down']);

function parseStackLineToBlock(text: string, st: PState, lineNo: number, col: number): { block: Block; src: string; end: number } | null {
    const stripped = stripMutationSuffix(text);
    const src = stripped.text;
    const attachMutation = (b: Block): void => {
        if (stripped.mutation !== undefined && b.opcode !== 'procedures_definition' && b.opcode !== 'procedures_call') {
            b.mutation = stripped.mutation as Record<string, unknown>;
        }
    };
    // turn cw/ccw (left/right share one template; direction is textual).
    for (const [word, opcode] of [['cw', 'motion_turnright'], ['ccw', 'motion_turnleft']] as Array<[string, string]>) {
        const turnM = matchParts(
            [{ label: 'turn' }, { label: word }, { slot: { kind: 'input', name: 'DEGREES' } }, { label: 'degrees' }],
            src, 0, (end) => {
                const rest = src.slice(end).trim();
                return rest === '' || rest.startsWith('//');
            },
        );
        if (turnM) {
            const b: Block = { opcode, inputs: {}, fields: {}, loc: { file: st.file, line: lineNo, col } };
            if (!isEmptyGroup(turnM.slots[0])) {
                const inp = parseSlot(turnM.slots[0], { kind: 'catalog', opcode, name: 'DEGREES', isField: false }, st, lineNo, col, opcode);
                if (inp) b.inputs['DEGREES'] = inp;
            }
            attachMutation(b);
            return { block: b, src, end: turnM.end };
        }
    }
    // Bare "turn (n) degrees" (agent shorthand): error, default to right.
    {
        const bareM = matchParts(
            [{ label: 'turn' }, { slot: { kind: 'input', name: 'DEGREES' } }, { label: 'degrees' }],
            src, 0, (end) => {
                const rest = src.slice(end).trim();
                return rest === '' || rest.startsWith('//');
            },
        );
        if (bareM) {
            err(st, lineNo, col, `turn needs "cw" (right) or "ccw" (left)`);
            const b: Block = { opcode: 'motion_turnright', inputs: {}, fields: {}, loc: { file: st.file, line: lineNo, col } };
            if (!isEmptyGroup(bareM.slots[0])) {
                const inp = parseSlot(bareM.slots[0], { kind: 'catalog', opcode: 'motion_turnright', name: 'DEGREES', isField: false }, st, lineNo, col, 'motion_turnright');
                if (inp) b.inputs['DEGREES'] = inp;
            }
            attachMutation(b);
            return { block: b, src, end: bareM.end };
        }
    }
    interface Cand {
        block: Block;
        end: number;
        errs: Diagnostic[];
        order: number;
        fields: number;
    }
    const cands: Cand[] = [];
    const consider = (build: () => { block: Block; end: number } | null, order: number): void => {
        const n = st.diags.length;
        const r = build();
        const errs = st.diags.slice(n);
        st.diags.length = n;
        if (r) cands.push({ block: r.block, end: r.end, errs, order, fields: Object.keys(r.block.fields).length });
    };
    // 1. C headers.
    let pi = 0;
    for (const p of getPatterns()) {
        pi++;
        if (p.shape !== 'c' && p.shape !== 'c2' && p.shape !== 'end-c') continue;
        consider(() => {
            const restOk = (end: number): boolean => {
                const rest = src.slice(end).trim();
                return rest === '' || rest.startsWith('//');
            };
            const slots = p.parts.filter((x) => 'slot' in x).map((x) => (x as { slot: Slot }).slot);
            let best: { block: Block; end: number; errs: Diagnostic[] } | null = null;
            let splits = 0;
            for (const m of matchPartsAll(p.header as Part[], src, 0, restOk)) {
                if (++splits > SPLIT_CAP) break;
                const n = st.diags.length;
                const b: Block = { opcode: p.opcode, inputs: {}, fields: {}, loc: { file: st.file, line: lineNo, col } };
                let ok = true;
                for (let i = 0; i < slots.length; i++) {
                    const s = slots[i];
                    if (s.kind === 'field') {
                        const g = asSingleGroup(m.slots[i]);
                        if (!g || g.kind !== 'square') {
                            ok = false;
                            break;
                        }
                        const raw = unesc(hasV(g.inner) ? stripV(g.inner) : g.inner);
                        b.fields[s.name] = { value: fieldValueFromRaw(p.opcode, s.name, raw, st, lineNo, col) };
                    } else {
                        const kind = specInputKind(p.opcode, s.name);
                        if (kind === 'stack') continue;
                        if (isEmptyGroup(m.slots[i])) continue; // missing stays missing
                        const inp = parseSlot(m.slots[i], { kind: 'catalog', opcode: p.opcode, name: s.name, isField: false }, st, lineNo, col, p.opcode);
                        if (!inp) {
                            ok = false;
                            break;
                        }
                        b.inputs[s.name] = inp;
                    }
                }
                const errs = st.diags.slice(n);
                st.diags.length = n;
                if (!ok) continue;
                if (errs.length === 0) return { block: b, end: m.end };
                if (!best || errs.length < best.errs.length) best = { block: b, end: m.end, errs };
            }
            if (!best) return null;
            st.diags.push(...best.errs);
            return { block: best.block, end: best.end };
        }, pi);
    }
    // 2. Stack/hat/cap statements.
    for (const p of getPatterns()) {
        pi++;
        if (p.shape !== 'stack' && p.shape !== 'hat' && p.shape !== 'cap') continue;
        if (NO_TEXT_MATCH.has(p.opcode)) continue;
        consider(() => matchCatalogParts(p.opcode, src, st, lineNo, col), pi);
    }
    // 3. Procedure calls.
    consider(() => matchCallFull(src, st, lineNo, col), 100000);
    if (cands.length === 0) return null;
    // Fewest diagnostics wins; then most field slots (named refs beat literals);
    // then catalog order, then calls.
    cands.sort((a, b) => a.errs.length - b.errs.length || b.fields - a.fields || a.order - b.order);
    const best = cands[0];
    st.diags.push(...best.errs);
    attachMutation(best.block);
    return { block: best.block, src, end: best.end };
}

function matchCallFull(text: string, st: PState, lineNo: number, col: number): { block: Block; end: number } | null {
    for (const def of st.defs) {
        const parts: Part[] = [];
        const { labels } = splitProccode(def.proccode);
        for (let i = 0; i < def.placeholders.length; i++) {
            if ((labels[i] ?? '') !== '') parts.push({ label: labels[i] });
            parts.push({ slot: { kind: 'input', name: def.argNames[i] ?? `arg${i + 1}` } });
        }
        if ((labels[def.placeholders.length] ?? '') !== '') parts.push({ label: labels[def.placeholders.length] });
        const restOk = (end: number): boolean => {
            const rest = text.slice(end).trim();
            return rest === '' || rest.startsWith('//');
        };
        let best: { block: Block; end: number; errs: Diagnostic[] } | null = null;
        let splits = 0;
        for (const m of matchPartsAll(parts, text, 0, restOk)) {
            if (++splits > SPLIT_CAP) break;
            if (m.slots.length !== def.placeholders.length) continue;
            const n = st.diags.length;
            const b: Block = {
                opcode: 'procedures_call',
                inputs: {},
                fields: {},
                proc: { proccode: def.proccode, argumentnames: [], argumentdefaults: [], warp: false },
                loc: { file: st.file, line: lineNo, col },
            };
            let ok = true;
            for (let i = 0; i < def.placeholders.length; i++) {
                if (isEmptyGroup(m.slots[i])) continue; // missing stays missing
                const inp = parseSlot(m.slots[i], { kind: 'callarg', ph: def.placeholders[i] }, st, lineNo, col, 'procedures_call');
                if (!inp || (inp as unknown as { kind: string }).kind === '__field') {
                    ok = false;
                    break;
                }
                b.inputs[def.argNames[i]] = inp;
            }
            const errs = st.diags.slice(n);
            st.diags.length = n;
            if (!ok) continue;
            if (errs.length === 0) return { block: b, end: m.end };
            if (!best || errs.length < best.errs.length) best = { block: b, end: m.end, errs };
        }
        if (best) {
            st.diags.push(...best.errs);
            return { block: best.block, end: best.end };
        }
    }
    return null;
}

function blockLine(line: string, st: PState, lineNo: number, col: number): void {
    const parsed = parseStackLineToBlock(line, st, lineNo, col);
    if (!parsed) {
        // Maybe a bare reporter/boolean expression (reporter script)?
        const g = asSingleGroup(line.trim());
        if (g) {
            const inp = parseSlot(line.trim(), { kind: 'any' }, st, lineNo, col);
            if (inp && inp.kind === 'block') {
                startReporterScript(st, inp.block, lineNo);
                return;
            }
            if (inp && (inp.kind === 'var' || inp.kind === 'list')) {
                const top: Block =
                    inp.kind === 'var'
                        ? { opcode: 'data_variable', inputs: {}, fields: { VARIABLE: { value: inp.name } }, loc: { file: st.file, line: lineNo, col } }
                        : { opcode: 'data_listcontents', inputs: {}, fields: { LIST: { value: inp.name } }, loc: { file: st.file, line: lineNo, col } };
                startReporterScript(st, top, lineNo);
                return;
            }
            if (inp) {
                err(st, lineNo, col, `a script must start with a block, not a value`);
                return;
            }
        }
        const sug = nearest(lineSkeleton(line.trim()), getPatterns().filter((p) => p.hasStatic), (p) => p.skeleton).map((p) => exampleFor(p.opcode));
        err(st, lineNo, col, `unknown block "${line.trim()}"${didYouMean(sug)}`);
        return;
    }
    st.cur.openComment = null;
    const rest = checkTrailing(parsed.src, parsed.end, st, lineNo, 'block');
    const shape = getBlockSpec(parsed.block.opcode)?.shape;
    const hat = shape === 'hat';
    const isC = shape === 'c' || shape === 'c2' || shape === 'end-c';
    const tail = currentTail(st);
    const chainOpen = !!tail;
    if ((hat || parsed.block.opcode === 'procedures_definition') && (st.cur.top || chainOpen)) {
        st.diags.push({ message: `"${line.trim()}" starts a new script`, file: st.file, line: lineNo, col, severity: 'warning' });
        startScript(st);
    }
    // NOTE: chains continue past cap blocks (dead code after stop/delete-clone
    // is preserved). New scripts need @anchor, a hat, or `define`.
    // Pending leading comments attach to the first block.
    if (!st.cur.top && !isC && st.cur.pendingLead.length > 0 && !parsed.block.comment) {
        const first = st.cur.pendingLead[0];
        const c: Comment = { text: st.cur.pendingLead.map((l) => l.text).join('\n'), loc: { file: st.file, line: lineNo, col } };
        if (first.anchor) c.anchor = first.anchor;
        if (first.minimized === true) c.minimized = true;
        resolveCommentAnchor(st, c);
        parsed.block.comment = c;
        st.cur.pendingLead = [];
    } else if (st.cur.pendingLead.length > 0 && st.cur.top) {
        st.cur.pendingLead = [];
    }
    appendBlock(st, parsed.block);
    if (rest.slash !== null || rest.star) attachTrailingComment(st, parsed.block, rest.slash, lineNo, rest.star);
    if (isC) {
        const pat = getPatterns().find((p) => p.opcode === parsed.block.opcode);
        st.cur.frames.push({ block: parsed.block, slots: pat?.stackSlots ?? [], idx: 0, tails: (pat?.stackSlots ?? []).map(() => undefined) });
    }
    st.cur.lineNo = lineNo;
}

function startReporterScript(st: PState, top: Block, lineNo: number): void {
    if (st.cur.top || st.cur.comment) startScript(st);
    st.cur.top = top;
    st.cur.tail = top;
    st.cur.lineNo = lineNo;
    // Reporter scripts complete immediately.
    finishScript(st);
    st.cur = newBuilder();
}

function parseRawJson(jsonText: string, st: PState, lineNo: number, col: number): Block | null {
    let o: any;
    try {
        o = JSON.parse(jsonText.trim());
    } catch (e) {
        err(st, lineNo, col, `bad raw block JSON: ${(e as Error)?.message}`);
        return null;
    }
    if (!o || typeof o.opcode !== 'string') {
        err(st, lineNo, col, `raw block needs an "opcode" string`);
        return null;
    }
    const b: Block = {
        opcode: o.opcode,
        inputs: o.inputs && typeof o.inputs === 'object' ? o.inputs : {},
        fields: o.fields && typeof o.fields === 'object' ? o.fields : {},
        loc: { file: st.file, line: lineNo, col },
    };
    if (o.mutation !== undefined) b.mutation = o.mutation;
    if (o.proc !== undefined) b.proc = o.proc;
    if (o.comment && typeof o.comment.text === 'string') {
        const c: Comment = { text: o.comment.text, loc: { file: st.file, line: lineNo, col } };
        if (typeof o.comment.anchor === 'string') c.anchor = o.comment.anchor;
        if (o.comment.minimized === true) c.minimized = true;
        resolveCommentAnchor(st, c);
        b.comment = c;
    }
    return b;
}

function rawLine(jsonText: string, st: PState, lineNo: number, col: number): void {
    const b = parseRawJson(jsonText, st, lineNo, col);
    if (!b) return;
    appendBlock(st, b);
    st.cur.openComment = null;
    st.cur.lineNo = lineNo;
    if (b.opcode === 'procedures_definition' && b.proc) {
        // `!`-escaped definition: track args for the body that follows.
        const { placeholders } = splitProccode(b.proc.proccode);
        st.defArgs = new Map(b.proc.argumentnames.map((n, i) => [n, placeholders[i] ?? '%s'] as [string, string]));
    }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** Parse full text. */
export function parseScripts(text: string, ctx: FormatCtx): { scripts: Script[]; diagnostics: Diagnostic[] } {
    const tables = loadTables(ctx);
    const st: PState = {
        ctx,
        tables,
        diags: [],
        scripts: [],
        cur: newBuilder(),
        defs: [],
        defArgs: null,
        seenAnchors: new Set(),
        file: ctx.file,
    };
    const lines = text.split('\n');
    // Pass 1: collect custom-block definitions for call matching.
    lines.forEach((raw, idx) => {
        const line = raw.replace(/\r$/, '');
        if (/^\s*define\b/.test(line)) {
            const rest = line.replace(/^\s*define\b/, '');
            try {
                const h = parseDefineHeader(stripDefineComment(rest));
                if (!st.defs.some((d) => d.proccode === h.proccode)) {
                    st.defs.push({ proccode: h.proccode, placeholders: h.placeholders, argNames: h.argNames, line: idx + 1 });
                }
            } catch {
                /* reported in pass 2 */
            }
        }
    });
    // Pass 2.
    lines.forEach((raw, idx) => {
        const lineNo = idx + 1;
        const line = raw.replace(/\r$/, '');
        if (/^\s*$/.test(line)) {
            st.cur.openComment = null;
            return;
        }
        const lstripped = line.replace(/^\s*/, '');
        const col = line.length - lstripped.length + 1;
        // Anchor header.
        const am = lstripped.match(/^@(\w+)\s*(.*)$/);
        if (am) {
            finishScript(st);
            st.cur = newBuilder();
            if (st.seenAnchors.has(am[1])) {
                st.diags.push({ message: `duplicate anchor @${am[1]}: treated as new`, file: st.file, line: lineNo, col, severity: 'warning' });
            } else {
                st.seenAnchors.add(am[1]);
                st.cur.anchor = am[1];
            }
            st.defArgs = null;
            const rest = am[2].trim();
            if (rest !== '' && !rest.startsWith('//')) {
                err(st, lineNo, col, `unexpected text after anchor @${am[1]}`);
            }
            return;
        }
        // Comment line (trailing spaces are significant: keep them).
        if (lstripped.startsWith('//')) {
            const pc = parseCommentRemainder(lstripped.slice(2));
            const tail = currentTail(st);
            if (tail && st.cur.openComment) {
                tail.comment!.text += '\n' + pc.text;
            } else if (tail) {
                const c: Comment = { text: pc.text, loc: { file: st.file, line: lineNo, col } };
                if (pc.anchor) c.anchor = pc.anchor;
                if (pc.minimized === true) c.minimized = true;
                resolveCommentAnchor(st, c);
                // Duplicate [cN] links: second occurrence becomes a new comment.
                tail.comment = c;
                st.cur.openComment = { owner: tail };
            } else {
                st.cur.pendingLead.push({ text: pc.text, anchor: pc.anchor, minimized: pc.minimized });
            }
            return;
        }
        // end / else.
        if (/^end(\s|\/|$)/.test(lstripped) && (lstripped === 'end' || lstripped.startsWith('end ') || lstripped.startsWith('end//') || lstripped.startsWith('end //') || /^end\s/.test(lstripped))) {
            const f = st.cur.frames.pop();
            if (!f) {
                err(st, lineNo, col, `"end" without an open if/repeat/forever block`);
                return;
            }
            st.cur.openComment = null;
            st.cur.lineNo = lineNo;
            return;
        }
        if (/^else(\s|\/|$)/.test(lstripped) && (lstripped === 'else' || lstripped.startsWith('else ') || lstripped.startsWith('else//') || lstripped.startsWith('else //') || /^else\s/.test(lstripped))) {
            const f = st.cur.frames[st.cur.frames.length - 1];
            if (!f) {
                err(st, lineNo, col, `"else" without an open if block`);
                return;
            }
            if (f.block.opcode !== 'control_if_else' && f.block.opcode !== 'control_if') {
                err(st, lineNo, col, `"else" needs "if ... then", this block is "${f.block.opcode}"`);
                return;
            }
            if (f.block.opcode === 'control_if') {
                // An `else` upgrades the if: same SUBSTACK, plus SUBSTACK2.
                f.block.opcode = 'control_if_else';
                f.slots = ['SUBSTACK', 'SUBSTACK2'];
                f.tails = [f.tails[0], undefined];
            }
            if (f.idx !== 0) {
                err(st, lineNo, col, `duplicate "else"`);
                return;
            }
            f.idx = 1;
            st.cur.openComment = null;
            return;
        }
        // Raw escape.
        if (lstripped.startsWith('!')) {
            rawLine(lstripped.slice(1), st, lineNo, col);
            return;
        }
        // Define.
        if (/^define(\s|$)/.test(lstripped)) {
            const rest = lstripped.replace(/^define(\s|$)/, '');
            const header = parseDefineHeader(stripDefineComment(rest));
            if (header.error) err(st, lineNo, col, header.error);
            if (st.defs.filter((d) => d.proccode === header.proccode).length > 1) {
                err(st, lineNo, col, `duplicate procedure definition "${header.proccode}"`);
            }
            if (st.cur.top) {
                st.diags.push({ message: `"define ..." starts a new script`, file: st.file, line: lineNo, col, severity: 'warning' });
                startScript(st);
            }
            const b: Block = {
                opcode: 'procedures_definition',
                inputs: {},
                fields: {},
                proc: { proccode: header.proccode, argumentnames: header.argNames, argumentdefaults: header.argDefaults, warp: header.warp },
                loc: { file: st.file, line: lineNo, col },
            };
            const rc = trailingCommentOf(rest);
            st.cur.openComment = null;
            appendBlock(st, b);
            if (rc.slash !== null || rc.star) attachTrailingComment(st, b, rc.slash, lineNo, rc.star);
            st.defArgs = new Map(header.argNames.map((n, i) => [n, header.placeholders[i] ?? '%s'] as [string, string]));
            st.cur.lineNo = lineNo;
            return;
        }
        blockLine(lstripped, st, lineNo, col);
    });
    finishScript(st);
    return { scripts: st.scripts, diagnostics: st.diags };
}

function stripDefineComment(rest: string): string {
    // Remove trailing // and [star] comments outside brackets.
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < rest.length - 1; i++) {
        const c = rest[i];
        if (inStr) {
            if (c === '\\') i++;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
            continue;
        }
        if (c === '\\') {
            i++;
            continue;
        }
        if (c === '(' || c === '[' || c === '<') depth++;
        else if (c === ')' || c === ']' || c === '>') depth--;
        else if (c === '/' && rest[i + 1] === '/' && depth === 0) return rest.slice(0, i);
        else if (c === '/' && rest[i + 1] === '*' && depth === 0) {
            const end = rest.indexOf('*/', i + 2);
            if (end >= 0) return rest.slice(0, i) + rest.slice(end + 2);
        }
    }
    return rest;
}

function trailingCommentOf(rest: string): { slash: string | null; star: { text: string; anchor?: string; minimized?: boolean } | null } {
    // Collect [star] stars outside brackets/quotes, plus a trailing //.
    let text = '';
    let star: { text: string; anchor?: string; minimized?: boolean } | null = null;
    let depth = 0;
    let inStr = false;
    let i = 0;
    const pushStar = (content: string): void => {
        const pc = parseStarContent(content);
        const found = { text: pc.text, anchor: pc.anchor, minimized: pc.minimized };
        star = star ? { text: `${star.text}\n${found.text}`, anchor: star.anchor ?? found.anchor, minimized: star.minimized ?? found.minimized } : found;
    };
    while (i < rest.length) {
        const c = rest[i];
        if (inStr) {
            text += c;
            if (c === '\\' && i + 1 < rest.length) {
                text += rest[i + 1];
                i += 2;
                continue;
            }
            if (c === '"') inStr = false;
            i++;
            continue;
        }
        if (c === '"') {
            inStr = true;
            text += c;
            i++;
            continue;
        }
        if ((c === '(' || c === '[' || c === '<') && depth >= 0) {
            depth++;
            text += c;
            i++;
            continue;
        }
        if ((c === ')' || c === ']' || c === '>') && depth > 0) {
            depth--;
            text += c;
            i++;
            continue;
        }
        if (c === '/' && rest[i + 1] === '*' && depth === 0) {
            const end = rest.indexOf('*/', i + 2);
            if (end < 0) {
                text += c;
                i++;
                continue;
            }
            pushStar(rest.slice(i + 2, end));
            i = end + 2;
            continue;
        }
        if (c === '/' && rest[i + 1] === '/' && depth === 0) break;
        text += c;
        i++;
    }
    const tail = rest.slice(i);
    if (tail.trim() === '') return { slash: null, star };
    const m = tail.match(/^[ \t]*\/\//);
    if (!m) return { slash: null, star };
    return { slash: tail.slice(m[0].length), star };
}
