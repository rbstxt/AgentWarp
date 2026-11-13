import {KNOWN_OPCODES} from './opcodes.mjs';
import {assetName, md5} from './sb3.mjs';

const KNOWN_EXTENSIONS = new Set([
    'pen', 'music', 'videoSensing', 'text2speech', 'translate',
    'makeymakey', 'microbit', 'ev3', 'boost', 'wedo2', 'gdxfor',
]);

// Input value type tags used in shadow literals: [tag, value]
const LITERAL_TAGS = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

function isBlockIdLike(v) {
    return typeof v === 'string';
}

function err(target, blockId, opcode, message) {
    return {target, blockId, opcode, message};
}

/**
 * Structural validation of a parsed project.json (+ zip file map for assets).
 * Returns {errors: [...], warnings: [...]}.
 */
export function validateProject(project, files) {
    const errors = [];
    const warnings = [];
    const targets = project?.targets;
    if (!Array.isArray(targets) || targets.length === 0) {
        return {errors: [err(null, null, null, 'project.targets must be a non-empty array')], warnings};
    }

    // Collect broadcast declarations across all targets: id -> {name, target}
    const broadcasts = new Map();
    for (const t of targets) {
        for (const [id, name] of Object.entries(t.broadcasts ?? {})) {
            if (!broadcasts.has(id)) broadcasts.set(id, {name, target: t.name});
        }
    }

    for (const t of targets) {
        const tname = t.name ?? '(unnamed)';
        const blocks = t.blocks ?? {};
        const varIds = new Set(Object.keys(t.variables ?? {}));
        const listIds = new Set(Object.keys(t.lists ?? {}));
        const stage = targets.find(s => s.isStage);
        const stageVarIds = new Set(Object.keys(stage?.variables ?? {}));
        const stageListIds = new Set(Object.keys(stage?.lists ?? {}));

        const blockIds = new Set(Object.keys(blocks));
        const reachable = new Set();

        for (const [id, b] of Object.entries(blocks)) {
            if (Array.isArray(b)) continue; // legacy compact form: opaque
            const opcode = b.opcode ?? null;
            const at = (msg) => err(tname, id, opcode, msg);

            if (!opcode || typeof opcode !== 'string') {
                errors.push(at('missing opcode'));
                continue;
            }
            if (!KNOWN_OPCODES.has(opcode)) {
                warnings.push({...at(`unknown opcode "${opcode}"`), message: `unknown opcode "${opcode}"`});
            }
            if (b.parent !== null && b.parent !== undefined && !blockIds.has(b.parent)) {
                errors.push(at(`dangling parent reference "${b.parent}"`));
            }
            if (b.next !== null && b.next !== undefined && !blockIds.has(b.next)) {
                errors.push(at(`dangling next reference "${b.next}"`));
            }
            if (b.topLevel) {
                if (typeof b.x !== 'number' || typeof b.y !== 'number') {
                    errors.push(at('topLevel block missing numeric x/y'));
                }
            }
            // inputs
            for (const [iname, ival] of Object.entries(b.inputs ?? {})) {
                if (!Array.isArray(ival) || ival.length < 2) {
                    errors.push(at(`malformed input "${iname}"`));
                    continue;
                }
                const [, primary] = ival;
                if (isBlockIdLike(primary)) {
                    if (!blockIds.has(primary)) {
                        errors.push(at(`input "${iname}" references missing block "${primary}"`));
                    }
                } else if (Array.isArray(primary)) {
                    if (!LITERAL_TAGS.has(primary[0])) {
                        warnings.push(at(`input "${iname}" has unusual literal tag ${primary[0]}`));
                    }
                } else if (typeof primary === 'number' || typeof primary === 'boolean') {
                    // tolerated: some serializers inline numbers
                } else if (primary === null || primary === undefined) {
                    // empty input slot
                } else {
                    errors.push(at(`input "${iname}" has unrecognised value`));
                }
                // any further elements (obscured shadow) ignored
            }
            // fields referencing declarations
            for (const [fname, fval] of Object.entries(b.fields ?? {})) {
                if (!Array.isArray(fval) || fval.length === 0) continue;
                const fid = fval.length > 1 ? fval[1] : null;
                if (fid === null || fid === undefined) continue; // e.g. custom-block arg names, key menus
                if (fname === 'VARIABLE') {
                    if (!varIds.has(fid) && !stageVarIds.has(fid)) {
                        errors.push(at(`variable field references undeclared id "${fid}"`));
                    }
                } else if (fname === 'LIST') {
                    if (!listIds.has(fid) && !stageListIds.has(fid)) {
                        errors.push(at(`list field references undeclared id "${fid}"`));
                    }
                } else if (fname === 'BROADCAST_OPTION') {
                    if (!broadcasts.has(fid)) {
                        errors.push(at(`broadcast field references undeclared id "${fid}" (${JSON.stringify(fval[0])})`));
                    }
                }
            }
            // parent/child consistency is advisory only
            if (b.parent != null && blocks[b.parent] && !Array.isArray(blocks[b.parent])) {
                const p = blocks[b.parent];
                const pointsBack =
                    p.next === id ||
                    Object.values(p.inputs ?? {}).some(iv => Array.isArray(iv) && iv[1] === id);
                if (!pointsBack) {
                    warnings.push(at(`parent "${b.parent}" does not reference this block back`));
                }
            }
        }

        // reachability from topLevel via next + block-ref inputs
        const visit = (id) => {
            if (reachable.has(id) || !blockIds.has(id)) return;
            reachable.add(id);
            const b = blocks[id];
            if (!b || Array.isArray(b)) return;
            if (typeof b.next === 'string') visit(b.next);
            for (const ival of Object.values(b.inputs ?? {})) {
                if (Array.isArray(ival) && isBlockIdLike(ival[1])) visit(ival[1]);
            }
        };
        for (const [id, b] of Object.entries(blocks)) {
            if (!Array.isArray(b) && b.topLevel) visit(id);
        }
        for (const id of blockIds) {
            const b = blocks[id];
            if (Array.isArray(b)) continue;
            if (!b.topLevel && !reachable.has(id)) {
                // Detached shadow blocks (stale menu/shadow inputs left by the
                // editor) are dead data but harmless: warn, don't fail.
                // Unreachable non-shadow blocks indicate real corruption.
                const msg = `orphan non-topLevel block (unreachable from any topLevel script)`;
                if (b.shadow) warnings.push(err(tname, id, b.opcode ?? null, msg));
                else errors.push(err(tname, id, b.opcode ?? null, msg));
            }
        }

        // comments
        for (const [cid, c] of Object.entries(t.comments ?? {})) {
            if (c.blockId !== null && c.blockId !== undefined && !blockIds.has(c.blockId)) {
                // Dangling comment attachments occur in real human projects
                // (deleted blocks leave floating comments). The VM and the
                // editor both tolerate them, so warn instead of failing.
                warnings.push(err(tname, null, null, `comment "${cid}" attached to missing block "${c.blockId}" (treated as workspace comment)`));
            }
        }

        // costumes / sounds
        for (const c of t.costumes ?? []) {
            const name = assetName(c);
            if (!name) {
                errors.push(err(tname, null, null, `costume "${c.name}" has no md5ext/assetId`));
                continue;
            }
            checkAsset(files, name, `costume "${c.name}"`, errors, tname);
        }
        for (const s of t.sounds ?? []) {
            const name = assetName(s);
            if (!name) {
                errors.push(err(tname, null, null, `sound "${s.name}" has no md5ext/assetId`));
                continue;
            }
            checkAsset(files, name, `sound "${s.name}"`, errors, tname);
        }
    }

    // monitors
    for (const m of project.monitors ?? []) {
        if (m.opcode && !KNOWN_OPCODES.has(m.opcode)) {
            warnings.push(err(null, null, m.opcode, `monitor "${m.id}" uses unknown opcode "${m.opcode}"`));
        }
    }
    // extensions
    for (const e of project.extensions ?? []) {
        if (!KNOWN_EXTENSIONS.has(e)) {
            warnings.push(err(null, null, null, `unknown extension "${e}"`));
        }
    }

    return {errors, warnings};
}

function checkAsset(files, name, label, errors, tname) {
    if (!files) return; // no zip map (e.g. raw project.json): skip existence checks
    const buf = files.get(name);
    if (!buf) {
        errors.push(err(tname, null, null, `${label} asset file "${name}" missing from zip`));
        return;
    }
    const dot = name.lastIndexOf('.');
    const idPart = dot > 0 ? name.slice(0, dot) : name;
    if (/^[0-9a-f]{32}$/.test(idPart) && md5(buf) !== idPart) {
        errors.push(err(tname, null, null, `${label} content md5 does not match "${name}"`));
    }
}
