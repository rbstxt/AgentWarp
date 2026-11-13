// L1: green flag -> cat to (0,0), move 10 steps, say Hello! for 2s.
import {
    blk, num, str, chain, stageTarget, spriteTarget, project, writeSb3,
    assetsOf, wsComment, CAT_SVG,
} from '../shared.mjs';

const blocks = {};
blk(blocks, 'go', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(blocks, 'goto', 'motion_gotoxy', { inputs: { X: num(0), Y: num(0) } });
blk(blocks, 'move', 'motion_movesteps', { inputs: { STEPS: num(10) } });
blk(blocks, 'say', 'looks_sayforsecs', { inputs: { MESSAGE: str('Hello!'), SECS: num(2) } });
chain(blocks, ['go', 'goto', 'move', 'say'], 20, 20);

const comments = {};
wsComment(comments, 'c1', 20, 200, 'L1: on green flag the cat goes to the center, steps forward, and greets.');

const st = stageTarget();
const cat = spriteTarget('Sprite1', CAT_SVG, { blocks, comments });

await writeSb3(new URL('./out.sb3', import.meta.url).pathname,
    project([st, cat]), assetsOf(st, cat));
