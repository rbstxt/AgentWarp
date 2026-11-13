/**
 * Catalog generator: extracts block definitions from the real TurboWarp sources
 * and writes ../blocks.json.
 *
 * Sources (all under <repo>/.cache, pinned commits recorded in blocks.json meta):
 *  - tw-scratch-blocks/blocks_vertical/*.js + blocks_common/{math,text,colour,matrix,note}.js
 *    (jsonInit message0/args0 blocks; shape extensions)
 *  - tw-scratch-blocks/msg/messages.js overlaid on msg/json/en.json (English label text)
 *  - tw-scratch-l10n/editor/blocks/ja.json (Japanese label text, same message keys)
 *  - tw-scratch-gui/src/lib/make-toolbox-xml.js (default shadows + default values per input)
 *  - tw-scratch-vm/src/extensions/{scratch3_pen,scratch3_music,scratch3_text2speech,
 *    scratch3_translate,scratch3_video_sensing,scratch3_makeymakey}/index.js (getInfo())
 *    plus tw-scratch-l10n/editor/extensions/{en,ja}.json for extension label text.
 *
 * Run:  node packages/core/catalog/gen/generate.ts   (from the repo root)
 * Node >= 23 runs the .ts directly (erasable syntax only: no enums, namespaces,
 * parameter properties; explicit .ts extensions on relative imports).
 */
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as vm from 'node:vm';

const GEN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = path.dirname(GEN_DIR);
const REPO = path.resolve(CATALOG_DIR, '..', '..', '..');
const CACHE = path.join(REPO, '.cache');
const SB = path.join(CACHE, 'tw-scratch-blocks');
const GUI = path.join(CACHE, 'tw-scratch-gui');
const VM = path.join(CACHE, 'tw-scratch-vm');
const L10N = path.join(CACHE, 'tw-scratch-l10n');

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function gitHash(dir: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: dir, encoding: 'utf8'}).trim();
}

/** Marker object standing in for any Blockly.* value inside jsonInit literals. */
const MARK = '@@';
function makeRef(p: string): any {
    const fn: any = function () {
        return makeRef(p + '()');
    };
    return new Proxy(fn, {
        get(_t: any, prop: string | symbol): any {
            // NOTE: well-known symbols are per-realm, so match ALL symbols here.
            if (typeof prop === 'symbol') return () => MARK + p + MARK;
            if (prop === 'toString' || prop === 'valueOf') return () => MARK + p + MARK;
            return makeRef(p + '.' + String(prop));
        },
        apply(): any {
            return makeRef(p + '()');
        },
        construct(): any {
            return makeRef(p + '()');
        },
    });
}

function isMark(v: unknown): v is string {
    return typeof v === 'string' && v.startsWith(MARK) && v.endsWith(MARK);
}

/** Extract the Blockly.* path from a marker string OR marker proxy (function). */
function asMark(v: unknown): string | null {
    if (typeof v === 'string') return isMark(v) ? markPath(v) : null;
    if ((typeof v === 'function' || typeof v === 'object') && v !== null) {
        try {
            const s = String(v);
            if (isMark(s)) return markPath(s);
        } catch {
            /* ignore */
        }
    }
    return null;
}

function markPath(v: string): string {
    return v.slice(MARK.length, -MARK.length);
}

/** Scan a balanced (...) group starting at the '(' at index `open`. Handles strings/comments. */
function balanced(src: string, open: number): string {
    let i = open;
    if (src[i] !== '(') throw new Error('expected ( at ' + open);
    let depth = 0;
    let str: string | null = null;
    let esc = false;
    let lineComment = false;
    let blockComment = false;
    for (; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1];
        if (lineComment) {
            if (c === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (c === '*' && n === '/') {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (str) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === str) str = null;
            continue;
        }
        if (c === '/' && n === '/') {
            lineComment = true;
            i++;
            continue;
        }
        if (c === '/' && n === '*') {
            blockComment = true;
            i++;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            str = c;
            continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) return src.slice(open + 1, i);
        }
    }
    throw new Error('unbalanced parens from ' + open);
}

/** Evaluate one jsonInit object literal with Blockly stubbed to marker refs. */
function evalJsonInit(objSrc: string): any {
    const base: Record<string, any> = {Blockly: makeRef('Blockly')};
    const sandbox = new Proxy(base, {
        // Resolve every free identifier (e.g. randomColour()) to a marker ref.
        has: () => true,
        get: (t, prop: string | symbol): any => {
            if (typeof prop === 'symbol') return () => MARK + 'global' + MARK;
            if (prop in t) return t[prop];
            return makeRef(String(prop));
        },
    });
    return vm.runInNewContext('(' + objSrc + ')', sandbox);
}

/* ------------------------------------------------------------------ */
/* Message tables (en + ja)                                            */
/* ------------------------------------------------------------------ */

interface MsgTables {
    en: Record<string, string>;
    ja: Record<string, string>;
    extEn: Record<string, string>;
    extJa: Record<string, string>;
}

