/**
 * Shared syntax helpers for the scratchblocks text format.
 *
 * Bracket codec (all group scanners are quote- and escape-aware):
 *   (10) (10.5) (-3)     number literal            -> {value: number}
 *   ("10") ("a)b")       quoted string literal     -> {value: string}
 *   [hello] ["10"] [#ff] text literal              -> {value: string|number}
 *   [name v]              dropdown / menu / variable / list / broadcast field
 *   <...>                boolean expression
 *   (x :: variables)     explicit kind hints: variables | list | args
 *   (text :: opcode)     explicit reporter/boolean opcode
 *   (lit :: 4)           explicit literal tag override (exact round trip)
 */
import type { Shape } from '../../packages/core/catalog/index.ts';
import { allBlockSpecs } from '../../packages/core/catalog/index.ts';

export type GroupKind = 'paren' | 'square' | 'bool';

export interface SlotRef {
    kind: 'input' | 'field';
    name: string;
}

export type Part = { label: string } | { slot: SlotRef };

export interface Pattern {
    opcode: string;
    shape: Shape;
    /** Full template split into labels and slots. */
    parts: Part[];
    /** Header form for c-shapes (stack slots removed). */
    header: Part[];
    /** Stack input names in template order (c-shapes only). */
    stackSlots: string[];
    /** Lowercase skeleton for did-you-mean, e.g. "move • steps". */
    skeleton: string;
    hasStatic: boolean;
}

function splitTemplate(text: string): Array<string | number> {
    const out: Array<string | number> = [];
    const re = /%(\d+)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        out.push(Number(m[1]));
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

let patternCache: Pattern[] | null = null;

/** All catalog block patterns, built once. Skips menu/prototype/definition/argument shapes. */
export function getPatterns(): Pattern[] {
    if (patternCache) return patternCache;
    const skip = new Set(['menu', 'prototype', 'definition', 'argument']);
    const out: Pattern[] = [];
    for (const spec of allBlockSpecs()) {
        if (skip.has(spec.shape)) continue;
        const chunks = splitTemplate(spec.text.en);
        const parts: Part[] = [];
        for (const c of chunks) {
            if (typeof c === 'string') {
                if (c !== '') parts.push({ label: c });
            } else {
                const arg = spec.args[c - 1];
                if (!arg) continue;
                if (arg.kind === 'input') parts.push({ slot: { kind: 'input', name: arg.input } });
                else parts.push({ slot: { kind: 'field', name: arg.field } });
            }
        }
        const stackSlots: string[] = [];
        for (const p of parts) {
            if ('slot' in p && p.slot.kind === 'input') {
                const ispec = spec.inputs.find((i) => i.name === p.slot.name);
                if (ispec?.kind === 'stack') stackSlots.push(p.slot.name);
            }
        }
        let header: Part[];
        if (spec.shape === 'c' || spec.shape === 'c2' || spec.shape === 'end-c') {
            // Header: drop substack slots and labels between two substack
            // slots (e.g. the "else" of if/else).
            const h: Part[] = [];
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if ('slot' in p && p.slot.kind === 'input' && stackSlots.includes(p.slot.name)) continue;
                if ('label' in p) {
                    const prev = parts[i - 1];
                    const next = parts[i + 1];
                    const isStackSlot = (x: Part | undefined): boolean =>
                        !!x && 'slot' in x && x.slot.kind === 'input' && stackSlots.includes(x.slot.name);
                    if (isStackSlot(prev) && isStackSlot(next)) continue;
                }
                h.push(p);
            }
            // Drop a trailing empty label left by removing "%2".
            while (h.length > 0 && 'label' in h[h.length - 1] && (h[h.length - 1] as { label: string }).label.trim() === '') {
                h.pop();
            }
            header = h;
        } else {
            header = parts;
        }
        const skeleton = parts
            .map((p) => ('label' in p ? p.label : '•'))
            .join('')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        const hasStatic = parts.some((p) => 'label' in p && p.label.trim() !== '');
        out.push({ opcode: spec.opcode, shape: spec.shape, parts, header, stackSlots, skeleton, hasStatic });
    }
    patternCache = out;
    return out;
}

/** Non-hidden stack/hat/cap/c patterns for statement matching (hidden ones still parse). */
export function visiblePatterns(): Pattern[] {
    void 0;
    return getPatterns();
}

// ---------------------------------------------------------------------------
// Escapes
// ---------------------------------------------------------------------------

