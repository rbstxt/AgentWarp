/**
 * sbpy printer: IR scripts -> Python-like text.
 *
 * Statement style (the ONE consistent choice): Python function calls named
 * by catalog opcode, e.g. `motion_movesteps(STEPS=10)`. Rationale, recorded
 * here so it stays stable: Scratch-English text templates are ambiguous
 * (`turn_left` and `turn_right` are both "turn %1 degrees"; `pen down`
 * exists twice; several music/pen/operator texts collide), so English text
 * cannot round-trip every opcode without hidden annotations. Opcode calls
 * are unambiguous, greppable, and give unknown/extension opcodes a natural
 * home (the `raw` escape). Expressions use Python literals; variable, list
 * and broadcast references are `var("..")`, `list("..")`, `broadcast("..")`
 * so inputs are never confused with plain strings, and Unicode/spaces in
 * names work via quoting.
 */
import type { Block, Comment, FormatCtx, Input, Script } from '../../packages/core/ir.ts';
import { getBlockSpec } from '../../packages/core/catalog/index.ts';
import { defaultTag, isBroadcastSlot, isMenuSlot, printNumber, printString } from './shared.ts';

const INDENT = '    ';

function isStackKind(input: Input): boolean {
    return input.kind === 'stack';
}

/** Does this block need the generic `raw` escape form? */
function needsRaw(block: Block, opts: { chainNode: boolean; isFirst: boolean }): boolean {
    const spec = getBlockSpec(block.opcode);
    if (!spec) return true;
    if (block.opcode === 'procedures_definition' && !(opts.chainNode && !opts.isFirst)) {
        return false; // printed with `define`
    }
    if (block.opcode === 'procedures_definition') return true; // mid-chain: raw fallback
    if (block.opcode === 'procedures_call') {
        return subtreeHasCommentedValue(block);
    }
    if (opts.chainNode) {
        // Only stack-shaped blocks read naturally as chain statements; hats
        // and definitions are allowed as the chain head (their suites are
        // the script body). Everything else goes through `raw`.
        const headOk = (spec.shape === 'hat' || block.opcode === 'procedures_definition') && opts.isFirst;
        if (spec.shape !== 'stack' && spec.shape !== 'cap' && !isCish(spec.shape) && !headOk) return true;
    }
    for (const [name, input] of Object.entries(block.inputs)) {
        if (isStackKind(input)) {
            if (!isCish(spec.shape)) return true;
            if (name !== 'SUBSTACK' && name !== 'SUBSTACK2') return true;
        }
    }
    if (subtreeHasCommentedValue(block)) return true;
    return false;
}

function isCish(shape: string): boolean {
    return shape === 'c' || shape === 'c2' || shape === 'end-c';
}

/** True when a value-position (non-chain) block anywhere below carries a comment. */
function subtreeHasCommentedValue(block: Block): boolean {
    const seen = new Set<Block>();
    const rec = (b: Block, inChain: boolean): boolean => {
        if (seen.has(b)) return false;
        seen.add(b);
        if (b.comment && !inChain) return true;
        for (const input of Object.values(b.inputs)) {
            if ((input.kind === 'block' || input.kind === 'stack') && input.block) {
                if (rec(input.block, input.kind === 'stack')) return true;
            }
        }
        if (b.next && rec(b.next, true)) return true;
        return false;
    };
    // The top block itself is a chain node here; check its value inputs and next chain values.
    for (const input of Object.values(block.inputs)) {
        if ((input.kind === 'block' || input.kind === 'stack') && input.block) {
            if (rec(input.block, input.kind === 'stack')) return true;
        }
    }
    return false;
}

/** Minimized-marker and escaping rules (inverse of the parser's). */
function commentTextLines(comment: Comment): string[] {
    const lines = comment.text.split('\n');
    if (comment.minimized === true) {
        return ['[min] ' + lines[0], ...lines.slice(1)];
    }
    if (/^\\?\[min\]( |$)/.test(lines[0])) {
        return ['\\' + lines[0], ...lines.slice(1)];
    }
    return lines;
}

/** `#...` full lines (no indent) for leading comment lines. */
function hashLine(text: string): string {
    return text === '' ? '#' : '# ' + text;
}

