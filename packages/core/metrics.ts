/**
 * Rendered-size model for Scratch blocks.
 *
 * Replicates TurboWarp scratch-blocks' vertical renderer
 * (`core/block_render_svg_vertical.js`, pinned at .cache/tw-scratch-blocks)
 * plus field measurement (`core/field*.js`):
 *
 * - constants: GRID 4, SEP 8, MIN_BLOCK_Y 48, notch 32x8, corner 4,
 *   statement edge 16, hat min width 100, C min width 160,
 *   lone-shadow height 32, reporter height 40, empty slot 40/48/48,
 *   output padding table SHAPE_IN_SHAPE_PADDING, hat/define handling.
 * - label/field widths: exact memoized widths for static editor strings
 *   (metrics/labels.json) + per-glyph widths for the editor font
 *   (500 16px "Helvetica Neue", metrics/glyphs.json) + measured pair
 *   kerning corrections (metrics/pairs.json).
 * - per-opcode input structure (row grouping, label attachment, icon
 *   dummies, empty-slot shapes) learned from rendered fixtures
 *   (metrics/structure.json, see tools/calibrate/extract-structure.py).
 *
 * Run: node --test packages/core/test/ (from the repo root).
 */
import glyphData from './metrics/glyphs.json' with {type: 'json'};
import labelWidths from './metrics/labels.json' with {type: 'json'};
import pairCorr from './metrics/pairs.json' with {type: 'json'};
import structureData from './metrics/structure.json' with {type: 'json'};
import structureJaData from './metrics/structure-ja.json' with {type: 'json'};
import optionsJaData from './metrics/options-ja.json' with {type: 'json'};
import {getBlockSpec} from './catalog/index.ts';

// --- renderer constants (block_render_svg_vertical.js) ---
const GRID = 4;
const SEP_X = 2 * GRID; // 8
const MIN_BLOCK_X = 16 * GRID; // 64
const MIN_BLOCK_X_OUTPUT = 12 * GRID; // 48
const MIN_BLOCK_X_SHADOW_OUTPUT = 10 * GRID; // 40
const MIN_BLOCK_Y = 12 * GRID; // 48
const EXTRA_STATEMENT_ROW_Y = 8 * GRID; // 32
const MIN_BLOCK_X_WITH_STATEMENT = 40 * GRID; // 160
const MIN_BLOCK_Y_SINGLE_FIELD_OUTPUT = 8 * GRID; // 32
const MIN_BLOCK_Y_REPORTER = 10 * GRID; // 40
const MIN_STATEMENT_INPUT_HEIGHT = 6 * GRID; // 24
const NOTCH_WIDTH = 8 * GRID; // 32
const NOTCH_HEIGHT = 2 * GRID; // 8
const CORNER_RADIUS = 1 * GRID; // 4
const STATEMENT_INPUT_EDGE_WIDTH = 4 * GRID; // 16
const STATEMENT_INPUT_INNER_SPACE = 2 * GRID; // 8
const HAT_MIN_WIDTH = 100;
const INPUT_SHAPE_SQUARE_WIDTH = 10 * GRID; // 40
const INPUT_SHAPE_ROUND_WIDTH = 12 * GRID; // 48
const INPUT_SHAPE_HEXAGONAL_WIDTH = 12 * GRID; // 48
const INPUT_SHAPE_HEIGHT = 8 * GRID; // 32
const FIELD_HEIGHT = 8 * GRID; // 32
const EDITABLE_FIELD_PADDING = 6;
const BOX_FIELD_PADDING = 2 * GRID; // 8
const DROPDOWN_ARROW_PADDING = 2 * GRID; // 8
const ARROW_SIZE = 12;
const INPUT_AND_FIELD_MIN_X = 12 * GRID; // 48
const INLINE_PADDING_Y = 1 * GRID; // 4
const DEFINE_BLOCK_PADDING_RIGHT = 2 * GRID; // 8

const OUTPUT_SHAPE_HEXAGONAL = 1;
const OUTPUT_SHAPE_ROUND = 2;
const OUTPUT_SHAPE_SQUARE = 3;

// Outer shape -> inner shape -> padding (SHAPE_IN_SHAPE_PADDING).
const SHAPE_PADDING: Record<number, Record<number, number>> = {
    1: {0: 5 * GRID, 1: 2 * GRID, 2: 5 * GRID, 3: 5 * GRID},
    2: {0: 3 * GRID, 1: 3 * GRID, 2: 1 * GRID, 3: 2 * GRID},
    3: {0: 2 * GRID, 1: 2 * GRID, 2: 2 * GRID, 3: 2 * GRID},
};

// Input type ids (core/constants.js).
const INPUT_VALUE = 1;
const NEXT_STATEMENT = 3;
const DUMMY_INPUT = 5;

// --- text measurement ---
interface GlyphTable {
    ascii: Record<string, number>;
    latin: Record<string, number>;
    jp: Record<string, number>;
    extra: Record<string, number>;
    probes: {space: number};
    avgAscii: number;
    avgJp: number;
}
const GLYPHS = glyphData as unknown as GlyphTable;
const LABELS = labelWidths as unknown as Record<string, number>;
const PAIRS = pairCorr as unknown as Record<string, number>;

function glyphWidth(ch: string): number {
    if (ch === ' ' || ch === ' ') return GLYPHS.probes.space;
    return GLYPHS.ascii[ch] ?? GLYPHS.jp[ch] ?? GLYPHS.extra?.[ch] ??
        GLYPHS.latin[ch] ?? (ch.charCodeAt(0) > 0x3000 ? 16 : GLYPHS.avgAscii);
}