function loadMessages(): MsgTables {
    const en: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(SB, 'msg', 'json', 'en.json'), 'utf8'));
    // messages.js is newer than en.json (e.g. PROCEDURES_RETURN); overlay it.
    const msgsSrc = fs.readFileSync(path.join(SB, 'msg', 'messages.js'), 'utf8');
    const re = /Blockly\.Msg\.([A-Z_0-9]+) = '((?:[^'\\]|\\.)*)';/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(msgsSrc)) !== null) {
        const key = m[1];
        if (!(key in en)) en[key] = m[2].replace(/\\'/g, "'");
    }
    const ja: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(L10N, 'editor', 'blocks', 'ja.json'), 'utf8'));
    const extEn: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(L10N, 'editor', 'extensions', 'en.json'), 'utf8'));
    const extJa: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(L10N, 'editor', 'extensions', 'ja.json'), 'utf8'));
    return {en, ja, extEn, extJa};
}

/** Resolve a jsonInit string that is either a literal or a Blockly.Msg.* marker. */
function resolveMsg(v: unknown, tables: MsgTables): {en: string; ja?: string} {
    const p = asMark(v);
    if (p !== null) {
        if (p.startsWith('Blockly.Msg.')) {
            const key = p.slice('Blockly.Msg.'.length);
            return {en: tables.en[key] ?? key, ja: tables.ja[key]};
        }
        return {en: v as string};
    }
    if (typeof v !== 'string') return {en: ''};
    return {en: v};
}

/* ------------------------------------------------------------------ */
/* Toolbox: default shadows + toolbox membership                       */
/* ------------------------------------------------------------------ */

interface ShadowDefault {
    shadowOpcode: string;
    shadowField?: string;
    def?: string;
}

function loadToolbox(): {inToolbox: Set<string>; shadows: Map<string, ShadowDefault>} {
    const src = fs.readFileSync(path.join(GUI, 'src', 'lib', 'make-toolbox-xml.js'), 'utf8');
    const inToolbox = new Set<string>();
    for (const m of src.matchAll(/<block[^>]*type="([^"]+)"/g)) inToolbox.add(m[1]);
    // translate('ID', 'fallback') constants used as ${var} defaults in the template.
    const fallbacks: Record<string, string> = {};
    for (const m of src.matchAll(/const (\w+) = translate\('[^']*', '((?:[^'\\]|\\.)*)'\)/g)) {
        fallbacks[m[1]] = m[2].replace(/\\'/g, "'");
    }
    const shadows = new Map<string, ShadowDefault>();
    // <value name="IN"> <shadow [id] type="OP"> [<field name="F">default</field>] </shadow> </value>
    const re =
        /<block[^>]*type="([^"]+)"[^>]*>([\s\S]*?)(?=<block[^>]*type="|<\/category>)/g;
    let bm: RegExpExecArray | null;
    while ((bm = re.exec(src)) !== null) {
        const blockType = bm[1];
        const body = bm[2];
        const vre = /<value name="([^"]+)">\s*<shadow(?: id="[^"]*")? type="([^"]+)"\s*\/?>(?:\s*<field name="([^"]+)"(?:>([\s\S]*?)<\/field>|\/>))?/g;
        let vm2: RegExpExecArray | null;
        while ((vm2 = vre.exec(body)) !== null) {
            const [, input, shadowOpcode, shadowField, rawDef] = vm2;
            let def: string | undefined;
            if (rawDef !== undefined) {
                def = rawDef.replace(/\$\{(\w+)\}/g, (_s, name: string) => fallbacks[name] ?? '');
                if (def === '' || /\$\{/.test(def)) def = undefined;
            }
            shadows.set(blockType + '.' + input, {shadowOpcode, shadowField, def});
        }
    }
    // Data-category blocks are not in make-toolbox-xml.js: scratch-blocks builds them at runtime in
    // core/data_category.js (DataCategory.addSetVariableTo / addChangeVariableBy / addAddToList …).
    // Mirror those defaults here.
    const DATA_SHADOWS: Array<[string, string, string, string]> = [
        ['data_setvariableto.VALUE', 'text', 'TEXT', '0'],
        ['data_changevariableby.VALUE', 'math_number', 'NUM', '1'],
        ['data_addtolist.ITEM', 'text', 'TEXT', 'thing'],
        ['data_deleteoflist.INDEX', 'math_integer', 'NUM', '1'],
        ['data_insertatlist.ITEM', 'text', 'TEXT', 'thing'],
        ['data_insertatlist.INDEX', 'math_integer', 'NUM', '1'],
        ['data_replaceitemoflist.INDEX', 'math_integer', 'NUM', '1'],
        ['data_replaceitemoflist.ITEM', 'text', 'TEXT', 'thing'],
        ['data_itemoflist.INDEX', 'math_integer', 'NUM', '1'],
        ['data_itemnumoflist.ITEM', 'text', 'TEXT', 'thing'],
        ['data_listcontainsitem.ITEM', 'text', 'TEXT', 'thing'],
        ['procedures_return.VALUE', 'text', 'TEXT', ''],
    ];
    for (const [key, shadowOpcode, shadowField, def] of DATA_SHADOWS) {
        if (!shadows.has(key)) shadows.set(key, {shadowOpcode, shadowField, def: def === '' ? undefined : def});
    }
    return {inToolbox, shadows};
}

