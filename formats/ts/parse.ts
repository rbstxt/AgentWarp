/**
 * TypeScript text -> IR, parsed with the TypeScript compiler API.
 * The text is never executed.
 */
import * as ts from 'typescript';
import type { Block, Comment, Diagnostic, FormatCtx, Input, Script } from '../../packages/core/ir.ts';
import { getBlockSpec } from '../../packages/core/catalog/index.ts';
import { allFnNames, opcodeForFn } from './names.ts';
import { proccodePlaceholders, SHADOW_TAG } from './print.ts';
import type { ProcScope } from './print.ts';

const MENU_KINDS = new Set(['menu', 'costume', 'sound']);
const EMPTY_SCOPE: ProcScope = { argNames: [], paramToArg: new Map(), booleanArgs: new Set() };

interface Ctx {
    file: string;
    targetJson: any;
    isStage: boolean;
    diagnostics: Diagnostic[];
    /** proccode -> arg names from this file's define() calls. */
    procDefs: Map<string, { argNames: string[]; warp: boolean }>;
    /** function name -> opcode (specific calls). */
    fnToOp: Map<string, string>;
}

function buildReverseMap(): Map<string, string> {
    const out = new Map<string, string>();
    for (const name of allFnNames()) {
        const op = opcodeForFn(name);
        if (op) out.set(name, op);
    }
    return out;
}

function posOf(ctx: Ctx, node: ts.Node): { line: number; col: number } {
    const sf = node.getSourceFile();
    const { line, character } = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf));
    return { line: line + 1, col: character + 1 };
}

function err(ctx: Ctx, node: ts.Node, message: string): void {
    const { line, col } = posOf(ctx, node);
    ctx.diagnostics.push({ message, file: ctx.file, line, col, severity: 'error' });
}

function warn(ctx: Ctx, node: ts.Node, message: string): void {
    const { line, col } = posOf(ctx, node);
    ctx.diagnostics.push({ message, file: ctx.file, line, col, severity: 'warning' });
}

function locOf(ctx: Ctx, node: ts.Node) {
    const { line, col } = posOf(ctx, node);
    return { file: ctx.file, line, col };
}

function editDistance(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}

function suggest(word: string, candidates: string[], n = 3): string {
    if (word === '') return '';
    const ranked = candidates
        .map((c) => ({ c, d: editDistance(word.toLowerCase(), c.toLowerCase()) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, n)
        .filter((x) => x.d <= Math.max(2, Math.floor(word.length / 2) + 1));
    if (ranked.length === 0) return '';
    return ` (did you mean ${ranked.map((x) => `"${x.c}"`).join(', ')}?)`;
}

/** Split leading trivia above a statement into script anchor, comment anchor, and attached comment. */
function leadingInfo(
    sf: ts.SourceFile,
    text: string,
    node: ts.Node,
): { anchor?: string; commentAnchor?: string; comment?: { text: string; minimized?: boolean } } {
    const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    const stmtLine = ts.getLineAndCharacterOfPosition(sf, node.getStart(sf)).line;
    const kept: ts.CommentRange[] = [];
    let expectLine = stmtLine - 1;
    for (let i = ranges.length - 1; i >= 0; i--) {
        const r = ranges[i];
        if (r.kind !== ts.SyntaxKind.SingleLineCommentTrivia) break;
        const line = ts.getLineAndCharacterOfPosition(sf, r.pos).line;
        const endLine = ts.getLineAndCharacterOfPosition(sf, r.end).line;
        if (endLine !== line || line !== expectLine) break;
        kept.unshift(r);
        expectLine = line - 1;
    }
    let anchor: string | undefined;
    let commentAnchor: string | undefined;
    const lines: Array<{ text: string; minimized: boolean }> = [];
    for (const r of kept) {
        const raw = text.slice(r.pos + 2, r.end);
        const m = raw.match(/^\s*@([ac])(\d+)\s*$/);
        if (m) {
            if (m[1] === 'a' && !anchor) anchor = `a${m[2]}`;
            else if (m[1] === 'c' && !commentAnchor) commentAnchor = `c${m[2]}`;
            continue;
        }
        if (raw.startsWith('/')) continue; // /// references: ignore
        let rest = raw;
        let minimized = false;
        if (rest.startsWith('-')) {
            minimized = true;
            rest = rest.slice(1);
        }
        if (rest.startsWith(' ')) rest = rest.slice(1);
        lines.push({ text: rest, minimized });
    }
    const out: { anchor?: string; commentAnchor?: string; comment?: { text: string; minimized?: boolean } } = {};
    if (anchor) out.anchor = anchor;
    if (commentAnchor) out.commentAnchor = commentAnchor;
    if (lines.length > 0) {
        out.comment = { text: lines.map((l) => l.text).join('\n'), minimized: lines.some((l) => l.minimized) ? true : undefined };
    }
    return out;
}

function strLiteral(node: ts.Node): string | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return null;
}

function numLiteral(node: ts.Node): number | null {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
        return -Number(node.operand.text);
    }
    return null;
}

function scalarValue(node: ts.Expression): string | number | boolean | undefined | null {
    const e = ts.skipOuterExpressions(node, ts.OuterExpressionKinds.Assertions) as ts.Expression;
    if (e.kind === ts.SyntaxKind.UndefinedKeyword || e.kind === ts.SyntaxKind.NullKeyword) return undefined;
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    const s = strLiteral(e);
    if (s !== null) return s;
    const n = numLiteral(e);
    if (n !== null) return n;
    return null;
}

function expectedTag(specKind: string | undefined, jsType: 'number' | 'string' | 'boolean', shadowOpcode?: string): number {
    if (shadowOpcode && SHADOW_TAG[shadowOpcode] !== undefined) return SHADOW_TAG[shadowOpcode];
    return jsType === 'number' ? 4 : 10;
}