/** Escape literal text for [...] (brackets, quotes, controls). */
export function escSquare(s: string): string {
    return s
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/"/g, '\\"')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

/** Escape literal text for "..." inside parens/brackets. */
export function escQuoted(s: string): string {
    return s
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/"/g, '\\"');
}

/** Unescape (lenient: unknown escapes keep the backslash). */
export function unesc(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) {
            const n = s[i + 1];
            if (n === 'n') out += '\n';
            else if (n === 't') out += '\t';
            else if (n === 'r') out += '\r';
            else if (n === '\\') out += '\\';
            else if (n === '"') out += '"';
            else if (n === '[') out += '[';
            else if (n === ']') out += ']';
            else if (n === '(') out += '(';
            else if (n === ')') out += ')';
            else if (n === '<') out += '<';
            else if (n === '>') out += '>';
            else out += '\\' + n;
            i++;
        } else {
            out += s[i];
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Bracket scanning (quote- and escape-aware, nests same-type brackets)
// ---------------------------------------------------------------------------

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '<': '>' };

/**
 * Read a bracket group starting at text[i] (text[i] must be an opener).
 * Returns the inner text and the index just past the closer, or null.
 */
export function readGroup(text: string, i: number): { kind: GroupKind; inner: string; end: number } | null {
    const open = text[i];
    const close = OPENERS[open];
    if (!close) return null;
    const kind: GroupKind = open === '(' ? 'paren' : open === '[' ? 'square' : 'bool';
    let depth = 0;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inStr) {
            if (c === '\\') j++;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
            continue;
        }
        if (c === '\\') {
            j++;
            continue;
        }
        if (c === open) depth++;
        else if (c === close) {
            depth--;
            if (depth === 0) return { kind, inner: text.slice(i + 1, j), end: j + 1 };
        }
    }
    return null;
}

/** True when the whole trimmed text is exactly one bracket group. */
export function asSingleGroup(text: string): { kind: GroupKind; inner: string } | null {
    const t = text.trim();
    if (t.length < 2 || !(t[0] in OPENERS)) return null;
    const g = readGroup(t, 0);
    if (g && g.end === t.length) return { kind: g.kind, inner: g.inner };
    return null;
}

function skipWs(text: string, pos: number): number {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    return pos;
}

function matchWord(text: string, pos: number, word: string): number {
    pos = skipWs(text, pos);
    if (text.slice(pos, pos + word.length).toLowerCase() === word.toLowerCase()) return pos + word.length;
    return -1;
}

/**
 * Candidate `>` closers for a `<` at pos: every `>` that is not inside a
 * string, a nested (...) / [...] group, or a star comment, shortest first.
 * (`>` doubles as template text in e.g. `(a) > (b)`, so matching backtracks
 * from short to long; the first split whose remainder matches is the
 * top-level operator.)
 */
export function boolCloserCandidates(text: string, pos: number): number[] {
    const out: number[] = [];
    let depthParen = 0;
    let depthSquare = 0;
    let inStr = false;
    for (let j = pos + 1; j < text.length; j++) {
        const c = text[j];
        if (inStr) {
            if (c === '\\') j++;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
            continue;
        }
        if (c === '\\') {
            j++;
            continue;
        }
        if (c === '/' && text[j + 1] === '*') {
            const end = text.indexOf('*/', j + 2);
            if (end < 0) break;
            j = end + 1;
            continue;
        }
        if (c === '(') depthParen++;
        else if (c === '[') depthSquare++;
        else if (c === ')') depthParen = Math.max(0, depthParen - 1);
        else if (c === ']') depthSquare = Math.max(0, depthSquare - 1);
        else if (c === '>' && depthParen === 0 && depthSquare === 0) out.push(j + 1);
    }
    return out;
}

/** Consume a trailing star comment (same line) at pos; null if none. */
export function readStarComment(text: string, pos: number): { text: string; end: number } | null {
    let p = pos;
    while (p < text.length && /\s/.test(text[p])) p++;
    if (text[p] !== '/' || text[p + 1] !== '*') return null;
    const end = text.indexOf('*/', p + 2);
    if (end < 0) return null;
    return { text: text.slice(p + 2, end), end: end + 2 };
}

/**
 * Match template parts against text at pos. Labels match case-insensitively
 * with flexible internal whitespace. Slots consume one bracket group.
 * Bool slots backtrack over candidate `>` closers (shortest first).
 * If restOk is given, only ends satisfying it are returned (callers use this
 * to require full consumption (empty rest for expressions, empty or comment rest for lines).
 */