/** Width of editor label text: exact memoized width when known, else sum of glyphs + pair kerning. */
export function textWidth(s: string): number {
    const exact = LABELS[s];
    if (exact !== undefined) return exact;
    const nbsp = s.replace(/ /g, ' ');
    if (nbsp !== s && LABELS[nbsp] !== undefined) return LABELS[nbsp];
    // SVG xml:space=default collapsing: strip ends, collapse inner runs.
    const str = (s === '' ? ' ' : s.replace(/ /g, ' ')).replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ') || ' ';
    let w = 0;
    let prev = '';
    for (const ch of str) {
        w += glyphWidth(ch);
        if (prev !== '') w += PAIRS[prev + ch] ?? 0;
        prev = ch;
    }
    return w;
}

// --- project.json block view ---
export interface JsonBlock {
    opcode?: string;
    next?: string | null;
    parent?: string | null;
    inputs?: Record<string, unknown>;
    fields?: Record<string, unknown>;
    mutation?: Record<string, unknown> | null;
    shadow?: boolean;
    topLevel?: boolean;
    x?: number;
    y?: number;
}
export type Blocks = Record<string, JsonBlock | unknown[]>;

function asDict(b: unknown): JsonBlock | null {
    return (typeof b === 'object' && b !== null && !Array.isArray(b)) ? (b as JsonBlock) : null;
}
function fieldValue(fields: Record<string, unknown> | undefined, name: string): string {
    const f = fields?.[name];
    if (Array.isArray(f) && f.length > 0) return String(f[0]);
    return '';
}

export interface ResolvedInput {
    id: string | null;
    /** Inline literal shadow array, if any. */
    inline: unknown[] | null;
    /** Whether the inline literal renders as a shadow (flag 1) vs real block (flag 3). */
    inlineShadow: boolean;
    /** The sb3 input flag (1 shadow slot, 2 no shadow, 3 block + obscured shadow). */
    flag: number;
}

/** Resolve an input slot to a connected block id, an inline shadow, or null. */
export function resolveInput(blocks: Blocks, input: unknown): ResolvedInput {
    const none: ResolvedInput = {id: null, inline: null, inlineShadow: true, flag: 1};
    if (!Array.isArray(input)) return none;
    const flag = input[0] === 2 || input[0] === 3 ? input[0] : 1;
    let primary: unknown = input.length > 1 ? input[1] : null;
    let fallback: unknown = input.length > 2 ? input[2] : null;
    // [1, null, shadowId] style: primary may be null with shadow in slot 3.
    if ((primary === null || primary === undefined) && fallback !== null && fallback !== undefined) {
        primary = fallback;
        fallback = null;
    }
    if (typeof primary === 'string') {
        if (asDict(blocks[primary])) return {id: primary, inline: null, inlineShadow: true, flag};
        if (typeof fallback === 'string' && asDict(blocks[fallback])) return {id: fallback, inline: null, inlineShadow: true, flag};
        if (Array.isArray(fallback)) return {id: null, inline: fallback, inlineShadow: true, flag};
        return {...none, flag};
    }
    if (Array.isArray(primary)) return {id: null, inline: primary, inlineShadow: flag !== 3, flag};
    if (typeof fallback === 'string' && asDict(blocks[fallback])) return {id: fallback, inline: null, inlineShadow: true, flag};
    if (Array.isArray(fallback)) return {id: null, inline: fallback, inlineShadow: true, flag};
    return {...none, flag};
}

const LITERAL_OPCODE: Record<number, string> = {
    4: 'math_number', 5: 'math_positive_number', 6: 'math_whole_number',
    7: 'math_integer', 8: 'math_angle', 9: 'colour_picker', 10: 'text',
};

/** Opcode + synthetic fields for an inline literal shadow array. */
function inlineShadow(inputName: string, hostOpcode: string, arr: unknown[], shadow: boolean): {opcode: string; fields: Record<string, string>; shadow: boolean} {
    const litType = arr[0] as number;
    const value = arr.length > 1 ? String(arr[1]) : '';
    if (litType === 11) {
        // Menu shadow: opcode depends on the host input's shadow.
        const spec = getBlockSpec(hostOpcode);
        const inp = spec?.inputs.find(i => i.name === inputName);
        const opcode = inp?.shadowOpcode ?? 'event_broadcast_menu';
        const field = inp?.shadowField
            ?? getBlockSpec(opcode)?.fields[0]?.name
            ?? 'OPTION';
        return {opcode, fields: {[field]: value}, shadow};
    }
    if (litType === 12) return {opcode: 'data_variable', fields: {VARIABLE: value}, shadow};
    if (litType === 13) return {opcode: 'data_listcontents', fields: {LIST: value}, shadow};
    const opcode = LITERAL_OPCODE[litType] ?? 'text';
    const field = opcode === 'colour_picker' ? 'COLOUR' : opcode === 'text' ? 'TEXT' : 'NUM';
    return {opcode, fields: {[field]: value}, shadow};
}

// --- structure table ---
interface StructFieldLabel {k: 'label'; t: string}
interface StructFieldImage {k: 'image'; w: number; h: number}
interface StructFieldValue {k: 'field'; name: string; rule: string}
type StructField = StructFieldLabel | StructFieldImage | StructFieldValue;
interface StructInput {
    name: string;
    t: number; // 1 value, 3 statement, 5 dummy
    hex?: boolean;
    align?: string;
    fields: StructField[];
}
interface StructOp {inputs: StructInput[]}
const STRUCTURE = structureData as unknown as Record<string, StructOp>;
const OPTIONS_JA = optionsJaData as Record<string, Record<string, Record<string, string>>>;
const STRUCTURE_JA = structureJaData as unknown as Record<string, StructOp>;
export type MetricsLocale = 'en' | 'ja';
export interface MetricsOptions { locale?: MetricsLocale }

