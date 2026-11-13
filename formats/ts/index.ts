/**
 * ts format: a TypeScript subset for Scratch scripts.
 *
 * - One top-level statement per script (hat calls, script(), define(),
 *   comment(), bare reporter expressions like vars.score).
 * - Parsed with the TypeScript compiler API; never executed.
 * - `generateDts(projectDir)` writes per-target declarations for tsc.
 */
import type { Diagnostic, Format, FormatCtx, Script } from '../../packages/core/ir.ts';
import { printScripts } from './print.ts';
import { parseScripts } from './parse.ts';

export { generateDts } from './dts.ts';

export const tsFormat: Format = {
    ext: 'ts',
    print(scripts: Script[], ctx: FormatCtx): string {
        return printScripts(scripts, ctx);
    },
    parse(text: string, ctx: FormatCtx): { scripts: Script[]; diagnostics: Diagnostic[] } {
        return parseScripts(text, ctx);
    },
};
