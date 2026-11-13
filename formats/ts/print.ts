/**
 * IR -> TypeScript text.
 *
 * Every script is exactly one top-level statement:
 * - hat scripts: `whenFlagClicked(() => { ... });`
 * - plain stacks: `script(() => { ... });`
 * - custom blocks: `define("jump %n", { warp: true }, (height = 10) => { ... });`
 * - workspace comments: `comment("text", { minimized: true });`
 * - top-level reporters: a bare expression like `vars.score;` or `add(1, 2);`
 *
 * Anchors print as `// @a1` above the script; attached comments as `//`
 * lines directly above the owning statement (`//-` prefix = minimized).
 */
import type { Block, Comment, FormatCtx, Input, Script } from '../../packages/core/ir.ts';
import { getBlockSpec, type BlockSpec } from '../../packages/core/catalog/index.ts';
import { fnNameFor, isDotName, sanitizeParam } from './names.ts';

export const SHADOW_TAG: Record<string, number> = {
    math_number: 4,
    math_positive_number: 5,
    math_whole_number: 6,
    math_integer: 7,
    math_angle: 8,
    colour_picker: 9,
    text: 10,
};

/** Extra input roles for kind:'any' (or ambiguous) inputs. */
const INPUT_ROLE: Record<string, Record<string, 'value' | 'menu'>> = {
    event_whentouchingobject: { TOUCHINGOBJECTMENU: 'menu' },
};

const MENU_KINDS = new Set(['menu', 'costume', 'sound']);

function inputSpec(opcode: string, name: string) {
    return getBlockSpec(opcode)?.inputs.find((i) => i.name === name);
}

function expectedTag(opcode: string, inputName: string, jsType: 'number' | 'string' | 'boolean'): number {
    const spec = inputSpec(opcode, inputName);
    if (spec?.shadowOpcode && SHADOW_TAG[spec.shadowOpcode] !== undefined) return SHADOW_TAG[spec.shadowOpcode];
    // note/matrix/any/boolean kinds without a catalog shadow: numbers act like
    // math_number, strings act like text.
    return jsType === 'number' ? 4 : 10;
}

/** Procedure proccode -> placeholder kinds ('s' | 'n' | 'b') in order. */
export function proccodePlaceholders(proccode: string): string[] {
    const out: string[] = [];
    for (const m of proccode.matchAll(/%([snb])/g)) out.push(m[1]);
    return out;
}

export interface ProcScope {
    /** Original argument names in order. */
    argNames: string[];
    /** param identifier -> original argument name. */
    paramToArg: Map<string, string>;
    /** Original argument names that are boolean (%b). */
    booleanArgs: Set<string>;
}

const NO_SCOPE: ProcScope = { argNames: [], paramToArg: new Map(), booleanArgs: new Set() };

const q = (s: string): string => JSON.stringify(s);

function member(root: 'vars' | 'lists', name: string): string {
    return isDotName(name) ? `${root}.${name}` : `${root}[${q(name)}]`;
}

function commentLines(c: Comment | undefined, indent: string): string[] {
    if (!c) return [];
    const prefix = c.minimized === true ? '//-' : '//';
    return String(c.text).split('\n').map((line) => (line ? `${indent}${prefix} ${line}` : `${indent}${prefix}`));
}

function printLiteralValue(v: string | number | boolean): string {
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return q(v);
}

function withCommentWrap(b: Block, expr: string): string {
    if (!b.comment) return expr;
    const t = q(b.comment.text);
    const opts: string[] = [];
    if (b.comment.minimized === true) opts.push('minimized: true');
    if (b.comment.anchor) opts.push(`anchor: ${q(b.comment.anchor)}`);
    return opts.length > 0 ? `withComment(${expr}, ${t}, { ${opts.join(', ')} })` : `withComment(${expr}, ${t})`;
}

function anchorLines(c: Comment | undefined, indent: string): string[] {
    if (c?.anchor && /^c\d+$/.test(c.anchor)) return [`${indent}// @${c.anchor}`];
    return [];
}

