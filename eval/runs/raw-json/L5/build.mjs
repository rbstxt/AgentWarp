// L5: platformer. Gravity + jump (ground only), level data in a list of
// platform rects (flat triples x,y,w), custom block collide (dx) (dy) with
// run-without-screen-refresh, camera scrollX, 2 levels via broadcast.
import {
    blk, num, str, chain, sub, varRef, keyPressed, onBroadcast, broadcastTo,
    stageTarget, spriteTarget, project, writeSb3, assetsOf, svgCostume,
    wsComment, PLAYER_SVG, PLATFORM_SVG,
} from '../shared.mjs';

let N = 0;
const nid = (p) => `${p}${++N}`;
// expression-block helper: creates reporter block, caller parents it via input [2, id]
// NOTE: arithmetic ops take NUM1/NUM2; comparisons/booleans take OPERAND*.
const ARITH = new Set(['operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide']);
function ex(blocks, opcode, inputs = {}, fields = {}) {
    if (ARITH.has(opcode)) {
        const fixed = {};
        for (const [k, v] of Object.entries(inputs)) {
            fixed[k === 'OPERAND1' ? 'NUM1' : k === 'OPERAND2' ? 'NUM2' : k] = v;
        }
        inputs = fixed;
    }
    const id = nid('e');
    blk(blocks, id, opcode, { inputs, fields });
    return id;
}

const V = { level: 'vLevel', sx: 'vSX' };          // stage globals
const P = {                                        // player locals
    wx: 'pWX', wy: 'pWY', vy: 'pVY', dx: 'pDX', g: 'pG',
    i: 'pI', px: 'pPX', py: 'pPY', pw: 'pPW',
};
const LIST = 'lPlat';
const BC = 'bcLevel2';
const ARGDX = 'aDX', ARGDY = 'aDY', ARGDXM = 'aDXm', ARGDYM = 'aDYm';

