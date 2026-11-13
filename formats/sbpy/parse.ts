/**
 * sbpy parser: Python-like text -> IR scripts + diagnostics.
 *
 * Hand-written tokenizer + recursive-descent structure parser (no
 * dependencies). Single-line statements; suites via indentation (spaces
 * only). See AGENTS.md for the full language description.
 */
import type { Block, Comment, Diagnostic, FormatCtx, Input, Script } from '../../packages/core/ir.ts';
import { getBlockSpec } from '../../packages/core/catalog/index.ts';
import {
    aliasToOpcode,
    defaultTag,
    isBroadcastSlot,
    isMenuSlot,
    nearest,
    parseQuoted,
    resolveOpcode,
    splitTopLevel,
} from './shared.ts';

// ---------------------------------------------------------------------------
// Line tokenizer
// ---------------------------------------------------------------------------

interface Tok {
    n: number; // 1-based line number
    indent: number; // leading spaces; -1 for blank
    col: number; // 1-based column of first non-space char
    kind: 'blank' | 'anchor' | 'hash' | 'code';
    anchor?: string; // 'a12' / 'c3' for anchor lines
    hash?: string; // comment text for hash lines (after `#`, minus one space)
    code?: string; // statement text (comment stripped, right-trimmed)
    comment?: string; // trailing `#` text, undefined when absent
    hasColon?: boolean; // code ends with ':' (outside strings)
}

function splitCommentLine(rest: string): { code: string; comment?: string } {
    let inStr: string | null = null;
    for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if (inStr) {
            if (c === '\\') {
                i++;
                continue;
            }
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            continue;
        }
        if (c === '#') {
            const after = rest.slice(i + 1);
            return { code: rest.slice(0, i).trimEnd(), comment: after.startsWith(' ') ? after.slice(1) : after };
        }
    }
    return { code: rest.trimEnd() };
}

function endsWithColon(code: string): boolean {
    let inStr: string | null = null;
    let last = '';
    for (let i = 0; i < code.length; i++) {
        const c = code[i];
        if (inStr) {
            if (c === '\\') {
                i++;
                continue;
            }
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            continue;
        }
        if (c !== ' ' && c !== '\t') last = c;
    }
    return last === ':';
}

function tokenize(text: string, file: string, diags: Diagnostic[]): Tok[] {
    const toks: Tok[] = [];
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; li++) {
        const raw = lines[li].endsWith('\r') ? lines[li].slice(0, -1) : lines[li];
        let indent = 0;
        let badTab = false;
        while (indent < raw.length && (raw[indent] === ' ' || raw[indent] === '\t')) {
            if (raw[indent] === '\t') badTab = true;
            indent++;
        }
        const n = li + 1;
        const rest = raw.slice(indent);
        if (badTab) {
            diags.push({ message: `line ${n}: tabs are not allowed for indentation; use spaces`, file, line: n, col: 1, severity: 'error' });
        }
        if (rest === '') {
            toks.push({ n, indent: -1, col: 1, kind: 'blank' });
            continue;
        }
        const col = indent + 1;
        if (rest.startsWith('@')) {
            const m = /^@([ac])(\d+)$/.exec(rest);
            if (m) {
                toks.push({ n, indent, col, kind: 'anchor', anchor: `${m[1]}${m[2]}` });
            } else {
                diags.push({
                    message: `line ${n}: bad anchor "${rest}"; anchors look like @a1 (scripts) or @c2 (comments)`,
                    file,
                    line: n,
                    col,
                    severity: 'error',
                });
            }
            continue;
        }
        if (rest.startsWith('#')) {
            const body = rest.slice(1);
            toks.push({ n, indent, col, kind: 'hash', hash: body.startsWith(' ') ? body.slice(1) : body });
            continue;
        }
        const { code, comment } = splitCommentLine(rest);
        if (code === '') {
            toks.push({ n, indent: -1, col: 1, kind: 'blank' });
            continue;
        }
        toks.push({ n, indent, col, kind: 'code', code, comment, hasColon: endsWithColon(code) });
    }
    return toks;
}

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

interface Ctx {
    file: string;
    diags: Diagnostic[];
    varNames: string[];
    listNames: string[];
    varSet: Set<string>;
    listSet: Set<string>;
}

function err(ctx: Ctx, tok: Tok, message: string): void {
    ctx.diags.push({ message: `line ${tok.n}: ${message}`, file: ctx.file, line: tok.n, col: tok.col, severity: 'error' });
}

function warn(ctx: Ctx, tok: Tok, message: string): void {
    ctx.diags.push({ message: `line ${tok.n}: ${message}`, file: ctx.file, line: tok.n, col: tok.col, severity: 'warning' });
}

function locOf(ctx: Ctx, tok: Tok): { file: string; line: number; col: number } {
    return { file: ctx.file, line: tok.n, col: tok.col };
}

/** Strip the minimized marker (inverse of the printer's escaping). */
function parseCommentText(text: string): { text: string; minimized?: boolean } {
    if (text === '[min]' || text.startsWith('[min] ')) {
        return { text: text === '[min]' ? '' : text.slice('[min] '.length), minimized: true };
    }
    if (text === '\\[min]' || text.startsWith('\\[min] ')) {
        return { text: text.slice(1) };
    }
    return { text };
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

type Slot = { kind: 'value'; opcode: string; input: string } | { kind: 'top' };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

function slotDefaultTag(slot: Slot): number {
    if (slot.kind === 'value') return defaultTag(slot.opcode, slot.input);
    return 10;
}

/** Plain string/number in a value slot: literal, menu or broadcast by slot kind. */
function coerceScalar(ctx: Ctx, tok: Tok, slot: Slot, value: string | number, tag: number | undefined): Input {
    if (slot.kind === 'value' && tag === undefined) {
        if (isBroadcastSlot(slot.opcode, slot.input)) return { kind: 'broadcast', name: String(value) };
        if (isMenuSlot(slot.opcode, slot.input)) return { kind: 'menu', value: String(value) };
    }
    const dt = slotDefaultTag(slot);
    return { kind: 'literal', value, litType: tag ?? dt };
}

function allOpcodeNames(): string[] {
    return [...new Set([...aliasToOpcode.keys(), ...aliasToOpcode.values()])];
}

function parseNameArg(ctx: Ctx, tok: Tok, text: string): string | null {
    const s = text.trim();
    if ((s.startsWith('"') || s.startsWith("'")) && s.length >= 2) {
        try {
            const { value, next } = parseQuoted(s, 0);
            if (s.slice(next).trim() !== '') {
                err(ctx, tok, `unexpected text after name string`);
                return null;
            }
            return value;
        } catch (e) {
            err(ctx, tok, `bad name string: ${(e as Error).message}`);
            return null;
        }
    }
    err(ctx, tok, `expected a quoted name like "score", got "${s.slice(0, 20)}"`);
    return null;
}

interface CallArgs {
    positionals: string[];
    kwargs: Array<{ name: string; text: string }>;
}

function parseArgList(tok: Tok, ctx: Ctx, inner: string): CallArgs {
    const out: CallArgs = { positionals: [], kwargs: [] };
    if (inner.trim() === '') return out;
    for (const part of splitTopLevel(inner)) {
        if (part.trim() === '') continue;
        const eq = findTopEq(part);
        if (eq >= 0) {
            // Argument names are usually catalog input/field names, but
            // procedure-call arguments (and wild files) can use arbitrary
            // labels, including empty ones. Validate at assignment time.
            const rawName = part.slice(0, eq).trim();
            if (/[\s'"()[\]{}=,;:]/.test(rawName)) {
                err(ctx, tok, `bad argument name "${rawName.slice(0, 20)}"; names look like STEPS or height`);
                continue;
            }
            out.kwargs.push({ name: rawName, text: part.slice(eq + 1).trim() });
        } else {
            out.positionals.push(part.trim());
        }
    }
    return out;
}

function findTopEq(s: string): number {
    let dParen = 0;
    let dBrack = 0;
    let dBrace = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '"' || c === "'") {
            try {
                i = parseQuoted(s, i).next - 1;
            } catch {
                return -1;
            }
            continue;
        }
        if (c === '(') dParen++;
        else if (c === ')') dParen--;
        else if (c === '[') dBrack++;
        else if (c === ']') dBrack--;
        else if (c === '{') dBrace++;
        else if (c === '}') dBrace--;
        else if (c === '=' && dParen === 0 && dBrack === 0 && dBrace === 0) {
            if (s[i + 1] === '=') return -1;
            return i;
        }
    }
    return -1;
}