interface Slot {
    kind: 'input' | 'call-arg' | 'generic' | 'none';
    opcode: string;
    name: string;
    specKind?: string;
    shadowOpcode?: string;
    role?: 'menu';
}

const INPUT_ROLE: Record<string, Record<string, 'value' | 'menu'>> = {
    event_whentouchingobject: { TOUCHINGOBJECTMENU: 'menu' },
};

function slotForInput(opcode: string, inputName: string): Slot {
    const spec = getBlockSpec(opcode)?.inputs.find((i) => i.name === inputName);
    return {
        kind: 'input',
        opcode,
        name: inputName,
        specKind: spec?.kind,
        shadowOpcode: spec?.shadowOpcode,
        role: INPUT_ROLE[opcode]?.[inputName] === 'menu' ? 'menu' : undefined,
    };
}

function memberRef(node: ts.Expression): { root: 'vars' | 'lists'; name: string } | null {
    const e = ts.skipOuterExpressions(node, ts.OuterExpressionKinds.Assertions) as ts.Expression;
    if (ts.isPropertyAccessExpression(e)) {
        const root = e.expression.getText();
        if ((root === 'vars' || root === 'lists') && ts.isIdentifier(e.name)) return { root, name: e.name.text };
        return null;
    }
    if (ts.isElementAccessExpression(e)) {
        const root = e.expression.getText();
        if (root !== 'vars' && root !== 'lists') return null;
        const arg = e.argumentExpression;
        if (arg && ts.isStringLiteral(arg)) return { root: root as 'vars' | 'lists', name: arg.text };
        if (arg && ts.isNumericLiteral(arg)) return { root: root as 'vars' | 'lists', name: arg.text };
    }
    return null;
}

function decodeScalarInput(ctx: Ctx, node: ts.Expression, slot: Slot): Input | null {
    const v = scalarValue(node);
    if (v === undefined) return null; // `undefined`: omit the input
    if (v === null) {
        err(ctx, node, `cannot use this expression for ${slot.opcode || 'this'} input "${slot.name}": expected a literal, variable, or reporter block`);
        return null;
    }
    const jsType = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
    if (slot.kind === 'input' && slot.specKind === 'broadcast' && jsType === 'string') return { kind: 'broadcast', name: v as string };
    if (slot.kind === 'input' && slot.specKind && MENU_KINDS.has(slot.specKind) && jsType === 'string') return { kind: 'menu', value: v as string };
    if (slot.kind === 'input' && slot.role === 'menu' && jsType === 'string') return { kind: 'menu', value: v as string };
    if (slot.kind === 'input' && slot.specKind === 'stack') {
        err(ctx, node, `input "${slot.name}" needs a stack block: pass an arrow function like () => { ... }`);
        return null;
    }
    if (jsType === 'boolean') {
        if (slot.specKind && slot.specKind !== 'boolean' && slot.specKind !== 'any') {
            err(ctx, node, `wrong input kind: a bare boolean does not fit ${slot.opcode} input "${slot.name}"`);
        }
        return { kind: 'literal', value: v as boolean };
    }
    const tag = expectedTag(slot.specKind, jsType, slot.shadowOpcode);
    return { kind: 'literal', value: v as string | number, litType: tag };
}

function decodeExpr(ctx: Ctx, node: ts.Expression, slot: Slot, scope: ProcScope): Block | Input | null {
    const expr = ts.skipOuterExpressions(node, ts.OuterExpressionKinds.Assertions) as ts.Expression;
    if (ts.isParenthesizedExpression(expr)) return decodeExpr(ctx, expr.expression, slot, scope);
    if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return decodeExpr(ctx, expr.expression, slot, scope);
    if (ts.isNonNullExpression(expr)) return decodeExpr(ctx, expr.expression, slot, scope);
    const mem = memberRef(expr);
    if (mem) return mem.root === 'vars' ? { kind: 'var', name: mem.name } : { kind: 'list', name: mem.name };
    if (ts.isArrowFunction(expr)) {
        if (slot.kind === 'input' && (slot.specKind === 'stack' || slot.name === 'SUBSTACK' || slot.name === 'SUBSTACK2')) {
            const head = decodeBody(ctx, expr, scope);
            return head ? { kind: 'stack', block: head } : null; // empty body = absent input
        }
        err(ctx, node, `unexpected arrow function here`);
        return null;
    }
    if (ts.isCallExpression(expr)) return decodeCall(ctx, expr, slot, scope);
    if (ts.isBinaryExpression(expr)) return decodeBinary(ctx, expr, slot, scope);
    if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
        const inner = toBlockInput(decodeExpr(ctx, expr.operand, { kind: 'none', opcode: '', name: '' }, scope));
        if (!inner) return null;
        return {
            opcode: 'operator_not',
            inputs: { OPERAND: { kind: 'block', block: inner } },
            fields: {},
            loc: locOf(ctx, expr),
        };
    }
    if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) {
        return { kind: 'literal', value: expr.kind === ts.SyntaxKind.TrueKeyword };
    }
    if (ts.isIdentifier(expr)) {
        const orig = scope.paramToArg.get(expr.text);
        if (orig !== undefined) {
            const opcode = scope.booleanArgs.has(orig) ? 'argument_reporter_boolean' : 'argument_reporter_string_number';
            return { opcode, inputs: {}, fields: { VALUE: { value: orig } }, loc: locOf(ctx, expr) };
        }
        err(ctx, node, `unknown name "${expr.text}"${suggest(expr.text, allFnNames())}`);
        return null;
    }
    const s = scalarValue(expr);
    if (s !== undefined && s !== null) return decodeScalarInput(ctx, expr, slot, scope);
    if (s === undefined) return null; // undefined/null handled (omit)
    err(ctx, node, `cannot decode this expression${slot.name ? ` for input "${slot.name}"` : ''}`);
    return null;
}