// ---------- Stage ----------
const sb = {};
blk(sb, 'flag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(sb, 'del', 'data_deletealloflist', { fields: { LIST: ['platforms', LIST] } });
const L1 = [0, -140, 400, 60, -60, 120, 190, 20, 100]; // flat x,y,w triples
const addIds = [];
L1.forEach((v, k) => {
    const id = `add${k}`;
    blk(sb, id, 'data_addtolist', {
        fields: { LIST: ['platforms', LIST] },
        inputs: { ITEM: str(v) },
    });
    addIds.push(id);
});
blk(sb, 'lvl1', 'data_setvariableto', {
    fields: { VARIABLE: ['level', V.level] }, inputs: { VALUE: num(1) } });
blk(sb, 'sx0', 'data_setvariableto', {
    fields: { VARIABLE: ['scrollX', V.sx] }, inputs: { VALUE: num(0) } });
blk(sb, 'bd1', 'looks_switchbackdropto', { inputs: { BACKDROP: [1, 'bd1m'] } });
blk(sb, 'bd1m', 'looks_backdrops', { shadow: true, fields: { BACKDROP: ['level1', null] } });
sb['bd1m'].parent = 'bd1';
chain(sb, ['flag', 'del', ...addIds, 'lvl1', 'sx0', 'bd1'], 20, 20);
// level 2 receiver: rebuild list, reset scroll, switch backdrop
blk(sb, 'l2hat', 'event_whenbroadcastreceived', { topLevel: true, x: 20, y: 560 });
sb['l2hat'].fields = { BROADCAST_OPTION: ['level2', BC] };
blk(sb, 'l2del', 'data_deletealloflist', { fields: { LIST: ['platforms', LIST] } });
const L2 = [0, -140, 400, -80, -60, 120, 40, 20, 100];
const add2Ids = [];
L2.forEach((v, k) => {
    const id = `add2${k}`;
    blk(sb, id, 'data_addtolist', {
        fields: { LIST: ['platforms', LIST] },
        inputs: { ITEM: str(v) },
    });
    add2Ids.push(id);
});
blk(sb, 'lvl2', 'data_setvariableto', {
    fields: { VARIABLE: ['level', V.level] }, inputs: { VALUE: num(2) } });
blk(sb, 'sx02', 'data_setvariableto', {
    fields: { VARIABLE: ['scrollX', V.sx] }, inputs: { VALUE: num(0) } });
blk(sb, 'bd2', 'looks_switchbackdropto', { inputs: { BACKDROP: [1, 'bd2m'] } });
blk(sb, 'bd2m', 'looks_backdrops', { shadow: true, fields: { BACKDROP: ['level2', null] } });
sb['bd2m'].parent = 'bd2';
chain(sb, ['l2hat', 'l2del', ...add2Ids, 'lvl2', 'sx02', 'bd2'], 20, 600);
const sc = {};
wsComment(sc, 'c1', 560, 20, 'L5: level data lives in the platforms list (flat x y w triples); flag builds level 1, level2 broadcast rebuilds it.');

const LV1_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#bfe3ff"/><rect x="0" y="310" width="480" height="50" fill="#7a4a21"/><rect x="0" y="310" width="480" height="6" fill="#37c837"/></svg>`;
const LV2_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#2030a0"/><rect x="0" y="310" width="480" height="50" fill="#5a3418"/><rect x="0" y="310" width="480" height="6" fill="#c83737"/></svg>`;
const lv1 = svgCostume('level1', LV1_SVG), lv2 = svgCostume('level2', LV2_SVG);
const st = stageTarget({
    variables: { [V.level]: ['level', 1], [V.sx]: ['scrollX', 0] },
    lists: { [LIST]: ['platforms', []] },
    broadcasts: { [BC]: 'level2' },
    blocks: sb, comments: sc,
    costumes: [lv1.costume, lv2.costume],
    extraAssets: [[lv1.md5ext, LV1_SVG], [lv2.md5ext, LV2_SVG]],
    monitors: [{
        id: V.level, mode: 'default', opcode: 'data_variable', params: { VARIABLE: 'level' },
        spriteName: null, value: 1, width: 0, height: 0, x: 5, y: 5, visible: true,
    }],
});

// ---------- Player ----------
const pb = {};
const pvars = {
    [P.wx]: ['wx', -150], [P.wy]: ['wy', 100], [P.vy]: ['vy', 0],
    [P.dx]: ['dx', 0], [P.g]: ['grounded', 0],
    [P.i]: ['i', 1], [P.px]: ['px', 0], [P.py]: ['py', 0], [P.pw]: ['pw', 0],
};
const W = (n) => varRef({ wx: 'wx', wy: 'wy', vy: 'vy', dx: 'dx', grounded: 'grounded', i: 'i', px: 'px', py: 'py', pw: 'pw' }[n] ?? n, { wx: P.wx, wy: P.wy, vy: P.vy, dx: P.dx, grounded: P.g, i: P.i, px: P.px, py: P.py, pw: P.pw }[n]);

// P1: main loop
blk(pb, 'flag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(pb, 'init', 'data_setvariableto', {
    fields: { VARIABLE: ['wx', P.wx] }, inputs: { VALUE: num(-150) } });
blk(pb, 'init2', 'data_setvariableto', {
    fields: { VARIABLE: ['wy', P.wy] }, inputs: { VALUE: num(100) } });
blk(pb, 'init3', 'data_setvariableto', {
    fields: { VARIABLE: ['vy', P.vy] }, inputs: { VALUE: num(0) } });
blk(pb, 'show', 'looks_show', {});
blk(pb, 'loop', 'control_forever', { inputs: { SUBSTACK: [2, 'sdx'] } });
// set dx from arrows
blk(pb, 'sdx', 'data_setvariableto', {
    fields: { VARIABLE: ['dx', P.dx] }, inputs: { VALUE: num(0) } });
blk(pb, 'ifr', 'control_if', { inputs: { CONDITION: [2, 'kr'], SUBSTACK: [2, 'sdxr'] } });
keyPressed(pb, 'kr', 'krmenu', 'right arrow');
blk(pb, 'sdxr', 'data_setvariableto', {
    fields: { VARIABLE: ['dx', P.dx] }, inputs: { VALUE: num(4) } });