/* ------------------------------------------------------------------ */
/* Core blocks from scratch-blocks                                     */
/* ------------------------------------------------------------------ */

interface RawCore {
    opcode: string;
    json: any;
    file: string;
    hasInit: boolean;
}

const CORE_FILES = [
    'motion.js',
    'looks.js',
    'sound.js',
    'event.js',
    'control.js',
    'sensing.js',
    'operators.js',
    'data.js',
    'procedures.js',
    'extensions.js',
];

const COMMON_FILES = [
    ['math.js', 'literals'],
    ['text.js', 'literals'],
    ['colour.js', 'literals'],
    ['matrix.js', 'literals'],
    ['note.js', 'literals'],
] as Array<[string, string]>;

function parseCoreFile(dir: string, file: string): RawCore[] {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const out: RawCore[] = [];
    const re = /Blockly\.Blocks\['([^']+)'\] = \{/g;
    let m: RegExpExecArray | null;
    const starts: Array<{opcode: string; idx: number}> = [];
    while ((m = re.exec(src)) !== null) starts.push({opcode: m[1], idx: m.index});
    for (let k = 0; k < starts.length; k++) {
        const {opcode, idx} = starts[k];
        const end = k + 1 < starts.length ? starts[k + 1].idx : src.length;
        const chunk = src.slice(idx, end);
        const jm = /this\.jsonInit\(/.exec(chunk);
        if (!jm) {
            out.push({opcode, json: null, file, hasInit: false});
            continue;
        }
        const objSrc = balanced(chunk, jm.index + 'this.jsonInit'.length);
        out.push({opcode, json: evalJsonInit(objSrc), file, hasInit: true});
    }
    return out;
}

const CATEGORY_MAP: Record<string, string> = {
    motion: 'motion',
    looks: 'looks',
    sounds: 'sound',
    sound: 'sound',
    event: 'event',
    events: 'event',
    control: 'control',
    sensing: 'sensing',
    pen: 'pen',
    operators: 'operators',
    more: 'more',
    data: 'data',
    'data-lists': 'data',
};

function categoryOf(raw: RawCore, fallbackFile: string): string {
    const c = asMark(raw.json?.category);
    if (c !== null && c.startsWith('Blockly.Categories.')) {
        const key = c.slice('Blockly.Categories.'.length);
        if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];
    }
    const base = fallbackFile.replace(/\.js$/, '');
    if (base === 'extensions') return 'more';
    if (base === 'procedures' || base === '__common__') {
        if (base === '__common__') return 'literals';
        return 'procedures';
    }
    return CATEGORY_MAP[base] ?? base;
}

const IMAGE_TYPES = new Set(['field_image', 'field_vertical_separator']);

interface ArgEntry {
    kind: 'input' | 'field';
    name: string;
    json: any;
}

/** GUI-overridden dynamic menus: opcode.field -> dynamic marker. */
const GUI_DYNAMIC: Record<string, 'sprites' | 'sprites+stage' | 'costumes' | 'sounds' | 'backdrops' | 'other'> = {
    'motion_pointtowards_menu.TOWARDS': 'sprites',
    'motion_goto_menu.TO': 'sprites',
    'motion_glideto_menu.TO': 'sprites',
    'sensing_of_object_menu.OBJECT': 'sprites+stage',
    'sensing_distancetomenu.DISTANCETOMENU': 'sprites',
    'sensing_touchingobjectmenu.TOUCHINGOBJECTMENU': 'sprites',
    'control_create_clone_of_menu.CLONE_OPTION': 'sprites',
    'sound_sounds_menu.SOUND_MENU': 'sounds',
    'looks_costume.COSTUME': 'costumes',
    'looks_backdrops.BACKDROP': 'backdrops',
    'event_whenbackdropswitchesto.BACKDROP': 'backdrops',
    'sensing_of.PROPERTY': 'other',
};

const SHADOW_KIND: Record<string, string> = {
    math_number: 'number',
    math_positive_number: 'positive_number',
    math_whole_number: 'whole_number',
    math_integer: 'integer',
    math_angle: 'angle',
    text: 'text',
    colour_picker: 'color',
    matrix: 'matrix',
    note: 'note',
};

