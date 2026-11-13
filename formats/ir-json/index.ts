/**
 * ir-json: a trivial Format that prints IR as pretty JSON.
 * For testing the unpack/pack pipeline end to end.
 */
import type { Diagnostic, Format, FormatCtx, Script } from '../../packages/core/ir.ts';

export const irJson: Format = {
    ext: 'json',
    print(scripts: Script[], _ctx: FormatCtx): string {
        return JSON.stringify(scripts, null, 2) + '\n';
    },
    parse(text: string, ctx: FormatCtx): { scripts: Script[]; diagnostics: Diagnostic[] } {
        try {
            const v: unknown = JSON.parse(text);
            if (!Array.isArray(v)) {
                return {
                    scripts: [],
                    diagnostics: [{ message: `${ctx.file}: expected a JSON array of scripts`, severity: 'error' }],
                };
            }
            return { scripts: v as Script[], diagnostics: [] };
        } catch (e) {
            return {
                scripts: [],
                diagnostics: [{ message: `${ctx.file}: invalid JSON: ${(e as Error)?.message}`, severity: 'error' }],
            };
        }
    },
};