blk(pb, 'ifl', 'control_if', { inputs: { CONDITION: [2, 'kl'], SUBSTACK: [2, 'sdxl'] } });
keyPressed(pb, 'kl', 'klmenu', 'left arrow');
blk(pb, 'sdxl', 'data_setvariableto', {
    fields: { VARIABLE: ['dx', P.dx] }, inputs: { VALUE: num(-4) } });
// gravity
blk(pb, 'grav', 'data_changevariableby', {
    fields: { VARIABLE: ['vy', P.vy] }, inputs: { VALUE: num(-0.8) } });
// jump if up + grounded
blk(pb, 'ifup', 'control_if', { inputs: { CONDITION: [2, 'kup'], SUBSTACK: [2, 'ifg'] } });
keyPressed(pb, 'kup', 'kupmenu', 'up arrow');
blk(pb, 'ifg', 'control_if', { inputs: { CONDITION: [2, 'gis1'], SUBSTACK: [2, 'jump'] } });
blk(pb, 'gis1', 'operator_equals', { inputs: { OPERAND1: W('grounded'), OPERAND2: num(1) } });
blk(pb, 'jump', 'data_setvariableto', {
    fields: { VARIABLE: ['vy', P.vy] }, inputs: { VALUE: num(12) } });
blk(pb, 'ung', 'data_setvariableto', {
    fields: { VARIABLE: ['grounded', P.g] }, inputs: { VALUE: num(0) } });
// collide(dx)(vy)
blk(pb, 'col', 'procedures_call', {
    inputs: { [ARGDX]: W('dx'), [ARGDY]: W('vy') },
    mutation: { tagName: 'mutation', children: [], proccode: 'collide %s %s', argumentids: `["${ARGDX}","${ARGDY}"]`, warp: 'true' },
});
// camera: scrollX = max(0, wx-100)
blk(pb, 'ifcam', 'control_if', {
    inputs: { CONDITION: [2, 'camc'], SUBSTACK: [2, 'camset'], SUBSTACK2: [2, 'cam0'] },
});
blk(pb, 'ifcam', 'control_if_else', {
    inputs: { CONDITION: [2, 'camc'], SUBSTACK: [2, 'camset'], SUBSTACK2: [2, 'cam0'] },
});
blk(pb, 'camc', 'operator_gt', { inputs: { OPERAND1: W('wx'), OPERAND2: num(100) } });
blk(pb, 'camset', 'data_setvariableto', {
    fields: { VARIABLE: ['scrollX', V.sx] },
    inputs: { VALUE: [2, 'camsub'] },
});
blk(pb, 'camsub', 'operator_subtract', { inputs: { NUM1: W('wx'), NUM2: num(100) } });
blk(pb, 'cam0', 'data_setvariableto', {
    fields: { VARIABLE: ['scrollX', V.sx] }, inputs: { VALUE: num(0) } });
// draw position
blk(pb, 'setx', 'motion_setx', { inputs: { X: [2, 'sxpos'] } });
blk(pb, 'sxpos', 'operator_subtract', {
    inputs: { NUM1: W('wx'), NUM2: varRef('scrollX', V.sx) },
});
blk(pb, 'sety', 'motion_sety', { inputs: { Y: [2, 'sypos'] } });
blk(pb, 'sypos', 'motion_yposition', {});
blk(pb, 'sypos', 'data_variable', { fields: { VARIABLE: ['wy', P.wy] } });
// NOTE sypos must report wy: use inline var reporter as input instead (see fix below)
// level trigger + fall reset
blk(pb, 'ifnext', 'control_if', { inputs: { CONDITION: [2, 'nextc'], SUBSTACK: [2, 'gonext'] } });
blk(pb, 'nextc', 'operator_and', { inputs: { OPERAND1: [2, 'nx1'], OPERAND2: [2, 'nx2'] } });
blk(pb, 'nx1', 'operator_gt', { inputs: { OPERAND1: W('wx'), OPERAND2: num(230) } });
blk(pb, 'nx2', 'operator_equals', {
    inputs: { OPERAND1: varRef('level', V.level), OPERAND2: num(1) } });