function buildCoreSpec(
    raw: RawCore,
    tables: MsgTables,
    toolbox: {inToolbox: Set<string>; shadows: Map<string, ShadowDefault>},
    warnings: string[],
): {spec: any; note?: string} | null {
    const {opcode, json} = raw;
    if (!raw.hasInit) {
        if (opcode === 'control_stop') return {spec: manualControlStop(tables)};
        warnings.push(`${opcode}: no jsonInit, skipped`);
        return null;
    }
    // Collect message0..N / args0..N.
    const messages: unknown[] = [];
    const args: any[][] = [];
    for (let i = 0; i < 10; i++) {
        const msg = json['message' + i];
        if (msg === undefined && json['args' + i] === undefined) {
            if (i === 0) break;
            continue;
        }
        messages[i] = msg;
        args[i] = json['args' + i] ?? [];
    }
    // Template: join message parts, renumbering %n over non-image args.
    const argEntries: ArgEntry[] = [];
    const partsEn: string[] = [];
    const partsJa: string[] = [];
    let counter = 0;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i] === undefined && (args[i] ?? []).length === 0) continue;
        const msgList = args[i] ?? [];
        const indexOf = new Map<number, number>(); // args[i] position -> %n
        msgList.forEach((a: any, k: number) => {
            if (a && !IMAGE_TYPES.has(a.type)) indexOf.set(k, ++counter);
        });
        const r = resolveMsg(messages[i] ?? '', tables);
        const conv = (t: string): string =>
            t.replace(/%(\d+)/g, (_s, d: string) => {
                const n = indexOf.get(Number(d) - 1);
                return n === undefined ? '' : '%' + n;
            });
        partsEn.push(conv(r.en));
        partsJa.push(r.ja === undefined ? '' : conv(r.ja));
        msgList.forEach((a: any) => {
            if (!a || IMAGE_TYPES.has(a.type)) return;
            argEntries.push({
                kind: a.type === 'input_value' || a.type === 'input_statement' ? 'input' : 'field',
                name: a.name,
                json: a,
            });
        });
    }
    const textEn = partsEn.join(' ').replace(/ +/g, ' ').trim();
    const textJaRaw = partsJa.join(' ').replace(/ +/g, ' ').trim();
    const textJa = partsJa.every(p => p === '') ? undefined : textJaRaw || undefined;

    const extensions: string[] = (json.extensions ?? []).filter((e: unknown) => typeof e === 'string');
    const has = (e: string): boolean => extensions.includes(e);
    const stmtInputs = argEntries.filter(
        e => e.kind === 'input' && e.json.type === 'input_statement').length;
    const output = json.output;
    let shape: string;
    if (opcode === 'procedures_definition') shape = 'definition';
    else if (opcode === 'procedures_prototype' || opcode === 'procedures_declaration') shape = 'prototype';
    else if (opcode.startsWith('argument_reporter_')) shape = 'argument';
    else if (opcode.startsWith('argument_editor_')) {
        shape = opcode.endsWith('_boolean') ? 'boolean' : 'reporter';
    } else if (has('shape_hat')) shape = 'hat';
    else if (has('shape_end')) shape = stmtInputs > 0 ? 'end-c' : 'cap';
    else if (has('shape_statement')) shape = stmtInputs >= 2 ? 'c2' : stmtInputs === 1 ? 'c' : 'stack';
    else if (isMenuBlock(argEntries, messages)) shape = 'menu';
    else if (output === 'Boolean' || has('output_boolean')) shape = 'boolean';
    else if (output !== undefined || has('output_number') || has('output_string')) shape = 'reporter';
    else if (json.previousStatement === null && json.nextStatement === null) shape = 'stack';
    else {
        warnings.push(`${opcode}: cannot determine shape, defaulting to stack`);
        shape = 'stack';
    }

    const inputs: any[] = [];
    const fields: any[] = [];
    const argsOut: any[] = [];
    for (const e of argEntries) {
        if (e.kind === 'input') {
            argsOut.push({kind: 'input', input: e.name});
            inputs.push(buildInputSpec(opcode, e, toolbox, warnings));
        } else {
            argsOut.push({kind: 'field', field: e.name});
            fields.push(buildFieldSpec(opcode, e, tables, warnings));
        }
    }

    const category = categoryOf(raw, raw.file);
    const isMenuSh = shape === 'menu';
    const isLiteral = raw.file === '__common__';
    const hidden =
        !toolbox.inToolbox.has(opcode) &&
        category !== 'data' &&
        !opcode.startsWith('procedures_') &&
        !opcode.startsWith('argument_');
    return {
        spec: {
            opcode,
            category,
            shape,
            text: textJa === undefined ? {en: textEn} : {en: textEn, ja: textJa},
            args: argsOut,
            inputs,
            fields,
            ...(hidden ? {hidden: true} : {}),
            ...(isMenuSh || isLiteral ? {isShadowOnly: true} : {}),
        },
    };
}

function isMenuBlock(argEntries: ArgEntry[], messages: unknown[]): boolean {
    if (messages[0] !== '%1') return false;
    if (argEntries.length !== 1 || argEntries[0].kind !== 'field') return false;
    const t = argEntries[0].json.type;
    if (t === 'field_dropdown') return true;
    if (t === 'field_variable') {
        const vt = argEntries[0].json.variableTypes;
        const flat = Array.isArray(vt)
            ? vt.map((x: unknown) => {
                try {
                    return String(x);
                } catch {
                    return '';
                }
            }).join(' ')
            : '';
        return flat.includes('BROADCAST');
    }
    return false;
}

