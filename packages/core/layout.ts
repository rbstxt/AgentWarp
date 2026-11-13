/**
 * Script layout: TurboWarp "Clean up Plus" replica, new-script placement and
 * overlap detection, all driven by metrics.ts geometry.
 *
 * Clean up Plus source: .cache/tw-scratch-gui
 *   src/addons/addons/editor-devtools/DevTools.js (pinned commit 7738389)
 *   - columns: top blocks (creation order) assigned to the nearest column
 *     with x-distance < 256, updating each column's mean x; output-shaped
 *     ("orphan") top blocks separated; declined delete prompt keeps them as
 *     the first column.
 *   - columns sorted by mean x, blocks within a column by y.
 *   - layout from (48, 64): advance y by rendered height + 72, advance x by
 *     max rendered width (or attached-comment extent) + 96.
 *   - attached comments auto-positioned (icon x + 32, or + 16 minimized)
 *     and accounted in the column width; floating comments untouched.
 *
 * Run: node --test packages/core/test/ (from the repo root).
 */
import {measureScript, measureComment, topLevelIds, isOrphanBlock} from './metrics.ts';
import type {Blocks, BlockBox} from './metrics.ts';

export interface TargetLike {
    name?: string;
    blocks: Blocks;
    comments?: Record<string, CommentJson>;
}
export interface CommentJson {
    blockId?: string | null;
    x?: number;
    y?: number;
    text?: string;
    minimized?: boolean;
    width?: number;
    height?: number;
}

export interface PlacedBlocks {
    blocks: Map<string, {x: number; y: number}>;
    comments: Map<string, {x: number; y: number}>;
}

interface ScriptGeom {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rowsRW: number;
    rowH0: number;
    perBlock: Map<string, {x: number; y: number; rw: number; rh0: number}>;
}

function scriptGeoms(target: TargetLike): Map<string, ScriptGeom> {
    const out = new Map<string, ScriptGeom>();
    for (const id of topLevelIds(target.blocks)) {
        const raw = target.blocks[id] as {x?: unknown; y?: unknown} | undefined;
        const m = measureScript(target.blocks, id);
        const x = Number(raw?.x);
        const y = Number(raw?.y);
        out.set(id, {
            id,
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            w: m.width,
            h: m.height,
            rowsRW: 0,
            rowH0: 0,
            perBlock: new Map(),
        });
        const g = out.get(id)!;
        for (const [bid, d] of m.perBlock) {
            g.perBlock.set(bid, {x: d.x, y: d.y, rw: (d as {rw?: number}).rw ?? 0, rh0: (d as {rh0?: number}).rh0 ?? 0});
        }
        const top = m.perBlock.get(id);
        g.rowsRW = (top as {rw?: number} | undefined)?.rw ?? 0;
        g.rowH0 = (top as {rh0?: number} | undefined)?.rh0 ?? 0;
    }
    return out;
}

function rootOf(target: TargetLike, blockId: string): string | null {
    let cur: string | null = blockId;
    const seen = new Set<string>();
    while (cur !== null && !seen.has(cur)) {
        seen.add(cur);
        const b = target.blocks[cur] as {parent?: unknown} | undefined;
        if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
        const p = b.parent;
        if (typeof p !== 'string') return cur;
        cur = p;
    }
    return cur;
}

/** Auto-position of an attached comment given its owner's geometry. */
export function attachedCommentPos(
    ownerX: number, ownerY: number, ownerRW: number, rowH0: number, minimized: boolean,
): {x: number; y: number} {
    // ScratchBlockComment.autoPosition_ (TW fork, overhang removed):
    // x_ = iconX + 32 (expanded) or iconX + 16 (minimized),
    // y_ = iconY - TOP_BAR_HEIGHT/2; icon at (ownerX + rowsRW, ownerY + rowH0/2).
    return {
        x: ownerX + ownerRW + (minimized ? 16 : 32),
        y: ownerY + rowH0 / 2 - 16,
    };
}