export function matchParts(parts: Part[], text: string, pos = 0, restOk?: (end: number) => boolean): { slots: string[]; end: number } | null {
    for (const m of matchPartsAll(parts, text, pos, restOk)) return m;
    return null;
}

/** Lazily enumerate all structural matches (bool closers shortest-first). */
export function* matchPartsAll(parts: Part[], text: string, pos = 0, restOk?: (end: number) => boolean): Generator<{ slots: string[]; end: number }> {
    const slots: string[] = [];
    const done = (p: number): number | null => (!restOk || restOk(p) ? p : null);
    const rec = function* (idx: number, p: number): Generator<number> {
        if (idx === parts.length) {
            const d = done(p);
            if (d !== null) yield d;
            return;
        }
        const part = parts[idx];
        if ('label' in part) {
            let q = skipWs(text, p);
            const words = part.label.split(/\s+/).filter((w) => w !== '');
            for (const w of words) {
                q = matchWord(text, q, w);
                if (q < 0) return;
            }
            yield* rec(idx + 1, q);
            return;
        }
        const slot = (part as { slot: { kind: string; name: string } }).slot;
        void slot;
        p = skipWs(text, p);
        const c = text[p];
        if (c !== '(' && c !== '[' && c !== '<') return;
        // A trailing star comment binds to the preceding group.
        const withStar = (end: number): { text: string; end: number } => {
            const star = readStarComment(text, end);
            if (star) return { text: text.slice(p, star.end), end: star.end };
            return { text: text.slice(p, end), end };
        };
        if (c === '<') {
            for (const end of boolCloserCandidates(text, p)) {
                const s = withStar(end);
                slots.push(s.text);
                yield* rec(idx + 1, s.end);
                slots.pop();
            }
            return;
        }
        const g = readGroup(text, p);
        if (!g) return;
        const s = withStar(g.end);
        slots.push(s.text);
        yield* rec(idx + 1, s.end);
        slots.pop();
    };
    for (const end of rec(0, skipWs(text, pos))) {
        yield { slots: [...slots], end };
    }
}

/** Split "content :: hint" at the last top-level :: (depth/quote aware). */
export function splitHint(inner: string): { content: string; hint: string } | null {
    let depth = 0;
    let inStr = false;
    let found = -1;
    for (let i = 0; i < inner.length - 1; i++) {
        const c = inner[i];
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
        else if (c === ':' && inner[i + 1] === ':' && depth === 0) found = i;
    }
    if (found < 0) return null;
    return { content: inner.slice(0, found), hint: inner.slice(found + 2) };
}

// ---------------------------------------------------------------------------
// Levenshtein for did-you-mean
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
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
        for (let j = 1; j <= m; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        const t = prev;
        prev = cur;
        cur = t;
    }
    return prev[m];
}

/** Nearest candidates (up to 3) within a dynamic threshold. */
export function nearest<T>(target: string, items: T[], key: (t: T) => string): T[] {
    const scored = items.map((it) => ({ it, d: levenshtein(target.toLowerCase(), key(it).toLowerCase()) }));
    scored.sort((a, b) => a.d - b.d);
    const limit = Math.max(3, Math.floor(target.length / 2));
    return scored
        .filter((s) => s.d <= limit)
        .slice(0, 3)
        .map((s) => s.it);
}

/** "did you mean …" suffix listing up to 3 examples. */
export function didYouMean(examples: string[]): string {
    if (examples.length === 0) return '';
    return ` (did you mean ${examples.map((e) => `"${e}"`).join(', ')})?`;
}

/** Normalize a block line's skeleton: bracket groups -> %, lowercase. */
export function lineSkeleton(line: string): string {
    let out = '';
    let i = 0;
    while (i < line.length) {
        const c = line[i];
        if (c === '(' || c === '[' || c === '<') {
            const g = readGroup(line, i);
            if (g) {
                out += '•';
                i = g.end;
            } else {
                out += c;
                i++;
            }
        } else {
            out += c;
            i++;
        }
    }
    return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

export const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Split a proccode like "jump %s %n steps" into labels and placeholders. */
export function splitProccode(proccode: string): { labels: string[]; placeholders: string[] } {
    const labels: string[] = [];
    const placeholders: string[] = [];
    const re = /%[snb]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(proccode)) !== null) {
        labels.push(proccode.slice(last, m.index));
        placeholders.push(m[0]);
        last = m.index + m[0].length;
    }
    labels.push(proccode.slice(last));
    return { labels, placeholders };
}