function toBlockInput(v: Block | Input | null): Block | null {
    if (!v) return null;
    if ('opcode' in v) return v;
    if (v.kind === 'block') return v.block;
    return null;
}

function toInput(v: Block | Input | null, ctx: Ctx, node: ts.Node): Input | null {
    void ctx;
    void node;
    if (!v) return null;
    if ('opcode' in v) return { kind: 'block', block: v };
    return v;
}

const BINOP = new Map<number, string>([
    [ts.SyntaxKind.PlusToken, 'operator_add'],
    [ts.SyntaxKind.MinusToken, 'operator_subtract'],
    [ts.SyntaxKind.AsteriskToken, 'operator_multiply'],
    [ts.SyntaxKind.SlashToken, 'operator_divide'],
    [ts.SyntaxKind.PercentToken, 'operator_mod'],
    [ts.SyntaxKind.GreaterThanToken, 'operator_gt'],
    [ts.SyntaxKind.LessThanToken, 'operator_lt'],
    [ts.SyntaxKind.EqualsEqualsToken, 'operator_equals'],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, 'operator_equals'],
    [ts.SyntaxKind.AmpersandAmpersandToken, 'operator_and'],
    [ts.SyntaxKind.BarBarToken, 'operator_or'],
]);

function decodeBinaryArgs(ctx: Ctx, node: ts.BinaryExpression, scope: ProcScope): { left: Input; right: Input } | null {
    const left = toInput(decodeExpr(ctx, node.left, { kind: 'none', opcode: '', name: '' }, scope), ctx, node.left);
    const right = toInput(decodeExpr(ctx, node.right, { kind: 'none', opcode: '', name: '' }, scope), ctx, node.right);
    if (!left || !right) return null;
    return { left, right };
}

function decodeBinary(ctx: Ctx, node: ts.BinaryExpression, slot: Slot, scope: ProcScope): Block | Input | null {
    void slot;
    const negated =
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
    const kind = negated ? ts.SyntaxKind.EqualsEqualsToken : node.operatorToken.kind;
    const opcode = BINOP.get(kind);
    if (!opcode) {
        err(ctx, node, `unsupported operator "${node.operatorToken.getText()}" (use a block function like add() instead)`);
        return null;
    }
    const operands = decodeBinaryArgs(ctx, node, scope);
    if (!operands) return null;
    const spec = getBlockSpec(opcode);
    const in1 = spec?.inputs[0]?.name ?? 'OPERAND1';
    const in2 = spec?.inputs[1]?.name ?? 'OPERAND2';
    const eq: Block = { opcode, inputs: { [in1]: operands.left, [in2]: operands.right }, fields: {}, loc: locOf(ctx, node) };
    if (negated) {
        return { opcode: 'operator_not', inputs: { OPERAND: { kind: 'block', block: eq } }, fields: {}, loc: locOf(ctx, node) };
    }
    return eq;
}

function decodeSpecificCall(ctx: Ctx, node: ts.CallExpression, opcode: string, slot: Slot, scope: ProcScope): Block | null {
    const spec = getBlockSpec(opcode);
    if (!spec) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : opcode;
        err(ctx, node, `unknown block "${name}"${suggest(name, allFnNames())}`);
        return null;
    }
    if (opcode === 'procedures_definition' || opcode === 'procedures_prototype') {
        err(ctx, node, `${opcode} cannot be called directly; use define() for custom blocks`);
        return null;
    }
    const isHat = spec.shape === 'hat';
    const args = [...node.arguments];
    let trailingBody: Block | undefined;
    if (isHat && args.length > 0 && ts.isArrowFunction(args[args.length - 1])) {
        trailingBody = decodeBody(ctx, args.pop() as ts.ArrowFunction, scope) ?? undefined;
    }
    if (args.length > spec.args.length) {
        err(ctx, node, `too many arguments for ${opcode}: expected ${spec.args.length}, got ${args.length}`);
        args.length = spec.args.length;
    }
    const inputs: Record<string, Input> = {};
    const fields: Record<string, { value: string }> = {};
    spec.args.forEach((a, i) => {
        const expr = args[i];
        if (a.kind === 'field') {
            if (!expr) return;
            const flat = ts.skipOuterExpressions(expr, ts.OuterExpressionKinds.Assertions) as ts.Expression;
            if (ts.isIdentifier(flat) && flat.text === 'undefined') return;
            const fspec = spec.fields.find((f) => f.name === a.field);
            if (!fspec || (fspec.kind !== 'variable' && fspec.kind !== 'list' && fspec.kind !== 'broadcast')) {
                const v = scalarValue(expr);
                if (v === undefined) return;
                if (v === null || typeof v === 'object') {
                    err(ctx, expr, `argument ${i + 1} of ${opcode}: expected a literal for field "${a.field}"`);
                    return;
                }
                fields[a.field] = { value: String(v) };
                return;
            }
            if (fspec.kind === 'broadcast') {
                const s = strLiteral(flat);
                if (s === null) {
                    err(ctx, expr, `argument ${i + 1} of ${opcode}: expected a broadcast name string`);
                    return;
                }
                fields[a.field] = { value: s };
                return;
            }
            const mem = memberRef(flat);
            const want = fspec.kind === 'variable' ? 'vars' : 'lists';
            if (mem && mem.root === want) {
                fields[a.field] = { value: mem.name };
                return;
            }
            const s = strLiteral(flat);
            if (s !== null) {
                fields[a.field] = { value: s }; // lenient: accept a name string
                return;
            }
            err(ctx, expr, `argument ${i + 1} of ${opcode}: expected ${want}.<name>`);
            return;
        }
        if (!expr) return;
        const flat = ts.skipOuterExpressions(expr, ts.OuterExpressionKinds.Assertions) as ts.Expression;
        if (ts.isIdentifier(flat) && flat.text === 'undefined') return;
        const ispec = spec.inputs.find((x) => x.name === a.input);
        if (ispec?.kind === 'stack' && !ts.isArrowFunction(flat)) {
            err(ctx, expr, `argument ${i + 1} of ${opcode}: input "${a.input}" needs an arrow function like () => { ... }`);
            return;
        }
        const decoded = decodeExpr(ctx, expr, slotForInput(opcode, a.input), scope);
        if (!decoded) return;
        if ('opcode' in decoded) {
            inputs[a.input] = { kind: 'block', block: decoded };
        } else {
            if (decoded.kind === 'stack' && ispec?.kind !== 'stack') {
                err(ctx, expr, `wrong input kind: a stack does not fit input "${a.input}"`);
                return;
            }
            if (decoded.kind !== 'stack' && ispec?.kind === 'stack') {
                err(ctx, expr, `wrong input kind: expected a stack block for input "${a.input}"`);
                return;
            }
            inputs[a.input] = decoded;
        }
    });
    if (args.length < spec.args.length) {
        warn(ctx, node, `${opcode}: missing arguments ${args.length + 1}..${spec.args.length} treated as empty`);
    }
    if (isHat && slot.kind !== 'none') warn(ctx, node, `hat block ${opcode} used inside another block`);
    const b: Block = { opcode, inputs, fields, loc: locOf(ctx, node) };
    if (trailingBody) b.next = trailingBody;
    validateBlock(ctx, b, node);
    return b;
}

