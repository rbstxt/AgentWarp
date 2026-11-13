// L4: shooter. Player (bottom) moves with left/right, space fires Bullet clones.
// Enemy clones fall from random x every 1s. Bullet hits enemy -> both gone, score+1.
// Enemy reaching bottom -> lives-1. lives 0 -> Game Over, stop all.
import {
    blk, num, str, chain, sub, varRef, keyPressed, onBroadcast, broadcastTo,
    cloneOf, touchObj, switchBackdrop, stageTarget, spriteTarget, project, writeSb3,
    assetsOf, wsComment, svgCostume, BACKDROP_SVG, GAMEOVER_SVG, SHIP_SVG, BULLET_SVG, ENEMY_SVG,
} from '../shared.mjs';

const SCORE = 'vScore', LIVES = 'vLives', FX = 'vFireX', FY = 'vFireY';
const BC = 'bcOver';

// ---------- Stage ----------
const sb = {};
blk(sb, 'flag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(sb, 's0', 'data_setvariableto', {
    fields: { VARIABLE: ['score', SCORE] }, inputs: { VALUE: num(0) } });
blk(sb, 'l0', 'data_setvariableto', {
    fields: { VARIABLE: ['lives', LIVES] }, inputs: { VALUE: num(3) } });
blk(sb, 'wait0', 'control_wait_until', { inputs: { CONDITION: [2, 'liv0'] } });
blk(sb, 'liv0', 'operator_equals', {
    inputs: { OPERAND1: varRef('lives', LIVES), OPERAND2: num(0) } });
switchBackdrop(sb, 'bdgame', 'bdgamemenu', 'gameover');
broadcastTo(sb, 'over', BC, 'gameover');
chain(sb, ['flag', 's0', 'l0', 'wait0', 'bdgame', 'over'], 20, 20);
sb['liv0'].parent = 'wait0';
const sc = {};
wsComment(sc, 'c1', 20, 480, 'L4: reset score/lives; when lives hit 0, broadcast game over.');

const gameoverDress = svgCostume('gameover', GAMEOVER_SVG);
const st = stageTarget({
    variables: { [SCORE]: ['score', 0], [LIVES]: ['lives', 3], [FX]: ['fireX', 0], [FY]: ['fireY', 0] },
    broadcasts: { [BC]: 'gameover' },
    blocks: sb, comments: sc,
    costumes: [svgCostume('backdrop1', BACKDROP_SVG).costume, gameoverDress.costume],
    extraAssets: [
        [svgCostume('backdrop1', BACKDROP_SVG).md5ext, BACKDROP_SVG],
        [gameoverDress.md5ext, GAMEOVER_SVG],
    ],
    monitors: [
        { id: SCORE, mode: 'default', opcode: 'data_variable', params: { VARIABLE: 'score' }, spriteName: null, value: 0, width: 0, height: 0, x: 5, y: 5, visible: true },
        { id: LIVES, mode: 'default', opcode: 'data_variable', params: { VARIABLE: 'lives' }, spriteName: null, value: 3, width: 0, height: 0, x: 5, y: 30, visible: true },
    ],
});

