/**
 * generateDts: write per-target project.d.ts style declarations so
 * `tsc --noEmit` catches typos in scripts.ts files.
 *
 * Writes <projectDir>/.agentwarp/types/<TargetDir>.d.ts, one file per target
 * directory (self-contained: block functions + vars/lists/costumes/sounds/
 * broadcasts/sprite/backdrop unions for that target).
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getBlockSpec, allBlockSpecs } from '../../packages/core/catalog/index.ts';
import { fnNameFor } from './names.ts';

const SCALAR = 'string | number';
/** Dynamic value: a reporter result or variable (assignable to string|number slots, but not to name unions). */
const DYN = 'Dyn | VarRef | ListRef';
const BODY = 'body: () => void';

interface TargetInfo {
    dir: string;
    name: string;
    isStage: boolean;
    variables: string[];
    lists: string[];
    broadcasts: string[];
    costumes: string[];
    sounds: string[];
    proccodes: string[];
}

function unionOrString(names: string[]): string {
    const uniq = [...new Set(names)];
    if (uniq.length === 0) return 'string';
    return uniq.map((n) => JSON.stringify(n)).join(' | ');
}

function fieldType(kind: string | undefined, fname: string): string {
    if (kind === 'variable') return 'VarRef';
    if (kind === 'list') return 'ListRef';
    if (kind === 'broadcast') return 'BroadcastName';
    if (kind === 'number' || kind === 'angle') return 'number';
    return 'string';
}

function staticUnion(options: Array<[string, string]> | undefined, fallback = 'string'): string {
    if (!options || options.length === 0) return fallback;
    return options.map(([, v]) => JSON.stringify(v)).join(' | ');
}

/** Scratch stores some dropdowns case-variant (GHOST vs ghost); keep string. */
const LOOSE_DROPDOWNS = new Set(['EFFECT']);

/** Static dropdowns whose catalog options miss values seen in the wild. */
const EXTENDED_OPTIONS: Record<string, string[]> = {
    'control_stop.STOP_OPTION': ['all', 'this script', 'other scripts in sprite', 'other scripts in stage'],
};

function dropdownType(opcode: string, fname: string): string {
    const ext = EXTENDED_OPTIONS[`${opcode}.${fname}`];
    if (ext) return ext.map((v) => JSON.stringify(v)).join(' | ');
    if (fname === 'BACKDROP') return 'BackdropName';
    const fspec = getBlockSpec(opcode)?.fields.find((f) => f.name === fname);
    if (!fspec) return 'string';
    if (LOOSE_DROPDOWNS.has(fname)) return 'string';
    if (fspec.options && fspec.options.length > 0 && fspec.options.length <= 24) {
        return staticUnion(fspec.options);
    }
    if (fspec.dynamic === 'sprites') return 'SpriteName';
    if (fspec.dynamic === 'costumes' || fspec.dynamic === 'backdrops') return 'string';
    if (fspec.dynamic === 'sounds') return 'string';
    if (fspec.dynamic === 'variables') return 'VarRef';
    if (fspec.dynamic === 'lists') return 'ListRef';
    return 'string';
}

function inputType(opcode: string, iname: string): string {
    const ispec = getBlockSpec(opcode)?.inputs.find((i) => i.name === iname);
    const kind = ispec?.kind;
    switch (kind) {
        case 'number':
        case 'positive_number':
        case 'whole_number':
        case 'integer':
        case 'angle':
        case 'text':
        case 'note':
            return SCALAR;
        case 'boolean':
            // Scratch coerces reporters and variables in boolean slots.
            return 'boolean | Dyn | VarRef | ListRef';
        case 'color':
        case 'matrix':
            return 'string';
        case 'broadcast':
            return 'BroadcastName';
        case 'costume':
            if (opcode === 'looks_switchbackdropto' || opcode === 'looks_switchbackdroptoandwait') {
                return `BackdropName | ${DYN}`;
            }
            return `CostumeName | ${DYN}`;
        case 'sound':
            return `SoundName | ${DYN}`;
        case 'menu':
            return menuInputType(opcode, iname);
        case 'stack':
            return '() => void';
        default:
            return SCALAR;
    }
}