const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;

function tryParseNumber(s: string): { value: number; next: number } | null {
    const m = NUM_RE.exec(s);
    if (!m) return null;
    if (/[A-Za-z_]/.test(s[m[0].length] ?? '')) return null;
    return { value: Number(m[0]), next: m[0].length };
}

/** Parse one expression; used for value inputs, proc-call args and bare lines. */
function parseExpr(ctx: Ctx, tok: Tok, text: string, slot: Slot): Input {
    const s = text.trim();
    const fallback = (): Input => ({ kind: 'literal', value: '', litType: slotDefaultTag(slot) });
    if (s === '') {
        err(ctx, tok, 'expected a value but found nothing');
        return fallback();
    }
    const ch = s[0];
    if (ch === '"' || ch === "'") {
        try {
            const { value, next } = parseQuoted(s, 0);
            const rest = s.slice(next).trim();
            if (rest !== '') err(ctx, tok, `unexpected text after string: "${rest.slice(0, 20)}"`);
            return coerceScalar(ctx, tok, slot, value, undefined);
        } catch (e) {
            err(ctx, tok, `bad string literal: ${(e as Error).message}`);
            return fallback();
        }
    }
    const num = tryParseNumber(s);
    if (num) {
        const rest = s.slice(num.next).trim();
        if (rest !== '') err(ctx, tok, `unexpected text after number: "${rest.slice(0, 20)}"`);
        return coerceScalar(ctx, tok, slot, num.value, undefined);
    }
    if (s === 'true' || s === 'false') {
        return coerceScalar(ctx, tok, slot, s, undefined);
    }
    if (s === 'none' || s === 'None') {
        err(ctx, tok, 'None is only allowed inside mutation {...}');
        return fallback();
    }
    if (s[0] === '[' || s[0] === '{') {
        err(ctx, tok, 'lists/dicts are only allowed inside mutation {...}');
        return fallback();
    }
    const m = IDENT.exec(s);
    if (!m) {
        err(ctx, tok, `cannot parse value "${s.slice(0, 30)}"`);
        return fallback();
    }
    const name = m[0];
    const rest = s.slice(name.length).trim();
    if (!rest.startsWith('(')) {
        const cands = nearest(name, allOpcodeNames(), 3);
        err(ctx, tok, `unknown value "${name}"${cands.length ? `; did you mean ${cands.map((c) => `"${c}"`).join(', ')}?` : ''}`);
        return fallback();
    }
    if (!rest.endsWith(')')) {
        err(ctx, tok, `unbalanced parentheses in "${s.slice(0, 40)}"`);
        return fallback();
    }
    const inner = rest.slice(1, -1);
    if (name === 'var' || name === 'list' || name === 'broadcast') {
        const a = parseArgList(tok, ctx, inner);
        if (a.positionals.length !== 1 || a.kwargs.length !== 0) {
            err(ctx, tok, `${name}("name") takes exactly one name argument`);
            return fallback();
        }
        const nm = parseNameArg(ctx, tok, a.positionals[0]);
        if (nm === null) return fallback();
        if (name === 'var' || name === 'list') checkKnownName(ctx, tok, name === 'var' ? 'variable' : 'list', nm);
        return name === 'var' ? { kind: 'var', name: nm } : name === 'list' ? { kind: 'list', name: nm } : { kind: 'broadcast', name: nm };
    }
    if (name === 'arg' || name === 'barg') {
        const a = parseArgList(tok, ctx, inner);
        if (a.positionals.length !== 1 || a.kwargs.length !== 0) {
            err(ctx, tok, `${name}("name") takes exactly one argument name`);
            return fallback();
        }
        const nm = parseNameArg(ctx, tok, a.positionals[0]);
        if (nm === null) return fallback();
        return {
            kind: 'block',
            block: {
                opcode: name === 'arg' ? 'argument_reporter_string_number' : 'argument_reporter_boolean',
                inputs: {},
                fields: { VALUE: { value: nm } },
                loc: locOf(ctx, tok),
            },
        };
    }
    if (name === 'lit') {
        return parseLitCall(ctx, tok, inner, slot);
    }
    if (name === 'menu') {
        const a = parseArgList(tok, ctx, inner);
        if (a.positionals.length !== 1 || a.kwargs.length !== 0) {
            err(ctx, tok, 'menu("name") takes exactly one menu value');
            return fallback();
        }
        const nm = parseNameArg(ctx, tok, a.positionals[0]);
        if (nm === null) return fallback();
        return { kind: 'menu', value: nm };
    }
    if (name === 'call') {
        return { kind: 'block', block: parseCallBlock(ctx, tok, inner) };
    }
    const opcode = resolveOpcode(name);
    if (!opcode) {
        const cands = nearest(name, allOpcodeNames(), 3).map((c) => {
            const spec = getBlockSpec(c);
            return spec ? `"${c}" (${spec.text.en})` : `"${c}"`;
        });
        err(ctx, tok, `unknown block "${name}"; did you mean ${cands.join(', ')}? (short aliases like "movesteps" also work)`);
        return fallback();
    }
    const block = parseBlockCall(ctx, tok, opcode, inner);
    const shape = getBlockSpec(opcode)?.shape;
    // Mirror extract: these reporters collapse to references.
    if (opcode === 'data_variable' && Object.keys(block.inputs).length === 0) {
        return { kind: 'var', name: block.fields['VARIABLE']?.value ?? '' };
    }
    if (opcode === 'data_listcontents' && Object.keys(block.inputs).length === 0) {
        return { kind: 'list', name: block.fields['LIST']?.value ?? '' };
    }
    if (shape === 'menu' && slot.kind === 'value') {
        const entries = Object.entries(block.fields);
        if (entries.length === 1) {
            if (isBroadcastSlot(slot.opcode, slot.input)) {
                const fspec = getBlockSpec(opcode)?.fields.find((f) => f.name === entries[0][0]);
                if (fspec?.kind === 'broadcast') return { kind: 'broadcast', name: entries[0][1].value };
            }
            if (isMenuSlot(slot.opcode, slot.input)) return { kind: 'menu', value: entries[0][1].value };
        }
    }
    if (shape === 'stack' || shape === 'cap' || shape === 'hat' || shape === 'definition' || shape === 'prototype') {
        err(ctx, tok, `"${opcode}" is a ${shape} block and cannot be used inside a value`);
    } else if (shape === 'c' || shape === 'c2' || shape === 'end-c') {
        err(ctx, tok, `"${opcode}" is a C-block and cannot nest inline; in raw blocks use "input NAME:" with an indented value below`);
    } else if (shape === 'menu') {
        err(ctx, tok, `"${opcode}" is a menu block; use its plain value (e.g. "myself") instead`);
    }
    return { kind: 'block', block };
}

function parseLitCall(ctx: Ctx, tok: Tok, inner: string, slot: Slot): Input {
    const fallback = (): Input => ({ kind: 'literal', value: '', litType: slotDefaultTag(slot) });
    const a = parseArgList(tok, ctx, inner);
    const kwargs = new Map(a.kwargs.map((k) => [k.name, k.text]));
    const vText = a.positionals[0] ?? kwargs.get('value');
    const tText = a.positionals[1] ?? kwargs.get('tag');
    if (vText === undefined) {
        err(ctx, tok, 'lit(value, tag=N) needs a value');
        return fallback();
    }
    for (const k of kwargs.keys()) {
        if (k !== 'value' && k !== 'tag') err(ctx, tok, `lit() has no argument "${k}"`);
    }
    const v = vText.trim();
    let value: string | number;
    if (v.startsWith('"') || v.startsWith("'")) {
        try {
            const r = parseQuoted(v, 0);
            if (v.slice(r.next).trim() !== '') err(ctx, tok, 'unexpected text after string in lit()');
            value = r.value;
        } catch (e) {
            err(ctx, tok, `bad string in lit(): ${(e as Error).message}`);
            value = '';
        }
    } else {
        const n = tryParseNumber(v);
        if (!n || v.slice(n.next).trim() !== '') {
            err(ctx, tok, `lit() value must be a number or a quoted string, got "${v.slice(0, 20)}"`);
            value = v;
        } else {
            value = n.value;
        }
    }
    if (tText === undefined) {
        err(ctx, tok, 'lit() needs an explicit tag, e.g. lit("10", tag=4)');
        return { kind: 'literal', value, litType: slotDefaultTag(slot) };
    }
    const n = tryParseNumber(tText.trim());
    if (!n || tText.trim().slice(n.next).trim() !== '' || !Number.isInteger(n.value) || n.value < 4 || n.value > 13) {
        err(ctx, tok, `lit() tag must be an integer 4..13, got "${tText.trim().slice(0, 20)}"`);
        return { kind: 'literal', value, litType: slotDefaultTag(slot) };
    }
    return { kind: 'literal', value, litType: n.value };
}