const RIGHT_ALIGN_OPS = new Set(['control_repeat', 'control_repeat_until', 'control_while', 'control_forever']);

function fieldWidthOf(rule: string, value: string, isShadow: boolean, hasBox: boolean): number {
    const t = textWidth(value);
    switch (rule) {
        case 'label': return t;
        case 'text': return t + EDITABLE_FIELD_PADDING;
        case 'dropdown': return t + EDITABLE_FIELD_PADDING + ARROW_SIZE + DROPDOWN_ARROW_PADDING + (isShadow || !hasBox ? 0 : 2 * BOX_FIELD_PADDING);
        case 'getter': return t;
        case 'color': return 10.453125;
        case 'matrix': return 50;
        case 'note': return t + EDITABLE_FIELD_PADDING + (isShadow || !hasBox ? 0 : 2 * BOX_FIELD_PADDING);
        default: return t + EDITABLE_FIELD_PADDING;
    }
}
function fieldHeightOf(rule: string): number {
    return rule === 'label' ? 0 : FIELD_HEIGHT;
}

// Dynamic procedure structure from a proccode (caller + prototype share it).
export type ProcPart = {label: string} | {arg: string; bool: boolean; atype: 'n' | 'b' | 's'};
export function parseProccode(proccode: string, argumentIds: string[]): ProcPart[] {
    const parts: ProcPart[] = [];
    const comps = proccode.split(/(?=[^\\]%[nbs])/);
    let ai = 0;
    for (const comp of comps) {
        let c = comp.trim();
        if (c.startsWith('%') && (c[1] === 'n' || c[1] === 'b' || c[1] === 's')) {
            const atype = c[1] as 'n' | 'b' | 's';
            c = c.substring(2).trim().replace(/\\%/g, '%');
            const id = argumentIds[ai++] ?? `input${ai}`;
            if (c) parts.push({label: c});
            parts.push({arg: id, bool: atype === 'b', atype});
        } else {
            c = c.replace(/\\%/g, '%');
            if (c) parts.push({label: c});
        }
    }
    return parts;
}

interface ProcInfo {
    parts: Array<ProcPart & {name?: string}>;
    warp: boolean;
    ret: number; // 0 statement, 1 reporter, 2 boolean
}
function strArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string') {
        try {
            const p = JSON.parse(v);
            if (Array.isArray(p)) return p.map(String);
        } catch { /* fall through */ }
    }
    return [];
}
function procInfoOf(block: JsonBlock): ProcInfo {
    const m = (block.mutation ?? {}) as Record<string, unknown>;
    const proccode = String(m['proccode'] ?? '');
    const ids = strArray(m['argumentids']);
    const names = strArray(m['argumentnames'] ?? m['argumentNames']);
    const parts: ProcInfo['parts'] = parseProccode(proccode, ids).map(p => {
        if ('label' in p) return p;
        const idx = ids.indexOf(p.arg);
        return {...p, name: idx >= 0 && idx < names.length ? names[idx] : ''};
    });
    return {
        parts,
        warp: m['warp'] === true || m['warp'] === 'true',
        ret: Number(m['return'] ?? 0),
    };
}

interface InputPlan {
    name: string;
    t: number;
    hex: boolean;
    alignRight: boolean;
    fields: Array<{w: number; h: number; editable: boolean; bump: boolean}>;
    // resolved child
    childId: string | null;
    childInline: {opcode: string; fields: Record<string, string>; shadow: boolean} | null;
}

interface BlockPlan {
    opcode: string;
    isShadow: boolean;
    isExtension: boolean;
    hasPrev: boolean;
    hasNext: boolean;
    hasOutput: boolean;
    outputShape: number; // 1 hex, 2 round
    inputs: InputPlan[];
}