function buildInputSpec(
    opcode: string,
    e: ArgEntry,
    toolbox: {shadows: Map<string, ShadowDefault>},
    warnings: string[],
): any {
    const name: string = e.name;
    if (e.json.type === 'input_statement') return {name, kind: 'stack'};
    const shadow = toolbox.shadows.get(opcode + '.' + name);
    if (shadow) {
        const s = shadow.shadowOpcode;
        let kind: string;
        if (SHADOW_KIND[s]) kind = SHADOW_KIND[s];
        else if (s === 'event_broadcast_menu') kind = 'broadcast';
        else if (s === 'sound_sounds_menu') kind = 'sound';
        else if (s === 'looks_costume' || s === 'looks_backdrops') kind = 'costume';
        else kind = 'menu';
        const spec: any = {name, kind, shadowOpcode: s};
        if (shadow.shadowField) spec.shadowField = shadow.shadowField;
        if (shadow.def !== undefined) {
            const n = Number(shadow.def);
            spec.default = shadow.def !== '' && !Number.isNaN(n) ? n : shadow.def;
        }
        return spec;
    }
    const check = e.json.check;
    if (check === 'Boolean' || (Array.isArray(check) && check.includes('Boolean'))) {
        return {name, kind: 'boolean'};
    }
    if (opcode.startsWith('data_')) return {name, kind: 'any'};
    warnings.push(`${opcode}.${name}: value input without toolbox shadow or check; kind=any`);
    return {name, kind: 'any'};
}

function buildFieldSpec(opcode: string, e: ArgEntry, tables: MsgTables, warnings: string[]): any {
    const name: string = e.name;
    const t: string = e.json.type;
    const key = opcode + '.' + name;
    const dyn = GUI_DYNAMIC[key];
    if (t === 'field_dropdown' || t === 'field_numberdropdown') {
        const options: Array<[string, string]> = (e.json.options ?? []).map((o: any) => {
            const r = resolveMsg(o[0], tables);
            return [r.en, String(o[1])];
        });
        const spec: any = {name, kind: 'dropdown'};
        if (options.length > 0) spec.options = options;
        if (dyn) spec.dynamic = dyn;
        return spec;
    }
    if (t === 'field_variable' || t === 'field_variable_getter') {
        const vt = e.json.variableTypes ?? e.json.variableType ?? '';
        const flat = Array.isArray(vt) ? vt.join(' ') : String(vt);
        if (flat.includes('BROADCAST')) return {name, kind: 'broadcast', dynamic: 'broadcast'};
        if (flat.includes('LIST')) return {name, kind: 'list', dynamic: 'lists'};
        return {name, kind: 'variable', dynamic: 'variables'};
    }
    if (t === 'field_number') return {name, kind: 'number'};
    if (t === 'field_angle') return {name, kind: 'angle'};
    if (t === 'field_checkbox') return {name, kind: 'checkbox'};
    if (t === 'field_colour' || t === 'field_colour_slider') return {name, kind: 'color'};
    if (t === 'field_note' || t === 'field_matrix') return {name, kind: 'other'};
    if (t.startsWith('field_label') || t === 'field_input' || t === 'field_text' || t === 'field_input_removable') {
        return {name, kind: 'text'};
    }
    warnings.push(`${opcode}.${name}: unknown field type ${t}; kind=other`);
    return {name, kind: 'other'};
}

/** control_stop is built with appendDummyInput (no jsonInit); encode it manually. */
function manualControlStop(tables: MsgTables): any {
    const r = (k: string): string => tables.en[k] ?? k;
    const en = `${r('CONTROL_STOP')} %1`;
    const jaBody = tables.ja['CONTROL_STOP'];
    return {
        opcode: 'control_stop',
        category: 'control',
        shape: 'cap',
        text: jaBody === undefined ? {en} : {en, ja: `${jaBody} %1`},
        args: [{kind: 'field', field: 'STOP_OPTION'}],
        inputs: [],
        fields: [{
            name: 'STOP_OPTION',
            kind: 'dropdown',
            options: [
                [r('CONTROL_STOP_ALL'), 'all'],
                [r('CONTROL_STOP_THIS'), 'this script'],
                [r('CONTROL_STOP_OTHER'), 'other scripts in sprite'],
            ],
        }],
    };
}

/* ------------------------------------------------------------------ */
/* VM extensions (pen, music, text2speech, translate, videoSensing,    */
/* makeymakey): load the real getInfo() with stubbed heavy imports.    */
/* ------------------------------------------------------------------ */

const EXT_IDS = ['pen', 'music', 'text2speech', 'translate', 'videoSensing', 'makeymakey'] as const;

const EXT_DIR: Record<string, string> = {
    pen: 'scratch3_pen',
    music: 'scratch3_music',
    text2speech: 'scratch3_text2speech',
    translate: 'scratch3_translate',
    videoSensing: 'scratch3_video_sensing',
    makeymakey: 'scratch3_makeymakey',
};

/** format-message stub: the en-locale result is the `default` message. */
function stubFormatMessage(): any {
    const fn: any = (opts: any) => {
        if (!opts || typeof opts !== 'object') return opts;
        // Box the string so the message id survives for ja lookup.
        const s = new String(opts.default);
        (s as any).msgId = opts.id;
        return s;
    };
    fn.setup = () => ({locale: 'en'});
    return fn;
}