/**
 * Split an attached comment into leading `#` lines and a trailing ` # ...`
 * suffix for the statement line. Single-line comments ride at end of line;
 * multi-line comments put all but the last line above.
 */
export function splitAttached(comment: Comment): { leading: string[]; trailing: string } {
    const lines = commentTextLines(comment);
    if (lines.length === 1) {
        return { leading: [], trailing: lines[0] === '' ? '  #' : '  # ' + lines[0] };
    }
    return {
        leading: lines.slice(0, -1).map(hashLine),
        trailing: lines[lines.length - 1] === '' ? '  #' : '  # ' + lines[lines.length - 1],
    };
}

/** Print a literal value for a value input. */
function printLiteral(value: string | number, litType: number | undefined, opcode: string, inputName: string): string {
    const dt = defaultTag(opcode, inputName);
    const bare = typeof value === 'number' ? printNumber(value) : printString(value);
    const tag = litType ?? dt;
    if (tag !== dt || isMenuSlot(opcode, inputName) || isBroadcastSlot(opcode, inputName)) {
        return `lit(${bare}, tag=${tag})`;
    }
    return bare;
}

/** Render one value input as an expression. */
function inputToExpr(input: Input, ownerOpcode: string, ownerInput: string): string {
    switch (input.kind) {
        case 'literal':
            return printLiteral(input.value, input.litType, ownerOpcode, ownerInput);
        case 'menu':
            return isMenuSlot(ownerOpcode, ownerInput) ? printString(input.value) : `menu(${printString(input.value)})`;
        case 'broadcast':
            return `broadcast(${printString(input.name)})`;
        case 'var':
            return `var(${printString(input.name)})`;
        case 'list':
            return `list(${printString(input.name)})`;
        case 'block':
            return blockToExpr(input.block);
        case 'stack':
            return 'None';
    }
}

/** Render a nested reporter/boolean block as an inline expression. */
export function blockToExpr(block: Block): string {
    if (block.opcode === 'argument_reporter_string_number') {
        return `arg(${printString(block.fields['VALUE']?.value ?? '')})`;
    }
    if (block.opcode === 'argument_reporter_boolean') {
        return `barg(${printString(block.fields['VALUE']?.value ?? '')})`;
    }
    return `${block.opcode}(${kwargsFor(block)})`;
}

/** `NAME=expr` list for value inputs + fields, catalog order, then extras, then mutation. */
function kwargsFor(block: Block): string {
    const spec = getBlockSpec(block.opcode);
    const parts: string[] = [];
    const used = new Set<string>();
    if (spec) {
        for (const a of spec.args) {
            if (a.kind === 'input') {
                const input = block.inputs[a.input];
                if (!input || isStackKind(input)) continue;
                used.add(a.input);
                parts.push(`${a.input}=${inputToExpr(input, block.opcode, a.input)}`);
            } else {
                const f = block.fields[a.field];
                if (!f) continue;
                used.add(a.field);
                parts.push(`${a.field}=${printString(f.value)}`);
            }
        }
    }
    for (const [name, input] of Object.entries(block.inputs)) {
        if (used.has(name) || isStackKind(input)) continue;
        parts.push(`${name}=${inputToExpr(input, block.opcode, name)}`);
    }
    for (const [name, f] of Object.entries(block.fields)) {
        if (used.has(name)) continue;
        parts.push(`${name}=${printString(f.value)}`);
    }
    if (block.mutation !== undefined) {
        parts.push(`mutation=${printJson(block.mutation)}`);
    }
    return parts.join(', ');
}

function printJson(v: unknown): string {
    if (v === null) return 'None';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return printNumber(v);
    if (typeof v === 'string') return printString(v);
    if (Array.isArray(v)) return `[${v.map(printJson).join(', ')}]`;
    if (typeof v === 'object') {
        return `{${Object.entries(v as Record<string, unknown>)
            .map(([k, val]) => `${printString(k)}: ${printJson(val)}`)
            .join(', ')}}`;
    }
    return printString(String(v));
}

