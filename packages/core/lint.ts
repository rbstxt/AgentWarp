/**
 * Scratch-semantics lint: warnings (and info) about code that packs and runs
 * but does not do what an agent likely meant, learned from the P1/P2 friction
 * logs. Every rule has a stable id; a comment containing
 * `agentwarp-ignore <rule-id>` attached to the flagged block silences that
 * rule for that block (`agentwarp-ignore-all` silences everything there).
 *
 * Usage: lintProject(project, sourcemap?) -> Diagnostic[] (with `rule`+`hint`).
 *
 * Run: node --test packages/core/test/  (from the repo root)
 */
import type { Diagnostic, Loc } from './ir.ts';

export type Sourcemap = Record<string, Loc>;

interface Ctx {
    project: any;
    sourcemap: Sourcemap;
    out: Diagnostic[];
    /** blockId -> attached comment texts, per target. */
    comments: Map<string, string[]>;
}

function locOf(ctx: Ctx, blockId: string | null): { file?: string; line?: number; col?: number } {
    if (!blockId) return {};
    const l = ctx.sourcemap[blockId];
    if (!l) return {};
    return { file: l.file, line: l.line, col: l.col };
}

function push(
    ctx: Ctx,
    rule: string,
    severity: Diagnostic['severity'],
    target: string,
    blockId: string | null,
    opcode: string | null,
    message: string,
    hint: string,
): void {
    if (blockId && suppressed(ctx, blockId, rule)) return;
    ctx.out.push({
        rule,
        severity,
        hint,
        message: `[${target}]${opcode ? ` ${opcode}` : ''}: ${message}`,
        ...locOf(ctx, blockId),
    });
}

function suppressed(ctx: Ctx, blockId: string, rule: string): boolean {
    const texts = ctx.comments.get(blockId) ?? [];
    return texts.some((t) => t.includes(`agentwarp-ignore ${rule}`) || t.includes('agentwarp-ignore-all'));
}

/** Also suppressed when ANY of several related blocks carries the ignore. */
function suppressedAny(ctx: Ctx, blockIds: Array<string | null>, rule: string): boolean {
    return blockIds.some((id) => id && suppressed(ctx, id, rule));
}

function isCompact(b: any): boolean {
    return Array.isArray(b);
}

function targetsOf(project: any): any[] {
    return Array.isArray(project?.targets) ? project.targets : [];
}

function blocksOf(t: any): Record<string, any> {
    return t?.blocks ?? {};
}

/** Follow `next` from head, returning block ids (cycle-safe). */
function chain(blocks: Record<string, any>, head: string | null): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur = head;
    while (typeof cur === 'string' && !seen.has(cur)) {
        const b = blocks[cur];
        if (!b || isCompact(b)) break;
        seen.add(cur);
        out.push(cur);
        cur = typeof b.next === 'string' ? b.next : null;
    }
    return out;
}

/** All block ids in a (sub)stack: the chain plus nested SUBSTACKs and value children. */
function subtree(blocks: Record<string, any>, head: string | null): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string | null): void => {
        if (typeof id !== 'string' || seen.has(id)) return;
        const b = blocks[id];
        if (!b || isCompact(b)) return;
        seen.add(id);
        out.push(id);
        for (const ival of Object.values<any>(b.inputs ?? {})) {
            if (Array.isArray(ival) && typeof ival[1] === 'string') visit(ival[1]);
        }
        if (typeof b.next === 'string') visit(b.next);
    };
    visit(head);
    return out;
}

function fieldVal(b: any, fname: string): string {
    const f = b?.fields?.[fname];
    return String(Array.isArray(f) ? (f[0] ?? '') : (f ?? ''));
}

/** Resolve a menu input (e.g. CLONE_OPTION) to the menu child's field value. */
function menuValue(blocks: Record<string, any>, b: any, iname: string, fname: string): string | null {
    const ival = b?.inputs?.[iname];
    if (!Array.isArray(ival) || typeof ival[1] !== 'string') return null;
    const menu = blocks[ival[1]];
    if (!menu || isCompact(menu)) return null;
    const f = menu.fields?.[fname];
    if (f === undefined) return null;
    return String(Array.isArray(f) ? (f[0] ?? '') : f);
}

/** Inline numeric literal of an input, or null when it is not a plain literal. */
function literalNumber(b: any, iname: string): number | null {
    const ival = b?.inputs?.[iname];
    if (!Array.isArray(ival) || !Array.isArray(ival[1])) return null;
    const v = Number(ival[1][1]);
    return Number.isFinite(v) ? v : null;
}

