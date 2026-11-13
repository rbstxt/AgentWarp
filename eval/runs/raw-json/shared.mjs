// Shared hand-JSON helpers for the raw-json approach.
// Everything here mirrors the sb3 serialization observed in real projects;
// no Scratch tooling is used, only JSON + zip.
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('/path/to/agentwarp/tools/vmrun/node_modules/jszip');

export const num = (v) => [1, [4, String(v)]];
export const str = (v) => [1, [10, String(v)]];
// variable reporter used as an input value: [3, [12, name, id], [10, default]]
export const varRef = (name, id, def = '0') => [3, [12, name, id], [10, String(def)]];
// list reporter: [3, [13, name, id], [10, default]]
export const listRef = (name, id, def = '') => [3, [13, name, id], [10, String(def)]];

export function blk(blocks, id, opcode, o = {}) {
    blocks[id] = {
        opcode,
        next: o.next ?? null,
        parent: o.parent ?? null,
        inputs: o.inputs ?? {},
        fields: o.fields ?? {},
        shadow: o.shadow ?? false,
        topLevel: o.topLevel ?? false,
        ...(o.topLevel ? { x: o.x ?? 20, y: o.y ?? 20 } : {}),
        ...(o.mutation ? { mutation: o.mutation } : {}),
        ...(o.comment ? { comment: o.comment } : {}),
    };
    return id;
}

// Link ids[0..] into a chain; ids[0] becomes the top-level script at (x,y).
export function chain(blocks, ids, x = 20, y = 20) {
    for (let i = 0; i < ids.length; i++) {
        const b = blocks[ids[i]];
        b.parent = i === 0 ? null : ids[i - 1];
        b.next = i === ids.length - 1 ? null : ids[i + 1];
        if (i === 0) {
            b.topLevel = true;
            b.x = x;
            b.y = y;
        } else {
            b.topLevel = false;
            delete b.x;
            delete b.y;
        }
    }
    return ids[0];
}

// Mark blocks as non-top-level (inside another script): clear x/y.
export function sub(blocks, ...ids) {
    for (const id of ids) {
        blocks[id].topLevel = false;
        delete blocks[id].x;
        delete blocks[id].y;
    }
}

// sensing_keypressed with canonical shadow menu block.
export function keyPressed(blocks, id, menuId, keyName) {
    blk(blocks, id, 'sensing_keypressed', { inputs: { KEY_OPTION: [1, menuId] } });
    blk(blocks, menuId, 'sensing_keyoptions', {
        shadow: true, fields: { KEY_OPTION: [keyName, null] },
    });
    blocks[menuId].parent = id;
    return id;
}

// switch costume/menu helpers
export function switchCostume(blocks, id, menuId, costumeName) {
    blk(blocks, id, 'looks_switchcostumeto', { inputs: { COSTUME: [1, menuId] } });
    blk(blocks, menuId, 'looks_costume', { shadow: true, fields: { COSTUME: [costumeName, null] } });
    blocks[menuId].parent = id;
    return id;
}
export function switchBackdrop(blocks, id, menuId, backdropName) {
    blk(blocks, id, 'looks_switchbackdropto', { inputs: { BACKDROP: [1, menuId] } });
    blk(blocks, menuId, 'looks_backdrops', { shadow: true, fields: { BACKDROP: [backdropName, null] } });
    blocks[menuId].parent = id;
    return id;
}
export function playSound(blocks, id, menuId, soundName) {
    blk(blocks, id, 'sound_play', { inputs: { SOUND_MENU: [1, menuId] } });
    blk(blocks, menuId, 'sound_sounds_menu', { shadow: true, fields: { SOUND_MENU: [soundName, null] } });
    blocks[menuId].parent = id;
    return id;
}
export function cloneOf(blocks, id, menuId, targetName) {
    blk(blocks, id, 'control_create_clone_of', { inputs: { CLONE_OPTION: [1, menuId] } });
    blk(blocks, menuId, 'control_create_clone_of_menu', {
        shadow: true, fields: { CLONE_OPTION: [targetName, null] },
    });
    blocks[menuId].parent = id;
    return id;
}
export function touchObj(blocks, id, menuId, objName) {
    blk(blocks, id, 'sensing_touchingobject', { inputs: { TOUCHINGOBJECTMENU: [1, menuId] } });
    blk(blocks, menuId, 'sensing_touchingobjectmenu', {
        shadow: true, fields: { TOUCHINGOBJECTMENU: [objName, null] },
    });
    blocks[menuId].parent = id;
    return id;
}
export function broadcastTo(blocks, id, bcId, bcName) {
    return blk(blocks, id, 'event_broadcast', {
        inputs: { BROADCAST_INPUT: [1, [11, bcName, bcId]] },
    });
}
export function onBroadcast(blocks, id, bcId, bcName) {
    return blk(blocks, id, 'event_whenbroadcastreceived', {
        fields: { BROADCAST_OPTION: [bcName, bcId] },
    });
}

