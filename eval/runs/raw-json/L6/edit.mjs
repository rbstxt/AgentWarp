// L6: edit scrolltutorial-378587848.sb3 (raw project.json edit, no Scratch tool).
// (a) EXPLAIN.md written separately.
// (b) P toggles pause: movement frozen, PAUSED shown in a say bubble.
// (c) Jump 17 -> 25.5 (1.5x) + double jump (one extra jump while airborne).
// (d) Scratch comments on each new/changed script.
// Untouched scripts keep exact ids and x/y; only listed blocks change.
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from '/path/to/agentwarp/tools/vmrun/node_modules/jszip/dist/jszip.js';

const IN = '/path/to/agentwarp/eval/fixtures/scrolltutorial-378587848.sb3';
const OUT = new URL('./out.sb3', import.meta.url).pathname;

const zip = await JSZip.loadAsync(readFileSync(IN));
const proj = JSON.parse(await zip.file('project.json').async('string'));

const player = proj.targets.find((t) => t.name === 'player');
const B = player.blocks;
const V = Object.fromEntries(
    Object.entries(player.variables).map(([id, [name]]) => [name, id]),
);
// V: x, y, 'speed y', 'in air'

// --- new variables ---
B && null;
player.variables['AWApaused'] = ['paused', 0];
player.variables['AWAjumps'] = ['jumps', 0];

function blk(id, opcode, o = {}) {
    if (B[id]) throw new Error('id collision: ' + id);
    B[id] = {
        opcode, next: o.next ?? null, parent: o.parent ?? null,
        inputs: o.inputs ?? {}, fields: o.fields ?? {},
        shadow: o.shadow ?? false, topLevel: o.topLevel ?? false,
        ...(o.topLevel ? { x: o.x ?? 20, y: o.y ?? 20 } : {}),
    };
    return id;
}
function sub(...ids) {
    for (const id of ids) {
        B[id].topLevel = false;
        delete B[id].x; delete B[id].y;
    }
}
const varRef = (name, id) => [3, [12, name, id], [10, '0']];
function keyP(blocks, id, menuId) {
    blk(id, 'sensing_keypressed', { inputs: { KEY_OPTION: [1, menuId] } });
    blk(menuId, 'sensing_keyoptions', { shadow: true, fields: { KEY_OPTION: ['p', null] } });
    B[menuId].parent = id;
}

// --- (b) pause gate: wrap tick body in `if paused = 0` ---
const TICKDEF = 'Yt{7~R5HQLmO$dUww)Gx';
const FIRSTIF = ':;94X9m|GM(r!o3fnE)/';
blk('AWAgate', 'control_if', { inputs: { CONDITION: [2, 'AWAeq0'], SUBSTACK: [2, FIRSTIF] } });
blk('AWAeq0', 'operator_equals', {
    inputs: { OPERAND1: varRef('paused', 'AWApaused'), OPERAND2: [1, [10, '0']] },
});
B['AWAeq0'].parent = 'AWAgate';
B['AWAgate'].parent = TICKDEF;
B['AWAgate'].next = null;
B[FIRSTIF].parent = 'AWAgate';
B[TICKDEF].next = 'AWAgate';
sub('AWAgate', 'AWAeq0');

// --- (c1) jump 17 -> 25.5 ---
const SET17 = '%MoM+%oOR-*DMp~)uxd3';
B[SET17].inputs.VALUE = [1, [10, '25.5']];