function printInputValue(
    ownerOpcode: string,
    inputName: string,
    input: Input,
    scope: ProcScope,
    specKnown: boolean,
    indent: string,
): string {
    switch (input.kind) {
        case 'stack':
            return printStackArrow(input.block, scope, indent);
        case 'block':
            return withCommentWrap(input.block, printBlockExpr(input.block, scope, indent));
        case 'var':
            return member('vars', input.name);
        case 'list':
            return member('lists', input.name);
        case 'broadcast': {
            const spec = inputSpec(ownerOpcode, inputName);
            if (specKnown && spec && spec.kind === 'broadcast') return q(input.name);
            return `bcast(${q(input.name)})`;
        }
        case 'menu': {
            const spec = inputSpec(ownerOpcode, inputName);
            const role = INPUT_ROLE[ownerOpcode]?.[inputName];
            if (specKnown && spec && (MENU_KINDS.has(spec.kind) || role === 'menu')) return q(input.value);
            return `menu(${q(input.value)})`;
        }
        case 'literal': {
            const spec = inputSpec(ownerOpcode, inputName);
            const role = INPUT_ROLE[ownerOpcode]?.[inputName];
            const jsType = typeof input.value === 'number' ? 'number' : typeof input.value === 'boolean' ? 'boolean' : 'string';
            if (specKnown && spec && (spec.kind === 'broadcast' || MENU_KINDS.has(spec.kind)) && jsType === 'string' && role !== 'value') {
                // A raw literal hiding in a menu/broadcast slot: keep it explicit.
                return `lit(${printLiteralValue(input.value as string | number)}, ${input.litType ?? 10})`;
            }
            if (specKnown && role === 'menu') return `lit(${printLiteralValue(input.value as string | number)}, ${input.litType ?? 10})`;
            const want = specKnown ? expectedTag(ownerOpcode, inputName, jsType) : jsType === 'number' ? 4 : 10;
            if ((input.litType ?? want) === want) return printLiteralValue(input.value as string | number);
            return `lit(${printLiteralValue(input.value as string | number)}, ${input.litType})`;
        }
    }
}

function printFieldValue(opcode: string, fieldName: string, value: string, specKnown: boolean): string {
    const spec = getBlockSpec(opcode)?.fields.find((f) => f.name === fieldName);
    const kind = spec?.kind ?? (fieldName === 'VARIABLE' ? 'variable' : fieldName === 'LIST' ? 'list' : fieldName === 'BROADCAST_OPTION' ? 'broadcast' : undefined);
    if (kind === 'variable') return member('vars', value);
    if (kind === 'list') return member('lists', value);
    void specKnown;
    return q(value);
}

/** Is this block node inlinable as a plain scalar (literal holder)? */
const HOLDER_OPCODES = new Set([
    'math_number',
    'math_positive_number',
    'math_whole_number',
    'math_integer',
    'math_angle',
    'text',
    'colour_picker',
    'note',
    'matrix',
]);

function holderScalar(b: Block): string | number | null {
    const f = b.fields?.NUM ?? b.fields?.TEXT ?? b.fields?.COLOUR ?? b.fields?.VALUE ?? b.fields?.MATRIX ?? b.fields?.NOTE;
    if (!f) return null;
    const v = f.value;
    if (b.opcode === 'text' || b.opcode === 'colour_picker' || b.opcode === 'matrix') return v;
    return v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
}

function printBodyArrow(head: Block | undefined, scope: ProcScope, indent: string): string {
    if (!head) return '() => {}';
    const inner = printChain(head, indent + '  ', scope);
    if (inner.length === 1 && !head.comment) {
        const single = inner[0].replace(/;$/, '');
        if (!single.includes('\n')) return `() => { ${single.trimStart()}; }`;
    }
    return `() => {\n${inner.join('\n')}\n${indent}}`;
}

function printStackArrow(head: Block | undefined, scope: ProcScope, indent: string): string {
    return printBodyArrow(head, scope, indent);
}

function printChain(head: Block, indent: string, scope: ProcScope): string[] {
    const lines: string[] = [];
    let cur: Block | undefined = head;
    const seen = new Set<Block>();
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        lines.push(...anchorLines(cur.comment, indent));
        lines.push(...commentLines(cur.comment, indent));
        lines.push(`${indent}${printBlockExpr(cur, scope, indent)};`);
        cur = cur.next;
    }
    return lines;
}

/**
 * Print one block as an expression. In statement position the caller appends
 * `;` (chain stitching is statement order, never nested).
 */