function menuInputType(opcode: string, iname: string): string {
    const key = `${opcode}.${iname}`;
    // Sprite-name menus stay `string`: real projects routinely reference
    // renamed/deleted sprites with stale strings, which tsc cannot verify.
    // (Costume/sound/backdrop/broadcast/variable/list names use strict unions.)
    const table: Record<string, string> = {
        'motion_goto.TO': 'string',
        'motion_glideto.TO': 'string',
        'motion_pointtowards.TOWARDS': 'string',
        'sensing_touchingobject.TOUCHINGOBJECTMENU': 'string',
        'event_whentouchingobject.TOUCHINGOBJECTMENU': 'string',
        'sensing_distanceto.DISTANCETOMENU': 'string',
        'sensing_of.OBJECT': 'string',
        'control_create_clone_of.CLONE_OPTION': 'string',
        'control_for_each.VALUE': SCALAR,
        'music_playNoteForBeats.NOTE': SCALAR,
        'music_playDrumForBeats.DRUM': 'string',
        'music_midiPlayDrumForBeats.DRUM': 'string',
        'music_restForBeats.BEATS': SCALAR,
        'music_midiSetInstrument.INSTRUMENT': 'string | number',
        'music_setInstrument.INSTRUMENT': 'string | number',
    };
    if (table[key]) return table[key];
    const shadow = getBlockSpec(opcode)?.inputs.find((i) => i.name === iname)?.shadowOpcode ?? '';
    if (shadow.includes('keyoptions') || shadow.includes('KEY')) return 'string';
    const menuSpec = getBlockSpec(shadow);
    if (menuSpec && menuSpec.fields.length > 0) {
        const f = menuSpec.fields[0];
        if (f.options && f.options.length > 0 && f.options.length <= 32) return staticUnion(f.options);
    }
    return 'string';
}

function returnType(opcode: string): string {
    const shape = getBlockSpec(opcode)?.shape;
    if (shape === 'boolean') return 'boolean';
    if (shape === 'reporter' || shape === 'argument') return 'Dyn';
    return 'void';
}

function blockDecl(opcode: string, fname: string): string {
    const spec = getBlockSpec(opcode);
    if (!spec) return `declare function ${fname}(...args: any[]): any;`;
    const params: string[] = [];
    for (const a of spec.args) {
        if (a.kind === 'field') {
            const fspec = spec.fields.find((f) => f.name === a.field);
            let t: string;
            if (!fspec) t = 'string';
            else if (fspec.kind === 'variable') t = 'VarRef';
            else if (fspec.kind === 'list') t = 'ListRef';
            else if (fspec.kind === 'broadcast') t = 'BroadcastName';
            else if (fspec.dynamic === 'sprites') t = 'SpriteName';
            else if (fspec.dynamic === 'backdrops') t = 'BackdropName';
            else if (fspec.dynamic === 'costumes') t = 'CostumeName';
            else if (fspec.dynamic === 'sounds') t = 'SoundName';
            else if (fspec.kind === 'dropdown') t = dropdownType(opcode, a.field);
            else t = fieldType(fspec.kind, a.field);
            params.push(`${sanitizeIdent(a.field)}?: ${t}`);
        } else {
            const ispec = spec.inputs.find((i) => i.name === a.input);
            if (ispec?.kind === 'stack') params.push(`${sanitizeIdent(a.input)}?: () => void`);
            else params.push(`${sanitizeIdent(a.input)}?: ${inputType(opcode, a.input)}`);
        }
    }
    if (spec.shape === 'hat') {
        if (!params.some((p) => p.startsWith('body'))) params.push(`${BODY}?`);
    }
    return `declare function ${fname}(${params.join(', ')}): ${returnType(opcode)};`;
}

function sanitizeIdent(s: string): string {
    let out = s.replace(/[^A-Za-z0-9_$]/g, '_');
    if (/^[0-9]/.test(out)) out = '_' + out;
    if (!out) out = 'arg';
    return out;
}

const PRELUDE = `type Dyn = (string & { readonly __dyn: true }) | (number & { readonly __dyn: true });
declare function script(body: () => void): void;
declare function comment(text: string, opts?: { minimized?: boolean }): void;
declare function define(proccode: string, impl: (...args: any[]) => void): void;
declare function define(proccode: string, opts: { warp?: boolean; argumentDefaults?: string[] }, impl: (...args: any[]) => void): void;
declare function call(proccode: string, ...args: any[]): any;
declare function block(opcode: string, inputs?: Record<string, any>, fields?: Record<string, any>, mutation?: any): any;
declare function lit(value: string | number | boolean, tag: number): any;
declare function menu(value: string): any;
declare function bcast(name: string): any;
declare function withComment<T>(blk: T, text: string, opts?: { minimized?: boolean; anchor?: string }): T;
`;

