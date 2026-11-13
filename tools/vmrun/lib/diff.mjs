// Preservation diff between an original and an edited sb3.
// Reports, per target, which top-level scripts survived unchanged (same id, same position, same content),
// which moved, which changed content, which were deleted/added, and what happened to comments.

function scriptBlocks(blocks, topId) {
    // Collect all block ids reachable from a top-level block (next chain + inputs).
    const out = [];
    const seen = new Set();
    const stack = [topId];
    while (stack.length) {
        const id = stack.pop();
        if (!id || seen.has(id) || !blocks[id] || typeof blocks[id] !== 'object' || Array.isArray(blocks[id])) continue;
        seen.add(id);
        out.push(id);
        const b = blocks[id];
        if (b.next) stack.push(b.next);
        for (const inp of Object.values(b.inputs || {})) {
            for (const v of inp.slice(1)) if (typeof v === 'string') stack.push(v);
        }
    }
    return out;
}

function canonicalScript(blocks, topId) {
    // Content fingerprint that ignores ids and the top-level position.
    const ids = scriptBlocks(blocks, topId);
    const index = new Map(ids.map((id, i) => [id, i]));
    const norm = ids.map(id => {
        const b = blocks[id];
        const inputs = {};
        for (const [k, v] of Object.entries(b.inputs || {})) {
            inputs[k] = v.map(x => (typeof x === 'string' && index.has(x) ? `#${index.get(x)}` : x));
        }
        return {op: b.opcode, f: b.fields, i: inputs, m: b.mutation, s: !!b.shadow,
            n: b.next ? `#${index.get(b.next)}` : null};
    });
    return JSON.stringify(norm);
}

export function diffProjects(a, b) {
    const result = {targets: {}, summary: {unchanged: 0, moved: 0, changed: 0, deleted: 0, added: 0,
        commentsKept: 0, commentsLost: 0, commentsChanged: 0, commentsAdded: 0, idsPreservedInChanged: 0}};
    const bTargets = new Map(b.targets.map(t => [t.name, t]));
    for (const ta of a.targets) {
        const tb = bTargets.get(ta.name);
        const r = {unchanged: [], moved: [], changed: [], deleted: [], added: [], comments: {kept: 0, lost: [], changed: [], added: 0}};
        result.targets[ta.name] = r;
        if (!tb) { r.missingTarget = true; continue; }
        const topA = Object.entries(ta.blocks).filter(([, v]) => v && v.topLevel).map(([k]) => k);
        const topB = new Set(Object.entries(tb.blocks).filter(([, v]) => v && v.topLevel).map(([k]) => k));
        for (const id of topA) {
            const ba = ta.blocks[id];
            if (!topB.has(id)) {
                // maybe re-created with new ids but same content
                r.deleted.push({id, opcode: ba.opcode});
                continue;
            }
            const bb = tb.blocks[id];
            const same = canonicalScript(ta.blocks, id) === canonicalScript(tb.blocks, id);
            const samePos = Math.round(ba.x) === Math.round(bb.x) && Math.round(ba.y) === Math.round(bb.y);
            if (same && samePos) r.unchanged.push(id);
            else if (same) r.moved.push({id, opcode: ba.opcode, from: [ba.x, ba.y], to: [bb.x, bb.y]});
            else {
                const idsA = scriptBlocks(ta.blocks, id);
                const idsB = new Set(scriptBlocks(tb.blocks, id));
                const kept = idsA.filter(x => idsB.has(x)).length;
                r.changed.push({id, opcode: ba.opcode, moved: !samePos, blockIdsKept: `${kept}/${idsA.length}`});
                result.summary.idsPreservedInChanged += kept / Math.max(1, idsA.length);
            }
            topB.delete(id);
        }
        for (const id of topB) r.added.push({id, opcode: tb.blocks[id].opcode, x: tb.blocks[id].x, y: tb.blocks[id].y});
        const ca = ta.comments || {}; const cb = tb.comments || {};
        for (const [id, c] of Object.entries(ca)) {
            const d = cb[id];
            if (!d) {
                // Comment may have been recreated under a new id with the same text.
                const twin = Object.values(cb).find(x => x.text === c.text);
                if (twin) r.comments.changed.push({id, reason: 'new id', text: c.text.slice(0, 40)});
                else r.comments.lost.push({id, text: c.text.slice(0, 60)});
            } else if (d.text !== c.text || d.blockId !== c.blockId) {
                r.comments.changed.push({id, reason: d.text !== c.text ? 'text' : 'attachment', text: c.text.slice(0, 40)});
            } else r.comments.kept++;
        }
        r.comments.added = Object.keys(cb).filter(id => !ca[id]).length;
        const s = result.summary;
        s.unchanged += r.unchanged.length; s.moved += r.moved.length; s.changed += r.changed.length;
        s.deleted += r.deleted.length; s.added += r.added.length;
        s.commentsKept += r.comments.kept; s.commentsLost += r.comments.lost.length;
        s.commentsChanged += r.comments.changed.length; s.commentsAdded += r.comments.added;
        r.unchangedCount = r.unchanged.length; delete r.unchanged;
    }
    for (const tb of b.targets) if (!a.targets.find(t => t.name === tb.name)) result.targets[tb.name] = {addedTarget: true};
    if (result.summary.changed) result.summary.idsPreservedInChanged = +(result.summary.idsPreservedInChanged / result.summary.changed).toFixed(2);
    return result;
}