function planBlock(blocks: Blocks, id: string | null, inline: {opcode: string; fields: Record<string, string>} | null, locale: MetricsLocale): BlockPlan | null {
    let opcode: string;
    let raw: JsonBlock | null = null;
    let inlineFields: Record<string, string> | null = null;
    if (id !== null) {
        raw = asDict(blocks[id]);
        if (!raw || !raw.opcode) return null;
        opcode = raw.opcode;
    } else if (inline) {
        opcode = inline.opcode;
        inlineFields = inline.fields;
    } else {
        return null;
    }
    const spec = getBlockSpec(opcode);
    const shape = spec?.shape ?? 'stack';
    const isShadow = raw?.shadow ?? inline?.shadow ?? true;
    const isExtension = !!spec?.extension && shape !== 'menu';
    const hasOutput = shape === 'reporter' || shape === 'boolean' || shape === 'menu' || shape === 'argument';
    const outputShape = shape === 'boolean' || opcode === 'argument_reporter_boolean' ? OUTPUT_SHAPE_HEXAGONAL : OUTPUT_SHAPE_ROUND;
    let hasPrev = false;
    let hasNext = false;
    if (!hasOutput) {
        if (shape === 'stack' || shape === 'c' || shape === 'c2') { hasPrev = true; hasNext = true; }
        else if (shape === 'hat') { hasNext = true; }
        else if (shape === 'cap' || shape === 'end-c') { hasPrev = true; }
        else if (shape === 'definition') { hasNext = true; }
        else if (shape === 'prototype') { hasPrev = true; hasNext = true; }
        else { hasPrev = true; hasNext = true; }
    }
    // control_stop with "other scripts in sprite" keeps its next connection
    // (mutation hasnext), unlike the plain cap shape.
    if (opcode === 'control_stop' && raw) {
        const hn = (raw.mutation as Record<string, unknown> | undefined)?.['hasnext'];
        if (hn === true || hn === 'true') hasNext = true;
    }
    // procedures_call with a reporter/boolean return behaves as an output block.
    let callRet = 0;
    if (opcode === 'procedures_call' && raw) callRet = procInfoOf(raw).ret;

    const inputs: InputPlan[] = [];
    const resolveChild = (plan: InputPlan, inputName: string) => {
        if (plan.t !== INPUT_VALUE && plan.t !== NEXT_STATEMENT) return;
        const slot = raw?.inputs?.[inputName];
        const r = resolveInput(blocks, slot);
        if (r.id !== null) {
            plan.childId = r.id;
        } else if (r.inline) {
            plan.childInline = inlineShadow(inputName, opcode, r.inline as unknown[], r.inlineShadow);
        }
    };
    const pushInput = (name: string, t: number, hex: boolean, fields: InputPlan['fields'], alignRight = false) => {
        const plan: InputPlan = {name, t, hex, alignRight, fields, childId: null, childInline: null};
        resolveChild(plan, name);
        inputs.push(plan);
    };

    const fieldVal = (name: string, rule?: string): string => {
        const stored = inlineFields && name in inlineFields
            ? inlineFields[name]
            : fieldValue(raw?.fields as Record<string, unknown> | undefined, name);
        if (rule === 'dropdown') {
            const fspec = getBlockSpec(opcode)?.fields.find(f => f.name === name);
            if (locale === 'ja') {
                const translated = OPTIONS_JA[opcode]?.[name]?.[stored];
                if (translated !== undefined) return translated;
            }
            if (fspec?.dynamic === 'backdrops' || fspec?.dynamic === 'costumes') return stored;
            if (fspec?.options) {
                for (const [label, value] of fspec.options) {
                    if (value === stored) return label;
                }
            }
        }
        return stored;
    };

    if (opcode === 'procedures_call' && raw) {
        const info = procInfoOf(raw);
        const isOutput = info.ret !== 0;
        // Caller rows: dummy labels + value inputs inline, single row.
        let row: InputPlan['fields'] = [];
        const flush = (dummyName: string) => {
            if (row.length > 0) {
                pushInput(dummyName, DUMMY_INPUT, false, row);
                row = [];
            }
        };
        let di = 0;
        for (const p of info.parts) {
            if ('label' in p) {
                row.push({w: textWidth(p.label), h: 0, editable: false, bump: false});
            } else {
                const plan: InputPlan = {name: p.arg, t: INPUT_VALUE, hex: p.bool, alignRight: false, fields: row, childId: null, childInline: null};
                resolveChild(plan, p.arg);
                if (!plan.childId && !plan.childInline && !p.bool) {
                    // The editor generates default shadows for missing call args
                    // (math_number '1' for %n, text '' for %s; %b stays empty).
                    plan.childInline = p.atype === 'n'
                        ? {opcode: 'math_number', fields: {NUM: '1'}, shadow: true}
                        : {opcode: 'text', fields: {TEXT: ''}, shadow: true};
                }
                inputs.push(plan);
                row = [];
                di++;
            }
        }
        flush(`dummy${di}`);
        if (isOutput) {
            return {
                opcode, isShadow, isExtension: false, hasPrev: false, hasNext: false,
                hasOutput: true, outputShape: info.ret === 2 ? OUTPUT_SHAPE_HEXAGONAL : OUTPUT_SHAPE_ROUND,
                inputs,
            };
        }
        return {opcode, isShadow: false, isExtension: false, hasPrev: true, hasNext: true, hasOutput: false, outputShape: OUTPUT_SHAPE_ROUND, inputs};
    }
    if (opcode === 'procedures_prototype' && raw) {
        const info = procInfoOf(raw);
        let row: InputPlan['fields'] = [];
        for (const p of info.parts) {
            if ('label' in p) {
                row.push({w: textWidth(p.label), h: 0, editable: false, bump: false});
            } else {
                const plan: InputPlan = {name: p.arg, t: INPUT_VALUE, hex: p.bool, alignRight: false, fields: row, childId: null, childInline: null};
                resolveChild(plan, p.arg);
                if (!plan.childId && !plan.childInline) {
                    // The editor synthesizes argument reporters for prototype
                    // slots with no stored child, showing the argument name.
                    plan.childInline = {
                        opcode: p.bool ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
                        fields: {VALUE: p.name ?? ''},
                        shadow: true,
                    };
                }
                inputs.push(plan);
                row = [];
            }
        }
        if (row.length > 0) pushInput('trailing', DUMMY_INPUT, false, row);
        return {opcode, isShadow: true, isExtension: false, hasPrev: true, hasNext: true, hasOutput: false, outputShape: OUTPUT_SHAPE_ROUND, inputs};
    }

    const st = (locale === 'ja' ? STRUCTURE_JA[opcode] : undefined) ?? STRUCTURE[opcode] ?? (opcode === 'note' || opcode === 'argument_reporter_boolean' ? STRUCTURE_JA[opcode] : undefined);
    if (st) {
        for (const si of st.inputs) {
            const fields: InputPlan['fields'] = [];
            for (const f of si.fields) {
                if (f.k === 'label') fields.push({w: textWidth(f.t), h: 0, editable: false, bump: false});
                else if (f.k === 'image') fields.push({w: f.w, h: f.h, editable: false, bump: false});
                else fields.push({w: fieldWidthOf(f.rule, fieldVal(f.name, f.rule), isShadow, true), h: fieldHeightOf(f.rule), editable: f.rule !== 'getter', bump: true});
            }
            pushInput(si.name, si.t, !!si.hex, fields, (si.align === 'right') || (RIGHT_ALIGN_OPS.has(opcode) && si.t === DUMMY_INPUT && si.fields.some(f => f.k === 'image')));
        }
    } else {
        // Fallback for opcodes never observed in calibration: single-message
        // template parse; statement inputs (catalog kind stack) break rows.
        fallbackInputs(spec, pushInput, fieldVal, (plan: InputPlan, name: string) => resolveChild(plan, name), inputs, isShadow, locale);
        // The VM prefixes extension messages with a 40px icon and 1px
        // vertical separator. The renderer adds its normal field spacing.
        if (isExtension && shape !== 'menu' && inputs.length > 0) {
            inputs[0].fields.unshift(
                {w: 40, h: 40, editable: false, bump: false},
                {w: 1, h: 40, editable: false, bump: false},
            );
        }
    }
    if (callRet !== 0) {
        return {opcode, isShadow, isExtension: false, hasPrev: false, hasNext: false, hasOutput: true, outputShape: callRet === 2 ? OUTPUT_SHAPE_HEXAGONAL : OUTPUT_SHAPE_ROUND, inputs};
    }
    return {opcode, isShadow, isExtension, hasPrev, hasNext, hasOutput, outputShape, inputs};
}