blk(pb, 'gonext', 'data_setvariableto', {
    fields: { VARIABLE: ['level', V.level] }, inputs: { VALUE: num(2) } });
blk(pb, 'gonext2', 'event_broadcast', { inputs: { BROADCAST_INPUT: [1, [11, 'level2', BC]] } });
blk(pb, 'iffall', 'control_if', { inputs: { CONDITION: [2, 'fallc'], SUBSTACK: [2, 'freset'] } });
blk(pb, 'fallc', 'operator_lt', { inputs: { OPERAND1: W('wy'), OPERAND2: num(-200) } });
blk(pb, 'freset', 'data_setvariableto', {
    fields: { VARIABLE: ['wx', P.wx] }, inputs: { VALUE: num(-150) } });
blk(pb, 'freset2', 'data_setvariableto', {
    fields: { VARIABLE: ['wy', P.wy] }, inputs: { VALUE: num(100) } });
blk(pb, 'freset3', 'data_setvariableto', {
    fields: { VARIABLE: ['vy', P.vy] }, inputs: { VALUE: num(0) } });

chain(pb, ['flag', 'init', 'init2', 'init3', 'show', 'loop'], 20, 20);
chain(pb, ['sdx', 'ifr', 'ifl', 'grav', 'ifup', 'col', 'ifcam', 'setx', 'sety', 'ifnext', 'iffall'], 0, 0);
pb['sdx'].parent = 'loop';
chain(pb, ['jump', 'ung'], 0, 0); pb['jump'].parent = 'ifg';
chain(pb, ['gonext', 'gonext2'], 0, 0); pb['gonext'].parent = 'ifnext';
chain(pb, ['freset', 'freset2', 'freset3'], 0, 0); pb['freset'].parent = 'iffall';
// parents of condition/expression blocks
for (const [c, p] of [['kr', 'ifr'], ['sdxr', 'ifr'], ['kl', 'ifl'], ['sdxl', 'ifl'],
    ['kup', 'ifup'], ['ifg', 'ifup'], ['gis1', 'ifg'], ['camc', 'ifcam'],
    ['camset', 'ifcam'], ['cam0', 'ifcam'], ['camsub', 'camset'],
    ['sxpos', 'setx'], ['sypos', 'sety'], ['nx1', 'nextc'], ['nx2', 'nextc'],
    ['nextc', 'ifnext'], ['fallc', 'iffall']]) pb[c].parent = p;
pb['krmenu'].parent = 'kr'; pb['klmenu'].parent = 'kl'; pb['kupmenu'].parent = 'kup';
sub(pb, 'sdx', 'ifr', 'ifl', 'grav', 'ifup', 'ifg', 'jump', 'ung', 'col',
    'ifcam', 'camset', 'cam0', 'setx', 'sxpos', 'sety', 'sypos',
    'ifnext', 'gonext', 'gonext2', 'iffall', 'freset', 'freset2', 'freset3');

// P2: level2 reset
blk(pb, 'l2h', 'event_whenbroadcastreceived', { topLevel: true, x: 20, y: 1150 });
pb['l2h'].fields = { BROADCAST_OPTION: ['level2', BC] };
blk(pb, 'l2x', 'data_setvariableto', {
    fields: { VARIABLE: ['wx', P.wx] }, inputs: { VALUE: num(-150) } });
blk(pb, 'l2y', 'data_setvariableto', {
    fields: { VARIABLE: ['wy', P.wy] }, inputs: { VALUE: num(100) } });
blk(pb, 'l2v', 'data_setvariableto', {
    fields: { VARIABLE: ['vy', P.vy] }, inputs: { VALUE: num(0) } });
chain(pb, ['l2h', 'l2x', 'l2y', 'l2v'], 20, 1400);

