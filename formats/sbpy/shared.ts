/**
 * sbpy shared helpers: shadow-tag defaults, opcode aliases, edit distance,
 * string/number tokenizing and printing.
 */
import { allBlockSpecs, getBlockSpec } from '../../packages/core/catalog/index.ts';

/** Shadow block opcode -> inline literal tag. */
export const SHADOW_TAG: Record<string, number> = {
    math_number: 4,
    math_positive_number: 5,
    math_whole_number: 6,
    math_integer: 7,
    math_angle: 8,
    colour_picker: 9,
    text: 10,
};

/**
 * Default inline-literal tag for a value input. The printer omits the tag
 * annotation when the IR litType equals this; the parser assumes it for
 * plain literals. MUST be the same function on both sides.
 */
export function defaultTag(opcode: string, inputName: string): number {
    const spec = getBlockSpec(opcode);
    const ispec = spec?.inputs.find((i) => i.name === inputName);
    if (ispec?.shadowOpcode && SHADOW_TAG[ispec.shadowOpcode] !== undefined) {
        return SHADOW_TAG[ispec.shadowOpcode];
    }
    switch (ispec?.kind) {
        case 'number':
            return 4;
        case 'positive_number':
            return 5;
        case 'whole_number':
            return 6;
        case 'integer':
            return 7;
        case 'angle':
            return 8;
        case 'color':
            return 9;
        default:
            return 10;
    }
}

/** True when an input slot takes a menu shadow (plain string = menu). */
export function isMenuSlot(opcode: string, inputName: string): boolean {
    const ispec = getBlockSpec(opcode)?.inputs.find((i) => i.name === inputName);
    if (!ispec) return false;
    if (ispec.kind === 'menu') return true;
    if (ispec.shadowOpcode && getBlockSpec(ispec.shadowOpcode)?.shape === 'menu') return true;
    return false;
}

/** True when an input slot takes a broadcast reference. */
export function isBroadcastSlot(opcode: string, inputName: string): boolean {
    return getBlockSpec(opcode)?.inputs.find((i) => i.name === inputName)?.kind === 'broadcast';
}

/** Names reserved for sbpy syntax; never offered as opcode aliases. */
export const RESERVED = new Set([
    'var',
    'list',
    'broadcast',
    'call',
    'define',
    'raw',
    'field',
    'input',
    'stack',
    'mutation',
    'pass',
    'else',
    'arg',
    'barg',
    'lit',
    'definition',
    'true',
    'false',
    'none',
]);

/**
 * Short aliases: the opcode segment after the last underscore, offered only
 * when it is unambiguous across the whole catalog and not a reserved word.
 * E.g. `movesteps` -> `motion_movesteps`. The canonical printer always
 * emits full opcodes; the parser accepts aliases.
 */
export const aliasToOpcode: Map<string, string> = buildAliases();

function buildAliases(): Map<string, string> {
    const byShort = new Map<string, string[]>();
    for (const s of allBlockSpecs()) {
        const short = s.opcode.split('_').pop() as string;
        const arr = byShort.get(short);
        if (arr) arr.push(s.opcode);
        else byShort.set(short, [s.opcode]);
    }
    const out = new Map<string, string>();
    for (const [short, ops] of byShort) {
        if (ops.length === 1 && !RESERVED.has(short) && short !== ops[0]) {
            out.set(short, ops[0]);
        }
    }
    return out;
}

/** Resolve a statement name to a catalog opcode (full name or alias). */
export function resolveOpcode(name: string): string | undefined {
    if (getBlockSpec(name)) return name;
    return aliasToOpcode.get(name);
}

/** Levenshtein distance (grapheme-ish: UTF-16 code units are fine here). */
export function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    const n = a.length;
    const m = b.length;
    if (n === 0) return m;
    if (m === 0) return n;
    let prev = new Array<number>(m + 1);
    let cur = new Array<number>(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
        cur[0] = i;
        const ca = a.charCodeAt(i - 1);
        for (let j = 1; j <= m; j++) {
            const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        const t = prev;
        prev = cur;
        cur = t;
    }
    return prev[m];
}

/** Nearest candidates to query, best first (up to n). */
export function nearest(query: string, candidates: string[], n = 3): string[] {
    return candidates
        .map((c) => ({ c, d: editDistance(query, c) }))
        .sort((a, b) => a.d - b.d || (a.c < b.c ? -1 : 1))
        .slice(0, n)
        .map((x) => x.c);
}

/** Print a string value with double quotes (JSON). */
export function printString(s: string): string {
    return JSON.stringify(s);
}

/**
 * Parse a quoted string starting at s[pos] (single or double quote).
 * Returns the value and the position just past the closing quote.
 */
export function parseQuoted(s: string, pos: number): { value: string; next: number } {
    const q = s[pos];
    if (q !== '"' && q !== "'") throw new Error(`expected string at column ${pos + 1}`);
    let out = '';
    let i = pos + 1;
    for (;;) {
        if (i >= s.length) throw new Error('unterminated string literal');
        const c = s[i];
        if (c === q) return { value: out, next: i + 1 };
        if (c === '\\') {
            const e = s[i + 1];
            if (e === undefined) throw new Error('unterminated string literal');
            switch (e) {
                case 'n':
                    out += '\n';
                    break;
                case 't':
                    out += '\t';
                    break;
                case 'r':
                    out += '\r';
                    break;
                case 'b':
                    out += '\b';
                    break;
                case 'f':
                    out += '\f';
                    break;
                case 'v':
                    out += '\v';
                    break;
                case '0':
                    out += '\0';
                    break;
                case 'u': {
                    const hex = s.slice(i + 2, i + 6);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error('bad \\u escape in string literal');
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 4;
                    break;
                }
                default:
                    out += e;
                    break;
            }
            i += 2;
        } else {
            out += c;
            i++;
        }
    }
}

/** Split a comma-separated argument list at depth 0 (strings and all brackets respected). */
export function splitTopLevel(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === '"' || c === "'") {
            const { next } = parseQuoted(s, i);
            cur += s.slice(i, next);
            i = next;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        if (c === ',' && depth === 0) {
            parts.push(cur);
            cur = '';
        } else {
            cur += c;
        }
        i++;
    }
    parts.push(cur);
    return parts;
}

/** Canonical number printing (stable across parse/print). */
export function printNumber(n: number): string {
    return JSON.stringify(n);
}

/** All catalog opcodes (for did-you-mean). */
export function allOpcodes(): string[] {
    return allBlockSpecs().map((s) => s.opcode);
}