function checkKnownName(ctx: Ctx, tok: Tok, kind: 'variable' | 'list', name: string): void {
    const set = kind === 'variable' ? ctx.varSet : ctx.listSet;
    if (set.has(name)) return;
    const cands = nearest(name, kind === 'variable' ? ctx.varNames : ctx.listNames, 3);
    const hint = cands.length ? `; did you mean ${cands.map((c) => `"${c}"`).join(', ')}?` : '';
    const stage = kind === 'variable' ? 'a Stage (global) variable' : 'a Stage (global) list';
    warn(
        ctx,
        tok,
        `unknown ${kind} "${name}" (not declared on this target's target.json${hint}; if it is ${stage}, make sure it exists)`,
    );
}

/** Parse a JSON-ish value (mutations, arrays, dicts). */
function parseJsonVal(ctx: Ctx, tok: Tok, text: string): unknown {
    const s = text.trim();
    if (s === '') {
        err(ctx, tok, 'expected a value but found nothing');
        return '';
    }
    const ch = s[0];
    if (ch === '"' || ch === "'") {
        try {
            const { value, next } = parseQuoted(s, 0);
            if (s.slice(next).trim() !== '') err(ctx, tok, 'unexpected text after string');
            return value;
        } catch (e) {
            err(ctx, tok, `bad string: ${(e as Error).message}`);
            return '';
        }
    }
    const num = tryParseNumber(s);
    if (num && s.slice(num.next).trim() === '') return num.value;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'none' || s === 'None' || s === 'null') return null;
    if (s[0] === '[') {
        if (!s.endsWith(']')) {
            err(ctx, tok, 'unbalanced [ ... ]');
            return [];
        }
        const inner = s.slice(1, -1);
        if (inner.trim() === '') return [];
        return splitTopLevel(inner).map((part) => parseJsonVal(ctx, tok, part));
    }
    if (s[0] === '{') {
        if (!s.endsWith('}')) {
            err(ctx, tok, 'unbalanced { ... }');
            return {};
        }
        const inner = s.slice(1, -1);
        const obj: Record<string, unknown> = {};
        if (inner.trim() === '') return obj;
        for (const part of splitTopLevel(inner)) {
            if (part.trim() === '') continue;
            const eq = findTopEq(part);
            const colon = part.indexOf(':');
            if (eq >= 0 && (colon < 0 || eq < colon)) {
                obj[String(parseJsonVal(ctx, tok, part.slice(0, eq)))] = parseJsonVal(ctx, tok, part.slice(eq + 1));
            } else if (colon >= 0) {
                obj[String(parseJsonVal(ctx, tok, part.slice(0, colon)))] = parseJsonVal(ctx, tok, part.slice(colon + 1));
            } else {
                err(ctx, tok, `bad dict entry "${part.trim().slice(0, 30)}"; use "key": value`);
            }
        }
        return obj;
    }
    err(ctx, tok, `cannot parse value "${s.slice(0, 30)}"`);
    return s;
}

// ---------------------------------------------------------------------------
// Block calls
// ---------------------------------------------------------------------------

/** Build a Block from `opcode(...)`. Never parses suites (callers handle bodies). */
function parseBlockCall(ctx: Ctx, tok: Tok, opcode: string, inner: string): Block {
    const spec = getBlockSpec(opcode);
    const block: Block = { opcode, inputs: {}, fields: {}, loc: locOf(ctx, tok) };
    const a = parseArgList(tok, ctx, inner);
    if (!spec) {
        // Unknown opcode: best-effort. Plain strings become fields, every
        // other value becomes an input; `mutation=` is honored. For exact
        // control use the `raw` form.
        if (a.positionals.length > 0) {
            err(ctx, tok, `unknown block "${opcode}" takes no positional arguments; use the raw form for exact control`);
        }
        for (const k of a.kwargs) {
            if (k.name === 'mutation') {
                const v = parseJsonVal(ctx, tok, k.text);
                if (v && typeof v === 'object' && !Array.isArray(v)) block.mutation = v as Record<string, unknown>;
                else err(ctx, tok, 'mutation must be an object like {"tagName": "mutation", ...}');
                continue;
            }
            const t = k.text.trim();
            if (t.startsWith('"') || t.startsWith("'")) {
                try {
                    const r = parseQuoted(t, 0);
                    if (t.slice(r.next).trim() !== '') err(ctx, tok, 'unexpected text after string');
                    block.fields[k.name] = { value: r.value };
                } catch (e) {
                    err(ctx, tok, `bad string: ${(e as Error).message}`);
                }
            } else {
                block.inputs[k.name] = parseExpr(ctx, tok, t, { kind: 'value', opcode, input: k.name });
            }
        }
        return block;
    }
    const order = spec.args.filter(
        (x) => !(x.kind === 'input' && spec.inputs.find((i) => i.name === x.input)?.kind === 'stack'),
    );
    if (a.positionals.length > order.length) {
        const names = order.map((x) => (x.kind === 'input' ? x.input : x.field)).join(', ');
        err(ctx, tok, `"${opcode}" takes at most ${order.length} positional argument(s) (${names}); use NAME=value for the rest`);
    }
    const seen = new Set<string>();
    const assign = (name: string, text: string): void => {
        if (seen.has(name)) {
            err(ctx, tok, `duplicate argument "${name}" (keeping the first)`);
            return;
        }
        seen.add(name);
        const argSpec = spec.args.find((x) => (x.kind === 'input' ? x.input === name : x.field === name));
        if (!argSpec) {
            const cands = nearest(name, [...spec.inputs.map((i) => i.name), ...spec.fields.map((f) => f.name)], 3);
            err(ctx, tok, `unknown argument "${name}" for "${opcode}"${cands.length ? `; did you mean ${cands.map((c) => `"${c}"`).join(', ')}?` : ''}`);
            return;
        }
        if (argSpec.kind === 'input') {
            const ispec = spec.inputs.find((i) => i.name === name) as { kind: string };
            if (ispec.kind === 'stack') {
                err(ctx, tok, `"${name}" is a body slot; put its blocks in an indented block below`);
                return;
            }
            block.inputs[name] = parseExpr(ctx, tok, text, { kind: 'value', opcode, input: name });
        } else {
            block.fields[name] = parseFieldValue(ctx, tok, opcode, name, text);
        }
    };
    a.positionals.slice(0, order.length).forEach((p, i) => {
        const target = order[i];
        assign(target.kind === 'input' ? target.input : target.field, p);
    });
    for (const k of a.kwargs) {
        if (k.name === 'mutation' && !spec.inputs.some((i) => i.name === 'mutation') && !spec.fields.some((f) => f.name === 'mutation') && opcode !== 'procedures_call') {
            const v = parseJsonVal(ctx, tok, k.text);
            if (v && typeof v === 'object' && !Array.isArray(v)) block.mutation = v as Record<string, unknown>;
            else err(ctx, tok, 'mutation must be an object like {"tagName": "mutation", ...}');
            continue;
        }
        assign(k.name, k.text);
    }
    return block;
}

function parseFieldValue(ctx: Ctx, tok: Tok, opcode: string, field: string, text: string): { value: string } {
    const spec = getBlockSpec(opcode);
    const fspec = spec?.fields.find((f) => f.name === field);
    const s = text.trim();
    const cm = /^(var|list|broadcast)\s*\((.*)\)$/.exec(s);
    if (cm) {
        const nm = parseNameArg(ctx, tok, cm[2]);
        const want = fspec?.kind === 'variable' ? 'var' : fspec?.kind === 'list' ? 'list' : fspec?.kind === 'broadcast' ? 'broadcast' : null;
        if (nm !== null && (want === null || want === cm[1])) {
            if (want === 'var') checkKnownName(ctx, tok, 'variable', nm);
            else if (want === 'list') checkKnownName(ctx, tok, 'list', nm);
            return { value: nm };
        }
    }
    if ((s.startsWith('"') || s.startsWith("'")) && s.length >= 2) {
        try {
            const r = parseQuoted(s, 0);
            if (s.slice(r.next).trim() !== '') {
                err(ctx, tok, `unexpected text after string`);
                return { value: '' };
            }
            checkDropdown(ctx, tok, opcode, fspec, field, r.value);
            return { value: r.value };
        } catch (e) {
            err(ctx, tok, `bad string: ${(e as Error).message}`);
            return { value: '' };
        }
    }
    const num = tryParseNumber(s);
    if (num && s.slice(num.next).trim() === '') {
        const v = String(num.value);
        checkDropdown(ctx, tok, opcode, fspec, field, v);
        return { value: v };
    }
    if (s === 'true' || s === 'false') {
        checkDropdown(ctx, tok, opcode, fspec, field, s);
        return { value: s };
    }
    err(ctx, tok, `field "${field}" of "${opcode}" expects a quoted name like "score", got "${s.slice(0, 20)}"`);
    return { value: '' };
}