/**
 * Replicate Clean up Plus for one target. Returns new top-left positions for
 * every top-level block plus new positions for attached comments. Floating
 * workspace comments are untouched (as in the editor).
 */
export function cleanUpPlus(target: TargetLike): PlacedBlocks {
    const geoms = scriptGeoms(target);
    const blocks: PlacedBlocks['blocks'] = new Map();
    const comments: PlacedBlocks['comments'] = new Map();
    // 1. Attached comments: auto-position at CURRENT geometry; column widths
    //    account for their right edge relative to the root block's left.
    const maxWidths = new Map<string, number>();
    const attached: Array<{id: string; root: string; owner: string; minimized: boolean; w: number}> = [];
    for (const [cid, c] of Object.entries(target.comments ?? {})) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        if (c.blockId === null || c.blockId === undefined) continue;
        const root = rootOf(target, c.blockId);
        if (root === null || !geoms.has(root)) continue;
        const g = geoms.get(root)!;
        const owner = g.perBlock.get(c.blockId);
        if (!owner) continue;
        const {w} = measureComment(c);
        const minimized = !!c.minimized;
        const pos = attachedCommentPos(g.x + owner.x, g.y + owner.y, owner.rw, owner.rh0, minimized);
        // DevTools uses getBoundingRectangle for both; the bubble is w wide
        // (minimized bubbles render at MINIMIZE_WIDTH 200).
        const right = pos.x + (minimized ? 200 : w);
        maxWidths.set(root, Math.max(maxWidths.get(root) ?? 0, right - g.x));
        attached.push({id: cid, root, owner: c.blockId, minimized, w});
    }
    // 2. Columns in topBlocks_ order (project.json key order): orphans split
    //    off, others join the nearest column within 256 (running mean x).
    interface Col {x: number; count: number; blocks: string[]}
    const cols: Col[] = [];
    const orphans: string[] = [];
    for (const id of topLevelIds(target.blocks)) {
        if (isOrphanBlock(target.blocks, id)) {
            orphans.push(id);
            continue;
        }
        const g = geoms.get(id)!;
        let best: Col | null = null;
        let bestErr = 256;
        for (const col of cols) {
            const err = Math.abs(g.x - col.x);
            if (err < bestErr) {
                bestErr = err;
                best = col;
            }
        }
        if (best) {
            best.x = (best.x * best.count + g.x) / ++best.count;
            best.blocks.push(id);
        } else {
            cols.push({x: g.x, count: 1, blocks: [id]});
        }
    }
    cols.sort((a, b) => a.x - b.x);
    for (const col of cols) {
        col.blocks.sort((a, b) => geoms.get(a)!.y - geoms.get(b)!.y);
    }
    const ordered: string[][] = [];
    if (orphans.length > 0) ordered.push(orphans);
    for (const col of cols) ordered.push(col.blocks);
    // 3. Stack columns from (48, 64).
    let cursorX = 48;
    for (const col of ordered) {
        let cursorY = 64;
        let maxWidth = 0;
        for (const id of col) {
            const g = geoms.get(id)!;
            blocks.set(id, {x: cursorX, y: cursorY});
            cursorY += g.h + 72;
            maxWidth = Math.max(maxWidth, g.w, maxWidths.get(id) ?? 0);
        }
        cursorX += maxWidth + 96;
    }
    // 4. Attached comments follow their roots to the new positions.
    for (const a of attached) {
        const nb = blocks.get(a.root)!;
        const g = geoms.get(a.root)!;
        const owner = g.perBlock.get(a.owner)!;
        comments.set(a.id, attachedCommentPos(nb.x + owner.x, nb.y + owner.y, owner.rw, owner.rh0, a.minimized));
    }
    return {blocks, comments};
}