function optsMinimized(node: ts.Expression | undefined): true | undefined {
    if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
    for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText() === 'minimized' && p.initializer.kind === ts.SyntaxKind.TrueKeyword) {
            return true;
        }
    }
    return undefined;
}

function withCommentOpts(node: ts.ObjectLiteralExpression): { minimized?: true; anchor?: string } {
    const out: { minimized?: true; anchor?: string } = {};
    for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const key = propKey(p.name);
        if (key === 'minimized' && p.initializer.kind === ts.SyntaxKind.TrueKeyword) out.minimized = true;
        else if (key === 'anchor' && ts.isStringLiteral(p.initializer) && /^c\d+$/.test(p.initializer.text)) out.anchor = p.initializer.text;
    }
    return out;
}

function decodeProcCall(ctx: Ctx, node: ts.CallExpression, scope: ProcScope): Block | null {
    const [procNode, ...rest] = node.arguments;
    const proccode = procNode ? strLiteral(procNode) : null;
    if (proccode === null) {
        err(ctx, node, `call needs a proccode string as its first argument`);
        return null;
    }
    const def = ctx.procDefs.get(proccode);
    const argNames = def ? def.argNames : rest.map((_, i) => `arg${i}`);
    if (!def) err(ctx, node, `procedure call "${proccode}" doesn't match a definition${suggest(proccode, [...ctx.procDefs.keys()])}`);
    const inputs: Record<string, Input> = {};
    rest.forEach((expr, i) => {
        const name = argNames[i] ?? `arg${i}`;
        const flat = ts.skipOuterExpressions(expr, ts.OuterExpressionKinds.Assertions) as ts.Expression;
        if (ts.isIdentifier(flat) && flat.text === 'undefined') return;
        const decoded = decodeExpr(ctx, expr, { kind: 'call-arg', opcode: 'procedures_call', name }, scope);
        if (!decoded) return;
        const inp = toInput(decoded, ctx, expr);
        if (inp) inputs[name] = inp;
    });
    const b: Block = {
        opcode: 'procedures_call',
        inputs,
        fields: {},
        // Calls carry names in their input keys; proc mirrors extract (empty).
        proc: { proccode, argumentnames: [], argumentdefaults: [], warp: false },
        loc: locOf(ctx, node),
    };
    return b;
}

function propKey(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return null;
}

