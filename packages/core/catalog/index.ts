/**
 * Block catalog: opcode schema for every Scratch/TurboWarp block.
 *
 * Generated data lives in ./blocks.json (see README.md for sources and
 * regeneration). This module is the typed accessor other packages code
 * against; the API shape is fixed.
 */
import catalog from './blocks.json' with {type: 'json'};

export type Shape =
    | 'hat'
    | 'stack'
    | 'c'
    | 'c2'
    | 'cap'
    | 'end-c'
    | 'reporter'
    | 'boolean'
    | 'menu'
    | 'definition'
    | 'prototype'
    | 'argument';

export interface InputSpec {
    name: string;
    kind:
        | 'number'
        | 'positive_number'
        | 'whole_number'
        | 'integer'
        | 'angle'
        | 'text'
        | 'color'
        | 'boolean'
        | 'stack'
        | 'menu'
        | 'reporter'
        | 'broadcast'
        | 'note'
        | 'matrix'
        | 'costume'
        | 'sound'
        | 'any';
    shadowOpcode?: string; // e.g. 'math_number', 'text', 'motion_goto_menu', 'event_broadcast_menu', 'colour_picker'
    shadowField?: string; // field name inside the shadow, e.g. 'NUM', 'TEXT', 'TO', 'BROADCAST_OPTION'
    default?: string | number; // toolbox default value
}

export interface FieldSpec {
    name: string;
    kind: 'dropdown' | 'variable' | 'list' | 'broadcast' | 'text' | 'number' | 'angle' | 'color' | 'checkbox' | 'other';
    options?: Array<[label: string, value: string]>; // static menus
    dynamic?: 'sprites' | 'sprites+stage' | 'costumes' | 'sounds' | 'backdrops' | 'variables' | 'lists' | 'keys' | 'other';
}

export interface BlockSpec {
    opcode: string;
    category: string;
    shape: Shape;
    text: {en: string; ja?: string}; // template with %1 %2 … in args order, e.g. "move %1 steps"
    args: Array<{kind: 'input'; input: string} | {kind: 'field'; field: string}>; // order of %n
    inputs: InputSpec[];
    fields: FieldSpec[];
    extension?: string;
    hidden?: boolean;
    isShadowOnly?: boolean;
}

interface CatalogFile {
    meta: {generatedBy: string; sources: Record<string, string>};
    notes: Record<string, string>;
    blocks: Record<string, BlockSpec>;
}

const data = catalog as unknown as CatalogFile;
const byOpcode: ReadonlyMap<string, BlockSpec> = new Map(Object.entries(data.blocks));

export function getBlockSpec(opcode: string): BlockSpec | undefined {
    return byOpcode.get(opcode);
}

export function allBlockSpecs(): BlockSpec[] {
    return [...byOpcode.values()];
}

/** True for shadow-only menu blocks, e.g. motion_goto_menu, looks_costume, sound_sounds_menu. */
export function isMenuShadow(opcode: string): boolean {
    return byOpcode.get(opcode)?.shape === 'menu';
}

export const LITERAL_TYPES = {
    math_number: 4,
    math_positive_number: 5,
    math_whole_number: 6,
    math_integer: 7,
    math_angle: 8,
    colour_picker: 9,
    text: 10,
    event_broadcast_menu: 11,
    data_variable: 12,
    data_listcontents: 13,
} as const;