/** Bounding boxes of scripts (with attached comment extents) at stored positions. */
export function scriptBoxes(target: TargetLike): Map<string, BlockBox> {
    const geoms = scriptGeoms(target);
    const out = new Map<string, BlockBox>();
    for (const [id, g] of geoms) {
        let x0 = g.x;
        let y0 = g.y;
        let x1 = g.x + g.w;
        let y1 = g.y + g.h;
        for (const [cid, c] of Object.entries(target.comments ?? {})) {
            if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
            if (c.blockId === null || c.blockId === undefined) continue;
            if (rootOf(target, c.blockId) !== id) continue;
            const owner = g.perBlock.get(c.blockId);
            if (!owner) continue;
            const {w, h} = measureComment(c);
            const cx = Number(c.x);
            const cy = Number(c.y);
            const px = Number.isFinite(cx) ? cx : g.x + owner.x + owner.rw + 32;
            const py = Number.isFinite(cy) ? cy : g.y + owner.y + owner.rh0 / 2 - 16;
            x0 = Math.min(x0, px);
            y0 = Math.min(y0, py);
            x1 = Math.max(x1, px + w);
            y1 = Math.max(y1, py + h);
        }
        out.set(id, {x: x0, y: y0, w: x1 - x0, h: y1 - y0});
    }
    return out;
}

function intersects(a: BlockBox, b: BlockBox): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Pairs of top-level script ids whose boxes overlap. */
export function overlaps(target: TargetLike): Array<[string, string]> {
    const boxes = scriptBoxes(target);
    const ids = [...boxes.keys()];
    const out: Array<[string, string]> = [];
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            if (intersects(boxes.get(ids[i])!, boxes.get(ids[j])!)) out.push([ids[i], ids[j]]);
        }
    }
    return out;
}

export interface PlaceOpts {
    /** Prefer a free spot right of / below this existing script. */
    near?: string;
}

/**
 * Place new scripts (and their attached comments) in free space, keeping all
 * existing scripts fixed. Each new script's footprint includes its attached
 * comments. Candidates, in order: (with opts.near) right of / below that script;
 * the bottom of each existing column, left to right (gap 72, aligned to the
 * column's lowest script); right of everything (gap 96); below everything.
 * Placed scripts extend their column, so consecutive new scripts stack neatly.
 */