function loadExtensionClass(extId: string): any {
    const dir = path.join(VM, 'src', 'extensions', EXT_DIR[extId]);
    const file = path.join(dir, 'index.js');
    const code = fs.readFileSync(file, 'utf8');
    const vendorLangs = JSON.parse(
        fs.readFileSync(path.join(GEN_DIR, 'vendor-translate-languages.json'), 'utf8'));
    const languageNamesStub = {
        menuMap: {en: vendorLangs.menuMap.en},
        nameMap: {},
        scratchToGoogleMap: vendorLangs.scratchToGoogleMap,
        previouslySupported: [],
        spokenLanguages: {en: []},
    };
    const moduleObj = {exports: {}};
    const localRequire = (id: string): any => {
        if (id === 'format-message') return stubFormatMessage();
        if (id === 'scratch-translate-extension-languages') return languageNamesStub;
        if (/(^|\/)engine\/runtime$/.test(id) || /(^|\/)io\/video$/.test(id)) return {};
        if (/\/library$/.test(id) && id.includes('video_sensing')) return function () {};
        if (!id.startsWith('.')) throw new Error(`unexpected bare import ${id} in ${extId}`);
        const resolved = path.resolve(dir, id);
        // Util/engine/io modules pull npm deps and browser APIs; getInfo() never needs them.
        if (resolved.includes(`${path.sep}util${path.sep}`) ||
            resolved.includes(`${path.sep}engine${path.sep}`) ||
            resolved.includes(`${path.sep}io${path.sep}`)) return {};
        return createRequire(file)(resolved);
    };
    const sandbox: Record<string, any> = {
        require: localRequire,
        module: moduleObj,
        exports: moduleObj.exports,
        navigator: {languages: ['en'], language: 'en', userLanguage: 'en'},
        console,
        setInterval: () => 0,
        clearInterval: () => {},
        setTimeout: () => 0,
        clearTimeout: () => {},
    };
    vm.runInNewContext(code, sandbox, {filename: file});
    const Cls = (moduleObj.exports as any).default ?? moduleObj.exports;
    if (typeof Cls !== 'function') throw new Error(`${extId}: no exported class`);
    return Cls;
}

const ARG_TYPE_KIND: Record<string, {kind: string; shadow?: {type: string; field: string}}> = {
    angle: {kind: 'angle', shadow: {type: 'math_angle', field: 'NUM'}},
    Boolean: {kind: 'boolean'},
    color: {kind: 'color', shadow: {type: 'colour_picker', field: 'COLOUR'}},
    number: {kind: 'number', shadow: {type: 'math_number', field: 'NUM'}},
    string: {kind: 'text', shadow: {type: 'text', field: 'TEXT'}},
    matrix: {kind: 'matrix', shadow: {type: 'matrix', field: 'MATRIX'}},
    note: {kind: 'note', shadow: {type: 'note', field: 'NOTE'}},
    costume: {kind: 'costume', shadow: {type: 'looks_costume', field: 'COSTUME'}},
    sound: {kind: 'sound', shadow: {type: 'sound_sounds_menu', field: 'SOUND_MENU'}},
    image: {kind: 'other'},
};

const BLOCK_TYPE_SHAPE: Record<string, string> = {
    command: 'stack',
    reporter: 'reporter',
    Boolean: 'boolean',
    boolean: 'boolean',
    hat: 'hat',
    event: 'hat',
    conditional: 'c',
    loop: 'c',
};

function templateFromBrackets(text: string, order: string[]): {en: string; indexOf: Map<string, number>} {
    const indexOf = new Map<string, number>();
    let n = 0;
    const en = text.replace(/\[([A-Za-z0-9_]+)\]/g, (_s, name: string) => {
        if (!indexOf.has(name)) indexOf.set(name, ++n);
        void order;
        return '%' + indexOf.get(name);
    });
    return {en, indexOf};
}