/** `define "proccode" (args) [warp] [defaults=[...]]:` header line (no indent, no comment). */
function defineHeader(block: Block): string {
    const proc = block.proc ?? { proccode: '', argumentnames: [], argumentdefaults: [], warp: false };
    const holders = proc.proccode.match(/%[snb]/g) ?? [];
    const params = proc.argumentnames.map((name, i) => {
        const isBool = holders[i] === '%b';
        const dflt = proc.argumentdefaults[i] ?? '';
        const shown = SIMPLE_PARAM.test(name) ? name : printString(name);
        if (dflt !== '') return isBool ? `<${shown}=${printString(dflt)}>` : `${shown}=${printString(dflt)}`;
        return isBool ? `<${shown}>` : shown;
    });
    // Wild projects sometimes carry an argumentdefaults array whose length
    // differs from the parameter count; round-trip it verbatim.
    const extras =
        proc.argumentdefaults.length !== proc.argumentnames.length
            ? ` defaults=${printJson(proc.argumentdefaults)}`
            : '';
    return `define ${printString(proc.proccode)} (${params.join(', ')})${proc.warp ? ' [warp]' : ''}${extras}:`;
}

/**
 * Parameter names print bare unless they contain structural characters
 * (commas, parens, =, <>, #, quotes) or surround whitespace; quoted names
 * parse back verbatim.
 */
const SIMPLE_PARAM = /^[^\s,()<>=#@"'][^,()<>=#@"']*[^\s,()<>=#@"']$|^[^\s,()<>=#@"']$/;

/** Print a statement chain (script top chain or substack) at the given indent. */
function printChain(head: Block | undefined, indent: string, out: string[], isTop: boolean): void {
    const seen = new Set<Block>();
    let cur = head;
    let first = true;
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        // Hat/definition heads consume their `next` as the indented suite;
        // every other node links to its sibling.
        const consumedSuite = printNode(cur, indent, out, isTop && first);
        first = false;
        if (consumedSuite) break;
        cur = cur.next;
    }
}

function printSuite(head: Block | undefined, indent: string, out: string[]): void {
    if (!head) {
        out.push(indent + 'pass');
        return;
    }
    printChain(head, indent, out, false);
}

function printAttachedLeading(block: Block, indent: string, out: string[]): string {
    if (!block.comment) return '';
    const { leading, trailing } = splitAttached(block.comment);
    for (const l of leading) out.push(indent + l);
    return trailing;
}

function printNode(block: Block, indent: string, out: string[], isFirst: boolean): boolean {
    if (block.opcode === 'procedures_definition' && isFirst) {
        const trail = printAttachedLeading(block, indent, out);
        out.push(indent + defineHeader(block) + trail);
        printSuite(block.next, indent + INDENT, out);
        return true;
    }
    const raw = needsRaw(block, { chainNode: true, isFirst });
    if (raw) {
        printRaw(block, indent, out);
        return false;
    }
    const spec = getBlockSpec(block.opcode);
    const shape = spec?.shape;
    const trail = printAttachedLeading(block, indent, out);
    if (block.opcode === 'procedures_call') {
        const proc = block.proc ?? { proccode: '', argumentnames: [], argumentdefaults: [], warp: false };
        const args = Object.entries(block.inputs).map(([k, v]) => `${k}=${inputToExpr(v, block.opcode, k)}`);
        out.push(indent + `call(${printString(proc.proccode)}${args.length ? ', ' + args.join(', ') : ''})` + trail);
        return false;
    }
    const header = indent + `${block.opcode}(${kwargsFor(block)})`;
    if (shape === 'c' || shape === 'end-c') {
        out.push(header + ':' + trail);
        printSuite(stackHead(block, 'SUBSTACK'), indent + INDENT, out);
        return false;
    }
    if (shape === 'c2') {
        out.push(header + ':' + trail);
        printSuite(stackHead(block, 'SUBSTACK'), indent + INDENT, out);
        out.push(indent + 'else:');
        printSuite(stackHead(block, 'SUBSTACK2'), indent + INDENT, out);
        return false;
    }
    if (shape === 'hat' && isFirst) {
        out.push(header + ':' + trail);
        printSuite(block.next, indent + INDENT, out);
        return true;
    }
    out.push(header + trail);
    return false;
}