function indexComments(ctx: Ctx): void {
    for (const t of targetsOf(ctx.project)) {
        for (const [cid, c] of Object.entries<any>(t?.comments ?? {})) {
            if (c && typeof c === 'object' && typeof c.blockId === 'string' && typeof c.text === 'string') {
                const arr = ctx.comments.get(c.blockId) ?? [];
                arr.push(c.text);
                ctx.comments.set(c.blockId, arr);
            }
            void cid;
        }
    }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const SAY_OPS = new Set(['looks_say', 'looks_think', 'looks_sayforsecs', 'looks_thinkforsecs']);

function ruleSayBeforeStop(ctx: Ctx, target: string, blocks: Record<string, any>): void {
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || !SAY_OPS.has(b.opcode)) continue;
        const next = typeof b.next === 'string' ? blocks[b.next] : null;
        if (!next || isCompact(next) || next.opcode !== 'control_stop') continue;
        if (fieldVal(next, 'STOP_OPTION') !== 'all') continue;
        if (suppressedAny(ctx, [id, b.next], 'say-before-stop')) continue;
        push(ctx, 'say-before-stop', 'warning', target, id, b.opcode,
            'say/think bubble is immediately cleared by "stop all" — nothing is ever seen',
            'use "say for 2 secs" before stopping, or stop "other scripts in sprite" instead');
    }
}

function selfCloneTarget(blocks: Record<string, any>, b: any, ownName: string): boolean {
    if (!b || isCompact(b) || b.opcode !== 'control_create_clone_of') return false;
    const v = menuValue(blocks, b, 'CLONE_OPTION', 'CLONE_OPTION');
    return v === '_myself_' || v === 'myself' || v === ownName;
}

function ruleCloneHats(ctx: Ctx, target: string, blocks: Record<string, any>, isStage: boolean): void {
    if (isStage) return;
    let selfClones = false;
    for (const b of Object.values<any>(blocks)) {
        if (selfCloneTarget(blocks, b, target)) {
            selfClones = true;
            break;
        }
    }
    if (!selfClones) return;
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b)) continue;
        if (b.opcode !== 'event_whenkeypressed' && b.opcode !== 'event_whenbroadcastreceived') continue;
        if (!b.topLevel) continue;
        push(ctx, 'clone-hat-explosion', 'warning', target, id, b.opcode,
            `"${target}" creates clones of itself, so every clone also runs this hat (clone bomb)`,
            'create clones from a different sprite, or gate the body on the original');
    }
}

function ruleCloneWithoutDelete(ctx: Ctx, target: string, blocks: Record<string, any>): void {
    const startsAsClone = new Set<string>();
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || b.opcode !== 'control_start_as_clone' || !b.topLevel) continue;
        for (const cid of chain(blocks, id)) startsAsClone.add(cid);
        for (const cid of subtree(blocks, id)) startsAsClone.add(cid);
    }
    const hasDelete = [...startsAsClone].some((cid) => blocks[cid]?.opcode === 'control_delete_this_clone');
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || b.opcode !== 'control_forever') continue;
        const sub = b.inputs?.SUBSTACK;
        const head = Array.isArray(sub) && typeof sub[1] === 'string' ? sub[1] : null;
        const clonesHere = subtree(blocks, head).some(
            (cid) => selfCloneTarget(blocks, blocks[cid], target));
        if (!clonesHere) continue;
        if (!hasDelete) {
            push(ctx, 'clone-without-delete', 'warning', target, id, 'control_create_clone_of',
                '"create clone of myself" inside "forever" with no "delete this clone" path — clones pile up without bound',
                'add "delete this clone" to the "when I start as clone" script');
        }
    }
}

function sentBroadcasts(blocks: Record<string, any>): Array<{ name: string; blockId: string }> {
    const out: Array<{ name: string; blockId: string }> = [];
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || (b.opcode !== 'event_broadcast' && b.opcode !== 'event_broadcastandwait')) continue;
        const ival = b.inputs?.BROADCAST_INPUT ?? b.inputs?.BROADCAST_OPTION;
        if (Array.isArray(ival)) {
            if (Array.isArray(ival[1]) && ival[1][0] === 11) out.push({ name: String(ival[1][1] ?? ''), blockId: id });
            else if (typeof ival[1] === 'string') {
                const menu = blocks[ival[1]];
                const f = !isCompact(menu) ? menu?.fields?.BROADCAST_OPTION : undefined;
                if (f !== undefined) out.push({ name: String(Array.isArray(f) ? (f[0] ?? '') : f), blockId: id });
            }
        }
    }
    return out;
}