function buildExtensionSpecs(
    extId: string,
    tables: MsgTables,
    warnings: string[],
): any[] {
    const Cls = loadExtensionClass(extId);
    const fakeRuntime: any = {on() {}, getTargetForStage: () => null, getEditingTarget: () => null};
    const inst = new Cls(fakeRuntime);
    if (extId === 'videoSensing') {
        // Skip the getInfo() side effect that powers on the video device
        // (updateVideoDisplay); block metadata is unaffected.
        inst.firstInstall = false;
    }
    const info = inst.getInfo();
    const specs: any[] = [];
    const seenMenus = new Set<string>();
    for (const b of info.blocks ?? []) {
        if (b.blockType === 'label' || b.blockType === 'button' || !b.opcode || !b.text) continue;
        const opcode = `${extId}_${b.opcode}`;
        const msgId = (b.text as any)?.msgId as string | undefined;
        const enText: string = String(b.text);
        const jaRaw = msgId ? (tables.extJa[msgId] ?? tables.extEn[msgId]) : undefined;
        const argDefs: Record<string, any> = b.arguments ?? {};
        const placeholders: string[] = [...enText.matchAll(/\[([A-Za-z0-9_]+)\]/g)].map(mm => mm[1]);
        const argNames = Object.keys(argDefs);
        if (placeholders.join(',') !== argNames.filter(a => argDefs[a]?.type !== 'image').join(',')) {
            warnings.push(`${opcode}: placeholder order [${placeholders}] != arg order [${argNames}]`);
        }
        const {en, indexOf} = templateFromBrackets(enText, argNames);
        const ja = jaRaw === undefined
            ? undefined
            : jaRaw.replace(/\[([A-Za-z0-9_]+)\]/g, (_s, name: string) => {
                const n = indexOf.get(name);
                return n === undefined ? `[${name}]` : '%' + n;
            });
        let shape = BLOCK_TYPE_SHAPE[String(b.blockType)] ?? 'stack';
        if ((b.blockType === 'command' || b.blockType === 'conditional' || b.blockType === 'loop') && b.isTerminal) {
            shape = 'cap';
        }
        if (shape === 'c' || (b.blockType !== undefined && !BLOCK_TYPE_SHAPE[String(b.blockType)])) {
            warnings.push(`${opcode}: unexpected blockType ${b.blockType}, shape=${shape}`);
        }
        const inputs: any[] = [];
        const argsOut: any[] = [];
        for (const name of [...indexOf.keys()]) {
            const a = argDefs[name];
            if (!a) {
                warnings.push(`${opcode}: placeholder [${name}] has no argument def`);
                continue;
            }
            argsOut.push({kind: 'input', input: name});
            const tk = ARG_TYPE_KIND[String(a.type)] ?? {kind: 'any'};
            if (a.menu) {
                seenMenus.add(a.menu);
                const dv = a.defaultValue;
                const def = extId === 'translate' ? undefined
                    : typeof dv === 'number' ? dv
                    : dv === undefined || dv === null ? undefined
                    : String(dv);
                const spec: any = {
                    name,
                    kind: (tk.kind === 'text' || tk.kind === 'number') ? 'menu' : tk.kind,
                    shadowOpcode: `${extId}_menu_${a.menu}`,
                    shadowField: a.menu,
                };
                if (def !== undefined) spec.default = def;
                inputs.push(spec);
            } else if (tk.shadow) {
                const spec: any = {name, kind: tk.kind, shadowOpcode: tk.shadow.type, shadowField: tk.shadow.field};
                const dv = a.defaultValue;
                if (typeof dv === 'number') spec.default = dv;
                else if (dv !== undefined && dv !== null) spec.default = String(dv);
                inputs.push(spec);
            } else {
                inputs.push({name, kind: tk.kind});
            }
        }
        for (const name of argNames) {
            if (!indexOf.has(name) && argDefs[name]?.type !== 'image') {
                warnings.push(`${opcode}: argument ${name} not referenced in text`);
            }
        }
        specs.push({
            opcode,
            category: extId,
            shape,
            text: ja === undefined ? {en} : {en, ja},
            args: argsOut,
            inputs,
            fields: [],
            extension: extId,
        });
    }
    // Synthesize menu shadow blocks: <ext>_menu_<Menu>.
    const menus: Record<string, any> = info.menus ?? {};
    for (const menuName of Object.keys(menus)) {
        if (!seenMenus.has(menuName)) {
            warnings.push(`${extId}: menu ${menuName} defined but unused`);
        }
        const items = menus[menuName]?.items ?? menus[menuName] ?? [];
        const options: Array<[string, string]> = (Array.isArray(items) ? items : []).map((it: any) => [
            String(it.text ?? it[0]),
            String(it.value ?? it[1]),
        ]);
        specs.push({
            opcode: `${extId}_menu_${menuName}`,
            category: extId,
            shape: 'menu',
            text: {en: '%1'},
            args: [{kind: 'field', field: menuName}],
            inputs: [],
            fields: [{name: menuName, kind: 'dropdown', ...(options.length > 0 ? {options} : {})}],
            extension: extId,
            hidden: true,
            isShadowOnly: true,
        });
    }
    return specs;
}

/* ------------------------------------------------------------------ */
/* Procedures: mutation-driven; fixed specs + notes.                   */
/* ------------------------------------------------------------------ */