function tsValueToJson(node: ts.Node): unknown {
    if (ts.isObjectLiteralExpression(node)) {
        const out: Record<string, unknown> = {};
        for (const p of node.properties) {
            if (!ts.isPropertyAssignment(p)) throw new Error('bad');
            const key = propKey(p.name);
            if (key === null) throw new Error('bad');
            out[key] = tsValueToJson(p.initializer);
        }
        return out;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(tsValueToJson);
    if (ts.isExpression(node)) {
        const s = strLiteral(node);
        if (s !== null) return s;
        const n = numLiteral(node);
        if (n !== null) return n;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    throw new Error('bad');
}

function decodeGeneric(ctx: Ctx, node: ts.CallExpression, scope: ProcScope): Block | null {
    const [opNode, ...rest] = node.arguments;
    const opcode = opNode ? strLiteral(opNode) : null;
    if (opcode === null) {
        err(ctx, node, `block needs an opcode string as its first argument`);
        return null;
    }
    const spec = getBlockSpec(opcode);
    const inputs: Record<string, Input> = {};
    const fields: Record<string, { value: string }> = {};
    let mutation: Record<string, unknown> | undefined;
    let body: Block | undefined;
    for (const a of rest) {
        if (ts.isArrowFunction(a)) {
            if (body) {
                err(ctx, a, `only one trailing arrow function is allowed`);
                continue;
            }
            if (spec?.shape === 'hat') {
                body = decodeBody(ctx, a, scope) ?? undefined;
            } else {
                err(ctx, a, `unexpected arrow function here`);
            }
            continue;
        }
        if (!ts.isObjectLiteralExpression(a)) {
            err(ctx, a, `block() takes an options object like { inputs: {...}, fields: {...}, mutation: {...} }`);
            continue;
        }
        for (const p of a.properties) {
            if (!ts.isPropertyAssignment(p)) {
                err(ctx, p, `block() options must be inputs/fields/mutation sections`);
                continue;
            }
            const key = propKey(p.name);
            if (key === 'inputs' && ts.isObjectLiteralExpression(p.initializer)) {
                for (const q of p.initializer.properties) {
                    if (!ts.isPropertyAssignment(q)) {
                        err(ctx, q, `block inputs must be "NAME": value pairs`);
                        continue;
                    }
                    const k = propKey(q.name);
                    if (k === null) {
                        err(ctx, q.name, `block input names must be strings`);
                        continue;
                    }
                    const decoded = decodeExpr(ctx, q.initializer, slotForInput(opcode, k), scope);
                    if (!decoded) continue;
                    if ('opcode' in decoded) inputs[k] = { kind: 'block', block: decoded };
                    else inputs[k] = decoded;
                }
            } else if (key === 'fields' && ts.isObjectLiteralExpression(p.initializer)) {
                for (const q of p.initializer.properties) {
                    if (!ts.isPropertyAssignment(q)) {
                        err(ctx, q, `block fields must be "NAME": value pairs`);
                        continue;
                    }
                    const k = propKey(q.name);
                    if (k === null) {
                        err(ctx, q.name, `block field names must be strings`);
                        continue;
                    }
                    const init = ts.skipOuterExpressions(q.initializer, ts.OuterExpressionKinds.Assertions) as ts.Expression;
                    const mem = memberRef(init);
                    if (mem) {
                        fields[k] = { value: mem.name };
                        continue;
                    }
                    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && (init.expression.text === 'menu' || init.expression.text === 'bcast') && init.arguments.length === 1) {
                        const s = strLiteral(init.arguments[0]);
                        if (s !== null) {
                            fields[k] = { value: s };
                            continue;
                        }
                    }
                    const s = strLiteral(init);
                    if (s !== null) {
                        fields[k] = { value: s };
                        continue;
                    }
                    const n = numLiteral(init);
                    if (n !== null) {
                        fields[k] = { value: String(n) };
                        continue;
                    }
                    err(ctx, init, `cannot decode this field value for "${k}"`);
                }
            } else if (key === 'mutation') {
                try {
                    const v = tsValueToJson(p.initializer);
                    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('bad');
                    mutation = v as Record<string, unknown>;
                } catch {
                    err(ctx, p.initializer, `block mutation must be a plain JSON object`);
                }
            } else {
                err(ctx, p, `unknown block() section "${key}" (expected inputs, fields, or mutation)`);
            }
        }
    }
    const b: Block = { opcode, inputs, fields, loc: locOf(ctx, node) };
    if (mutation !== undefined) b.mutation = mutation;
    if (body) b.next = body;
    validateBlock(ctx, b, node);
    return b;
}

function decodeCall(ctx: Ctx, node: ts.CallExpression, slot: Slot, scope: ProcScope): Block | Input | null {
    const callee = node.expression;
    if (!ts.isIdentifier(callee)) {
        err(ctx, node, `cannot decode this call`);
        return null;
    }
    const name = callee.text;
    if (name === 'call') {
        const b = decodeProcCall(ctx, node, scope);
        return b;
    }
    if (name === 'block') return decodeGeneric(ctx, node, scope);
    if (name === 'lit') {
        const [vNode, tagNode] = node.arguments;
        if (!vNode || !tagNode) {
            err(ctx, node, `lit needs (value, tag)`);
            return null;
        }
        const v = scalarValue(vNode);
        const t = numLiteral(tagNode);
        if ((typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') || t === null) {
            err(ctx, node, `lit needs a scalar value and a numeric tag`);
            return null;
        }
        return { kind: 'literal', value: v, litType: t };
    }
    if (name === 'menu') {
        const [vNode] = node.arguments;
        const s = vNode ? strLiteral(vNode) : null;
        if (s === null) {
            err(ctx, node, `menu needs a string literal`);
            return null;
        }
        return { kind: 'menu', value: s };
    }
    if (name === 'bcast') {
        const [vNode] = node.arguments;
        const s = vNode ? strLiteral(vNode) : null;
        if (s === null) {
            err(ctx, node, `bcast needs a string literal`);
            return null;
        }
        return { kind: 'broadcast', name: s };
    }
    if (name === 'withComment') {
        const [inner, textNode, optsNode] = node.arguments;
        if (!inner || !textNode) {
            err(ctx, node, `withComment needs (block, "text")`);
            return null;
        }
        const text = strLiteral(textNode);
        if (text === null) {
            err(ctx, textNode, `withComment text must be a string literal`);
            return null;
        }
        const decoded = decodeExpr(ctx, inner, slot, scope);
        const blk = toBlockInput(decoded);
        if (!blk) return null;
        const withOpts = optsNode && ts.isExpression(optsNode) && ts.isObjectLiteralExpression(optsNode) ? withCommentOpts(optsNode) : {};
        blk.comment = { text, minimized: withOpts.minimized, anchor: withOpts.anchor, loc: blk.loc };
        return blk;
    }
    const opcode = ctx.fnToOp.get(name);
    if (!opcode) {
        err(ctx, node, `unknown block "${name}"${suggest(name, allFnNames())}`);
        return null;
    }
    return decodeSpecificCall(ctx, node, opcode, slot, scope);
}

/** Decode a stack arrow body into a next-chain head. */
function decodeBody(ctx: Ctx, arrow: ts.ArrowFunction, outerScope: ProcScope): Block | null {
    if (ts.isBlock(arrow.body)) return decodeStatementList(ctx, [...arrow.body.statements], outerScope);
    return decodeStatementBlock(ctx, arrow.body as ts.Expression, outerScope);
}

/** Decode consecutive statements into a chain; returns the head. */
function decodeStatementList(ctx: Ctx, stmts: ts.Statement[], scope: ProcScope): Block | null {
    void ctx;
    let head: Block | null = null;
    let tail: Block | null = null;
    for (const stmt of stmts) {
        if (ts.isEmptyStatement(stmt)) continue;
        if (!ts.isExpressionStatement(stmt)) {
            err(ctx, stmt, `only block calls are allowed here (no ${ts.SyntaxKind[stmt.kind]})`);
            continue;
        }
        const lead = leadingInfo(stmt.getSourceFile(), stmt.getSourceFile().text, stmt);
        const b = decodeStatementBlock(ctx, stmt.expression, scope);
        if (!b) continue;
        if (lead.comment || lead.commentAnchor) {
            const merged = mergeComment(b.comment, lead.comment ?? { text: '' }, locOf(ctx, stmt), lead.commentAnchor);
            if (merged) b.comment = merged;
            else if (lead.commentAnchor && b.comment) b.comment.anchor = lead.commentAnchor;
            else delete b.comment;
        }
        if (!head) head = b;
        if (tail) tail.next = b;
        tail = b;
        // Note: cap/end-c blocks (stop, delete, forever) can still carry a
        // next chain in real projects (e.g. stop other scripts, then continue),
        // so chains are preserved faithfully without splitting.
    }
    return head;
}

function decodeStatementBlock(ctx: Ctx, expr: ts.Expression, scope: ProcScope): Block | null {
    const e = ts.skipOuterExpressions(expr, ts.OuterExpressionKinds.Assertions) as ts.Expression;
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
        const name = e.expression.text;
        if (name === 'script' || name === 'comment' || name === 'define') {
            err(ctx, e, `${name}(...) cannot be nested here`);
            return null;
        }
    }
    const decoded = decodeExpr(ctx, e, { kind: 'none', opcode: '', name: '' }, scope);
    return toBlockInput(decoded);
}

function decodeDefine(ctx: Ctx, node: ts.CallExpression): Block | null {    const [procNode, second, third] = node.arguments;
    const proccode = procNode ? strLiteral(procNode) : null;
    if (proccode === null) {
        err(ctx, node, `define needs a proccode string as its first argument`);
        return null;
    }
    const fn = third && ts.isArrowFunction(third) ? third : second && ts.isArrowFunction(second) ? second : null;
    const opts = third && ts.isArrowFunction(third) && second ? second : null;
    if (!fn || !ts.isArrowFunction(fn)) {
        err(ctx, node, `define needs an arrow function implementation`);
        return null;
    }
    if (opts && !ts.isObjectLiteralExpression(opts)) {
        err(ctx, opts, `define options must be an object like { warp: true }`);
        return null;
    }
    let warp = false;
    let explicitDefaults: string[] | null = null;
    if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const p of opts.properties) {
            if (!ts.isPropertyAssignment(p)) {
                err(ctx, p, `define options must be key: value pairs`);
                continue;
            }
            const key = propKey(p.name);
            if (key === 'warp') warp = p.initializer.kind === ts.SyntaxKind.TrueKeyword;
            else if (key === 'argumentDefaults' && ts.isArrayLiteralExpression(p.initializer)) {
                explicitDefaults = [];
                for (const el of p.initializer.elements) {
                    const s = strLiteral(el);
                    explicitDefaults.push(s !== null ? s : (ts.isNumericLiteral(el) ? el.text : el.getText()));
                }
            } else {
                warn(ctx, p, `unknown define option "${key}" (expected warp, argumentDefaults)`);
            }
        }
    }
    const sf = node.getSourceFile();
    const text = sf.text;
    const argNames: string[] = [];
    const defaults: string[] = [];
    const params: string[] = [];
    for (const param of fn.parameters) {
        if (!ts.isIdentifier(param.name)) {
            err(ctx, param, `define parameters must be simple names`);
            continue;
        }
        let orig = param.name.text;
        const trails = ts.getTrailingCommentRanges(text, param.getEnd()) ?? [];
        for (const t of trails) {
            const tLine = ts.getLineAndCharacterOfPosition(sf, t.pos).line;
            const pLine = ts.getLineAndCharacterOfPosition(sf, param.getEnd()).line;
            if (tLine !== pLine || t.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
            const body = text.slice(t.pos + 2, t.end - 2).trim();
            if (body.startsWith('"')) {
                try {
                    const parsed: unknown = JSON.parse(body);
                    if (typeof parsed === 'string') orig = parsed;
                } catch {
                    /* keep param */
                }
                break;
            }
        }
        argNames.push(orig);
        params.push(param.name.text);
        defaults.push(paramDefaultText(param));
    }
    const kinds = proccodePlaceholders(proccode);
    const scope: ProcScope = {
        argNames,
        paramToArg: new Map(params.map((p, i) => [p, argNames[i]])),
        booleanArgs: new Set(argNames.filter((_, i) => kinds[i] === 'b')),
    };
    let head: Block | null;
    if (ts.isBlock(fn.body)) head = decodeStatementList(ctx, [...fn.body.statements], scope);
    else head = decodeStatementBlock(ctx, fn.body as ts.Expression, scope);
    const finalDefaults = explicitDefaults ?? defaults;
    const b: Block = {
        opcode: 'procedures_definition',
        inputs: {},
        fields: {},
        proc: { proccode, argumentnames: argNames, argumentdefaults: finalDefaults, warp },
        loc: locOf(ctx, node),
    };
    if (head) b.next = head;
    return b;
}