// P3: custom block collide (dx) (dy), warp
blk(pb, 'def', 'procedures_definition', { topLevel: true, x: 560, y: 20 });
blk(pb, 'proto', 'procedures_prototype', {
    shadow: true,
    inputs: { [ARGDX]: [1, ARGDXM], [ARGDY]: [1, ARGDYM] },
    mutation: {
        tagName: 'mutation', children: [], proccode: 'collide %s %s',
        argumentids: `["${ARGDX}","${ARGDY}"]`, argumentnames: '["dx","dy"]',
        argumentdefaults: '["0","0"]', warp: 'true',
    },
});
pb['proto'].parent = 'def';
pb['def'].inputs = { custom_block: [1, 'proto'] };
blk(pb, ARGDXM, 'argument_reporter_string_number', { shadow: true, fields: { VALUE: ['dx', null] } });
blk(pb, ARGDYM, 'argument_reporter_string_number', { shadow: true, fields: { VALUE: ['dy', null] } });
pb[ARGDXM].parent = 'proto'; pb[ARGDYM].parent = 'proto';
const AR = (m, dflt) => [3, m, [10, dflt]];  // arg use inside def (mirrors real projects)
blk(pb, 'mwx', 'data_changevariableby', {
    fields: { VARIABLE: ['wx', P.wx] }, inputs: { VALUE: AR(ARGDXM, '0') } });
blk(pb, 'mwy', 'data_changevariableby', {
    fields: { VARIABLE: ['wy', P.wy] }, inputs: { VALUE: AR(ARGDYM, '0') } });
blk(pb, 'ung2', 'data_setvariableto', {
    fields: { VARIABLE: ['grounded', P.g] }, inputs: { VALUE: num(0) } });
blk(pb, 'seti', 'data_setvariableto', {
    fields: { VARIABLE: ['i', P.i] }, inputs: { VALUE: num(1) } });
blk(pb, 'rep', 'control_repeat', {
    inputs: {
        SUBSTACK: [2, 'rdpx'],
        TIMES: [2, 'repct'],
    },
});
blk(pb, 'repct', 'operator_divide', {
    inputs: { NUM1: [2, 'replen'], NUM2: num(3) } });
blk(pb, 'replen', 'data_lengthoflist', { fields: { LIST: ['platforms', LIST] } });
// px = item((i-1)*3+1) etc.
// build ((i-1)*3)+base explicitly:
function itemBlock(blocks, base) {
    const s1 = ex(blocks, 'operator_subtract', { OPERAND1: W('i'), OPERAND2: num(1) });
    const m1 = ex(blocks, 'operator_multiply', { OPERAND1: [2, s1], OPERAND2: num(3) });
    const a1 = ex(blocks, 'operator_add', { OPERAND1: [2, m1], OPERAND2: num(base) });
    blocks[s1].parent = m1; blocks[m1].parent = a1;
    const it = nid('it');
    blk(blocks, it, 'data_itemoflist', {
        inputs: { INDEX: [2, a1] },
        fields: { LIST: ['platforms', LIST] },
    });
    blocks[a1].parent = it;
    return it;
}
const itpx = itemBlock(pb, 1), itpy = itemBlock(pb, 2), itpw = itemBlock(pb, 3);
blk(pb, 'rdpx', 'data_setvariableto', {
    fields: { VARIABLE: ['px', P.px] }, inputs: { VALUE: [2, itpx] } });
blk(pb, 'rdpy', 'data_setvariableto', {
    fields: { VARIABLE: ['py', P.py] }, inputs: { VALUE: [2, itpy] } });
blk(pb, 'rdpw', 'data_setvariableto', {
    fields: { VARIABLE: ['pw', P.pw] }, inputs: { VALUE: [2, itpw] } });