// --- (c2) double jump: replace `in air < 4` with grounded-or-(jumps < 2) ---
const NESTED = 'B#BItKTRdN;emLzZJb/#';
const OLDCOND = 'r([ia+5=^=d+cfqO}/E_';
blk('AWAor', 'operator_or', { inputs: { OPERAND1: [2, 'AWAeqg'], OPERAND2: [2, 'AWAltj'] } });
blk('AWAeqg', 'operator_equals', {
    inputs: { OPERAND1: varRef('in air', V['in air']), OPERAND2: [1, [10, '0']] },
});
blk('AWAltj', 'operator_lt', {
    inputs: { OPERAND1: varRef('jumps', 'AWAjumps'), OPERAND2: [1, [10, '2']] },
});
B['AWAor'].parent = NESTED;
B['AWAeqg'].parent = 'AWAor';
B['AWAltj'].parent = 'AWAor';
B[NESTED].inputs.CONDITION = [2, 'AWAor'];
delete B[OLDCOND]; // orphaned non-shadow block would fail `check`
sub('AWAor', 'AWAeqg', 'AWAltj');
// count the jump: after setting speed y, change jumps by 1
blk('AWAincj', 'data_changevariableby', {
    fields: { VARIABLE: ['jumps', 'AWAjumps'] }, inputs: { VALUE: [1, [4, '1']] },
});
B['AWAincj'].parent = SET17;
B[SET17].next = 'AWAincj';
sub('AWAincj');
// reset jumps on landing (in-air=0 inside `change player y`)
const LANDSET = 'Z*~Y(5!nnX]b3P[hHQ!7';
if (B[LANDSET].next !== null) throw new Error('landing set has next?');
blk('AWArstj', 'data_setvariableto', {
    fields: { VARIABLE: ['jumps', 'AWAjumps'] }, inputs: { VALUE: [1, [10, '0']] },
});
B['AWArstj'].parent = LANDSET;
B[LANDSET].next = 'AWArstj';
sub('AWArstj');