function receivedBroadcasts(blocks: Record<string, any>): Array<{ name: string; blockId: string }> {
    const out: Array<{ name: string; blockId: string }> = [];
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || b.opcode !== 'event_whenbroadcastreceived') continue;
        out.push({ name: fieldVal(b, 'BROADCAST_OPTION'), blockId: id });
    }
    return out;
}

function ruleBroadcastBalance(
    ctx: Ctx,
    allSent: Array<{ name: string; target: string; blockId: string }>,
    allReceived: Array<{ name: string; target: string; blockId: string }>,
): void {
    const receivedNames = new Set(allReceived.map((r) => r.name));
    for (const s of allSent) {
        if (!s.name || receivedNames.has(s.name)) continue;
        push(ctx, 'broadcast-sent-never-received', 'warning', s.target, s.blockId, 'event_broadcast',
            `broadcast "${s.name}" is sent but nothing receives it — receivers never fire`,
            `add a "when I receive ${s.name}" script, or remove the broadcast`);
    }
    const sentNames = new Set(allSent.map((s) => s.name));
    for (const r of allReceived) {
        if (!r.name || sentNames.has(r.name)) continue;
        push(ctx, 'broadcast-received-never-sent', 'warning', r.target, r.blockId, 'event_whenbroadcastreceived',
            `broadcast "${r.name}" is received but never sent — this script never runs`,
            `send "${r.name}" somewhere, or remove the receiver`);
    }
}

function ruleZeroEqualsDecrement(
    ctx: Ctx,
    target: string,
    blocks: Record<string, any>,
    varNames: Map<string, string>,
): void {
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || b.opcode !== 'operator_equals') continue;
        const ops = [b.inputs?.OPERAND1, b.inputs?.OPERAND2];
        let varId: string | null = null;
        let zeroSide = false;
        for (const op of ops) {
            if (!Array.isArray(op)) continue;
            if (Array.isArray(op[1]) && Number(op[1][1]) === 0) zeroSide = true;
            else if (typeof op[1] === 'string') {
                const child = blocks[op[1]];
                if (child && !isCompact(child) && child.opcode === 'data_variable') {
                    const fid = child.fields?.VARIABLE;
                    if (Array.isArray(fid) && typeof fid[1] === 'string') varId = fid[1];
                }
            }
        }
        if (!varId || !zeroSide) continue;
        let sawChange = false;
        let onlyNegativeLiteral = true;
        let sawSet = false;
        for (const ob of Object.values<any>(blocks)) {
            if (!ob || isCompact(ob)) continue;
            const fid = ob.fields?.VARIABLE;
            if (!Array.isArray(fid) || fid[1] !== varId) continue;
            if (ob.opcode === 'data_changevariableby') {
                sawChange = true;
                if (literalNumber(ob, 'VALUE') === null || (literalNumber(ob, 'VALUE') as number) >= 0) {
                    onlyNegativeLiteral = false;
                }
            } else if (ob.opcode === 'data_setvariableto') {
                sawSet = true;
            }
        }
        if (sawChange && onlyNegativeLiteral && !sawSet) {
            const vname = varNames.get(varId) ?? varId;
            push(ctx, 'zero-equals-decrement', 'warning', target, id, 'operator_equals',
                `variable "${vname}" is only decremented by "change by -n", so "= 0" can be skipped (5, 3, 1, -1, …)`,
                'compare "< 1" instead of "= 0"');
        }
    }
}

function ruleTouchingHidden(ctx: Ctx, target: string, blocks: Record<string, any>, byName: Map<string, any>): void {
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || b.opcode !== 'sensing_touchingobject') continue;
        const v = menuValue(blocks, b, 'TOUCHINGOBJECTMENU', 'TOUCHINGOBJECTMENU');
        if (!v || v === '_mouse_' || v === 'mouse-pointer' || v === '_edge_' || v === 'edge' ||
            v === '_myself_' || v === 'myself' || v === '_random_') continue;
        const other = byName.get(v);
        if (!other || other.isStage) continue;
        if (other.visible === false) {
            push(ctx, 'touching-hidden-sprite', 'warning', target, id, 'sensing_touchingobject',
                `sprite "${v}" is hidden (visible=false), yet "touching" still collides with hidden sprites`,
                `show "${v}" first, or test its visibility before trusting the touch`);
        }
    }
}

