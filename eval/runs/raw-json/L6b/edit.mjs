// L6b: edit platformer-853110869.sb3 (raw project.json edit).
// Add variable タイム (seconds since green flag) + visible monitor,
// timer script, and reset-on-level-restart (`次のステージ` broadcast receiver).
// Everything else byte-identical in meaning: no ids/positions touched.
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from '/path/to/agentwarp/tools/vmrun/node_modules/jszip/dist/jszip.js';

const IN = '/path/to/agentwarp/eval/fixtures/platformer-853110869.sb3';
const OUT = new URL('./out.sb3', import.meta.url).pathname;

const zip = await JSZip.loadAsync(readFileSync(IN));
const proj = JSON.parse(await zip.file('project.json').async('string'));

const stage = proj.targets.find((t) => t.isStage);
const B = stage.blocks;
const NEXT_BC = 'pjlItp5b*r{6m;P)J@1x'; // '次のステージ'
if (!Object.values(stage.broadcasts).includes('次のステージ')) {
    throw new Error('restart broadcast not found');
}

const V = 'AWAjikan';
stage.variables[V] = ['タイム', 0];
proj.monitors.push({
    id: V, mode: 'default', opcode: 'data_variable', params: { VARIABLE: 'タイム' },
    spriteName: null, value: 0, width: 0, height: 0, x: 5, y: 5, visible: true,
});

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

// timer: flag -> set 0 -> forever { wait 1; change by 1 }
blk('AWAt-flag', 'event_whenflagclicked', { topLevel: true, x: 262, y: 500 });
blk('AWAt-zero', 'data_setvariableto', {
    fields: { VARIABLE: ['タイム', V] }, inputs: { VALUE: [1, [4, '0']] },
});
blk('AWAt-loop', 'control_forever', { inputs: { SUBSTACK: [2, 'AWAt-wait'] } });
blk('AWAt-wait', 'control_wait', { inputs: { DURATION: [1, [4, '1']] } });
blk('AWAt-inc', 'data_changevariableby', {
    fields: { VARIABLE: ['タイム', V] }, inputs: { VALUE: [1, [4, '1']] },
});
B['AWAt-flag'].next = 'AWAt-zero';
B['AWAt-zero'].parent = 'AWAt-flag'; B['AWAt-zero'].next = 'AWAt-loop';
B['AWAt-loop'].parent = 'AWAt-zero';
B['AWAt-wait'].parent = 'AWAt-loop';
B['AWAt-inc'].parent = 'AWAt-wait';
B['AWAt-wait'].next = 'AWAt-inc';

// reset on level restart
blk('AWAr-hat', 'event_whenbroadcastreceived', { topLevel: true, x: 262, y: 760 });
B['AWAr-hat'].fields = { BROADCAST_OPTION: ['次のステージ', NEXT_BC] };
blk('AWAr-zero', 'data_setvariableto', {
    fields: { VARIABLE: ['タイム', V] }, inputs: { VALUE: [1, [4, '0']] },
});
B['AWAr-hat'].next = 'AWAr-zero';
B['AWAr-zero'].parent = 'AWAr-hat';

// comments on the new scripts
function comment(id, blockId, x, y, text) {
    if (stage.comments[id]) throw new Error('comment collision: ' + id);
    stage.comments[id] = { blockId, x, y, width: 240, height: 80, minimized: false, text };
}
comment('AWAc-timer', 'AWAt-flag', 540, 500,
    'タイム timer: counts seconds since the green flag (1s loop); shown in the monitor.');
comment('AWAc-reset', 'AWAr-hat', 540, 760,
    'Level restart: the 次のステージ broadcast zeroes タイム.');

zip.file('project.json', JSON.stringify(proj));
const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUT, out);
console.log('wrote', OUT, out.length, 'bytes');
