/**
 * scratchblocks text format: English block text from the catalog's text.en
 * templates, one block per line, C-blocks with end/else, `define` for
 * custom blocks, `//` attached comments, `@aN` script anchor headers.
 */
import type { Format } from '../../packages/core/ir.ts';
import { printScripts } from './print.ts';
import { parseScripts } from './parse.ts';

export const scratchblocks: Format = {
    ext: 'sb',
    print(scripts, ctx) {
        return printScripts(scripts, ctx);
    },
    parse(text, ctx) {
        return parseScripts(text, ctx);
    },
};