function checkDropdown(
    ctx: Ctx,
    tok: Tok,
    opcode: string,
    fspec: { kind: string; options?: Array<[string, string]> } | undefined,
    field: string,
    value: string,
): void {
    if (!fspec) return;
    if (fspec.kind === 'variable' || fspec.kind === 'list') {
        checkKnownName(ctx, tok, fspec.kind, value);
        return;
    }
    if (fspec.kind === 'dropdown' && fspec.options && fspec.options.length > 0) {
        const values = new Set(fspec.options.map((o) => o[1]));
        if (!values.has(value)) {
            warn(
                ctx,
                tok,
                `unexpected value "${value}" for "${field}" of "${opcode}"; valid options: ${[...values].map((v) => `"${v}"`).join(', ')}`,
            );
        }
    }
}

/** `call("proccode", arg=value, ...)` -> procedures_call block. */
function parseCallBlock(ctx: Ctx, tok: Tok, inner: string): Block {
    const fallback: Block = {
        opcode: 'procedures_call',
        inputs: {},
        fields: {},
        proc: { proccode: '', argumentnames: [], argumentdefaults: [], warp: false },
        loc: locOf(ctx, tok),
    };
    const a = parseArgList(tok, ctx, inner);
    if (a.positionals.length === 0) {
        err(ctx, tok, 'call needs a procedure code string first, e.g. call("jump %n", height=10)');
        return fallback;
    }
    if (a.positionals.length > 1) {
        err(ctx, tok, 'call takes one positional argument (the procedure code); pass arguments as name=value');
    }
    const codeText = a.positionals[0].trim();
    if ((codeText.startsWith('"') || codeText.startsWith("'")) && codeText.length >= 2) {
        try {
            const r = parseQuoted(codeText, 0);
            if (codeText.slice(r.next).trim() !== '') err(ctx, tok, 'unexpected text after procedure code string');
            else fallback.proc = { proccode: r.value, argumentnames: [], argumentdefaults: [], warp: false };
        } catch (e) {
            err(ctx, tok, `bad procedure code string: ${(e as Error).message}`);
        }
    } else {
        err(ctx, tok, `call needs a quoted procedure code first, got "${codeText.slice(0, 20)}"`);
    }
    for (const k of a.kwargs) {
        if (k.name === 'mutation') {
            err(ctx, tok, 'call builds its own mutation; do not pass mutation=');
            continue;
        }
        fallback.inputs[k.name] = parseExpr(ctx, tok, k.text, { kind: 'value', opcode: 'procedures_call', input: k.name });
    }
    return fallback;
}

// ---------------------------------------------------------------------------
// Structure parser
// ---------------------------------------------------------------------------

type Role = 'hat' | 'stack' | 'reporter';

interface Stray {
    texts: string[];
    tok: Tok;
}

interface PNode {
    tok: Tok;
    block: Block;
    role: Role;
    thenStmts?: PNode[];
    elseStmts?: PNode[];
    thenStray?: Stray[];
    elseStray?: Stray[];
    rawStacks?: Array<{ name: string; stmts: PNode[]; stray: Stray[] }>;
}

interface Pending {
    a?: { anchor: string; tok: Tok };
    c?: { anchor: string; tok: Tok };
    hash: Array<{ indent: number; text: string; tok: Tok }>;
    /** Anchors are "bound" once a `#` run starts right below them (no blank
     *  between); a blank line then flushes hash+bound anchors as a workspace
     *  comment, while unbound anchors stay pending for the next statement. */
    bound?: boolean;
    blankSinceAnchor?: boolean;
}

interface Parser {
    ctx: Ctx;
    toks: Tok[];
    pos: number;
    scripts: Script[];
    /** Open hatless chain at top level (null when none). */
    open: { script: Script; tail: Block } | null;
    pend: Pending;
}

function makeComment(ctx: Ctx, tok: Tok, texts: string[], anchor: string | undefined): Comment {
    const { text, minimized } = parseCommentText(texts.join('\n'));
    const c: Comment = { text, loc: locOf(ctx, tok) };
    if (minimized === true) c.minimized = true;
    if (anchor !== undefined) c.anchor = anchor;
    return c;
}

/** Flush pending `#` lines as a workspace comment script. */
function flushWorkspace(p: Parser, texts: string[], tok: Tok, anchorA?: string, anchorC?: string): void {
    if (texts.length === 0) return;
    const comment = makeComment(p.ctx, tok, texts, anchorC);
    const script: Script = { kind: 'comment', comment, loc: locOf(p.ctx, tok) };
    if (anchorA !== undefined) script.anchor = anchorA;
    p.scripts.push(script);
}

/** Blank line: a bound `#` run becomes a workspace comment; chain closes. */
function onBlank(p: Parser): void {
    if (p.pend.hash.length > 0) {
        const texts = p.pend.hash.map((h) => h.text);
        const tok = p.pend.hash[0].tok;
        if (p.pend.bound) {
            flushWorkspace(p, texts, tok, p.pend.a?.anchor, p.pend.c?.anchor);
            p.pend.a = undefined;
            p.pend.c = undefined;
            p.pend.bound = undefined;
        } else {
            flushWorkspace(p, texts, tok);
        }
        p.pend.hash = [];
    }
    p.pend.blankSinceAnchor = true;
    p.open = null;
}

function pushAnchor(p: Parser, tok: Tok, anchor: string): void {
    if (anchor.startsWith('a')) {
        if (p.pend.a) {
            err(p.ctx, tok, `duplicate script anchor @${anchor} (keeping @${p.pend.a.anchor})`);
            return;
        }
        p.open = null;
        p.pend.a = { anchor, tok };
    } else {
        if (p.pend.c) {
            err(p.ctx, tok, `duplicate comment anchor @${anchor} (keeping @${p.pend.c.anchor})`);
            return;
        }
        p.pend.c = { anchor, tok };
    }
    p.pend.blankSinceAnchor = false;
}

function bindAnchors(p: Parser): void {
    if (!p.pend.blankSinceAnchor && (p.pend.a || p.pend.c)) p.pend.bound = true;
}

/** Attach pending leading `#` + the line's trailing `#` to a block. */
function attachComment(p: Parser, tok: Tok, block: Block, codeIndent: number): void {
    const leading = p.pend.hash.length > 0 && p.pend.hash[0].indent === codeIndent ? p.pend.hash : [];
    if (p.pend.hash.length > 0 && leading.length === 0) {
        const texts = p.pend.hash.map((h) => h.text);
        const first = p.pend.hash[0].tok;
        if (p.pend.bound) {
            flushWorkspace(p, texts, first, p.pend.a?.anchor, p.pend.c?.anchor);
            p.pend.a = undefined;
            p.pend.c = undefined;
            p.pend.bound = undefined;
        } else {
            flushWorkspace(p, texts, first);
        }
    }
    p.pend.hash = [];
    const texts = leading.map((h) => h.text);
    if (tok.comment !== undefined) texts.push(tok.comment);
    if (texts.length === 0 && !p.pend.c) {
        p.pend.bound = undefined;
        return;
    }
    if (texts.length === 0 && p.pend.c) {
        err(p.ctx, tok, `comment anchor @${p.pend.c.anchor} has no comment text; the anchor is dropped`);
        p.pend.c = undefined;
        p.pend.bound = undefined;
        return;
    }
    block.comment = makeComment(p.ctx, leading[0]?.tok ?? tok, texts, p.pend.c?.anchor);
    p.pend.c = undefined;
    p.pend.bound = undefined;
}

function emitStackScript(p: Parser, block: Block, anchor: string | undefined): void {
    const script: Script = { kind: 'stack', top: block, loc: block.loc };
    if (anchor !== undefined) script.anchor = anchor;
    p.scripts.push(script);
    p.open = { script, tail: block };
}

