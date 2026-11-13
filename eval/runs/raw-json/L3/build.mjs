// L3: Cookie clicker. Click -> score+1, pop sound, pressed costume 0.1s.
// Score monitor; at 10 the stage switches to the win backdrop + broadcasts win.
import {
    blk, num, str, chain, varRef, onBroadcast, broadcastTo, switchCostume,
    switchBackdrop, playSound, stageTarget, spriteTarget, project, writeSb3,
    assetsOf, svgCostume, makePopWav, wsComment, BACKDROP_SVG, WIN_SVG,
    COOKIE_SVG, COOKIE_PRESSED_SVG,
} from '../shared.mjs';

const VAR = 'vScore';
const BC = 'bcWin';

// --- Stage: score var, two backdrops, win watcher ---
const sblocks = {};
blk(sblocks, 'flag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(sblocks, 'zero', 'data_setvariableto', {
    fields: { VARIABLE: ['score', VAR] }, inputs: { VALUE: num(0) },
});
switchBackdrop(sblocks, 'bd0', 'bd0menu', 'backdrop1');
blk(sblocks, 'waitwin', 'control_wait_until', {
    inputs: {
        CONDITION: [2, 'scoreis10'],
    },
});
blk(sblocks, 'scoreis10', 'operator_equals', {
    inputs: { OPERAND1: varRef('score', VAR), OPERAND2: num(10) },
});
switchBackdrop(sblocks, 'bdwin', 'bdwinmenu', 'win');
broadcastTo(sblocks, 'bcast', BC, 'win');
chain(sblocks, ['flag', 'zero', 'bd0', 'waitwin', 'bdwin', 'bcast'], 20, 20);
sblocks['scoreis10'].parent = 'waitwin';
const scomments = {};
wsComment(scomments, 'c1', 20, 620, 'L3: reset score, wait until score hits 10, then show the win backdrop.');

const winDress = svgCostume('win', WIN_SVG);
const st = stageTarget({
    variables: { [VAR]: ['score', 0] },
    broadcasts: { [BC]: 'win' },
    blocks: sblocks,
    comments: scomments,
    costumes: [svgCostume('backdrop1', BACKDROP_SVG).costume, winDress.costume],
    extraAssets: [
        [svgCostume('backdrop1', BACKDROP_SVG).md5ext, BACKDROP_SVG],
        [winDress.md5ext, WIN_SVG],
    ],
    monitors: [{
        id: VAR, mode: 'default', opcode: 'data_variable',
        params: { VARIABLE: 'score' }, spriteName: null, value: 0,
        width: 0, height: 0, x: 5, y: 5, visible: true,
    }],
});

// --- Cookie: click handler ---
const cblocks = {};
blk(cblocks, 'click', 'event_whenthisspriteclicked', { topLevel: true, x: 20, y: 20 });
blk(cblocks, 'incr', 'data_changevariableby', {
    fields: { VARIABLE: ['score', VAR] }, inputs: { VALUE: num(1) },
});
playSound(cblocks, 'pop', 'popmenu', 'pop');
switchCostume(cblocks, 'press', 'pressmenu', 'Cookie-pressed');
blk(cblocks, 'hold', 'control_wait', { inputs: { DURATION: num(0.1) } });
switchCostume(cblocks, 'release', 'releasemenu', 'Cookie-a');
chain(cblocks, ['click', 'incr', 'pop', 'press', 'hold', 'release'], 20, 20);
const ccomments = {};
wsComment(ccomments, 'c1', 20, 480, 'L3: each click scores 1, plays pop, flashes the pressed costume.');

const pop = makePopWav();
const normal = svgCostume('Cookie-a', COOKIE_SVG);
const pressed = svgCostume('Cookie-pressed', COOKIE_PRESSED_SVG);
const cookie = spriteTarget('Cookie', COOKIE_SVG, {
    blocks: cblocks,
    comments: ccomments,
    costumes: [normal.costume, pressed.costume],
    sounds: [{
        assetId: pop.assetId, name: 'pop', dataFormat: 'wav', format: '',
        rate: pop.rate, sampleCount: pop.sampleCount, md5ext: pop.md5ext,
    }],
});
cookie.assets.push([normal.md5ext, COOKIE_SVG], [pressed.md5ext, COOKIE_PRESSED_SVG], [pop.md5ext, pop.data]);

await writeSb3(new URL('./out.sb3', import.meta.url).pathname,
    project([st, cookie]), assetsOf(st, cookie));