function fallbackInputs(
    spec: ReturnType<typeof getBlockSpec>,
    pushInput: (name: string, t: number, hex: boolean, fields: InputPlan['fields'], alignRight?: boolean) => void,
    fieldVal: (name: string, rule?: string) => string,
    resolveChild: (plan: InputPlan, name: string) => void,
    inputs: InputPlan[],
    isShadow: boolean,
    locale: MetricsLocale,
): void {
    if (!spec) {
        pushInput('unknown', DUMMY_INPUT, false, []);
        return;
    }
    const tokens = (locale === 'ja' ? spec.text.ja ?? spec.text.en : spec.text.en).split(/(%\d+)/g).filter(t => t.length > 0);
    let row: InputPlan['fields'] = [];
    let seen = 0;
    const flushDummy = () => {
        if (row.length > 0) { pushInput(`dummy${seen++}`, DUMMY_INPUT, false, row); row = []; }
    };
    for (const tok of tokens) {
        const m = tok.match(/^%(\d+)$/);
        if (!m) {
            row.push({w: textWidth(tok), h: 0, editable: false, bump: false});
            continue;
        }
        const arg = spec.args[Number(m[1]) - 1];
        if (!arg) continue;
        if (arg.kind === 'field') {
            const fname = (arg as {field: string}).field;
            const fspec = spec.fields.find(f => f.name === fname);
            const kind = fspec?.kind ?? 'other';
            const rule = (kind === 'variable' || kind === 'list') && spec.shape === 'reporter' && spec.inputs.length === 0 && spec.text.en.trim() === '%1' ? 'getter'
                : kind === 'dropdown' || kind === 'broadcast' ? 'dropdown'
                : kind === 'variable' || kind === 'list' ? 'dropdown'
                : kind === 'color' ? 'color' : kind === 'other' ? 'dropdown' : 'text';
            row.push({w: fieldWidthOf(rule, fieldVal(fname, rule), isShadow, true), h: FIELD_HEIGHT, editable: rule !== 'getter', bump: true});
        } else {
            const iname = (arg as {input: string}).input;
            const ispec = spec.inputs.find(i => i.name === iname);
            if (ispec?.kind === 'stack') {
                flushDummy();
                pushInput(iname, NEXT_STATEMENT, false, row);
                row = [];
            } else {
                const plan: InputPlan = {name: iname, t: INPUT_VALUE, hex: ispec?.kind === 'boolean', alignRight: false, fields: row, childId: null, childInline: null};
                row = [];
                resolveChild(plan, iname);
                inputs.push(plan);
            }
        }
    }
    flushDummy();
}


// --- measurement engine (mirrors renderCompute_ + renderDrawRight_) ---

export interface BlockBox {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface BlockDetail extends BlockBox {
    /** inputRows.rightEdge: comment icons anchor at (x + rw, y + rh0 / 2). */
    rw: number;
    /** First row height. */
    rh0: number;
}
export interface ScriptMeasure {
    width: number;
    height: number;
    perBlock: Map<string, BlockBox>;
}
export interface ScriptMeasureDetailed {
    width: number;
    height: number;
    perBlock: Map<string, BlockDetail>;
}

interface MeasuredNode {
    key: string; // dict id or synthetic inline key
    id: string | null; // dict id when present
    plan: BlockPlan;
    ownW: number; // this.width
    ownH: number; // this.height (cursorY + notch if hasNext)
    cursorY: number; // sum of row heights (no notch)
    rowsRW: number; // inputRows.rightEdge after draw
    rowH0: number; // first row height
    totalW: number; // getHeightWidth().width (incl. next chain)
    totalH: number; // getHeightWidth().height (incl. next chain)
    endsOpen: boolean; // lastConnectionInStack(): stack ends with unconnected next
    kids: Map<InputPlan, MeasuredNode | null>;
    next: MeasuredNode | null;
    stmtEdge: number;
    rowStarts: number[];
    rowConns: Array<Array<{x: number; y: number; inp: InputPlan}>>;
}

function isArgReporter(opcode: string): boolean {
    return opcode === 'argument_reporter_boolean' || opcode === 'argument_reporter_string_number';
}

// Base row height for one input (computeInputHeight_), before linked content.
function baseInputHeight(plan: BlockPlan, inp: InputPlan, rowIsStmt: boolean, prevRowIsStmt: boolean, singleRow: boolean): number {
    if (singleRow && plan.hasOutput && plan.isShadow && !isArgReporter(plan.opcode)) {
        return MIN_BLOCK_Y_SINGLE_FIELD_OUTPUT;
    }
    if (plan.hasOutput) {
        return plan.isExtension ? MIN_BLOCK_Y_REPORTER + 2 * GRID : MIN_BLOCK_Y_REPORTER;
    }
    if (rowIsStmt) return MIN_STATEMENT_INPUT_HEIGHT;
    if (prevRowIsStmt) return EXTRA_STATEMENT_ROW_Y;
    return plan.isExtension && plan.hasPrev ? MIN_BLOCK_Y + 2 * GRID : MIN_BLOCK_Y;
}

export class Measurer {
    plans = new Map<string, BlockPlan | null>();
    nodes = new Map<string, MeasuredNode>();
    inlineSeq = 0;
    blocks: Blocks;