export function placeNew(
    target: TargetLike,
    newTopIds: string[],
    newCommentIds: string[] = [],
    opts: PlaceOpts = {},
): PlacedBlocks {
    const geoms = scriptGeoms(target);
    const boxes = scriptBoxes(target);
    const newSet = new Set(newTopIds);
    for (const id of newSet) boxes.delete(id);
    const newComments = new Set(newCommentIds);
    // Comments of new scripts are placed with their script; drop their provisional boxes.
    const commentRoot = new Map<string, string>();
    for (const [cid, c] of Object.entries(target.comments ?? {})) {
        if (!c || typeof c !== 'object' || c.blockId === null || c.blockId === undefined) continue;
        const root = rootOf(target, c.blockId);
        if (root !== null) commentRoot.set(cid, root);
    }
    const placed: PlacedBlocks = {blocks: new Map(), comments: new Map()};
    const occupied: BlockBox[] = [...boxes.values()];
    for (const [cid, c] of Object.entries(target.comments ?? {})) {
        if (!c || typeof c !== 'object') continue;
        const root = commentRoot.get(cid);
        if (newComments.has(cid) || (root !== undefined && newSet.has(root))) continue;
        const {w, h} = measureComment(c);
        occupied.push({x: Number(c.x) || 0, y: Number(c.y) || 0, w, h});
    }
    interface Col {x: number; n: number; anchorX: number; bottom: number}
    const cols: Col[] = [];
    for (const id of topLevelIds(target.blocks)) {
        if (isOrphanBlock(target.blocks, id) || newSet.has(id)) continue;
        const g = geoms.get(id);
        if (!g) continue;
        let best: Col | null = null;
        let bestErr = 256;
        for (const col of cols) {
            const err = Math.abs(g.x - col.x);
            if (err < bestErr) {
                bestErr = err;
                best = col;
            }
        }
        if (best) {
            best.x = (best.x * best.n + g.x) / (best.n + 1);
            best.n++;
            if (g.y + g.h > best.bottom) {
                best.bottom = g.y + g.h;
                best.anchorX = g.x;
            }
        } else {
            cols.push({x: g.x, n: 1, anchorX: g.x, bottom: g.y + g.h});
        }
    }
    cols.sort((a, b) => a.x - b.x);
    const fits = (box: BlockBox): boolean => !occupied.some(o => intersects(box, o));
    // Footprint of a new script relative to its top-left: the stack plus its attached comments.
    const footprint = (id: string): {w: number; h: number; comments: Array<{cid: string; dx: number; dy: number; w: number; h: number}>} => {
        const g = geoms.get(id);
        const fp = {w: g?.w ?? 64, h: g?.h ?? 48, comments: [] as Array<{cid: string; dx: number; dy: number; w: number; h: number}>};
        if (!g) return fp;
        for (const [cid, root] of commentRoot) {
            if (root !== id) continue;
            const c = target.comments![cid];
            const owner = g.perBlock.get(String(c.blockId));
            if (!owner) continue;
            const pos = attachedCommentPos(owner.x, owner.y, owner.rw, owner.rh0, !!c.minimized);
            const {w, h} = measureComment(c);
            fp.comments.push({cid, dx: pos.x, dy: pos.y, w, h});
            fp.w = Math.max(fp.w, pos.x + w);
            fp.h = Math.max(fp.h, pos.y + h);
        }
        return fp;
    };
    for (const id of newTopIds) {
        const fp = footprint(id);
        const candidates: Array<{x: number; y: number; col?: Col}> = [];
        if (opts.near && geoms.has(opts.near) && boxes.has(opts.near)) {
            const n = geoms.get(opts.near)!;
            const nb = boxes.get(opts.near)!;
            candidates.push({x: nb.x + nb.w + 96, y: n.y});
            candidates.push({x: n.x, y: n.y + n.h + 72});
        }
        for (const col of cols) candidates.push({x: col.anchorX, y: col.bottom + 72, col});
        let maxRight = 48;
        let maxBottom = 64 - 72;
        for (const b of occupied) {
            maxRight = Math.max(maxRight, b.x + b.w);
            maxBottom = Math.max(maxBottom, b.y + b.h);
        }
        const topY = occupied.length ? Math.min(...occupied.map(b => b.y)) : 64;
        if (occupied.length) candidates.push({x: maxRight + 96, y: topY});
        candidates.push({x: 48, y: maxBottom + 72});
        let pick = candidates[candidates.length - 1];
        for (const c of candidates) {
            if (fits({x: c.x, y: c.y, w: fp.w, h: fp.h})) {
                pick = c;
                break;
            }
        }
        placed.blocks.set(id, {x: pick.x, y: pick.y});
        occupied.push({x: pick.x, y: pick.y, w: fp.w, h: fp.h});
        for (const c of fp.comments) placed.comments.set(c.cid, {x: pick.x + c.dx, y: pick.y + c.dy});
        if (pick.col) {
            pick.col.bottom = pick.y + fp.h;
            pick.col.anchorX = pick.x;
        } else {
            cols.push({x: pick.x, n: 1, anchorX: pick.x, bottom: pick.y + fp.h});
            cols.sort((a, b) => a.x - b.x);
        }
    }
    // New attached comments on EXISTING scripts: Scratch's auto-position next to their block.
    for (const cid of newCommentIds) {
        if (placed.comments.has(cid)) continue;
        const c = target.comments?.[cid];
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const root = commentRoot.get(cid);
        if (root === undefined) continue;
        const g = geoms.get(root);
        const owner = g?.perBlock.get(String(c.blockId));
        if (!g || !owner) continue;
        const pos = attachedCommentPos(g.x + owner.x, g.y + owner.y, owner.rw, owner.rh0, !!c.minimized);
        placed.comments.set(cid, pos);
    }
    return placed;
}