function ruleWaitZeroNoRefresh(ctx: Ctx, target: string, blocks: Record<string, any>): void {
    for (const [id, b] of Object.entries<any>(blocks)) {
        if (!b || isCompact(b) || b.opcode !== 'control_all_at_once') continue;
        const sub = b.inputs?.SUBSTACK;
        const head = Array.isArray(sub) && typeof sub[1] === 'string' ? sub[1] : null;
        for (const cid of subtree(blocks, head)) {
            const w = blocks[cid];
            if (!w || isCompact(w) || w.opcode !== 'control_wait') continue;
            if (literalNumber(w, 'DURATION') === 0) {
                push(ctx, 'wait-zero-no-refresh', 'warning', target, cid, 'control_wait',
                    '"wait 0" inside "run without screen refresh" never yields a fresh frame — busy loop',
                    'move the loop out of warp, or wait longer than 0');
            }
        }
    }
}

const LIST_READ_OPS = new Set([
    'data_lengthoflist',
    'data_itemoflist',
    'data_itemnumoflist',
    'data_listcontainsitem',
    'data_listcontents',
]);

function filledLists(project: any): Set<string> {
    const filled = new Set<string>();
    for (const t of targetsOf(project)) {
        // Initial items count as filled.
        for (const [id, v] of Object.entries<any>(t?.lists ?? {})) {
            if (Array.isArray(v) && Array.isArray(v[1]) && v[1].length > 0) filled.add(id);
        }
        for (const b of Object.values<any>(blocksOf(t))) {
            if (!b || isCompact(b)) continue;
            if (b.opcode !== 'data_addtolist' && b.opcode !== 'data_insertatlist' &&
                b.opcode !== 'data_replaceitemoflist') continue;
            const f = b.fields?.LIST;
            if (Array.isArray(f) && typeof f[1] === 'string') filled.add(f[1]);
        }
    }
    return filled;
}

function ruleEmptyListReads(ctx: Ctx, filled: Set<string>): void {
    for (const t of targetsOf(ctx.project)) {
        const target = String(t?.name ?? '(unnamed)');
        for (const [id, b] of Object.entries<any>(blocksOf(t))) {
            if (!b || isCompact(b) || !LIST_READ_OPS.has(b.opcode)) continue;
            const f = b.fields?.LIST;
            if (!Array.isArray(f) || typeof f[1] !== 'string') continue;
            if (filled.has(f[1])) continue;
            push(ctx, 'length-of-empty-list', 'info', target, id, b.opcode,
                `list "${String(f[0] ?? '')}" starts empty and is never filled — this read always yields 0/""`,
                `fill "${String(f[0] ?? '')}" first, or drop the read`);
        }
    }
}

/**
 * Lint a packed project.json. Returns diagnostics with stable `rule` ids,
 * one-line `hint`s, and file:line:col from `sourcemap` where available.
 */
export function lintProject(project: any, sourcemap: Sourcemap = {}): Diagnostic[] {
    const ctx: Ctx = { project, sourcemap, out: [], comments: new Map() };
    indexComments(ctx);
    const byName = new Map<string, any>();
    const varNames = new Map<string, string>();
    for (const t of targetsOf(project)) {
        byName.set(String(t?.name), t);
        for (const [id, v] of Object.entries<any>(t?.variables ?? {})) {
            if (Array.isArray(v) && !varNames.has(id)) varNames.set(id, String(v[0] ?? id));
        }
    }
    const filled = filledLists(project);
    const allSent: Array<{ name: string; target: string; blockId: string }> = [];
    const allReceived: Array<{ name: string; target: string; blockId: string }> = [];
    for (const t of targetsOf(project)) {
        const name = String(t?.name ?? '(unnamed)');
        const blocks = blocksOf(t);
        const isStage = t?.isStage === true;
        ruleSayBeforeStop(ctx, name, blocks);
        ruleCloneHats(ctx, name, blocks, isStage);
        ruleCloneWithoutDelete(ctx, name, blocks);
        ruleZeroEqualsDecrement(ctx, name, blocks, varNames);
        ruleTouchingHidden(ctx, name, blocks, byName);
        ruleWaitZeroNoRefresh(ctx, name, blocks);
        for (const s of sentBroadcasts(blocks)) allSent.push({ ...s, target: name });
        for (const r of receivedBroadcasts(blocks)) allReceived.push({ ...r, target: name });
    }
    ruleBroadcastBalance(ctx, allSent, allReceived);
    ruleEmptyListReads(ctx, filled);
    return ctx.out;
}
