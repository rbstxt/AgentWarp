/**
 * sbpy: a Python-like, indentation-based text format for Scratch projects.
 *
 * One block per line, suites for C-blocks/hats/definitions, Python-style
 * calls named by catalog opcode, `var("..")` / `list("..")` /
 * `broadcast("..")` references, `#` comments, `@a1` / `@c2` anchors.
 * See AGENTS.md for the full language description.
 */
import type { Diagnostic, Format, FormatCtx, Script } from '../../packages/core/ir.ts';
import { printScripts } from './print.ts';
import { parseScripts } from './parse.ts';

export const sbpy: Format = {
    ext: 'sbpy',
    print(scripts: Script[], ctx: FormatCtx): string {
        return printScripts(scripts, ctx);
    },
    parse(text: string, ctx: FormatCtx): { scripts: Script[]; diagnostics: Diagnostic[] } {
        return parseScripts(text, ctx);
    },
};