/**
 * Recursive suite parser: consumes toks with indent > minIndent.
 * `stopAtElse` lets an if_else header claim its `else:`.
 */
function parseLevel(p: Parser, minIndent: number, stopAtElse: boolean): { stmts: PNode[]; elseTok?: Tok; stray: Stray[] } {
    const stmts: PNode[] = [];
    const stray: Stray[] = [];
    // The indent of the first statement in this suite; deeper lines without
    // an intervening header, or shallower lines matching no open level, are
    // agent mistakes (reported, then read as siblings).
    let bodyIndent = -1;
    const drainPass = (tok: Tok): void => {
        const texts: string[] = [];
        let first: Tok | undefined;
        for (const h of p.pend.hash) {
            if (h.indent > minIndent) {
                texts.push(h.text);
                first ??= h.tok;
            }
        }
        p.pend.hash = p.pend.hash.filter((h) => h.indent <= minIndent);
        if (tok.comment !== undefined) {
            texts.push(tok.comment);
            first ??= tok;
        }
        if (texts.length > 0 && first) stray.push({ texts, tok: first });
    };
    while (p.pos < p.toks.length) {
        const tok = p.toks[p.pos];
        if (tok.kind === 'blank') {
            onBlank(p);
            p.pos++;
            continue;
        }
        if (tok.indent <= minIndent) {
            if (tok.kind === 'code' && stopAtElse && tok.indent === minIndent) {
                const c = (tok.code as string).trim();
                const bareElse = tok.hasColon ? c.slice(0, -1).trimEnd() : c;
                if (bareElse === 'else' && tok.hasColon) return { stmts, elseTok: tok, stray };
            }
            break;
        }
        if (tok.kind === 'anchor') {
            if (tok.anchor?.startsWith('a')) {
                err(p.ctx, tok, `script anchor @${tok.anchor} is only allowed at the top level; it is ignored`);
            } else {
                pushAnchor(p, tok, tok.anchor as string);
            }
            p.pos++;
            continue;
        }
        if (tok.kind === 'hash') {
            p.pend.hash.push({ indent: tok.indent, text: tok.hash ?? '', tok });
            bindAnchors(p);
            p.pos++;
            continue;
        }
        const code = (tok.code as string).trim();
        if (bodyIndent < 0) bodyIndent = tok.indent;
        if (tok.indent > bodyIndent) {
            err(p.ctx, tok, `unexpected indent (this block uses ${bodyIndent} spaces); the line is read as part of it`);
        } else if (tok.indent < bodyIndent) {
            err(p.ctx, tok, `inconsistent indent (expected ${bodyIndent} spaces like the lines above); the line is read as part of this block`);
        }
        const bare = tok.hasColon ? code.slice(0, -1).trimEnd() : code;
        if (bare === 'pass') {
            drainPass(tok);
            p.pos++;
            continue;
        }
        if (bare === 'else' && tok.hasColon) {
            err(p.ctx, tok, 'else without a matching "if ... :" header above it');
            p.pos++;
            continue;
        }
        const node = parseHeaderOrStatement(p, tok, code, false);
        if (node) stmts.push(node);
    }
    return { stmts, stray };
}

function isCish(shape: string | undefined): boolean {
    return shape === 'c' || shape === 'c2' || shape === 'end-c';
}

/** Parse one header/statement line; consumes its suite when it opens one. */
function parseHeaderOrStatement(p: Parser, tok: Tok, code: string, isTop: boolean): PNode | null {
    const body = tok.hasColon ? code.slice(0, code.lastIndexOf(':')).trimEnd() : code;
    if (/^define(\s|$)/.test(body)) return parseDefine(p, tok, body);
    if (/^raw(\s|$)/.test(body)) return parseRaw(p, tok, body);
    if (/^(field|input|stack|mutation)(\s|$)/.test(body)) {
        err(p.ctx, tok, `"${body.split(/\s/)[0]}" lines only belong directly inside a raw "...": block`);
        if (tok.hasColon) skipSuite(p, tok.indent);
        else p.pos++;
        return null;
    }
    const nameM = IDENT.exec(body);
    if (!nameM) {
        err(p.ctx, tok, `cannot parse "${code.slice(0, 40)}"`);
        if (tok.hasColon) skipSuite(p, tok.indent);
        else p.pos++;
        return null;
    }
    const name = nameM[0];
    const rest = body.slice(name.length).trim();
    const isCtor = name === 'var' || name === 'list' || name === 'broadcast' || name === 'arg' || name === 'barg' || name === 'lit' || name === 'menu';
    if (name === 'call') {
        if (!rest.startsWith('(') || !rest.endsWith(')')) {
            err(p.ctx, tok, 'call needs the form call("procedure code", arg=value, ...)');
            if (tok.hasColon) skipSuite(p, tok.indent);
            else p.pos++;
            return null;
        }
        const block = parseCallBlock(p.ctx, tok, rest.slice(1, -1));
        attachComment(p, tok, block, tok.indent);
        if (tok.hasColon) {
            err(p.ctx, tok, '"call" takes no body; the indented block is skipped');
            skipSuite(p, tok.indent);
        } else {
            p.pos++;
        }
        return { tok, block, role: 'stack' };
    }
    if (isCtor) {
        if (!rest.startsWith('(') || !rest.endsWith(')')) {
            err(p.ctx, tok, `"${name}(...)" is a value, not a statement`);
            if (tok.hasColon) skipSuite(p, tok.indent);
            else p.pos++;
            return null;
        }
        if (tok.hasColon) {
            err(p.ctx, tok, 'a value cannot open a body; the indented block is skipped');
            skipSuite(p, tok.indent);
            return null;
        }
        const input = parseExpr(p.ctx, tok, body, { kind: 'top' });
        p.pos++;
        if (input.kind === 'block') {
            attachComment(p, tok, input.block, tok.indent);
            return { tok, block: input.block, role: 'reporter' };
        }
        if (input.kind === 'var' || input.kind === 'list') {
            const block: Block = {
                opcode: input.kind === 'var' ? 'data_variable' : 'data_listcontents',
                inputs: {},
                fields: input.kind === 'var' ? { VARIABLE: { value: input.name } } : { LIST: { value: input.name } },
                loc: locOf(p.ctx, tok),
            };
            attachComment(p, tok, block, tok.indent);
            return { tok, block, role: 'reporter' };
        }
        err(p.ctx, tok, `a ${input.kind} reference cannot stand alone as a statement`);
        return null;
    }
    if (!rest.startsWith('(')) {
        const cands = nearest(name, allOpcodeNames(), 3);
        err(p.ctx, tok, `unknown block "${name}"${cands.length ? `; did you mean ${cands.map((c) => `"${c}"`).join(', ')}?` : ''}`);
        if (tok.hasColon) skipSuite(p, tok.indent);
        else p.pos++;
        return null;
    }
    if (!rest.endsWith(')')) {
        err(p.ctx, tok, `unbalanced parentheses in "${code.slice(0, 40)}"`);
        if (tok.hasColon) skipSuite(p, tok.indent);
        else p.pos++;
        return null;
    }
    const opcode = resolveOpcode(name);
    if (!opcode) {
        const cands = nearest(name, allOpcodeNames(), 3).map((c) => {
            const spec = getBlockSpec(c);
            return spec ? `"${c}" (${spec.text.en})` : `"${c}"`;
        });
        err(p.ctx, tok, `unknown block "${name}"; did you mean ${cands.join(', ')}? (short aliases like "movesteps" also work)`);
        const block: Block = { opcode: name, inputs: {}, fields: {}, loc: locOf(p.ctx, tok) };
        const a = parseArgList(tok, p.ctx, rest.slice(1, -1));
        for (const k of a.kwargs) {
            if (k.name === 'mutation') continue;
            const t = k.text.trim();
            if (t.startsWith('"') || t.startsWith("'")) {
                try {
                    const r = parseQuoted(t, 0);
                    block.fields[k.name] = { value: r.value };
                } catch {
                    /* recorded */
                }
            } else {
                block.inputs[k.name] = parseExpr(p.ctx, tok, t, { kind: 'value', opcode: name, input: k.name });
            }
        }
        attachComment(p, tok, block, tok.indent);
        if (tok.hasColon) {
            err(p.ctx, tok, `the indented block under unknown "${name}" is skipped`);
            skipSuite(p, tok.indent);
        } else {
            p.pos++;
        }
        return { tok, block, role: 'stack' };
    }
    const shape = getBlockSpec(opcode)?.shape ?? 'stack';
    if (opcode === 'procedures_definition') {
        err(p.ctx, tok, '"procedures_definition" is internal; define custom blocks with the define "..." (...) [warp]: form');
    }
    if (shape === 'hat' || shape === 'definition') {
        if (!isTop) {
            err(p.ctx, tok, `"${opcode}" must start its own script at the top level; it and its body are skipped`);
            skipSuite(p, tok.indent);
            return null;
        }
        const block = parseBlockCall(p.ctx, tok, opcode, rest.slice(1, -1));
        attachComment(p, tok, block, tok.indent);
        p.pos++;
        if (!tok.hasColon) err(p.ctx, tok, `"${opcode}" opens a body; add ':' at the end of the line`);
        const sub = parseLevel(p, tok.indent, false);
        if (opcode === 'procedures_definition') {
            return { tok, block, role: 'hat', thenStmts: sub.stmts, thenStray: sub.stray };
        }
        return { tok, block, role: 'hat', thenStmts: sub.stmts, thenStray: sub.stray };
    }
    const block = parseBlockCall(p.ctx, tok, opcode, rest.slice(1, -1));
    attachComment(p, tok, block, tok.indent);
    if (isCish(shape)) {
        p.pos++;
        if (!tok.hasColon) err(p.ctx, tok, `"${opcode}" opens a body; add ':' at the end of the line`);
        const sub = parseLevel(p, tok.indent, shape === 'c2');
        if (shape === 'c2') {
            let elseStmts: PNode[] | undefined;
            let elseStray: Stray[] | undefined;
            if (sub.elseTok) {
                const elseTok = sub.elseTok;
                p.pos++; // consume else:
                if (elseTok.comment !== undefined) {
                    if (block.comment) block.comment.text += '\n' + elseTok.comment;
                    else block.comment = { text: elseTok.comment, loc: locOf(p.ctx, elseTok) };
                }
                const e = parseLevel(p, tok.indent, false);
                elseStmts = e.stmts;
                elseStray = e.stray;
            }
            return { tok, block, role: 'stack', thenStmts: sub.stmts, thenStray: sub.stray, elseStmts, elseStray };
        }
        return { tok, block, role: 'stack', thenStmts: sub.stmts, thenStray: sub.stray };
    }
    if (tok.hasColon) {
        err(p.ctx, tok, `"${opcode}" takes no body; the indented block is skipped`);
        skipSuite(p, tok.indent);
        return { tok, block, role: shape === 'reporter' || shape === 'boolean' || shape === 'argument' ? 'reporter' : 'stack' };
    }
    p.pos++;
    if (shape === 'reporter' || shape === 'boolean' || shape === 'argument') {
        return { tok, block, role: 'reporter' };
    }
    if (shape === 'menu' || shape === 'prototype') {
        err(p.ctx, tok, `"${opcode}" cannot be used as a statement; it is kept so nothing is lost`);
    }
    return { tok, block, role: 'stack' };
}