async function readTarget(projectDir: string, dir: string): Promise<TargetInfo | null> {
    let tj: any;
    try {
        tj = JSON.parse(await readFile(join(projectDir, dir, 'target.json'), 'utf8'));
    } catch {
        return null;
    }
    const names = (arr: any): string[] => (Array.isArray(arr) ? arr.map((x) => String(x?.name ?? '')).filter(Boolean) : []);
    let scriptsText = '';
    try {
        scriptsText = await readFile(join(projectDir, dir, 'scripts.ts'), 'utf8');
    } catch {
        /* no scripts */
    }
    const proccodes: string[] = [];
    for (const m of scriptsText.matchAll(/define\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        try {
            proccodes.push(JSON.parse(`"${m[1]}"`));
        } catch {
            /* skip */
        }
    }
    return {
        dir,
        name: String(tj?.name ?? dir),
        isStage: tj?.isStage === true,
        variables: names(tj?.variables),
        lists: names(tj?.lists),
        broadcasts: names(tj?.broadcasts),
        costumes: names(tj?.costumes),
        sounds: names(tj?.sounds),
        proccodes: [...new Set(proccodes)],
    };
}

/**
 * Write .agentwarp/types/<dir>.d.ts for every target in projectDir.
 * Returns the written file paths.
 */
export async function generateDts(projectDir: string): Promise<string[]> {
    const entries = await readdir(projectDir);
    const targets: TargetInfo[] = [];
    for (const e of entries.sort()) {
        if (e === '.agentwarp' || e === 'agentwarp.json') continue;
        const t = await readTarget(projectDir, e);
        if (t) targets.push(t);
    }
    const stage = targets.find((t) => t.isStage);
    const spriteNames = targets.filter((t) => !t.isStage).map((t) => t.name);
    const backdropNames = stage ? stage.costumes : [];
    const allBroadcasts = [...new Set(targets.flatMap((t) => t.broadcasts))];
    const outDir = join(projectDir, '.agentwarp', 'types');
    await mkdir(outDir, { recursive: true });
    const written: string[] = [];
    for (const t of targets) {
        const vars = [...new Set([...t.variables, ...(stage && !t.isStage ? stage.variables : [])])];
        const lists = [...new Set([...t.lists, ...(stage && !t.isStage ? stage.lists : [])])];
        const lines: string[] = [];
        lines.push(`// Generated by @agentwarp/format-ts for target "${t.name}". Do not edit.`);
        lines.push(`// Regenerate after changing target.json: see formats/ts/AGENTS.md.`);
        lines.push(`type VarRef = string & { readonly __var: true };`);
        lines.push(`type ListRef = string & { readonly __list: true };`);
        // Broadcasts: known names autocomplete, but NEW names are allowed (pack declares them on the Stage);
        // typos are caught by lint (broadcast-sent-never-received / received-never-sent).
        lines.push(`type BroadcastName = ${allBroadcasts.length ? unionOrString(allBroadcasts) + ' | (string & {})' : 'string'};`);
        lines.push(`type CostumeName = ${unionOrString(t.costumes)};`);
        lines.push(`type SoundName = ${unionOrString(t.sounds)};`);
        lines.push(`type BackdropName = ${unionOrString(backdropNames)};`);
        lines.push(`type SpriteName = ${unionOrString(spriteNames)};`);
        lines.push(
            `declare const vars: { ${vars.map((n) => `${JSON.stringify(n)}: VarRef`).join('; ')} };`,
        );
        lines.push(
            `declare const lists: { ${lists.map((n) => `${JSON.stringify(n)}: ListRef`).join('; ')} };`,
        );
        if (t.proccodes.length > 0) {
            lines.push(`type Proccode = ${t.proccodes.map((p) => JSON.stringify(p)).join(' | ')};`);
        }
        const fns = new Map<string, string>();
        for (const s of allBlockSpecs()) {
            if (s.shape === 'menu' || s.isShadowOnly) continue;
            if (s.opcode === 'procedures_definition' || s.opcode === 'procedures_prototype' || s.opcode === 'procedures_declaration') continue;
            if (s.opcode === 'argument_reporter_string_number' || s.opcode === 'argument_reporter_boolean') continue;
            if (s.opcode === 'data_variable' || s.opcode === 'data_listcontents') continue;
            if (s.opcode === 'procedures_call') continue; // declared via call() below
            if (s.opcode.startsWith('math_') || s.opcode === 'text' || s.opcode === 'colour_picker' || s.opcode === 'note' || s.opcode === 'matrix') continue;
            const fname = fnNameFor(s.opcode);
            if (fns.has(fname)) continue;
            fns.set(fname, blockDecl(s.opcode, fname));
        }
        // Resolve curated/auto names consistently with the printer.
        void PRELUDE;
        lines.push(...[...fns.values()].sort());
        if (t.proccodes.length > 0) {
            lines.push(`declare function call(proccode: Proccode | (string & {}), ...args: any[]): any;`);
        } else {
            lines.push(`declare function call(proccode: string, ...args: any[]): any;`);
        }
        lines.push(PRELUDE.trim());
        const dest = join(outDir, `${t.dir}.d.ts`);
        await writeFile(dest, lines.join('\n') + '\n');
        written.push(dest);
    }
    return written;
}

// Re-exported for tests: block function name for an opcode (printer-consistent).