function paramDefaultText(param: ts.ParameterDeclaration): string {
    if (!param.initializer) return '';
    const init = param.initializer;
    const s = strLiteral(init);
    if (s !== null) return s;
    const n = numLiteral(init);
    if (n !== null) return String(n);
    if (init.kind === ts.SyntaxKind.TrueKeyword) return 'true';
    if (init.kind === ts.SyntaxKind.FalseKeyword) return 'false';
    return '';
}

/** Pre-pass: collect define() proccodes -> arg names (params + trailing comments). */
function collectDefines(ctx: Ctx, sf: ts.SourceFile, text: string): void {
    for (const stmt of sf.statements) {
        if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression)) continue;
        const call = stmt.expression;
        if (!ts.isIdentifier(call.expression) || call.expression.text !== 'define') continue;
        const [procNode, second, third] = call.arguments;
        const proccode = procNode ? strLiteral(procNode) : null;
        if (proccode === null) continue;
        const fn = third && ts.isArrowFunction(third) ? third : second && ts.isArrowFunction(second) ? second : null;
        if (!fn || !ts.isArrowFunction(fn)) continue;
        const argNames: string[] = [];
        for (const param of fn.parameters) {
            if (!ts.isIdentifier(param.name)) continue;
            let orig = param.name.text;
            const trails = ts.getTrailingCommentRanges(text, param.getEnd()) ?? [];
            for (const t of trails) {
                const tLine = ts.getLineAndCharacterOfPosition(sf, t.pos).line;
                const pLine = ts.getLineAndCharacterOfPosition(sf, param.getEnd()).line;
                if (tLine !== pLine || t.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
                const body = text.slice(t.pos + 2, t.end - 2).trim();
                if (body.startsWith('"')) {
                    try {
                        const parsed: unknown = JSON.parse(body);
                        if (typeof parsed === 'string') orig = parsed;
                    } catch {
                        /* keep */
                    }
                    break;
                }
            }
            argNames.push(orig);
        }
        if (!ctx.procDefs.has(proccode)) ctx.procDefs.set(proccode, { argNames, warp: false });
    }
}