// --- assets ---
function md5hex(buf) {
    return createHash('md5').update(buf).digest('hex');
}
export function svgCostume(name, svg, cx = 50, cy = 50) {
    const h = md5hex(svg);
    return {
        asset: svg,
        costume: {
            name, bitmapResolution: 1, dataFormat: 'svg',
            assetId: h, md5ext: `${h}.svg`, rotationCenterX: cx, rotationCenterY: cy,
        },
        md5ext: `${h}.svg`,
    };
}
export function makePopWav() {
    const rate = 8000;
    const len = Math.floor(rate * 0.25);
    const data = Buffer.alloc(44 + len);
    data.write('RIFF', 0);
    data.writeUInt32LE(36 + len, 4);
    data.write('WAVE', 8);
    data.write('fmt ', 12);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(rate, 24);
    data.writeUInt32LE(rate, 28);
    data.writeUInt16LE(1, 32);
    data.writeUInt16LE(8, 34);
    data.write('data', 36);
    data.writeUInt32LE(len, 40);
    for (let i = 0; i < len; i++) {
        const env = 1 - i / len;
        data[44 + i] = Math.round(128 + 100 * env * Math.sin((2 * Math.PI * 880 * i) / rate));
    }
    const h = md5hex(data);
    return { data, md5ext: `${h}.wav`, assetId: h, rate, sampleCount: len };
}

export const CAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="55" rx="34" ry="30" fill="#ff8c1a"/><circle cx="38" cy="48" r="5" fill="#000"/><circle cx="62" cy="48" r="5" fill="#000"/><path d="M42 66 Q50 74 58 66" stroke="#000" fill="none" stroke-width="3"/><polygon points="28,32 34,12 46,28" fill="#ff8c1a"/><polygon points="72,32 66,12 54,28" fill="#ff8c1a"/></svg>`;
export const BACKDROP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#ffffff"/></svg>`;
export const BALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#e11d2e"/></svg>`;
export const COOKIE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="#c98a3d"/><circle cx="28" cy="30" r="5" fill="#5b3a12"/><circle cx="52" cy="34" r="5" fill="#5b3a12"/><circle cx="40" cy="54" r="5" fill="#5b3a12"/></svg>`;
export const COOKIE_PRESSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="#8a5a1d"/><circle cx="28" cy="30" r="5" fill="#3a220a"/><circle cx="52" cy="34" r="5" fill="#3a220a"/><circle cx="40" cy="54" r="5" fill="#3a220a"/></svg>`;
export const WIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#37c837"/><text x="240" y="190" font-size="48" text-anchor="middle" font-family="sans-serif" fill="#ffffff">YOU WIN!</text></svg>`;
export const GAMEOVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#14141c"/><text x="240" y="190" font-size="44" text-anchor="middle" font-family="sans-serif" fill="#ff5252">GAME OVER</text></svg>`;
export const LEVEL2_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#2030a0"/></svg>`;
export const PLAYER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"><rect x="1" y="1" width="28" height="38" rx="6" fill="#2b9be4"/><circle cx="10" cy="14" r="3" fill="#fff"/><circle cx="20" cy="14" r="3" fill="#fff"/></svg>`;
export const BULLET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 24"><rect x="1" y="1" width="10" height="22" rx="5" fill="#ffd23f"/></svg>`;
export const ENEMY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="23" fill="#8e44ad"/><circle cx="17" cy="20" r="4" fill="#fff"/><circle cx="33" cy="20" r="4" fill="#fff"/><path d="M15 34 Q25 28 35 34" stroke="#fff" fill="none" stroke-width="3"/></svg>`;
export const SHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><polygon points="30,4 52,52 30,42 8,52" fill="#2b9be4"/><circle cx="30" cy="26" r="6" fill="#dff3ff"/></svg>`;
export const PLATFORM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><rect x="1" y="1" width="98" height="18" rx="4" fill="#7a4a21"/></svg>`;

export function stageTarget(o = {}) {
    const bd = svgCostume('backdrop1', BACKDROP_SVG);
    return {
        target: {
            isStage: true, name: 'Stage',
            variables: o.variables ?? {}, lists: o.lists ?? {},
            broadcasts: o.broadcasts ?? {}, blocks: o.blocks ?? {}, comments: o.comments ?? {},
            currentCostume: 0, costumes: o.costumes ?? [bd.costume], sounds: o.sounds ?? [],
            volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off',
            textToSpeechLanguage: null,
        },
        assets: o.extraAssets ?? [[bd.md5ext, bd.asset]],
        monitors: o.monitors ?? [],
    };
}

export function spriteTarget(name, svg, o = {}, extra = {}) {
    const c = svgCostume(`${name}-a`, svg);
    return {
        target: {
            isStage: false, name,
            variables: o.variables ?? {}, lists: o.lists ?? {},
            broadcasts: o.broadcasts ?? {}, blocks: o.blocks ?? {}, comments: o.comments ?? {},
            currentCostume: 0, costumes: o.costumes ?? [c.costume], sounds: o.sounds ?? [],
            volume: 100, layerOrder: 1, visible: true,
            x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around',
            ...extra,
        },
        assets: [[c.md5ext, c.asset]],
        monitors: o.monitors ?? [],
    };
}

export function project(targets, extensions = []) {
    return {
        targets: targets.map((t) => t.target),
        monitors: targets.flatMap((t) => t.monitors ?? []),
        extensionData: {},
        extensions,
        meta: { semver: '3.0.0', vm: '2.1.46', agent: 'raw-json' },
    };
}

export async function writeSb3(path, proj, assetPairs) {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(proj));
    for (const [name, content] of assetPairs) zip.file(name, content);
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    writeFileSync(path, out);
    console.log('wrote', path, out.length, 'bytes');
}

export const assetsOf = (...ts) => ts.flatMap((t) => t.assets);

export function wsComment(comments, id, x, y, text, w = 220, h = 120) {
    comments[id] = { blockId: null, x, y, width: w, height: h, minimized: false, text };
}