    locale: MetricsLocale;
    constructor(blocks: Blocks, locale: MetricsLocale = 'en') {
        this.blocks = blocks;
        this.locale = locale;
    }

    nodeOf(plan: BlockPlan, id: string | null, key: string): MeasuredNode {
        const cached = this.nodes.get(key);
        if (cached) return cached;
        const node: MeasuredNode = {
            key, id, plan, ownW: 0, ownH: 0, cursorY: 0, rowsRW: 0, rowH0: 0,
            totalW: 0, totalH: 0, endsOpen: false, kids: new Map(), next: null,
            stmtEdge: STATEMENT_INPUT_EDGE_WIDTH, rowStarts: [], rowConns: [],
        };
        this.nodes.set(key, node);
        this.compute(node);
        // Link next AFTER computing (cycles impossible: project.json is a DAG).
        if (plan.hasNext && id !== null) {
            const raw = asDict(this.blocks[id]);
            const nid = typeof raw?.next === 'string' ? raw.next : null;
            if (nid !== null && asDict(this.blocks[nid])) {
                node.next = this.measure(nid, null);
            }
        }
        node.totalW = node.ownW;
        node.totalH = node.ownH;
        if (node.next) {
            node.totalW = Math.max(node.totalW, node.next.totalW);
            node.totalH = node.next.totalH + node.ownH - NOTCH_HEIGHT;
            node.endsOpen = node.next.endsOpen;
        } else {
            node.endsOpen = plan.hasNext;
        }
        return node;
    }

    measure(id: string | null, inline: {opcode: string; fields: Record<string, string>; shadow: boolean} | null): MeasuredNode | null {
        const key = id ?? `inline:${this.inlineSeq++}:${inline?.opcode}:${JSON.stringify(inline?.fields)}`;
        if (this.nodes.has(key)) return this.nodes.get(key) ?? null;
        if (!this.plans.has(key)) {
            this.plans.set(key, planBlock(this.blocks, id, inline, this.locale));
        }
        const plan = this.plans.get(key);
        if (!plan) return null;
        return this.nodeOf(plan, id, key);
    }

    childOf(node: MeasuredNode, inp: InputPlan): MeasuredNode | null {
        const hit = node.kids.get(inp);
        return hit === undefined ? null : hit;
    }