// overlap test: (wx > px-pw/2-15) & (wx < px+pw/2+15) & (wy-20 < py+10) & (wy-20 > py-30)
function half(blocks) {
    return ex(blocks, 'operator_add', {
        OPERAND1: [2, ex(blocks, 'operator_divide', { OPERAND1: W('pw'), OPERAND2: num(2) })],
        OPERAND2: num(15),
    });
}
const h1 = half(pb), h2 = half(pb);
const c1 = ex(pb, 'operator_gt', {
    OPERAND1: W('wx'),
    OPERAND2: [2, ex(pb, 'operator_subtract', { OPERAND1: W('px'), OPERAND2: [2, h1] })],
});
const c2 = ex(pb, 'operator_lt', {
    OPERAND1: W('wx'),
    OPERAND2: [2, ex(pb, 'operator_add', { OPERAND1: W('px'), OPERAND2: [2, h2] })],
});
const c3 = ex(pb, 'operator_lt', {
    OPERAND1: [2, ex(pb, 'operator_subtract', { OPERAND1: W('wy'), OPERAND2: num(20) })],
    OPERAND2: [2, ex(pb, 'operator_add', { OPERAND1: W('py'), OPERAND2: num(10) })],
});
const c4 = ex(pb, 'operator_gt', {
    OPERAND1: [2, ex(pb, 'operator_subtract', { OPERAND1: W('wy'), OPERAND2: num(20) })],
    OPERAND2: [2, ex(pb, 'operator_subtract', { OPERAND1: W('py'), OPERAND2: num(30) })],
});
// fix parents: walk all ex blocks — set each [2, childId] input's child parent.
// (done generically below via parentPass)
const c12 = ex(pb, 'operator_and', { OPERAND1: [2, c1], OPERAND2: [2, c2] });
const c34 = ex(pb, 'operator_and', { OPERAND1: [2, c3], OPERAND2: [2, c4] });
const call = ex(pb, 'operator_and', { OPERAND1: [2, c12], OPERAND2: [2, c34] });
blk(pb, 'ifov', 'control_if', {
    inputs: { CONDITION: [2, call], SUBSTACK: [2, 'ifdn'] },
});
blk(pb, 'ifdn', 'control_if_else', {
    inputs: {
        CONDITION: [2, 'dnc'],
        SUBSTACK: [2, 'land'],
        SUBSTACK2: [2, 'ifup2'],
    },
});
blk(pb, 'dnc', 'operator_lt', { inputs: { OPERAND1: AR(ARGDYM, '0'), OPERAND2: num(1) } });
blk(pb, 'land', 'data_setvariableto', {
    fields: { VARIABLE: ['wy', P.wy] },
    inputs: { VALUE: [2, 'landv'] },
});
blk(pb, 'landv', 'operator_add', { inputs: { NUM1: W('py'), NUM2: num(30) } });
blk(pb, 'landv2', 'data_setvariableto', {
    fields: { VARIABLE: ['vy', P.vy] }, inputs: { VALUE: num(0) } });
blk(pb, 'landg', 'data_setvariableto', {
    fields: { VARIABLE: ['grounded', P.g] }, inputs: { VALUE: num(1) } });
blk(pb, 'ifup2', 'data_setvariableto', {
    fields: { VARIABLE: ['wy', P.wy] },
    inputs: { VALUE: [2, 'headv'] },
});
blk(pb, 'headv', 'operator_subtract', { inputs: { NUM1: W('py'), NUM2: num(30) } });
blk(pb, 'headv2', 'data_setvariableto', {
    fields: { VARIABLE: ['vy', P.vy] }, inputs: { VALUE: num(0) } });
blk(pb, 'inci', 'data_changevariableby', {
    fields: { VARIABLE: ['i', P.i] }, inputs: { VALUE: num(1) } });