// ---------- Player ----------
const pb = {};
blk(pb, 'pflag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(pb, 'phome', 'motion_gotoxy', { inputs: { X: num(0), Y: num(-130) } });
blk(pb, 'pshow', 'looks_show', {});
blk(pb, 'ploop', 'control_forever', { inputs: { SUBSTACK: [2, 'pifL'] } });
blk(pb, 'pifL', 'control_if', { inputs: { CONDITION: [2, 'pkL'], SUBSTACK: [2, 'pmL'] } });
keyPressed(pb, 'pkL', 'pkLmenu', 'left arrow');
blk(pb, 'pmL', 'motion_changexby', { inputs: { DX: num(-8) } });
blk(pb, 'pifR', 'control_if', { inputs: { CONDITION: [2, 'pkR'], SUBSTACK: [2, 'pmR'] } });
keyPressed(pb, 'pkR', 'pkRmenu', 'right arrow');
blk(pb, 'pmR', 'motion_changexby', { inputs: { DX: num(8) } });
blk(pb, 'pifS', 'control_if', { inputs: { CONDITION: [2, 'pkS'], SUBSTACK: [2, 'pfire'] } });
keyPressed(pb, 'pkS', 'pkSmenu', 'space');
blk(pb, 'pfire', 'control_create_clone_of', {});
blk(pb, 'pfiremenu', 'control_create_clone_of_menu', {
    shadow: true, fields: { CLONE_OPTION: ['Bullet', null] } });
pb['pfiremenu'].parent = 'pfire';
pb['pfire'].inputs = { CLONE_OPTION: [1, 'pfiremenu'] };
// record muzzle position for the clone, then cooldown
blk(pb, 'psetx', 'data_setvariableto', {
    fields: { VARIABLE: ['fireX', FX] },
    inputs: { VALUE: [3, [12, 'x position', null], [10, '0']] } });
blk(pb, 'psety', 'data_setvariableto', {
    fields: { VARIABLE: ['fireY', FY] },
    inputs: { VALUE: [3, [12, 'y position', null], [10, '0']] } });
blk(pb, 'pcool', 'control_wait', { inputs: { DURATION: num(0.2) } });
pb['pkL'].parent = 'pifL'; pb['pmL'].parent = 'pifL';
pb['pkR'].parent = 'pifR'; pb['pmR'].parent = 'pifR';
pb['pkS'].parent = 'pifS'; pb['pfire'].parent = 'pifS';
chain(pb, ['pflag', 'phome', 'pshow', 'ploop'], 20, 20);
chain(pb, ['pifL', 'pifR', 'pifS'], 0, 0);
blk(pb, 'pgate', 'control_if', { inputs: { CONDITION: [2, 'palive'], SUBSTACK: [2, 'pifL'] } });
blk(pb, 'palive', 'operator_gt', { inputs: { OPERAND1: varRef('lives', LIVES), OPERAND2: num(0) } });
pb['palive'].parent = 'pgate';
pb['pifL'].parent = 'pgate';
pb['ploop'].inputs.SUBSTACK = [2, 'pgate'];
pb['pgate'].parent = 'ploop';
sub(pb, 'pgate');
chain(pb, ['pfire', 'psetx', 'psety', 'pcool'], 0, 0);
pb['pfire'].parent = 'pifS';
sub(pb, 'pifL', 'pifR', 'pifS', 'pfire', 'psetx', 'psety', 'pcool', 'pgate');
// game-over receiver
blk(pb, 'ghat', 'event_whenbroadcastreceived', { topLevel: true, x: 20, y: 700 });
pb['ghat'].fields = { BROADCAST_OPTION: ['gameover', BC] };
blk(pb, 'gsay', 'looks_say', { inputs: { MESSAGE: str('Game Over') } });
chain(pb, ['ghat', 'gsay'], 20, 700);
const pc = {};
wsComment(pc, 'c1', 20, 900, 'L4: Player moves with arrows, fires Bullet clones on space. Game over ends everything.');

// NOTE: sprite-local motion reporters need the sprite name, not null:
// ([x position v] of [Player v]) is sensing_of; simpler and exact here is
// motion_xposition / motion_yposition (no inputs, own sprite).
pb['psetx'].inputs = { VALUE: [3, 'mx', [10, '0']] };
pb['psety'].inputs = { VALUE: [3, 'my', [10, '0']] };
blk(pb, 'mx', 'motion_xposition', {});
blk(pb, 'my', 'motion_yposition', {});
pb['mx'].parent = 'psetx'; pb['my'].parent = 'psety';

const player = spriteTarget('Player', SHIP_SVG, { blocks: pb, comments: pc });

// ---------- Bullet ----------
const bb = {};
blk(bb, 'bflag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(bb, 'bhide', 'looks_hide', {});
blk(bb, 'bpark', 'motion_gotoxy', { inputs: { X: num(0), Y: num(999) } });
chain(bb, ['bflag', 'bhide', 'bpark'], 20, 20);
blk(bb, 'bstart', 'control_start_as_clone', { topLevel: true, x: 20, y: 220 });
blk(bb, 'bat', 'motion_gotoxy', {
    inputs: { X: varRef('fireX', FX), Y: varRef('fireY', FY) } });
blk(bb, 'bdir', 'motion_pointindirection', { inputs: { DIRECTION: num(0) } });
blk(bb, 'bshow', 'looks_show', {});
blk(bb, 'bloop', 'control_forever', { inputs: { SUBSTACK: [2, 'bmove'] } });
blk(bb, 'bmove', 'motion_movesteps', { inputs: { STEPS: num(10) } });
blk(bb, 'bifE', 'control_if', { inputs: { CONDITION: [2, 'btE'], SUBSTACK: [2, 'bdel'] } });
touchObj(bb, 'btE', 'btEmenu', 'Enemy');
blk(bb, 'bdel', 'control_delete_this_clone', {});
blk(bb, 'bifT', 'control_if', { inputs: { CONDITION: [2, 'bty'], SUBSTACK: [2, 'bdel2'] } });
blk(bb, 'bty', 'operator_gt', {
    inputs: { OPERAND1: [3, 'bmy', [10, '0']], OPERAND2: num(175) } });
blk(bb, 'bmy', 'motion_yposition', {});
blk(bb, 'bdel2', 'control_delete_this_clone', {});
chain(bb, ['bstart', 'bat', 'bdir', 'bshow', 'bloop'], 20, 220);
blk(bb, 'bifG', 'control_if', { inputs: { CONDITION: [2, 'bend'], SUBSTACK: [2, 'bdel3'] } });
blk(bb, 'bend', 'operator_equals', { inputs: { OPERAND1: varRef('lives', LIVES), OPERAND2: num(0) } });
blk(bb, 'bdel3', 'control_delete_this_clone', {});
chain(bb, ['bmove', 'bifE', 'bifT', 'bifG'], 0, 0);
bb['bend'].parent = 'bifG'; bb['bdel3'].parent = 'bifG';
bb['bmove'].parent = 'bloop';
sub(bb, 'bmove', 'bifE', 'bifT', 'bifG');
bb['btE'].parent = 'bifE'; bb['bdel'].parent = 'bifE';
bb['bty'].parent = 'bifT'; bb['bdel2'].parent = 'bifT';
bb['bmy'].parent = 'bty';
const bc = {};
wsComment(bc, 'c1', 20, 820, 'L4: Bullet clones fly up from the muzzle; enemy contact or leaving the top deletes them.');
const bullet = spriteTarget('Bullet', BULLET_SVG, { blocks: bb, comments: bc }, { x: 0, y: 999 });

// ---------- Enemy ----------
const eb = {};
blk(eb, 'eflag', 'event_whenflagclicked', { topLevel: true, x: 20, y: 20 });
blk(eb, 'ehide', 'looks_hide', {});
blk(eb, 'epark', 'motion_gotoxy', { inputs: { X: num(0), Y: num(999) } });
blk(eb, 'eloop', 'control_repeat_until', { inputs: { SUBSTACK: [2, 'ewait'], CONDITION: [2, 'euntil'] } });
blk(eb, 'euntil', 'operator_equals', { inputs: { OPERAND1: varRef('lives', LIVES), OPERAND2: num(0) } });
eb['euntil'].parent = 'eloop';
blk(eb, 'ewait', 'control_wait', { inputs: { DURATION: num(1) } });
cloneOf(eb, 'espawn', 'espawnmenu', '_myself_');
chain(eb, ['eflag', 'ehide', 'epark', 'eloop'], 20, 20);
chain(eb, ['ewait', 'espawn'], 0, 0);
eb['ewait'].parent = 'eloop';
eb['ewait'].topLevel = false; delete eb['ewait'].x; delete eb['ewait'].y;
eb['espawn'].topLevel = false;
blk(eb, 'estart', 'control_start_as_clone', { topLevel: true, x: 20, y: 260 });
blk(eb, 'eat', 'motion_gotoxy', {
    inputs: {
        X: [2, 'erand'],
        Y: num(170),
    },
});
blk(eb, 'erand', 'operator_random', { inputs: { FROM: num(-220), TO: num(220) } });
blk(eb, 'eshow', 'looks_show', {});
blk(eb, 'efall', 'control_forever', { inputs: { SUBSTACK: [2, 'edy'] } });
blk(eb, 'edy', 'motion_changeyby', { inputs: { DY: num(-2) } });
blk(eb, 'eifB', 'control_if', { inputs: { CONDITION: [2, 'etB'], SUBSTACK: [2, 'ehit'] } });
touchObj(eb, 'etB', 'etBmenu', 'Bullet');
blk(eb, 'ehit', 'data_changevariableby', {
    fields: { VARIABLE: ['score', SCORE] }, inputs: { VALUE: num(1) } });
blk(eb, 'ehitdel', 'control_delete_this_clone', {});
blk(eb, 'eifD', 'control_if', { inputs: { CONDITION: [2, 'eylow'], SUBSTACK: [2, 'ehurt'] } });
blk(eb, 'eylow', 'operator_lt', {
    inputs: { OPERAND1: [3, 'emy', [10, '0']], OPERAND2: num(-150) } });
blk(eb, 'emy', 'motion_yposition', {});
blk(eb, 'ehurt', 'data_changevariableby', {
    fields: { VARIABLE: ['lives', LIVES] }, inputs: { VALUE: num(-1) } });
blk(eb, 'ehurtdel', 'control_delete_this_clone', {});
chain(eb, ['estart', 'eat', 'eshow', 'efall'], 20, 260);
blk(eb, 'eifG', 'control_if', { inputs: { CONDITION: [2, 'eend'], SUBSTACK: [2, 'egdel'] } });
blk(eb, 'eend', 'operator_equals', { inputs: { OPERAND1: varRef('lives', LIVES), OPERAND2: num(0) } });
blk(eb, 'egdel', 'control_delete_this_clone', {});
chain(eb, ['edy', 'eifB', 'eifD', 'eifG'], 0, 0);
eb['edy'].parent = 'efall';
eb['eend'].parent = 'eifG'; eb['egdel'].parent = 'eifG';
sub(eb, 'edy', 'eifB', 'eifD');
eb['erand'].parent = 'eat';
eb['etB'].parent = 'eifB'; eb['ehit'].parent = 'eifB';
chain(eb, ['ehit', 'ehitdel'], 0, 0); eb['ehit'].parent = 'eifB';
eb['eylow'].parent = 'eifD'; eb['ehurt'].parent = 'eifD';
chain(eb, ['ehurt', 'ehurtdel'], 0, 0); eb['ehurt'].parent = 'eifD';
eb['emy'].parent = 'eylow';
sub(eb, 'ehit', 'ehitdel', 'ehurt', 'ehurtdel', 'ewait', 'espawn', 'eifG');
const ec = {};
wsComment(ec, 'c1', 20, 900, 'L4: Enemy clones drop from random x; bullets kill them (+1), reaching the bottom costs a life.');
const enemy = spriteTarget('Enemy', ENEMY_SVG, { blocks: eb, comments: ec }, { x: 0, y: 999 });

await writeSb3(new URL('./out.sb3', import.meta.url).pathname,
    project([st, player, bullet, enemy]), assetsOf(st, player, bullet, enemy));
