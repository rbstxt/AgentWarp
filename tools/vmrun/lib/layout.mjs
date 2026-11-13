// Script layout metrics + "clean up" rearrangement.
//
// Block size model (approximation, documented in README.md):
//   - hat blocks (event_*, control_start_as_clone, procedures_definition):
//     w=180, h=44
//   - C-blocks (control_repeat, control_forever, control_if, control_if_else,
//     control_while): header row h=32; body = stacked inner scripts + 8px gaps;
//     footer cap h=16. Width = max(header width, inner widths + 32 indent).
//   - other stack blocks: h=30, width from text length.
//   - embedded reporters/booleans add width (and 24px height if they force a
//     taller row, which we ignore).
// Text width estimate: 7px per character of (opcode sans prefix + literal
// input text + field text), plus 56px base padding per row.

const H_HAT = 44;
const W_HAT = 180;
const H_ROW = 30;
const H_C_HEADER = 32;
const H_C_FOOTER = 16;
const INDENT = 28;
const GAP = 8;

const HAT_OPCODES = new Set([
    'event_whenflagclicked', 'event_whenkeypressed', 'event_whenthisspriteclicked',
    'event_whenstageclicked', 'event_whenbroadcastreceived', 'event_whenbackdropswitchesto',
    'event_whengreaterthan', 'event_whentouchingobject', 'control_start_as_clone',
    'procedures_definition',
]);

const C_BLOCKS = new Set([
    'control_repeat', 'control_forever', 'control_if', 'control_if_else', 'control_while',
]);

const SUBSTACK_INPUTS = new Set(['SUBSTACK', 'SUBSTACK2']);

function literalText(ival) {
    if (!Array.isArray(ival) || ival.length < 2) return '';
    const v = ival[1];
    if (typeof v === 'string') return v; // block id: counted at its own level, skip here
    if (Array.isArray(v)) return String(v[1] ?? '');
    if (v === null || v === undefined) return '';
    return String(v);
}

function rowTextLen(block) {
    let n = (block.opcode ?? '').replace(/^[a-z]+_/, '').length;
    for (const ival of Object.values(block.inputs ?? {})) {
        if (Array.isArray(ival) && !SUBSTACK_INPUTS.has(keyOf(block, ival))) {
            n += literalText(ival).length;
        }
    }
    for (const fval of Object.values(block.fields ?? {})) {
        if (Array.isArray(fval) && fval[0] !== null && fval[0] !== undefined) n += String(fval[0]).length;
    }
    return n;
}

function keyOf(block, ival) {
    for (const [k, v] of Object.entries(block.inputs ?? {})) {
        if (v === ival) return k;
    }
    return '';
}

function rowWidth(block) {
    return 56 + 7 * rowTextLen(block);
}

// Returns {w, h} for the stack starting at blockId (follows next chain,
// recurses into substacks).
export function stackSize(blocks, blockId) {
    const b = blocks[blockId];
    if (!b || Array.isArray(b)) return {w: 0, h: 0};
    const isHat = HAT_OPCODES.has(b.opcode) || b.topLevel;
    let w = isHat ? Math.max(W_HAT, rowWidth(b)) : rowWidth(b);
    let h = HAT_OPCODES.has(b.opcode) ? H_HAT : H_ROW;
    if (C_BLOCKS.has(b.opcode)) {
        h = (HAT_OPCODES.has(b.opcode) ? H_HAT : H_C_HEADER);
        for (const [iname, ival] of Object.entries(b.inputs ?? {})) {
            if (SUBSTACK_INPUTS.has(iname) && Array.isArray(ival) && typeof ival[1] === 'string') {
                const inner = stackSize(blocks, ival[1]);
                h += GAP + inner.h;
                w = Math.max(w, inner.w + INDENT);
            }
        }
        h += GAP + H_C_FOOTER;
    }
    if (typeof b.next === 'string' && blocks[b.next]) {
        const rest = stackSize(blocks, b.next);
        h += GAP + rest.h;
        w = Math.max(w, rest.w);
    }
    return {w: Math.round(w), h: Math.round(h)};
}

function rectsOverlap(a, b, margin = 4) {
    return a.x - margin < b.x + b.w + margin &&
        a.x + a.w + margin > b.x - margin &&
        a.y - margin < b.y + b.h + margin &&
        a.y + a.h + margin > b.y - margin;
}

export function layoutReport(project) {
    const targets = {};
    let overlapPairs = 0;
    let scriptCount = 0;
    for (const t of project.targets ?? []) {
        const blocks = t.blocks ?? {};
        const scripts = [];
        for (const [id, b] of Object.entries(blocks)) {
            if (Array.isArray(b) || !b.topLevel) continue;
            const {w, h} = stackSize(blocks, id);
            scripts.push({
                blockId: id,
                opcode: b.opcode,
                x: typeof b.x === 'number' ? b.x : 0,
                y: typeof b.y === 'number' ? b.y : 0,
                w, h,
            });
        }
        const comments = [];
        for (const [cid, c] of Object.entries(t.comments ?? {})) {
            comments.push({
                id: cid,
                blockId: c.blockId ?? null,
                x: c.x ?? 0, y: c.y ?? 0,
                w: c.width ?? 200, h: c.height ?? 200,
            });
        }
        const overlaps = [];
        const items = [
            ...scripts.map(s => ({kind: 'script', id: s.blockId, ...s})),
            ...comments.filter(c => c.blockId === null || c.blockId === undefined)
                .map(c => ({kind: 'comment', id: c.id, ...c})),
        ];
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                // An attached comment travels with its block; only compare
                // workspace comments and scripts against each other.
                if (rectsOverlap(items[i], items[j])) {
                    overlaps.push([`${items[i].kind}:${items[i].id}`, `${items[j].kind}:${items[j].id}`]);
                }
            }
        }
        overlapPairs += overlaps.length;
        scriptCount += scripts.length;
        targets[t.name ?? '(unnamed)'] = {scripts, comments, overlaps};
    }
    const score = Math.max(0, 100 - 15 * overlapPairs);
    return {targets, overlapPairs, scriptCount, score};
}

// Rearrange top-level scripts into a single left-aligned column ordered by
// (y, x), like Scratch's "Clean up blocks". Attached comments move with
// their block; workspace comments are preserved untouched. Mutates project.
export function cleanupLayout(project, {x0 = 20, y0 = 20, gap = 30} = {}) {
    for (const t of project.targets ?? []) {
        const blocks = t.blocks ?? {};
        const tops = Object.entries(blocks)
            .filter(([, b]) => !Array.isArray(b) && b.topLevel)
            .sort((a, b) => (a[1].y - b[1].y) || (a[1].x - b[1].x));
        let y = y0;
        for (const [id, b] of tops) {
            const {h} = stackSize(blocks, id);
            const dx = x0 - b.x;
            const dy = y - b.y;
            b.x = x0;
            b.y = y;
            y += h + gap;
            // Move attached comments with their block.
            for (const c of Object.values(t.comments ?? {})) {
                if (c.blockId === id) {
                    c.x = (c.x ?? 0) + dx;
                    c.y = (c.y ?? 0) + dy;
                }
            }
        }
    }
    return project;
}