chain(pb, ['def', 'mwx', 'mwy', 'ung2', 'seti', 'rep'], 560, 20);
pb['proto'].parent = 'def';
pb['def'].inputs = { custom_block: [1, 'proto'] };
chain(pb, ['rdpx', 'rdpy', 'rdpw', 'ifov', 'inci'], 0, 0);
pb['rdpx'].parent = 'rep';
chain(pb, ['land', 'landv2', 'landg'], 0, 0); pb['land'].parent = 'ifdn';
chain(pb, ['ifup2', 'headv2'], 0, 0); pb['ifup2'].parent = 'ifdn';
// generic parent pass: any block referenced as [2, id] in inputs gets parented
for (const [bid, b] of Object.entries(pb)) {
    for (const v of Object.values(b.inputs ?? {})) {
        if (Array.isArray(v) && v[0] === 2 && typeof v[1] === 'string' && pb[v[1]]) {
            if (!pb[v[1]].parent) pb[v[1]].parent = bid;
        }
    }
}
sub(pb, 'mwx', 'mwy', 'ung2', 'seti', 'rep', 'rdpx', 'rdpy', 'rdpw', 'ifov',
    'ifdn', 'land', 'landv2', 'landg', 'ifup2', 'headv2', 'inci');
for (const [bid, b] of Object.entries(pb)) {
    if (b.parent && b.topLevel) { b.topLevel = false; delete b.x; delete b.y; }
}
const pc = {};
wsComment(pc, 'c1', 560, 1000, 'L5: main loop — input, gravity, jump, collide(dx)(vy), camera, level switch.');
wsComment(pc, 'c2', 560, 800, 'L5: collide (dx) (dy) moves with platform collision (no screen refresh); sets grounded.');
wsComment(pc, 'c3', 560, 1180, 'L5: level2 resets the player to the start.');

const player = spriteTarget('Player', PLAYER_SVG, {
    variables: pvars, broadcasts: { [BC]: 'level2' }, blocks: pb, comments: pc,
});

// ---------- Platform sprites (one per platform slot, repositioned every frame) ----------
function platformSprite(name, k) {
    const b = {};
    blk(b, 'flag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
    blk(b, 'show', 'looks_show', {});
    blk(b, 'loop', 'control_forever', { inputs: { SUBSTACK: [2, 'rdx'] } });
    const ix = (off) => [1, [7, String(k + off)]];
    blk(b, 'rdx', 'motion_setx', { inputs: { X: [2, 'ex'] } });
    blk(b, 'ex', 'operator_subtract', {
        inputs: { NUM1: [2, 'itx'], NUM2: varRef('scrollX', V.sx) },
    });
    blk(b, 'itx', 'data_itemoflist', {
        inputs: { INDEX: ix(0) }, fields: { LIST: ['platforms', LIST] },
    });
    blk(b, 'rdy', 'motion_sety', { inputs: { Y: [2, 'ity'] } });
    blk(b, 'ity', 'data_itemoflist', {
        inputs: { INDEX: ix(1) }, fields: { LIST: ['platforms', LIST] },
    });
    blk(b, 'sz', 'looks_setsizeto', { inputs: { SIZE: [2, 'itw'] } });
    blk(b, 'itw', 'data_itemoflist', {
        inputs: { INDEX: ix(2) }, fields: { LIST: ['platforms', LIST] },
    });
    chain(b, ['flag', 'show', 'loop'], 20, 20);
    chain(b, ['rdx', 'rdy', 'sz'], 0, 0);
    b['rdx'].parent = 'loop';
    for (const id of ['rdx', 'rdy', 'sz', 'ex', 'itx', 'ity', 'itw']) {
        b[id].topLevel = false; delete b[id].x; delete b[id].y;
    }
    b['ex'].parent = 'rdx'; b['itx'].parent = 'ex';
    b['ity'].parent = 'rdy'; b['itw'].parent = 'sz';
    const c = {};
    wsComment(c, 'c1', 20, 320, `L5: Platform clone visuals — sprite ${name} renders list slot ${k}-${k + 2}, shifted by scrollX.`);
    return spriteTarget(name, PLATFORM_SVG, { blocks: b, comments: c });
}
const p1 = platformSprite('Platform1', 1);
const p2 = platformSprite('Platform2', 4);
const p3 = platformSprite('Platform3', 7);

await writeSb3(new URL('./out.sb3', import.meta.url).pathname,
    project([st, player, p1, p2, p3]), assetsOf(st, player, p1, p2, p3));