/** Skip an indented suite (after an error), flushing stray comments to workspace. */
function skipSuite(p: Parser, headerIndent: number): void {
    p.pos++;
    while (p.pos < p.toks.length) {
        const tok = p.toks[p.pos];
        if (tok.kind === 'blank') {
            onBlank(p);
            p.pos++;
            continue;
        }
        if (tok.indent <= headerIndent) break;
        if (tok.kind === 'hash') {
            p.pend.hash.push({ indent: tok.indent, text: tok.hash ?? '', tok });
            bindAnchors(p);
        }
        if (tok.kind === 'anchor') {
            err(p.ctx, tok, `anchor @${tok.anchor} is dropped with the skipped block`);
        }
        p.pos++;
    }
    if (p.pend.hash.length > 0) {
        const texts = p.pend.hash.map((h) => h.text);
        flushWorkspace(p, texts, p.pend.hash[0].tok);
        p.pend.hash = [];
    }
}

/** Extract the balanced bracket body starting at s[0]; returns inner + rest. */
function balancedInner(s: string, open: string, close: string): { inner: string; rest: string } | null {
    if (!s.startsWith(open)) return null;
    let inStr: string | null = null;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (c === '\\') {
                i++;
                continue;
            }
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            continue;
        }
        if (c === open) depth++;
        else if (c === close) {
            depth--;
            if (depth === 0) return { inner: s.slice(1, i), rest: s.slice(i + 1) };
        }
    }
    return null;
}

/** Parse one define parameter: name, <bool>, name="dflt", "quoted name", ... */
function parseOneParam(t: string): { name: string; dflt: string; isBool: boolean } | null {
    let s = t;
    let isBool = false;
    if (s.startsWith('<')) {
        if (!s.endsWith('>')) return null;
        isBool = true;
        s = s.slice(1, -1).trim();
    }
    let name = '';
    if (s.startsWith('"') || s.startsWith("'")) {
        try {
            const r = parseQuoted(s, 0);
            name = r.value;
            s = s.slice(r.next).trimStart();
        } catch {
            return null;
        }
    } else {
        const eq = s.indexOf('=');
        if (eq < 0) {
            name = s.trim();
            s = '';
        } else {
            name = s.slice(0, eq).trim();
            s = s.slice(eq);
        }
    }
    let dflt = '';
    if (s !== '') {
        if (!s.startsWith('=')) return null;
        const d = s.slice(1).trimStart();
        if (!d.startsWith('"') && !d.startsWith("'")) return null;
        try {
            const r = parseQuoted(d, 0);
            if (d.slice(r.next).trim() !== '') return null;
            dflt = r.value;
        } catch {
            return null;
        }
    }
    return { name, dflt, isBool };
}

function parseDefine(p: Parser, tok: Tok, body: string): PNode | null {
    // define "proccode" (params) [warp] [defaults=[...]]:
    // The `defaults=[...]` clause only appears when the base project has an
    // argumentdefaults array whose length differs from the parameter count
    // (wild-file drift); it round-trips the array verbatim.
    const fail = (): null => {
        err(p.ctx, tok, 'define needs the form define "label %n ..." (args) [warp]: e.g. define "jump %n" (height) [warp]:');
        if (tok.hasColon) skipSuite(p, tok.indent);
        else p.pos++;
        return null;
    };
    let rest = body.slice('define'.length).trimStart();
    if (!rest.startsWith('"') && !rest.startsWith("'")) return fail();
    let proccode = '';
    try {
        const r = parseQuoted(rest, 0);
        proccode = r.value;
        rest = rest.slice(r.next).trimStart();
    } catch (e) {
        err(p.ctx, tok, `bad procedure code string: ${(e as Error).message}`);
        return fail();
    }
    if (!rest.startsWith('(')) return fail();
    const inner = balancedInner(rest, '(', ')');
    if (inner === null) return fail();
    rest = inner.rest.trimStart();
    let warp = false;
    if (rest.startsWith('[warp]')) {
        warp = true;
        rest = rest.slice('[warp]'.length).trimStart();
    }
    let verbatimDefaults: string[] | null = null;
    if (rest.startsWith('defaults')) {
        const dm = /^defaults\s*=\s*/.exec(rest);
        if (!dm || rest[dm[0].length] !== '[') return fail();
        const jb = balancedInner(rest.slice(dm[0].length), '[', ']');
        if (jb === null) return fail();
        try {
            const v = JSON.parse('[' + jb.inner + ']') as unknown;
            if (!Array.isArray(v)) {
                err(p.ctx, tok, 'defaults=[...] must be an array of strings');
                return fail();
            }
            // Wild files carry non-string defaults; extract coerces with
            // String(), so do the same here.
            verbatimDefaults = v.map((x) => String(x));
        } catch {
            err(p.ctx, tok, 'defaults=[...] must be valid JSON, e.g. defaults=["", "1"]');
            return fail();
        }
        rest = jb.rest.trimStart();
    }
    if (rest !== '') return fail();
    const holders = proccode.match(/%[snb]/g) ?? [];
    const names: string[] = [];
    const defaults: string[] = [];
    const bools: boolean[] = [];
    const paramsInner = inner.inner;
    if (paramsInner.trim() !== '') {
        for (const part of splitTopLevel(paramsInner)) {
            const t = part.trim();
            // Empty names are legal (wild projects use them); keep them so
            // the parameter list stays aligned with the proccode.
            if (t === '') {
                names.push('');
                defaults.push('');
                bools.push(false);
                continue;
            }
            const one = parseOneParam(t);
            if (!one) {
                err(p.ctx, tok, `bad parameter "${t}"; use name, <boolname>, name="default" or <boolname>="default" (quote tricky names: "my, name")`);
                names.push('');
                defaults.push('');
                bools.push(false);
                continue;
            }
            names.push(one.name);
            defaults.push(one.dflt);
            bools.push(one.isBool);
        }
    }
    if (names.length !== holders.length) {
        warn(
            p.ctx,
            tok,
            `define "${proccode}" declares ${holders.length} placeholder(s) (${holders.join(' ') || 'none'}) but lists ${names.length} parameter(s)`,
        );
    }
    holders.forEach((h, i) => {
        if (names[i] === undefined) return;
        if (h === '%b' && !bools[i]) warn(p.ctx, tok, `parameter ${i + 1} ("${names[i]}") is boolean (%b); write it as <${names[i]}>`);
        if (h !== '%b' && bools[i]) warn(p.ctx, tok, `parameter ${i + 1} ("${names[i]}") is not boolean; write it as ${names[i]}`);
    });
    const block: Block = {
        opcode: 'procedures_definition',
        inputs: {},
        fields: {},
        proc: { proccode, argumentnames: names, argumentdefaults: verbatimDefaults ?? defaults, warp },
        loc: locOf(p.ctx, tok),
    };
    attachComment(p, tok, block, tok.indent);
    p.pos++;
    if (!tok.hasColon) err(p.ctx, tok, "define opens a body; add ':' at the end of the line");
    const sub = parseLevel(p, tok.indent, false);
    return { tok, block, role: 'hat', thenStmts: sub.stmts, thenStray: sub.stray };
}

