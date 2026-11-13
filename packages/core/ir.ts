/**
 * IR: format-independent tree representation of a Scratch target's scripts.
 *
 * Variables/lists/broadcasts are referenced by NAME; resolution to ids
 * happens in reconcile using the target then Stage tables. Procedure calls
 * reference the proccode with inputs keyed by argument NAME — formats never
 * see argument ids.
 */

export interface Loc {
    file: string;
    line: number;
    col: number;
}

export type ScriptKind = 'stack' | 'reporter' | 'comment';

export interface Script {
    /** Short stable label (a1, a2, …) the printer emits; agents keep it. */
    anchor?: string;
    kind: ScriptKind;
    /** Set for kind 'stack' | 'reporter'. */
    top?: Block;
    /** Set for kind 'comment' (workspace comment). */
    comment?: Comment;
    /** Base block id (top-level) or raw array id; present after extract. */
    srcId?: string;
    loc?: Loc;
}

export interface Block {
    opcode: string;
    inputs: Record<string, Input>;
    fields: Record<string, Field>;
    /** Opaque mutation object, copied verbatim (except procedures, rebuilt). */
    mutation?: Record<string, unknown>;
    /** Present on procedures_definition / procedures_call. */
    proc?: ProcDef;
    comment?: Comment;
    next?: Block;
    /** Base block id; present after extract. */
    srcId?: string;
    loc?: Loc;
}

export type Input =
    | { kind: 'literal'; value: string | number; litType?: number }
    | { kind: 'menu'; value: string }
    | { kind: 'block'; block: Block }
    | { kind: 'stack'; block?: Block }
    | { kind: 'var'; name: string }
    | { kind: 'list'; name: string }
    | { kind: 'broadcast'; name: string };

export interface Field {
    /** Variable/list/broadcast/option NAME (never an id). */
    value: string;
}

export interface ProcDef {
    proccode: string;
    argumentnames: string[];
    argumentdefaults: string[];
    warp: boolean;
}

export interface Comment {
    text: string;
    anchor?: string;
    minimized?: boolean;
    /** Base comment id; present after extract. */
    srcId?: string;
    loc?: Loc;
}

/** Name tables used to resolve IR names back to ids. */
export interface NameTables {
    variables: Map<string, string>; // name -> id (target's own, then Stage)
    lists: Map<string, string>; // name -> id
    broadcasts: Map<string, string>; // name -> id (all targets' declarations)
}

export interface Diagnostic {
    message: string;
    file?: string;
    line?: number;
    col?: number;
    severity: 'error' | 'warning';
}

export interface FormatCtx {
    targetName: string;
    /** Scripts file path (for diagnostics and locs). */
    file: string;
    /** Parsed <Target>/target.json (variables, lists, broadcasts, costumes, sounds, …). */
    targetJson?: any;
    isStage?: boolean;
    /** Parsed Stage/target.json (global variables, lists, broadcasts, backdrops). */
    stageJson?: any;
}

/** Pluggable script-text format (e.g. ir-json, scratchblocks, …). */
export interface Format {
    /** File extension for the scripts file, without dot. */
    ext: string;
    print(scripts: Script[], ctx: FormatCtx): string;
    parse(text: string, ctx: FormatCtx): { scripts: Script[]; diagnostics: Diagnostic[] };
}