function proceduresSpecs(tables: MsgTables): Array<{spec: any; note: string}> {
    const r = (k: string, fb: string): {en: string; ja?: string} => {
        const en = tables.en[k] ?? fb;
        const ja = tables.ja[k];
        return ja === undefined ? {en} : {en, ja};
    };
    void r;
    return [
        {
            spec: {
                opcode: 'procedures_definition',
                category: 'procedures',
                shape: 'definition',
                text: {en: 'define'},
                args: [],
                inputs: [],
                fields: [],
            },
            note: 'Inputs are mutation-driven (the definition always carries a custom_block ' +
                'input holding a procedures_prototype shadow; argument names/ids live in the ' +
                'mutation proccode/argumentids, not in statically named inputs).',
        },
        {
            spec: {
                opcode: 'procedures_prototype',
                category: 'procedures',
                shape: 'prototype',
                text: {en: ''},
                args: [],
                inputs: [],
                fields: [],
            },
            note: 'Shadow of procedures_definition; inputs are mutation-driven from proccode/argumentids.',
        },
        {
            spec: {
                opcode: 'procedures_call',
                category: 'procedures',
                shape: 'stack',
                text: {en: ''},
                args: [],
                inputs: [],
                fields: [],
            },
            note: 'Inputs are mutation-driven: one input per procedure argument, named by the ' +
                'mutation argumentids. Shape is stack, reporter, or boolean according to the return type.',
        },
        {
            spec: {
                opcode: 'argument_reporter_string_number',
                category: 'procedures',
                shape: 'argument',
                text: {en: '%1'},
                args: [{kind: 'field', field: 'VALUE'}],
                inputs: [],
                fields: [{name: 'VALUE', kind: 'text'}],
            },
            note: 'VALUE names the procedure argument; resolved against the enclosing custom block.',
        },
        {
            spec: {
                opcode: 'argument_reporter_boolean',
                category: 'procedures',
                shape: 'argument',
                text: {en: '%1'},
                args: [{kind: 'field', field: 'VALUE'}],
                inputs: [],
                fields: [{name: 'VALUE', kind: 'text'}],
            },
            note: 'VALUE names the procedure argument; resolved against the enclosing custom block.',
        },
        {
            spec: {
                opcode: 'procedures_declaration',
                category: 'procedures',
                shape: 'prototype',
                text: {en: ''},
                args: [],
                inputs: [],
                fields: [],
                hidden: true,
            },
            note: 'Editor-only root of the procedure declaration dialog; never stored in project.json.',
        },
        {
            spec: {
                opcode: 'argument_editor_boolean',
                category: 'procedures',
                shape: 'boolean',
                text: {en: '%1'},
                args: [{kind: 'field', field: 'TEXT'}],
                inputs: [],
                fields: [{name: 'TEXT', kind: 'text'}],
                hidden: true,
            },
            note: 'Editor-only (procedure declaration dialog); never stored in project.json.',
        },
        {
            spec: {
                opcode: 'argument_editor_string_number',
                category: 'procedures',
                shape: 'reporter',
                text: {en: '%1'},
                args: [{kind: 'field', field: 'TEXT'}],
                inputs: [],
                fields: [{name: 'TEXT', kind: 'text'}],
                hidden: true,
            },
            note: 'Editor-only (procedure declaration dialog); never stored in project.json.',
        },
    ];
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

function main(): void {
    const warnings: string[] = [];
    const tables = loadMessages();
    const toolbox = loadToolbox();

    const specs = new Map<string, any>();
    const notes: Record<string, string> = {};
    const add = (spec: any, note?: string): void => {
        if (specs.has(spec.opcode)) warnings.push(`duplicate spec for ${spec.opcode}`);
        specs.set(spec.opcode, spec);
        if (note) notes[spec.opcode] = note;
    };

const GENERATED_PROCEDURES = new Set([
    'procedures_definition',
    'procedures_prototype',
    'procedures_call',
    'procedures_declaration',
    'argument_reporter_string_number',
    'argument_reporter_boolean',
    'argument_editor_boolean',
    'argument_editor_string_number',
]);

    for (const f of CORE_FILES) {
        for (const raw of parseCoreFile(path.join(SB, 'blocks_vertical'), f)) {
            // Replaced by the fixed mutation-driven specs below (except
            // procedures_return, which is a real block).
            if (GENERATED_PROCEDURES.has(raw.opcode)) continue;
            const built = buildCoreSpec(raw, tables, toolbox, warnings);
            if (built) add(built.spec, built.note);
        }
    }
    for (const [f] of COMMON_FILES) {
        for (const raw of parseCoreFile(path.join(SB, 'blocks_common'), f)) {
            raw.file = '__common__';
            const built = buildCoreSpec(raw, tables, toolbox, warnings);
            if (built) add(built.spec, built.note);
        }
    }
    // Fixed mutation-driven specs for procedures (not extracted above).
    for (const {spec, note} of proceduresSpecs(tables)) add(spec, note);

    for (const extId of EXT_IDS) {
        for (const spec of buildExtensionSpecs(extId, tables, warnings)) add(spec);
    }

    const blocks: Record<string, any> = {};
    for (const opcode of [...specs.keys()].sort()) blocks[opcode] = specs.get(opcode);
    const out = {
        meta: {
            generatedBy: 'packages/core/catalog/gen/generate.ts',
            sources: {
                'tw-scratch-blocks': gitHash(SB),
                'tw-scratch-gui': gitHash(GUI),
                'tw-scratch-vm': gitHash(VM),
                'tw-scratch-l10n': gitHash(L10N),
            },
        },
        notes,
        blocks,
    };
    fs.writeFileSync(path.join(CATALOG_DIR, 'blocks.json'), JSON.stringify(out, null, 2) + '\n');
    const withJa = [...specs.values()].filter(s => s.text.ja !== undefined).length;
    console.log(`opcodes: ${specs.size}, with ja: ${withJa}`);
    const byCat = new Map<string, number>();
    for (const s of specs.values()) byCat.set(s.category, (byCat.get(s.category) ?? 0) + 1);
    console.log('by category: ' + [...byCat.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' '));
    if (warnings.length > 0) {
        console.log(`warnings (${warnings.length}):`);
        for (const w of warnings) console.log('  - ' + w);
    }
}

main();