// --- (b2) pause watcher script (edge-triggered P toggle + PAUSED bubble) ---
blk('AWApflag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 2100 });
blk('AWApset0', 'data_setvariableto', {
    fields: { VARIABLE: ['paused', 'AWApaused'] }, inputs: { VALUE: [1, [10, '0']] },
});
blk('AWAp loop', 'control_forever', { inputs: { SUBSTACK: [2, 'AWAw1'] } });
blk('AWAw1', 'control_wait_until', { inputs: { CONDITION: [2, 'AWAkp1'] } });
keyP(B, 'AWAkp1', 'AWAkp1m');
blk('AWAptog', 'control_if_else', {
    inputs: { CONDITION: [2, 'AWAp0'], SUBSTACK: [2, 'AWAps1'], SUBSTACK2: [2, 'AWAps0'] },
});
blk('AWAp0', 'operator_equals', {
    inputs: { OPERAND1: varRef('paused', 'AWApaused'), OPERAND2: [1, [10, '0']] },
});
blk('AWAps1', 'data_setvariableto', {
    fields: { VARIABLE: ['paused', 'AWApaused'] }, inputs: { VALUE: [1, [10, '1']] },
});
blk('AWAsayp', 'looks_say', { inputs: { MESSAGE: [1, [10, 'PAUSED']] } });
blk('AWAps0', 'data_setvariableto', {
    fields: { VARIABLE: ['paused', 'AWApaused'] }, inputs: { VALUE: [1, [10, '0']] },
});
blk('AWAsayc', 'looks_say', { inputs: { MESSAGE: [1, [10, '']] } });
blk('AWAw2', 'control_wait_until', { inputs: { CONDITION: [2, 'AWAnot'] } });
blk('AWAnot', 'operator_not', { inputs: { OPERAND: [2, 'AWAkp2'] } });
keyP(B, 'AWAkp2', 'AWAkp2m');
B['AWApset0'].parent = 'AWApflag';
B['AWAp loop'].parent = 'AWApset0';
B['AWApflag'].next = 'AWApset0';
B['AWApset0'].next = 'AWAp loop';
B['AWAw1'].parent = 'AWAp loop';
B['AWAptog'].parent = 'AWAw1';
B['AWAptog'].next = null;
B['AWAw1'].next = 'AWAptog';
B['AWAptog'].next = 'AWAw2';
B['AWAkp1'].parent = 'AWAw1';
B['AWAp0'].parent = 'AWAptog';
B['AWAps1'].parent = 'AWAptog';
B['AWAps0'].parent = 'AWAptog';
B['AWAps1'].next = 'AWAsayp';
B['AWAsayp'].parent = 'AWAps1';
B['AWAps0'].next = 'AWAsayc';
B['AWAsayc'].parent = 'AWAps0';
B['AWAw2'].parent = 'AWAptog';
B['AWAnot'].parent = 'AWAw2';
B['AWAkp2'].parent = 'AWAnot';
sub('AWApset0', 'AWAp loop', 'AWAw1', 'AWAkp1', 'AWAkp1m', 'AWAptog', 'AWAp0',
    'AWAps1', 'AWAsayp', 'AWAps0', 'AWAsayc', 'AWAw2', 'AWAnot', 'AWAkp2', 'AWAkp2m');

// --- (d) comments on each new/changed script ---
function comment(id, blockId, x, y, text) {
    if (player.comments[id]) throw new Error('comment collision: ' + id);
    player.comments[id] = {
        blockId, x, y, width: 260, height: 90, minimized: false, text,
    };
}
comment('AWAc-gate', 'AWAgate', 294, -100,
    'PAUSE: the whole tick body only runs while paused = 0, so P freezes the player.');
comment('AWAc-jump', SET17, 600, -120,
    'JUMP 1.5x + DOUBLE JUMP: up-arrow gives speed 25.5 when standing (jumps 0) or once mid-air (jumps 1); jumps resets to 0 on landing.');
comment('AWAc-land', 'AWArstj', 250, 454,
    'DOUBLE JUMP reset: landing clears the jump counter so two jumps are available again.');
comment('AWAc-pause', 'AWApflag', 300, 2100,
    'PAUSE watcher: pressing P toggles paused; while paused the player shows PAUSED in a say bubble.');

// --- (c3) edge detection: hold-to-jump must not burn the double jump ---
// up-if CONDITION: kup AND NOT prevUp ; end of tick records prevUp.
player.variables['AWAprevUp'] = ['prevUp', 0];
const UPIF = 'CD,N)g9ENIPub,dOGTUQ';
const KUP = '7a)..i-4+gA~cX[#n#zx';
const TICKLAST = 'SqLLAo^Fq]6][R_t$.#F';
blk('AWAedge', 'operator_and', { inputs: { OPERAND1: [2, KUP], OPERAND2: [2, 'AWAenot'] } });
blk('AWAenot', 'operator_not', {
    inputs: { OPERAND: [3, [12, 'prevUp', 'AWAprevUp'], [10, '0']] },
});
B['AWAedge'].parent = UPIF;
B['AWAenot'].parent = 'AWAedge';
B[KUP].parent = 'AWAedge';
B[UPIF].inputs.CONDITION = [2, 'AWAedge'];
blk('AWAifp2', 'control_if_else', {
    inputs: { CONDITION: [2, 'AWAkup3'], SUBSTACK: [2, 'AWAprev1'], SUBSTACK2: [2, 'AWAprev0'] },
});
keyP(B, 'AWAkup3', 'AWAkup3m');
B['AWAkup3m'].fields.KEY_OPTION = ['up arrow', null];
blk('AWAprev1', 'data_setvariableto', {
    fields: { VARIABLE: ['prevUp', 'AWAprevUp'] }, inputs: { VALUE: [1, [10, '1']] },
});
blk('AWAprev0', 'data_setvariableto', {
    fields: { VARIABLE: ['prevUp', 'AWAprevUp'] }, inputs: { VALUE: [1, [10, '0']] },
});
B['AWAifp2'].parent = TICKLAST;
B[TICKLAST].next = 'AWAifp2';
B['AWAkup3'].parent = 'AWAifp2';
B['AWAprev1'].parent = 'AWAifp2';
B['AWAprev0'].parent = 'AWAifp2';
sub('AWAedge', 'AWAenot', 'AWAifp2', 'AWAkup3', 'AWAkup3m', 'AWAprev1', 'AWAprev0');

zip.file('project.json', JSON.stringify(proj));
const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUT, out);
console.log('wrote', OUT, out.length, 'bytes');