function appendRawRemark(p: Parser, block: Block, texts: string[], tok: Tok): void {
    const { text } = parseCommentText(texts.join('\n'));
    if (block.comment) block.comment.text += '\n' + text;
    else block.comment = { text, loc: locOf(p.ctx, tok) };
}

function parseRaw(p: Parser, tok: Tok, body: string): PNode | null {
    const m = /^raw\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.exec(body);
    if (!m) {
        err(p.ctx, tok, 'raw needs the form raw "opcode": with field/input/stack/mutation lines below');
        if (tok.hasColon) skipSuite(p, tok.indent);
        else p.pos++;
        return null;
    }
    let opcode = '';
    try {
        opcode = parseQuoted(m[1], 0).value;
    } catch (e) {
        err(p.ctx, tok, `bad opcode string: ${(e as Error).message}`);
    }
    if (opcode === 'procedures_definition' || opcode === 'procedures_prototype') {
        err(p.ctx, tok, `"${opcode}" is internal; define custom blocks with the define form`);
    }
    const block: Block = { opcode, inputs: {}, fields: {}, loc: locOf(p.ctx, tok) };
    attachComment(p, tok, block, tok.indent);
    const spec = getBlockSpec(opcode);
    if (opcode === 'procedures_call') {
        const mut = block.mutation;
        void mut;
    }
    p.pos++;
    if (!tok.hasColon) err(p.ctx, tok, "raw opens a parameter block; add ':' at the end of the line");
    const bodyIndent = tok.indent;
    const rawStacks: Array<{ name: string; stmts: PNode[]; stray: Stray[] }> = [];
    const seen = new Set<string>();
    const claim = (t: Tok, kind: string, name: string): boolean => {
        const key = `${kind} ${name}`;
        if (seen.has(key)) {
            err(p.ctx, t, `duplicate ${kind} "${name}" (keeping the first)`);
            return false;
        }
        seen.add(key);
        return true;
    };
    for (;;) {
        while (p.pos < p.toks.length && p.toks[p.pos].kind === 'blank') {
            onBlank(p);
            p.pos++;
        }
        if (p.pos >= p.toks.length) break;
        const t = p.toks[p.pos];
        if (t.indent <= bodyIndent) break;
        if (t.kind === 'anchor') {
            err(p.ctx, t, `anchor @${t.anchor} inside a raw block is dropped`);
            p.pos++;
            continue;
        }
        if (t.kind === 'hash') {
            appendRawRemark(p, block, [t.hash ?? ''], t);
            p.pos++;
            continue;
        }
        const line = (t.code as string).trim();
        // Raw parameter lines: `stack NAME:` and `input NAME:` open suites
        // (colon required); the rest take `=` values (colon forbidden).
        const pline = t.hasColon ? line.slice(0, -1).trimEnd() : line;
        if (pline === 'pass') {
            if (t.comment !== undefined) appendRawRemark(p, block, [t.comment], t);
            p.pos++;
            continue;
        }
        let pm = /^field\s+([^\s=:,()]+)\s*=\s*(.+)$/.exec(pline);
        if (pm) {
            if (t.hasColon) err(p.ctx, t, 'unexpected ":" on a field line');
            if (claim(t, 'field', pm[1])) {
                if (spec && !spec.fields.some((f) => f.name === pm[1])) {
                    const cands = nearest(pm[1], spec.fields.map((f) => f.name), 3);
                    err(p.ctx, t, `unknown field "${pm[1]}" for "${opcode}"${cands.length ? `; did you mean ${cands.map((c) => `"${c}"`).join(', ')}?` : ''}`);
                } else {
                    block.fields[pm[1]] = parseFieldValue(p.ctx, t, opcode, pm[1], pm[2]);
                }
            }
            if (t.comment !== undefined) appendRawRemark(p, block, [t.comment], t);
            p.pos++;
            continue;
        }
        pm = /^input\s+([^\s=:,()]+)\s*=\s*(.+)$/.exec(pline);
        if (pm) {
            if (t.hasColon) err(p.ctx, t, 'unexpected ":" on an input line; use "input NAME:" with an indented value below for nested blocks');
            if (claim(t, 'input', pm[1])) {
                if (spec && !spec.inputs.some((i) => i.name === pm[1])) {
                    err(p.ctx, t, `unknown input "${pm[1]}" for "${opcode}"`);
                } else {
                    setRawInput(p, block, opcode, pm[1], t, pm[2]);
                }
            }
            if (t.comment !== undefined) appendRawRemark(p, block, [t.comment], t);
            p.pos++;
            continue;
        }
        pm = /^input\s+([^\s=:,()]+)\s*$/.exec(pline);
        if (pm && t.hasColon) {
            if (claim(t, 'input', pm[1])) {
                if (spec && !spec.inputs.some((i) => i.name === pm[1])) {
                    err(p.ctx, t, `unknown input "${pm[1]}" for "${opcode}"`);
                    skipSuite(p, t.indent);
                } else {
                    p.pos++;
                    const sub = parseLevel(p, t.indent, false);
                    const live = liveStmts(sub.stmts);
                    for (const s of sub.stray) appendRawRemark(p, block, s.texts, s.tok);
                    if (live.length === 0) {
                        // Empty value: omit the input (matches empty suites elsewhere).
                    } else {
                        if (live.length > 1) {
                            err(p.ctx, t, `"input ${pm[1]}:" holds a single value block, found ${live.length} (keeping the first)`);
                        }
                        const v = live[0];
                        materializeNode(p, v);
                        block.inputs[pm[1]] = { kind: 'block', block: v.block };
                    }
                }
            } else {
                if (t.hasColon) skipSuite(p, t.indent);
                else p.pos++;
            }
            continue;
        }
        pm = /^stack\s+([^\s=:,()]+)\s*$/.exec(pline);
        if (pm && t.hasColon) {
            if (claim(t, 'stack', pm[1])) {
                p.pos++;
                const sub = parseLevel(p, t.indent, false);
                rawStacks.push({ name: pm[1], stmts: sub.stmts, stray: sub.stray });
            } else {
                skipSuite(p, t.indent);
            }
            continue;
        }
        pm = /^mutation\s*=\s*(.+)$/.exec(line);
        if (pm) {
            if (t.hasColon) err(p.ctx, t, 'unexpected ":" on a mutation line');
            if (claim(t, 'mutation', '')) {
                const v = parseJsonVal(p.ctx, t, pm[1]);
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    block.mutation = v as Record<string, unknown>;
                } else {
                    err(p.ctx, t, 'mutation must be an object like {"tagName": "mutation", ...}');
                }
            }
            if (t.comment !== undefined) appendRawRemark(p, block, [t.comment], t);
            p.pos++;
            continue;
        }
        if (/^(field|input|stack|mutation)(\s|$)/.test(line)) {
            err(p.ctx, t, `cannot parse raw parameter "${line.slice(0, 40)}"`);
            if (t.hasColon) skipSuite(p, t.indent);
            else p.pos++;
            continue;
        }
        err(p.ctx, t, `expected field/input/stack/mutation inside raw "${opcode}", got "${line.slice(0, 40)}"`);
        if (t.hasColon) skipSuite(p, t.indent);
        else p.pos++;
    }
    if (block.opcode === 'procedures_call' && block.mutation && typeof block.mutation === 'object') {
        const proccode = String((block.mutation as Record<string, unknown>)['proccode'] ?? '');
        if (proccode !== '') {
            block.proc = { proccode, argumentnames: [], argumentdefaults: [], warp: false };
        } else {
            err(p.ctx, tok, 'raw "procedures_call" needs its mutation (with the procedure code) to round-trip; prefer the call("...") form');
        }
    }
    return { tok, block, role: 'stack', rawStacks };
}