function targetNames(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x?.name ?? '')).filter(Boolean);
}

/** Whole-block validation that needs catalog + target tables. */
function validateBlock(ctx: Ctx, b: Block, node: ts.Node): void {
    const spec = getBlockSpec(b.opcode);
    if (!spec) return; // unknown opcode: generic block(), nothing to check
    const costumes: string[] = targetNames(ctx.targetJson?.costumes);
    const sounds: string[] = targetNames(ctx.targetJson?.sounds);
    for (const ispec of spec.inputs) {
        if (ispec.kind !== 'costume' && ispec.kind !== 'sound') continue;
        // Switch-backdrop inputs are backdrops (Stage costumes), not the
        // sprite's own costumes; validated separately on the Stage.
        if (ispec.kind === 'costume' && (b.opcode === 'looks_switchbackdropto' || b.opcode === 'looks_switchbackdroptoandwait')) continue;
        const inp = b.inputs[ispec.name];
        if (!inp || inp.kind !== 'menu') continue;
        const names = ispec.kind === 'costume' ? costumes : sounds;
        if (!names.includes(inp.value)) {
            // Warning only: real projects contain stale names (renamed assets).
            warn(ctx, node, `unknown ${ispec.kind} "${inp.value}"${suggest(inp.value, names)}`);
        }
    }
    if (ctx.isStage) {
        // Backdrops live on the Stage: validate switch/backdrop-hat names.
        if (b.opcode === 'looks_switchbackdropto' || b.opcode === 'looks_switchbackdroptoandwait' || b.opcode === 'event_whenbackdropswitchesto') {
            for (const ispec of spec.inputs) {
                const inp = ispec.kind === 'costume' ? b.inputs[ispec.name] : undefined;
                if (inp && inp.kind === 'menu' && !costumes.includes(inp.value)) {
                    warn(ctx, node, `unknown backdrop "${inp.value}"${suggest(inp.value, costumes)}`);
                }
            }
            for (const fspec of spec.fields) {
                const f = b.fields[fspec.name];
                if (f && !costumes.includes(f.value)) {
                    warn(ctx, node, `unknown backdrop "${f.value}"${suggest(f.value, costumes)}`);
                }
            }
        }
        // Stage has the complete variable/list tables.
        const variables: string[] = targetNames(ctx.targetJson?.variables);
        const lists: string[] = targetNames(ctx.targetJson?.lists);
        const walk = (blk: Block): void => {
            for (const inp of Object.values(blk.inputs)) {
                if (inp.kind === 'var' && !variables.includes(inp.name)) {
                    warn(ctx, node, `unknown variable "${inp.name}"${suggest(inp.name, variables)}`);
                }
                if (inp.kind === 'list' && !lists.includes(inp.name)) {
                    warn(ctx, node, `unknown list "${inp.name}"${suggest(inp.name, lists)}`);
                }
            }
            for (const [fname, f] of Object.entries(blk.fields)) {
                const fspec = spec.fields.find((x) => x.name === fname);
                const kind = fspec?.kind ?? (fname === 'VARIABLE' ? 'variable' : fname === 'LIST' ? 'list' : undefined);
                if (kind === 'variable' && !variables.includes(f.value)) {
                    warn(ctx, node, `unknown variable "${f.value}"${suggest(f.value, variables)}`);
                }
                if (kind === 'list' && !lists.includes(f.value)) {
                    warn(ctx, node, `unknown list "${f.value}"${suggest(f.value, lists)}`);
                }
            }
        };
        walk(b);
    }
}

function mergeComment(
    existing: Comment | undefined,
    lead: { text: string; minimized?: boolean },
    loc: Comment['loc'],
    commentAnchor?: string,
): Comment | undefined {
    if (!lead.text && !existing) return undefined;
    if (!existing) return { ...lead, anchor: commentAnchor, loc };
    return {
        text: lead.text ? `${lead.text}\n${existing.text}` : existing.text,
        minimized: lead.minimized ?? existing.minimized,
        anchor: commentAnchor ?? existing.anchor,
        loc: existing.loc,
    };
}