    compute(node: MeasuredNode): void {
        const plan = node.plan;
        // Group inputs into rows.
        const rows: InputPlan[][] = [];
        let lastWasStmt = false;
        let first = true;
        for (const inp of plan.inputs) {
            if (first || lastWasStmt || inp.t === NEXT_STATEMENT) {
                rows.push([]);
                first = false;
            }
            rows[rows.length - 1].push(inp);
            lastWasStmt = inp.t === NEXT_STATEMENT;
        }
        // Resolve children first (they are needed for heights).
        for (const r of rows) {
            for (const inp of r) {
                let child: MeasuredNode | null = null;
                if (inp.t === INPUT_VALUE || inp.t === NEXT_STATEMENT) {
                    if (inp.childId !== null) child = this.measure(inp.childId, null);
                    else if (inp.childInline !== null) child = this.measure(null, inp.childInline);
                }
                node.kids.set(inp, child);
            }
        }
        const isDefine = plan.opcode === 'procedures_definition';
        interface Row {inputs: InputPlan[]; stmt: boolean; h: number; fieldWidth: number; y: number}
        const out: Row[] = [];
        let fieldStatementWidth = 0;
        for (const r of rows) {
            const stmt = r[0].t === NEXT_STATEMENT;
            const row: Row = {inputs: r, stmt, h: 0, fieldWidth: this.fieldRowWidth(r), y: 0};
            const prevStmt = out.length > 0 && out[out.length - 1].stmt;
            if (plan.inputs.length === 1 && plan.hasOutput && plan.isShadow && !isArgReporter(plan.opcode)) {
                row.h = MIN_BLOCK_Y_SINGLE_FIELD_OUTPUT;
            } else if (plan.hasOutput) {
                row.h = plan.isExtension ? MIN_BLOCK_Y_REPORTER + 2 * GRID : MIN_BLOCK_Y_REPORTER;
            } else if (stmt) {
                row.h = MIN_STATEMENT_INPUT_HEIGHT;
            } else if (prevStmt) {
                row.h = EXTRA_STATEMENT_ROW_Y;
            } else {
                row.h = plan.isExtension && plan.hasPrev ? MIN_BLOCK_Y + 2 * GRID : MIN_BLOCK_Y;
            }
            for (const inp of r) {
                if (inp.t === INPUT_VALUE) {
                    const child = node.kids.get(inp) ?? null;
                    const padded = child ? child.totalH + 2 * INLINE_PADDING_Y : INPUT_SHAPE_HEIGHT;
                    row.h = Math.max(row.h, padded);
                } else if (inp.t === NEXT_STATEMENT) {
                    const child = node.kids.get(inp) ?? null;
                    let padded: number;
                    if (child) {
                        padded = child.totalH;
                        if (!(child && !child.endsOpen)) padded -= NOTCH_HEIGHT;
                    } else {
                        padded = INPUT_SHAPE_HEIGHT - NOTCH_HEIGHT;
                    }
                    row.h = Math.max(row.h, padded);
                }
            }
            for (const inp of r) for (const f of inp.fields) row.h = Math.max(row.h, f.h);
            if (stmt) fieldStatementWidth = Math.max(fieldStatementWidth, row.fieldWidth);
            out.push(row);
        }
        const hasStmt = out.some(r => r.stmt);
        const stmtEdge = STATEMENT_INPUT_EDGE_WIDTH + fieldStatementWidth;
        // Minimum right edge (computeRightEdge_).
        let minimum = 0;
        if (plan.hasPrev || plan.hasNext) minimum = Math.max(minimum, MIN_BLOCK_X);
        else if (plan.hasOutput) {
            const lone = plan.isShadow && !isArgReporter(plan.opcode);
            minimum = Math.max(minimum, lone ? MIN_BLOCK_X_SHADOW_OUTPUT : MIN_BLOCK_X_OUTPUT);
        }
        if (hasStmt) minimum = Math.max(minimum, MIN_BLOCK_X_WITH_STATEMENT);
        // Output padding for single-row output blocks (not lone shadows).
        let paddingStart = SEP_X;
        let paddingEnd = SEP_X;
        if (plan.hasOutput && rows.length === 1 && !(plan.isShadow && !isArgReporter(plan.opcode))) {
            paddingStart = 0;
            paddingEnd = 0;
            const shape = plan.outputShape;
            const rowInputs = rows[0];
            const firstInput = rowInputs[0];
            let other: number;
            if (firstInput.fields.length > 0) {
                other = 0;
            } else {
                const c = node.kids.get(firstInput) ?? null;
                other = c ? c.plan.outputShape : (firstInput.hex ? OUTPUT_SHAPE_HEXAGONAL : OUTPUT_SHAPE_ROUND);
                if (shape === OUTPUT_SHAPE_HEXAGONAL && other !== OUTPUT_SHAPE_HEXAGONAL) {
                    paddingStart += (slotH(plan, firstInput, c) - MIN_BLOCK_Y_REPORTER) / 2;
                }
            }
            paddingStart += SHAPE_PADDING[shape][other];
            const lastInput = rowInputs[rowInputs.length - 1];
            if (lastInput.t === INPUT_VALUE) {
                const c = node.kids.get(lastInput) ?? null;
                other = c ? c.plan.outputShape : (lastInput.hex ? OUTPUT_SHAPE_HEXAGONAL : OUTPUT_SHAPE_ROUND);
                if (shape === OUTPUT_SHAPE_HEXAGONAL && other !== OUTPUT_SHAPE_HEXAGONAL) {
                    paddingEnd += (slotH(plan, lastInput, c) - MIN_BLOCK_Y_REPORTER) / 2;
                }
            } else {
                other = 0;
            }
            paddingEnd += SHAPE_PADDING[shape][other];
        }
        // Draw walk.
        let rightEdge = minimum;
        let width = minimum;
        if (!plan.hasOutput && !plan.hasPrev) {
            rightEdge = Math.max(rightEdge, HAT_MIN_WIDTH);
            width = Math.max(width, rightEdge);
        }
        interface Conn {x: number; y: number; inp: InputPlan}
        const conns: Conn[][] = [];
        let cursorY = 0;
        for (let y = 0; y < out.length; y++) {
            const row = out[y];
            const rowConns: Conn[] = [];
            conns.push(rowConns);
            row.y = cursorY;
            if (!row.stmt) {
                let cursorX = paddingStart;
                if (y === 0 && plan.isExtension && plan.hasOutput) cursorX += GRID;
                for (const inp of row.inputs) {
                    if (inp.alignRight) {
                        cursorX += rightEdge - this.inputFieldWidth(inp) - 2 * SEP_X;
                    }
                    for (let j = 0; j < inp.fields.length; j++) {
                        const f = inp.fields[j];
                        if (j > 0 && inp.fields[j - 1].editable && f.editable) cursorX += SEP_X;
                        if (plan.hasPrev && f.bump) cursorX = Math.max(cursorX, INPUT_AND_FIELD_MIN_X);
                        cursorX += f.w + SEP_X;
                    }
                    if (inp.t === INPUT_VALUE) {
                        if (plan.hasPrev) cursorX = Math.max(cursorX, INPUT_AND_FIELD_MIN_X);
                        const child = node.kids.get(inp) ?? null;
                        const cw = child ? child.totalW : inp.hex ? INPUT_SHAPE_HEXAGONAL_WIDTH : INPUT_SHAPE_ROUND_WIDTH;
                        rowConns.push({x: cursorX, y: cursorY + row.h / 2, inp});
                        cursorX += cw + SEP_X;
                    }
                }
                cursorX -= SEP_X;
                cursorX += paddingEnd;
                rightEdge = Math.max(cursorX, rightEdge);
                cursorX = Math.max(cursorX, rightEdge);
                width = Math.max(width, cursorX);
            } else {
                const inp = row.inputs[0];
                const child = node.kids.get(inp) ?? null;
                if (isDefine) {
                    if (child) {
                        rowConns.push({x: stmtEdge + NOTCH_WIDTH, y: cursorY, inp});
                        width = Math.max(width, stmtEdge + child.totalW);
                    }
                    row.h += 3 * GRID;
                    row.h += GRID;
                } else {
                    if (child) {
                        rowConns.push({x: stmtEdge + NOTCH_WIDTH, y: cursorY, inp});
                        width = Math.max(width, stmtEdge + child.totalW);
                    }
                    if (y === out.length - 1 || out[y + 1].stmt) cursorY += EXTRA_STATEMENT_ROW_Y;
                }
            }
            cursorY += row.h;
        }
        node.ownW = width;
        node.cursorY = cursorY;
        node.ownH = cursorY + (plan.hasNext ? NOTCH_HEIGHT : 0);
        node.rowsRW = rightEdge;
        node.rowH0 = out.length > 0 ? out[0].h : 0;
        node.stmtEdge = stmtEdge;
        node.rowStarts = out.map(r => r.y);
        node.rowConns = conns;
    }