function setRawInput(p: Parser, block: Block, opcode: string, name: string, tok: Tok, text: string): void {
    const v = parseExpr(p.ctx, tok, text.trim(), { kind: 'value', opcode, input: name });
    if (v.kind === 'block' && getBlockSpec(v.block.opcode)?.shape === 'menu') {
        const entries = Object.entries(v.block.fields);
        if (entries.length === 1 && isMenuSlot(opcode, name)) {
            block.inputs[name] = { kind: 'menu', value: entries[0][1].value };
            return;
        }
    }
    if (v.kind === 'block' && v.block.opcode === 'data_variable' && Object.keys(v.block.inputs).length === 0) {
        block.inputs[name] = { kind: 'var', name: v.block.fields['VARIABLE']?.value ?? '' };
        return;
    }
    if (v.kind === 'block' && v.block.opcode === 'data_listcontents' && Object.keys(v.block.inputs).length === 0) {
        block.inputs[name] = { kind: 'list', name: v.block.fields['LIST']?.value ?? '' };
        return;
    }
    block.inputs[name] = v;
}

// ---------------------------------------------------------------------------
// Materialization: nodes -> IR blocks/scripts
// ---------------------------------------------------------------------------

function liveStmts(stmts: PNode[]): PNode[] {
    return stmts.filter((s) => s.block.opcode !== '__pass__');
}

/** Materialize a suite; stray pass-remarks go to the owner block. */
function materializeSuite(p: Parser, stmts: PNode[], stray: Stray[], owner: Block): Block | undefined {
    const live = liveStmts(stmts);
    for (const s of live) materializeNode(p, s);
    let head: Block | undefined;
    let tail: Block | undefined;
    for (const s of live) {
        if (s.role === 'reporter') {
            err(p.ctx, s.tok, `"${s.block.opcode}" is a reporter; it cannot be used as a stack statement (nest it inside another block's input)`);
        }
        if (!head) head = s.block;
        if (tail) tail.next = s.block;
        tail = s.block;
    }
    if (tail) tail.next = undefined;
    for (const s of stray) appendRawRemark(p, owner, s.texts, s.tok);
    return head;
}

function materializeNode(p: Parser, s: PNode): void {
    const b = s.block;
    if (b.opcode === 'procedures_definition' && s.thenStmts) {
        b.next = materializeSuite(p, s.thenStmts, s.thenStray ?? [], b);
        return;
    }
    if (s.rawStacks) {
        for (const r of s.rawStacks) {
            if (r.stmts.length === 0) continue;
            const head = materializeSuite(p, r.stmts, r.stray, b);
            if (head) b.inputs[r.name] = { kind: 'stack', block: head };
        }
        return;
    }
    const shape = getBlockSpec(b.opcode)?.shape;
    if ((shape === 'c' || shape === 'end-c') && s.thenStmts) {
        const head = materializeSuite(p, s.thenStmts, s.thenStray ?? [], b);
        if (head) b.inputs['SUBSTACK'] = { kind: 'stack', block: head };
        return;
    }
    if (shape === 'c2' && s.thenStmts) {
        const head = materializeSuite(p, s.thenStmts, s.thenStray ?? [], b);
        if (head) b.inputs['SUBSTACK'] = { kind: 'stack', block: head };
        if (s.elseStmts) {
            const ehead = materializeSuite(p, s.elseStmts, s.elseStray ?? [], b);
            if (ehead) b.inputs['SUBSTACK2'] = { kind: 'stack', block: ehead };
        }
        return;
    }
    if (s.role === 'hat' && s.thenStmts) {
        b.next = materializeSuite(p, s.thenStmts, s.thenStray ?? [], b);
        return;
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseScripts(text: string, ctx: FormatCtx): { scripts: Script[]; diagnostics: Diagnostic[] } {
    const diags: Diagnostic[] = [];
    const toks = tokenize(text, ctx.file, diags);
    const targetJson = (ctx.targetJson ?? {}) as {
        variables?: Array<{ name?: string }>;
        lists?: Array<{ name?: string }>;
    };
    const varNames = Array.isArray(targetJson.variables) ? targetJson.variables.map((v) => String(v?.name ?? '')) : [];
    const listNames = Array.isArray(targetJson.lists) ? targetJson.lists.map((v) => String(v?.name ?? '')) : [];
    const pctx: Ctx = {
        file: ctx.file,
        diags,
        varNames,
        listNames,
        varSet: new Set(varNames),
        listSet: new Set(listNames),
    };
    const p: Parser = { ctx: pctx, toks, pos: 0, scripts: [], open: null, pend: { hash: [] } };
    while (p.pos < p.toks.length) {
        const tok = p.toks[p.pos];
        if (tok.kind === 'blank') {
            onBlank(p);
            p.pos++;
            continue;
        }
        if (tok.kind === 'anchor') {
            pushAnchor(p, tok, tok.anchor as string);
            p.pos++;
            continue;
        }
        if (tok.kind === 'hash') {
            p.pend.hash.push({ indent: tok.indent, text: tok.hash ?? '', tok });
            bindAnchors(p);
            p.pos++;
            continue;
        }
        if (tok.indent > 0) {
            err(pctx, tok, 'unexpected indent (no block opens a body here); the line is read at the top level');
            tok.indent = 0;
        }
        const code = (tok.code as string).trim();
        const bare = tok.hasColon ? code.slice(0, -1).trimEnd() : code;
        if (bare === 'pass') {
            if (tok.comment !== undefined) flushWorkspace(p, [tok.comment], tok);
            p.pos++;
            continue;
        }
        if (bare === 'else' && tok.hasColon) {
            err(pctx, tok, 'else without a matching "if ... :" header above it');
            p.pos++;
            continue;
        }
        const node = parseHeaderOrStatement(p, tok, code, true);
        if (!node) continue;
        materializeNode(p, node);
        placeTopNode(p, node);
    }
    if (p.pend.hash.length > 0) {
        const texts = p.pend.hash.map((h) => h.text);
        const anchorA = p.pend.a?.anchor;
        const anchorC = p.pend.c?.anchor;
        const comment = makeComment(pctx, p.pend.hash[0].tok, texts, anchorC);
        const script: Script = { kind: 'comment', comment, loc: locOf(pctx, p.pend.hash[0].tok) };
        if (anchorA !== undefined) script.anchor = anchorA;
        p.scripts.push(script);
        p.pend.hash = [];
        p.pend.a = undefined;
        p.pend.c = undefined;
        p.pend.bound = undefined;
    } else if (p.pend.a || p.pend.c) {
        const tok = (p.pend.a ?? p.pend.c) as { tok: Tok };
        warn(pctx, tok.tok, `dangling anchor @${p.pend.a?.anchor ?? p.pend.c?.anchor} with no script; it is ignored`);
    }
    return { scripts: p.scripts, diagnostics: diags };
}

/** Place one top-level node per the chain/anchor/hat rules. */
function placeTopNode(p: Parser, node: PNode): void {
    const b = node.block;
    const anchor = p.pend.a?.anchor;
    p.pend.a = undefined;
    p.pend.bound = undefined;
    if (node.role === 'hat') {
        p.open = null;
        const script: Script = { kind: 'stack', top: b, loc: b.loc };
        if (anchor !== undefined) script.anchor = anchor;
        p.scripts.push(script);
        return;
    }
    if (node.role === 'reporter') {
        p.open = null;
        const script: Script = { kind: 'reporter', top: b, loc: b.loc };
        if (anchor !== undefined) script.anchor = anchor;
        p.scripts.push(script);
        return;
    }
    if (p.open) {
        let tail = p.open.tail;
        const seen = new Set<Block>();
        while (tail.next && !seen.has(tail.next)) {
            seen.add(tail);
            tail = tail.next;
        }
        tail.next = b;
        p.open.tail = b;
        return;
    }
    emitStackScript(p, b, anchor);
}