export function printBlockExpr(b: Block, scope: ProcScope, indent = ''): string {
    // Variable/list top reporters are handled by the caller; nested holder
    // blocks inline as scalars.
    if (b.opcode === 'procedures_call') return printCall(b, scope, indent);
    if (b.opcode === 'procedures_definition') return printDefine(b);
    if (b.opcode === 'data_variable' && b.fields?.VARIABLE) return member('vars', b.fields.VARIABLE.value);
    if (b.opcode === 'data_listcontents' && b.fields?.LIST) return member('lists', b.fields.LIST.value);
    if (b.opcode === 'argument_reporter_string_number' || b.opcode === 'argument_reporter_boolean') {
        const orig = b.fields?.VALUE?.value ?? '';
        const param = [...scope.paramToArg.entries()].find(([, o]) => o === orig)?.[0];
        if (param) return param;
        return q(orig);
    }
    if (HOLDER_OPCODES.has(b.opcode)) {
        const v = holderScalar(b);
        if (v !== null) return printLiteralValue(v);
    }
    const spec = getBlockSpec(b.opcode);
    if (!spec || needsGeneric(b, spec)) return printGeneric(b, !!spec, scope, indent);
    const fn = fnNameFor(b.opcode);
    const parts: string[] = [];
    for (const a of spec.args) {
        if (a.kind === 'field') {
            const f = b.fields[a.field];
            parts.push(f ? printFieldValue(b.opcode, a.field, f.value, true) : q(''));
            continue;
        }
        const inp = b.inputs[a.input];
        if (!inp) {
            const ispec = spec.inputs.find((i) => i.name === a.input);
            parts.push(ispec?.kind === 'stack' ? '() => {}' : 'undefined');
            continue;
        }
        parts.push(printInputValue(b.opcode, a.input, inp, scope, true, indent));
    }
    // Hat bodies and C-block substacks are already trailing arrows; a hat with
    // no script body still needs its callback for the script wrapper.
    return `${fn}(${parts.join(', ')})`;
}

/** Opcodes whose specific form cannot represent the node: use block(). */
function needsGeneric(b: Block, spec: BlockSpec): boolean {
    if (b.mutation !== undefined) return true; // opaque mutation (e.g. control_stop hasnext)
    if (spec.shape === 'menu') return true;
    if (b.opcode === 'procedures_prototype' || b.opcode === 'procedures_declaration') return true;
    return false;
}

function printGeneric(b: Block, specKnown: boolean, scope: ProcScope, indent: string): string {
    const inputs = Object.entries(b.inputs);
    const fields = Object.entries(b.fields);
    const args: string[] = [q(b.opcode)];
    const sections: string[] = [];
    if (inputs.length > 0) {
        const parts = inputs.map(([k, v]) => `${q(k)}: ${printInputValue(b.opcode, k, v, scope, specKnown, indent)}`);
        sections.push(`inputs: { ${parts.join(', ')} }`);
    }
    if (fields.length > 0) {
        const parts = fields.map(([k, f]) => {
            const spec = getBlockSpec(b.opcode)?.fields.find((x) => x.name === k);
            let val: string;
            if (spec?.kind === 'variable') val = member('vars', f.value);
            else if (spec?.kind === 'list') val = member('lists', f.value);
            else if (spec?.kind === 'broadcast') val = q(f.value);
            else val = q(f.value);
            return `${q(k)}: ${val}`;
        });
        sections.push(`fields: { ${parts.join(', ')} }`);
    }
    if (b.mutation !== undefined) sections.push(`mutation: ${JSON.stringify(b.mutation)}`);
    if (sections.length > 0) args.push(`{ ${sections.join(', ')} }`);
    return `block(${args.join(', ')})`;
}

function callArgOrder(b: Block): string[] {
    const names = b.proc?.argumentnames ?? [];
    const keys = Object.keys(b.inputs);
    const ordered = names.filter((n) => keys.includes(n));
    for (const k of keys) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
}

function printCall(b: Block, scope: ProcScope, indent: string): string {
    const proccode = b.proc?.proccode ?? '';
    const args = callArgOrder(b).map((k) => printInputValue(b.opcode, k, b.inputs[k], scope, false, indent));
    return `call(${q(proccode)}${args.length > 0 ? ', ' + args.join(', ') : ''})`;
}

function printDefine(b: Block): string {
    const proc = b.proc ?? { proccode: '', argumentnames: [], argumentdefaults: [], warp: false };
    const placeholders = proccodePlaceholders(proc.proccode);
    const taken = new Set<string>();
    const params = proc.argumentnames.map((orig, i) => {
        const safe = sanitizeParam(orig, taken);
        const dflt = proc.argumentdefaults[i] ?? '';
        const needComment = safe !== orig;
        const defStr = proc.argumentdefaults.length === proc.argumentnames.length && dflt !== '' ? ` = ${printDefault(dflt)}` : '';
        const cmt = needComment ? ` /* ${q(orig)} */` : '';
        void placeholders;
        return `${safe}${defStr}${cmt}`;
    });
    const mismatch = proc.argumentdefaults.length !== proc.argumentnames.length;
    const opts: string[] = [];
    if (proc.warp) opts.push('warp: true');
    if (mismatch) opts.push(`argumentDefaults: [${proc.argumentdefaults.map((d) => q(d)).join(', ')}]`);
    const head = opts.length > 0 ? `${q(proc.proccode)}, { ${opts.join(', ')} }, ` : `${q(proc.proccode)}, `;
    const scope = defineScope(proc);
    const inner = b.next ? printChain(b.next, '    ', scope) : [];
    const body = inner.length === 0 ? '{}' : `{\n${inner.join('\n')}\n  }`;
    // A definition's own attached comment prints above the statement (caller).
    return `define(${head}(${params.join(', ')}) => ${body})`;
}

