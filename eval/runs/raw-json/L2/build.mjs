// L2: arrows move cat 5px/frame; Ball (red circle) moves diagonally, bounces forever.
import {
    blk, num, chain, keyPressed, stageTarget, spriteTarget, project,
    writeSb3, assetsOf, wsComment, CAT_SVG, BALL_SVG,
} from '../shared.mjs';

// --- Sprite1: 4-direction movement, 5 px per frame ---
const cat = {};
blk(cat, 'flag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(cat, 'home', 'motion_gotoxy', { inputs: { X: num(0), Y: num(0) } });
blk(cat, 'loop', 'control_forever', { inputs: { SUBSTACK: [2, 'ifR'] } });
const moves = [
    ['ifR', 'kR', 'mR', 'right arrow', 'DX', 5],
    ['ifL', 'kL', 'mL', 'left arrow', 'DX', -5],
    ['ifU', 'kU', 'mU', 'up arrow', 'DY', 5],
    ['ifD', 'kD', 'mD', 'down arrow', 'DY', -5],
];
for (const [ifi, ki, mi, key, axis, d] of moves) {
    blk(cat, ifi, 'control_if', { inputs: { CONDITION: [2, ki], SUBSTACK: [2, mi] } });
    keyPressed(cat, ki, ki + 'menu', key);
    const op = axis === 'DX' ? 'motion_changexby' : 'motion_changeyby';
    blk(cat, mi, op, { inputs: { [axis]: num(d) } });
    cat[ki].parent = ifi;
    cat[mi].parent = ifi;
}
chain(cat, ['flag', 'home', 'loop'], 20, 20);
// link the four ifs in a vertical chain inside the loop
cat['loop'].inputs.SUBSTACK = [2, 'ifR'];
for (let i = 0; i < moves.length; i++) {
    const [ifi] = moves[i];
    cat[ifi].parent = i === 0 ? 'loop' : moves[i - 1][0];
    cat[ifi].next = i === moves.length - 1 ? null : moves[i + 1][0];
}
const catComments = {};
wsComment(catComments, 'c1', 20, 600, 'L2: arrow keys move the cat 5 px per frame (one if per direction).');

// --- Ball: diagonal drift + edge bounce, forever ---
const ball = {};
blk(ball, 'bflag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(ball, 'bhome', 'motion_gotoxy', { inputs: { X: num(-100), Y: num(50) } });
blk(ball, 'bpoint', 'motion_pointindirection', { inputs: { DIRECTION: num(45) } });
blk(ball, 'bloop', 'control_forever', { inputs: { SUBSTACK: [2, 'bmove'] } });
blk(ball, 'bmove', 'motion_movesteps', { inputs: { STEPS: num(5) } });
blk(ball, 'bbounce', 'motion_ifonedgebounce', {});
chain(ball, ['bflag', 'bhome', 'bpoint', 'bloop'], 20, 20);
chain(ball, ['bmove', 'bbounce'], 0, 0);
ball['bmove'].parent = 'bloop';
ball['bmove'].topLevel = false;
delete ball['bmove'].x; delete ball['bmove'].y;
const ballComments = {};
wsComment(ballComments, 'c1', 20, 300, 'L2: Ball drifts diagonally and bounces off the stage edges forever.');

const st = stageTarget();
const s1 = spriteTarget('Sprite1', CAT_SVG, { blocks: cat, comments: catComments });
const s2 = spriteTarget('Ball', BALL_SVG, { blocks: ball, comments: ballComments });

await writeSb3(new URL('./out.sb3', import.meta.url).pathname,
    project([st, s1, s2]), assetsOf(st, s1, s2));
