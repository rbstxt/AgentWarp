#!/usr/bin/env node
// Generate small test sb3 fixtures programmatically.
// Usage: node make-fixtures.mjs [outDir]
// Writes: greenflag.sb3, keys.sb3, clones.sb3, click.sb3, touch.sb3,
//         ask.sb3, lists.sb3
// Each: project.json + SVG costumes (+ generated WAV for click) packed as sb3.

import {mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';

const outDir = process.argv[2] ?? new URL('./test-fixtures/', import.meta.url).pathname;
mkdirSync(outDir, {recursive: true});

let n = 0;
const bid = (p = 'b') => `${p}${++n}`;

function blk(opcode, o = {}) {
    return {
        opcode,
        next: o.next ?? null,
        parent: o.parent ?? null,
        inputs: o.inputs ?? {},
        fields: o.fields ?? {},
        shadow: o.shadow ?? false,
        topLevel: o.topLevel ?? false,
        ...(o.topLevel ? {x: o.x ?? 20, y: o.y ?? 20} : {}),
        ...(o.mutation ? {mutation: o.mutation} : {}),
    };
}
// Literal shadow input: [1, [tag, value]]  (4=number, 10=string, 11=broadcast)
const num = (v) => [1, [4, String(v)]];
const str = (v) => [1, [10, String(v)]];

function chain(blocks, ids) {
    // ids: ordered top..bottom (topLevel first). Links parent/next.
    for (let i = 0; i < ids.length; i++) {
        const b = blocks[ids[i]];
        b.parent = i === 0 ? null : ids[i - 1];
        b.next = i === ids.length - 1 ? null : ids[i + 1];
        if (i === 0) {
            b.topLevel = true;
            b.x = 20;
            b.y = 20 + 0;
        }
    }
    return ids[0];
}

const CAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="55" rx="34" ry="30" fill="#ff8c1a"/><circle cx="38" cy="48" r="5" fill="#000"/><circle cx="62" cy="48" r="5" fill="#000"/><path d="M42 66 Q50 74 58 66" stroke="#000" fill="none" stroke-width="3"/><polygon points="28,32 34,12 46,28" fill="#ff8c1a"/><polygon points="72,32 66,12 54,28" fill="#ff8c1a"/></svg>`;
const BACKDROP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#ffffff"/></svg>`;
const BALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#e11d2e"/></svg>`;
const COOKIE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="#c98a3d"/><circle cx="28" cy="30" r="5" fill="#5b3a12"/><circle cx="52" cy="34" r="5" fill="#5b3a12"/><circle cx="40" cy="54" r="5" fill="#5b3a12"/></svg>`;

function md5extOf(content) {
    const h = createHash('md5').update(content).digest('hex');
    return {md5ext: `${h}.svg`, assetId: h};
}

function svgCostume(name, svg) {
    const {md5ext, assetId} = md5extOf(svg);
    return {asset: svg, costume: {name, bitmapResolution: 1, dataFormat: 'svg', assetId, md5ext, rotationCenterX: 50, rotationCenterY: 50}, md5ext};
}

// Tiny 8-bit PCM WAV: 0.25s 880Hz sine "pop".
function makePopWav() {
    const rate = 8000;
    const len = Math.floor(rate * 0.25);
    const data = Buffer.alloc(44 + len);
    data.write('RIFF', 0);
    data.writeUInt32LE(36 + len, 4);
    data.write('WAVE', 8);
    data.write('fmt ', 12);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20); // PCM
    data.writeUInt16LE(1, 22); // mono
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
    const h = createHash('md5').update(data).digest('hex');
    return {data, md5ext: `${h}.wav`, assetId: h, rate, sampleCount: len};
}

function stageTarget({variables = {}, broadcasts = {}, blocks = {}, sounds = []} = {}) {
    const bd = svgCostume('backdrop1', BACKDROP_SVG);
    return {
        target: {
            isStage: true, name: 'Stage', variables, lists: {}, broadcasts, blocks, comments: {},
            currentCostume: 0, costumes: [bd.costume], sounds,
            volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off',
            textToSpeechLanguage: null,
        },
        assets: [[bd.md5ext, bd.asset]],
    };
}

function spriteTarget(name, svg, {variables = {}, lists = {}, broadcasts = {}, blocks = {}, sounds = []} = {}, extra = {}) {
    const c = svgCostume(`${name}-a`, svg);
    return {
        target: {
            isStage: false, name, variables, lists, broadcasts, blocks, comments: {},
            currentCostume: 0, costumes: [c.costume], sounds,
            volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90,
            draggable: false, rotationStyle: 'all around',
            ...extra,
        },
        assets: [[c.md5ext, c.asset]],
    };
}

function project(targets, extensions = []) {
    return {
        targets: targets.map(t => t.target),
        monitors: targets.flatMap(t => t.monitors ?? []),
        extensionData: {},
        extensions,
        meta: {semver: '3.0.0', vm: '2.1.46', agent: 'vmrun-make-fixtures'},
    };
}

async function writeSb3(path, proj, assetPairs) {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(proj));
    for (const [name, content] of assetPairs) zip.file(name, content);
    const out = await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'});
    writeFileSync(path, out);
    console.log('wrote', path);
}

const assetsOf = (...ts) => ts.flatMap(t => t.assets);

// --- fixture 1: green flag move + say + broadcast -----------------------------
function greenflag() {
    n = 0;
    const bcast = bid('bc');
    const blocks = {};
    const b1 = bid(), b2 = bid(), b3 = bid(), b4 = bid();
    blocks[b1] = blk('event_whenflagclicked', {topLevel: true, x: 20, y: 20, next: b2});
    blocks[b2] = blk('motion_gotoxy', {parent: b1, next: b3, inputs: {X: num(0), Y: num(0)}});
    blocks[b3] = blk('motion_movesteps', {parent: b2, next: b4, inputs: {STEPS: num(10)}});
    blocks[b4] = blk('looks_sayforsecs', {parent: b3, inputs: {MESSAGE: str('Hello!'), SECS: num(2)}});
    // broadcast after the say
    const b5 = bid();
    blocks[b4].next = b5;
    blocks[b5] = blk('event_broadcast', {parent: b4, inputs: {BROADCAST_INPUT: [1, [11, 'done', bcast]]}});
    const s = spriteTarget('Sprite1', CAT_SVG, {broadcasts: {[bcast]: 'done'}, blocks});
    // Stage listens for the broadcast and acknowledges it.
    const sb1 = bid(), sb2 = bid();
    const sblocks = {};
    sblocks[sb1] = blk('event_whenbroadcastreceived', {
        topLevel: true, x: 20, y: 20, next: sb2,
        fields: {BROADCAST_OPTION: ['done', bcast]},
    });
    sblocks[sb2] = blk('looks_sayforsecs', {parent: sb1, inputs: {MESSAGE: str('heard!'), SECS: num(1)}});
    const st = stageTarget({broadcasts: {[bcast]: 'done'}, blocks: sblocks});
    return {proj: project([st, s]), assets: assetsOf(st, s)};
}

// --- fixture 2: key movement + edge bounce ------------------------------------
function keys() {
    n = 0;
    // Sprite1: forever { if <key right arrow pressed?> change x by 5 }
    const k = {};
    const k1 = bid(), k2 = bid(), k3 = bid(), k4 = bid(), k5 = bid();
    k[k1] = blk('event_whenflagclicked', {topLevel: true, x: 20, y: 20, next: k2});
    k[k2] = blk('control_forever', {parent: k1, inputs: {SUBSTACK: [2, k3]}});
    k[k3] = blk('control_if', {parent: k2, inputs: {CONDITION: [2, k4], SUBSTACK: [2, k5]}});
    k[k4] = blk('sensing_keypressed', {parent: k3, inputs: {KEY_OPTION: str('right arrow')}});
    k[k5] = blk('motion_changexby', {parent: k3, inputs: {DX: num(5)}});
    const s1 = spriteTarget('Sprite1', CAT_SVG, {blocks: k});
    // Ball: forever { move 10 steps; if on edge, bounce }
    const b = {};
    const c1 = bid(), c2 = bid(), c3 = bid(), c4 = bid();
    b[c1] = blk('event_whenflagclicked', {topLevel: true, x: 20, y: 20, next: c2});
    b[c2] = blk('control_forever', {parent: c1, inputs: {SUBSTACK: [2, c3]}});
    b[c3] = blk('motion_movesteps', {parent: c2, next: c4, inputs: {STEPS: num(10)}});
    b[c4] = blk('motion_ifonedgebounce', {parent: c3});
    const s2 = spriteTarget('Ball', BALL_SVG, {blocks: b}, {x: 0, y: 0});
    const st = stageTarget();
    return {proj: project([st, s1, s2]), assets: assetsOf(st, s1, s2)};
}

// --- fixture 3: clones ---------------------------------------------------------
function clones() {
    n = 0;
    const blocks = {};
    const f1 = bid(), f2 = bid(), f3 = bid(), m1 = bid();
    blocks[f1] = blk('event_whenflagclicked', {topLevel: true, x: 20, y: 20, next: f2});
    blocks[f2] = blk('control_repeat', {parent: f1, inputs: {TIMES: num(3), SUBSTACK: [2, f3]}});
    blocks[f3] = blk('control_create_clone_of', {
        parent: f2, inputs: {CLONE_OPTION: [1, m1]},
    });
    blocks[m1] = blk('control_create_clone_of_menu', {
        parent: f3, shadow: true, fields: {CLONE_OPTION: ['_myself_', null]},
    });
    const s1 = bid(), s2 = bid();
    blocks[s1] = blk('control_start_as_clone', {topLevel: true, x: 20, y: 200, next: s2});
    blocks[s2] = blk('looks_say', {parent: s1, inputs: {MESSAGE: str('clone')}});
    const s = spriteTarget('Sprite1', CAT_SVG, {blocks});
    const st = stageTarget();
    return {proj: project([st, s]), assets: assetsOf(st, s)};
}

// --- fixture 4: click increments score (with sound + monitor) ------------------
function click() {
    n = 0;
    const scoreId = bid('var');
    const pop = makePopWav();
    const blocks = {};
    const c1 = bid(), c2 = bid();
    blocks[c1] = blk('event_whenthisspriteclicked', {topLevel: true, x: 20, y: 20, next: c2});
    blocks[c2] = blk('data_changevariableby', {
        parent: c1,
        fields: {VARIABLE: ['score', scoreId]},
        inputs: {VALUE: num(1)},
    });
    const s = spriteTarget('Cookie', COOKIE_SVG, {
        variables: {[scoreId]: ['score', 0]},
        blocks,
        sounds: [{assetId: pop.assetId, name: 'pop', dataFormat: 'wav', format: '', rate: pop.rate, sampleCount: pop.sampleCount, md5ext: pop.md5ext}],
    });
    s.monitors = [{
        id: scoreId, mode: 'default', opcode: 'data_variable', params: {VARIABLE: 'score'},
        spriteName: null, value: 0, width: 0, height: 0, x: 5, y: 5, visible: true,
    }];
    const st = stageTarget();
    const assets = [...assetsOf(st, s), [pop.md5ext, pop.data]];
    return {proj: project([st, s]), assets};
}

// --- fixture 5: touching via bounding boxes ------------------------------------
function touch() {
    n = 0;
    // Chaser: flag -> goto(-150,0) -> point right -> forever move 6
    const c = {};
    const c1 = bid(), c2 = bid(), c3 = bid(), c4 = bid(), c5 = bid(), c6 = bid(), m1 = bid();
    c[c1] = blk('event_whenflagclicked', {topLevel: true, x: 20, y: 20, next: c2});
    c[c2] = blk('motion_gotoxy', {parent: c1, next: c3, inputs: {X: num(-150), Y: num(0)}});
    c[c3] = blk('motion_pointindirection', {parent: c2, next: c4, inputs: {DIRECTION: num(90)}});
    c[c4] = blk('control_forever', {parent: c3, inputs: {SUBSTACK: [2, c5]}});
    c[c5] = blk('control_if_else', {parent: c4, inputs: {CONDITION: [2, c6]}});
    // if NOT touching Target -> move; else say hit
    const not1 = bid(), touch1 = bid();
    c[c6] = blk('operator_not', {parent: c5, inputs: {OPERAND: [2, not1]}});
    c[not1] = blk('sensing_touchingobject', {parent: c6, inputs: {TOUCHINGOBJECTMENU: [1, m1]}});
    c[m1] = blk('sensing_touchingobjectmenu', {parent: not1, shadow: true, fields: {TOUCHINGOBJECTMENU: ['Target', null]}});
    const mv = bid(), say = bid();
    c[c5].inputs.SUBSTACK2 = [2, say];
    c[mv] = blk('motion_movesteps', {parent: c5, inputs: {STEPS: num(6)}});
    c[c5].inputs.SUBSTACK = [2, mv];
    c[say] = blk('looks_say', {parent: c5, inputs: {MESSAGE: str('hit')}});
    const chaser = spriteTarget('Chaser', CAT_SVG, {blocks: c}, {x: -150, y: 0});
    const tgt = spriteTarget('Target', BALL_SVG, {}, {x: 100, y: 0});
    const st = stageTarget();
    return {proj: project([st, chaser, tgt]), assets: assetsOf(st, chaser, tgt)};
}

// --- fixture 6: ask/answer ---------------------------------------------------------
function ask() {
    n = 0;
    const blocks = {};
    const a1 = bid(), a2 = bid(), a3 = bid(), r1 = bid();
    blocks[a1] = blk('event_whenflagclicked', {topLevel: true, x: 20, y: 20, next: a2});
    blocks[a2] = blk('sensing_askandwait', {parent: a1, next: a3, inputs: {QUESTION: str('name?')}});
    blocks[a3] = blk('looks_say', {parent: a2, inputs: {MESSAGE: [2, r1]}});
    blocks[r1] = blk('sensing_answer', {parent: a3});
    const s = spriteTarget('Sprite1', CAT_SVG, {blocks});
    const st = stageTarget();
    return {proj: project([st, s]), assets: assetsOf(st, s)};
}

// --- fixture 7: sprite scalar + list + broadcast separation -------------------------
function lists() {
    n = 0;
    const varId = bid('var');
    const listId = bid('list');
    const bcast = bid('bc');
    const blocks = {};
    const f1 = bid(), f2 = bid(), f3 = bid();
    blocks[f1] = blk('event_whenflagclicked', {topLevel: true, x: 20, y: 20, next: f2});
    blocks[f2] = blk('data_setvariableto', {
        parent: f1, next: f3,
        fields: {VARIABLE: ['score', varId]},
        inputs: {VALUE: num(7)},
    });
    blocks[f3] = blk('data_addtolist', {
        parent: f2,
        fields: {LIST: ['items', listId]},
        inputs: {ITEM: str('a')},
    });
    const s = spriteTarget('Sprite1', CAT_SVG, {
        variables: {[varId]: ['score', 0]},
        lists: {[listId]: ['items', []]},
        broadcasts: {[bcast]: 'go'},
        blocks,
    });
    const st = stageTarget({broadcasts: {[bcast]: 'go'}});
    return {proj: project([st, s]), assets: assetsOf(st, s)};
}

const makers = {greenflag, keys, clones, click, touch, ask, lists};

async function main() {
    for (const [name, fn] of Object.entries(makers)) {
        const {proj, assets} = fn();
        await writeSb3(`${outDir}/${name}.sb3`, proj, assets);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