function printDefault(d: string): string {
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(d)) return d;
    return q(d);
}

export function defineScope(proc: { proccode: string; argumentnames: string[] }): ProcScope {
    const placeholders = proccodePlaceholders(proc.proccode);
    const taken = new Set<string>();
    const paramToArg = new Map<string, string>();
    const booleanArgs = new Set<string>();
    proc.argumentnames.forEach((orig, i) => {
        paramToArg.set(sanitizeParam(orig, taken), orig);
        if (placeholders[i] === 'b') booleanArgs.add(orig);
    });
    return { argNames: [...proc.argumentnames], paramToArg, booleanArgs };
}

function hatCallArgs(b: Block, scope: ProcScope, indent: string): string {
    const spec = getBlockSpec(b.opcode);
    const parts: string[] = [];
    if (spec) {
        for (const a of spec.args) {
            if (a.kind === 'field') {
                const f = b.fields[a.field];
                parts.push(f ? printFieldValue(b.opcode, a.field, f.value, true) : q(''));
            } else {
                const inp = b.inputs[a.input];
                if (inp) parts.push(printInputValue(b.opcode, a.input, inp, scope, true, indent));
            }
        }
    }
    return parts.length > 0 ? parts.join(', ') + ', ' : '';
}

function printScript(s: Script, _ctx: FormatCtx): string[] {
    const lines: string[] = [];
    if (s.anchor) lines.push(`// @${s.anchor}`);
    if (s.kind === 'comment' && s.comment) {
        // Workspace comments carry their text in the call; never duplicate it
        // as // lines (those would merge back into the text on parse).
        const opts = s.comment.minimized === true ? ', { minimized: true }' : '';
        lines.push(`comment(${q(s.comment.text)}${opts});`);
        return lines;
    }
    const top = s.top;
    if (!top) return lines;
    if (top.opcode === 'procedures_definition') {
        lines.push(...anchorLines(top.comment, ''));
        lines.push(...commentLines(top.comment, ''));
        lines.push(`${printDefine(top)};`);
        return lines;
    }
    const shape = getBlockSpec(top.opcode)?.shape;
    const isReporterTop = shape === 'reporter' || shape === 'boolean' || top.opcode === 'data_variable' || top.opcode === 'data_listcontents';
    if (isReporterTop) {
        lines.push(...anchorLines(top.comment, ''));
        lines.push(...commentLines(top.comment, ''));
        lines.push(`${printBlockExpr(top, NO_SCOPE)};`);
        return lines;
    }
    if (shape === 'hat') {
        lines.push(...anchorLines(top.comment, ''));
        lines.push(...commentLines(top.comment, ''));
        const spec = getBlockSpec(top.opcode) as BlockSpec | undefined;
        const generic = !spec || needsGeneric(top, spec);
        const body = printBodyArrow(top.next, NO_SCOPE, '');
        if (!generic && spec) lines.push(`${fnNameFor(top.opcode)}(${hatCallArgs(top, NO_SCOPE, '')}${body});`);
        else {
            // Generic hat: block("opcode", {...}, {...}, mutation?, () => {...}).
            const core = printGeneric({ ...top, next: undefined }, !!spec, NO_SCOPE, '');
            lines.push(`${core.slice(0, -1)}, ${body});`);
        }
        return lines;
    }
    // Plain stack: one script() wrapper per script (printChain owns the top comment).
    const inner = printChain(top, '  ', NO_SCOPE);
    lines.push(`script(() => {`);
    lines.push(...inner);
    lines.push(`});`);
    return lines;
}

export function printScripts(scripts: Script[], ctx: FormatCtx): string {
    if (scripts.length === 0) return '';
    const out: string[] = [];
    scripts.forEach((s, i) => {
        if (i > 0) out.push('');
        out.push(...printScript(s, ctx));
    });
    return out.join('\n') + '\n';
}