/** Attach a leading // comment and/or @cN anchor to a block's comment. */
function attachLead<T extends { comment?: Comment }>(blk: T, lead: { comment?: { text: string; minimized?: boolean }; commentAnchor?: string }, loc: Comment['loc']): void {
    if (lead.comment) {
        blk.comment = mergeComment(blk.comment, lead.comment, loc, lead.commentAnchor) as Comment;
    } else if (lead.commentAnchor && blk.comment) {
        blk.comment.anchor = lead.commentAnchor;
    }
}

export function parseScripts(text: string, ctx: FormatCtx): { scripts: Script[]; diagnostics: Diagnostic[] } {
    const sf = ts.createSourceFile(ctx.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diagnostics: Diagnostic[] = [];
    const c: Ctx = {
        file: ctx.file,
        targetJson: ctx.targetJson,
        isStage: ctx.isStage === true,
        diagnostics,
        procDefs: new Map(),
        fnToOp: buildReverseMap(),
    };
    const parseDiags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    for (const d of parseDiags) {
        const pos = typeof d.start === 'number' ? d.start : 0;
        const { line, character } = ts.getLineAndCharacterOfPosition(sf, pos);
        diagnostics.push({
            message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
            file: ctx.file,
            line: line + 1,
            col: character + 1,
            severity: 'error',
        });
    }
    collectDefines(c, sf, text);
    const scripts: Script[] = [];
    for (const stmt of sf.statements) {
        if (ts.isEmptyStatement(stmt)) continue;
        if (!ts.isExpressionStatement(stmt)) {
            err(c, stmt, `only block calls are allowed at the top level (no ${ts.SyntaxKind[stmt.kind]})`);
            continue;
        }
        const lead = leadingInfo(sf, text, stmt);
        const expr = ts.skipOuterExpressions(stmt.expression, ts.OuterExpressionKinds.Assertions) as ts.Expression;
        if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) {
            // Bare reporter expression (vars.score, a + b, ...).
            const decoded = decodeExpr(c, expr, { kind: 'none', opcode: '', name: '' }, EMPTY_SCOPE);
            let blk: Block | null = null;
            if (decoded && 'opcode' in decoded) blk = decoded;
            else if (decoded && decoded.kind === 'var') blk = { opcode: 'data_variable', inputs: {}, fields: { VARIABLE: { value: decoded.name } }, loc: locOf(c, stmt) };
            else if (decoded && decoded.kind === 'list') blk = { opcode: 'data_listcontents', inputs: {}, fields: { LIST: { value: decoded.name } }, loc: locOf(c, stmt) };
            if (!blk) continue;
            const shape = getBlockSpec(blk.opcode)?.shape;
            if (shape !== 'reporter' && shape !== 'boolean' && blk.opcode !== 'data_variable' && blk.opcode !== 'data_listcontents') {
                err(c, stmt, `this expression is not a reporter block`);
                continue;
            }
            attachLead(blk, lead, locOf(c, stmt));

            scripts.push({ anchor: lead.anchor, kind: 'reporter', top: blk, loc: locOf(c, stmt) });
            continue;
        }
        const name = expr.expression.text;
        if (name === 'comment') {
            const [textNode, optsNode] = expr.arguments;
            const t = textNode ? strLiteral(textNode) : null;
            if (t === null) {
                err(c, expr, `comment needs a string literal`);
                continue;
            }
            const minimized = optsNode && ts.isExpression(optsNode) ? optsMinimized(optsNode) : undefined;
            const full = lead.comment ? `${lead.comment.text}\n${t}` : t;
            scripts.push({
                anchor: lead.anchor,
                kind: 'comment',
                comment: { text: full, anchor: lead.commentAnchor ?? lead.anchor, minimized: minimized ?? lead.comment?.minimized, loc: locOf(c, stmt) },
                loc: locOf(c, stmt),
            });
            continue;
        }
        if (name === 'script') {
            const [arrow] = expr.arguments;
            if (!arrow || !ts.isArrowFunction(arrow)) {
                err(c, expr, `script needs an arrow function like script(() => { ... })`);
                continue;
            }
            const head = decodeBody(c, arrow, EMPTY_SCOPE);
            if (!head) {
                if (lead.comment) warn(c, stmt, `empty script() ignored`);
                continue;
            }
            attachLead(head, lead, locOf(c, stmt));
            scripts.push({ anchor: lead.anchor, kind: 'stack', top: head, loc: locOf(c, stmt) });
            continue;
        }
        if (name === 'define') {
            const b = decodeDefine(c, expr);
            if (!b) continue;
            attachLead(b, lead, locOf(c, stmt));
            scripts.push({ anchor: lead.anchor, kind: 'stack', top: b, loc: locOf(c, stmt) });
            continue;
        }
        const decoded = decodeCall(c, expr, { kind: 'none', opcode: '', name: '' }, EMPTY_SCOPE);
        const blk = toBlockInput(decoded);
        if (!blk) continue;
        attachLead(blk, lead, locOf(c, stmt));
        const shape = getBlockSpec(blk.opcode)?.shape;
        if (shape === 'reporter' || shape === 'boolean' || blk.opcode === 'data_variable' || blk.opcode === 'data_listcontents') {
            scripts.push({ anchor: lead.anchor, kind: 'reporter', top: blk, loc: locOf(c, stmt) });
        } else {
            scripts.push({ anchor: lead.anchor, kind: 'stack', top: blk, loc: locOf(c, stmt) });
        }
    }
    return { scripts, diagnostics };
}