function stackHead(block: Block, name: string): Block | undefined {
    const inp = block.inputs[name];
    return inp && inp.kind === 'stack' ? inp.block : undefined;
}

function printRaw(block: Block, indent: string, out: string[]): void {
    const trail = printAttachedLeading(block, indent, out);
    out.push(indent + `raw ${printString(block.opcode)}:` + trail);
    const sub = indent + INDENT;
    for (const [name, f] of Object.entries(block.fields)) {
        out.push(sub + `field ${name} = ${printString(f.value)}`);
    }
    for (const [name, input] of Object.entries(block.inputs)) {
        if (input.kind === 'stack') {
            if (input.block) {
                out.push(sub + `stack ${name}:`);
                printChain(input.block, sub + INDENT, out, false);
            } else {
                out.push(sub + `stack ${name}:`);
                out.push(sub + INDENT + 'pass');
            }
            continue;
        }
        const val = inputToExpr(input, block.opcode, name);
        // Suite form when the value cannot sit inline (suites, raw params,
        // or a comment that needs its own line).
        if (input.kind === 'block' && (needsRawValue(input.block) || input.block.comment)) {
            out.push(sub + `input ${name}:`);
            printNode(input.block, sub + INDENT, out, false);
        } else {
            out.push(sub + `input ${name} = ${val}`);
        }
    }
    if (block.mutation !== undefined) {
        out.push(sub + `mutation = ${printJson(block.mutation)}`);
    }
    if (Object.keys(block.fields).length === 0 && Object.keys(block.inputs).length === 0 && block.mutation === undefined) {
        out.push(sub + 'pass');
    }
}

/** A nested value block that cannot sit inline (has suites or raw params). */
function needsRawValue(block: Block): boolean {
    const spec = getBlockSpec(block.opcode);
    if (!spec) return true;
    if (isCish(spec.shape)) return true;
    return needsRaw(block, { chainNode: false, isFirst: false });
}

/** Print one workspace comment script. */
function printWorkspace(comment: Comment): string[] {
    return commentTextLines(comment).map(hashLine);
}

function printTopChain(script: Script, out: string[]): void {
    const top = script.top as Block;
    printChain(top, '', out, true);
}

export function printScripts(scripts: Script[], _ctx: FormatCtx): string {
    const out: string[] = [];
    scripts.forEach((s, i) => {
        if (i > 0) out.push('');
        if (s.anchor) out.push(`@${s.anchor}`);
        if (s.kind === 'comment' && s.comment) {
            if (s.comment.anchor) out.push(`@${s.comment.anchor}`);
            out.push(...printWorkspace(s.comment));
            return;
        }
        if (s.kind === 'reporter' && s.top) {
            const top = s.top;
            if (top.comment) out.push(...splitAttached(top.comment).leading);
            out.push(topExprLine(top) + (top.comment ? splitAttached(top.comment).trailing : ''));
            let cur = top.next;
            const seen = new Set<Block>();
            while (cur && !seen.has(cur)) {
                seen.add(cur);
                if (cur.comment) out.push(...splitAttached(cur.comment).leading);
                out.push(topExprLine(cur) + (cur.comment ? splitAttached(cur.comment).trailing : ''));
                cur = cur.next;
            }
            return;
        }
        if (s.top) printTopChain(s, out);
    });
    return out.length ? out.join('\n') + '\n' : '';
}

/** Expression line for a top-level reporter script node. */
function topExprLine(block: Block): string {
    const plain = Object.keys(block.inputs).length === 0 && block.mutation === undefined;
    if (plain && block.opcode === 'data_variable') {
        return `var(${printString(block.fields['VARIABLE']?.value ?? '')})`;
    }
    if (plain && block.opcode === 'data_listcontents') {
        return `list(${printString(block.fields['LIST']?.value ?? '')})`;
    }
    if (plain && block.opcode === 'argument_reporter_string_number') {
        return `arg(${printString(block.fields['VALUE']?.value ?? '')})`;
    }
    if (plain && block.opcode === 'argument_reporter_boolean') {
        return `barg(${printString(block.fields['VALUE']?.value ?? '')})`;
    }
    return blockToExpr(block);
}