    fieldRowWidth(r: InputPlan[]): number {
        let fw = 0;
        for (const inp of r) fw += this.inputFieldWidth(inp);
        return fw;
    }

    inputFieldWidth(inp: InputPlan): number {
        let fw = 0;
        for (let j = 0; j < inp.fields.length; j++) {
            const f = inp.fields[j];
            if (j !== 0) fw += SEP_X;
            if (j > 0 && inp.fields[j - 1].editable && f.editable) fw += SEP_X;
            fw += f.w;
        }
        return fw;
    }
}

// input.renderHeight for hex outer-shape padding (computeInputHeight_ equivalent).
function slotH(plan: BlockPlan, inp: InputPlan, child: MeasuredNode | null): number {
    let base: number;
    if (plan.inputs.length === 1 && plan.hasOutput && plan.isShadow && !isArgReporter(plan.opcode)) {
        base = MIN_BLOCK_Y_SINGLE_FIELD_OUTPUT;
    } else if (plan.hasOutput) {
        base = plan.isExtension ? MIN_BLOCK_Y_REPORTER + 2 * GRID : MIN_BLOCK_Y_REPORTER;
    } else {
        base = MIN_BLOCK_Y;
    }
    if (inp.t === INPUT_VALUE) {
        const padded = child ? child.totalH + 2 * INLINE_PADDING_Y : INPUT_SHAPE_HEIGHT;
        return Math.max(base, padded);
    }
    return base;
}


// --- public API ---

/** Expanded size of a comment from its project.json record. */
export function measureComment(comment: unknown): {w: number; h: number} {
    const c = (comment ?? {}) as {width?: unknown; height?: unknown};
    const w = Number(c.width);
    const h = Number(c.height);
    return {
        w: Number.isFinite(w) && w > 0 ? w : 200,
        h: Number.isFinite(h) && h > 0 ? h : 200,
    };
}

function assignPositions(node: MeasuredNode, x: number, y: number, out: Map<string, BlockDetail>, measurer: Measurer): void {
    out.set(node.key, {x, y, w: node.totalW, h: node.totalH, rw: node.rowsRW, rh0: node.rowH0});
    // next chain
    if (node.next) {
        assignPositions(node.next, x, y + node.cursorY, out, measurer);
    }
    // children
    const rows: InputPlan[][] = [];
    {
        let lastWasStmt = false;
        let first = true;
        for (const inp of node.plan.inputs) {
            if (first || lastWasStmt || inp.t === NEXT_STATEMENT) {
                rows.push([]);
                first = false;
            }
            rows[rows.length - 1].push(inp);
            lastWasStmt = inp.t === NEXT_STATEMENT;
        }
    }
    for (let y2 = 0; y2 < rows.length; y2++) {
        const conns = node.rowConns[y2] ?? [];
        for (const c of conns) {
            const child = measurer.childOf(node, c.inp);
            if (!child || child.id === null) continue;
            if (c.inp.t === NEXT_STATEMENT) {
                assignPositions(child, x + node.stmtEdge, y + node.rowStarts[y2], out, measurer);
            } else {
                assignPositions(child, x + c.x, y + c.y - child.ownH / 2, out, measurer);
            }
        }
    }
}

/**
 * Measure a top-level script: total size (getHeightWidth) plus per-block
 * boxes. Coordinates are relative to the script top-left (0, 0); add the
 * script's project.json x/y for workspace coordinates. Only blocks present
 * in `blocks` (dict form) get entries; inline literal shadows are folded
 * into their parents.
 */
export function measureScript(
    blocks: Blocks,
    topId: string,
    options: MetricsOptions = {},
): ScriptMeasureDetailed {
    const measurer = new Measurer(blocks, options.locale ?? 'en');
    const top = measurer.measure(topId, null);
    const perBlock = new Map<string, BlockDetail>();
    if (top) assignPositions(top, 0, 0, perBlock, measurer);
    // Without an explicit locale, keep English dimensions but expose a safe
    // comment anchor for both supported editor languages.
    if (!options.locale) {
        const japanese = measureScript(blocks, topId, {locale: 'ja'});
        for (const [id, d] of perBlock) {
            const j = japanese.perBlock.get(id);
            if (j) d.rw = Math.max(d.x + d.rw, j.x + j.rw) - d.x;
        }
    }
    return {
        width: top ? top.totalW : 0,
        height: top ? top.totalH : 0,
        perBlock,
    };
}

/** All top-level block ids of a target's blocks dict, in file order. */
export function topLevelIds(blocks: Blocks): string[] {
    const out: string[] = [];
    for (const [id, b] of Object.entries(blocks)) {
        const d = asDict(b);
        if (d && d.topLevel !== false && (d.parent === null || d.parent === undefined) && d.opcode) {
            // Compact [name, ...] arrays (orphan data_variable/list) are skipped:
            // they render as reporters but are stored without geometry.
            out.push(id);
        }
    }
    return out;
}

/** True for output-shaped (orphan-separable) top-level blocks. */
export function isOrphanBlock(blocks: Blocks, id: string): boolean {
    const d = asDict(blocks[id]);
    if (!d || !d.opcode) return false;
    const spec = getBlockSpec(d.opcode);
    const shape = spec?.shape;
    return shape === 'reporter' || shape === 'boolean' || shape === 'menu' || shape === 'argument';
}
