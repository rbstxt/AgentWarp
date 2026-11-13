#!/usr/bin/env node
// vmrun self-test: builds fixtures, runs check/run/layout, asserts expected state.
// Usage: npm test  (runs inside tools/vmrun)
// Exits non-zero on any failure. All assertions use the harness library
// directly plus the CLI for JSON-output coverage.

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync, writeFileSync} from 'node:fs';

const execFileP = promisify(execFile);
const CLI = new URL('./cli.mjs', import.meta.url).pathname;
const FIX = new URL('./test-fixtures/', import.meta.url).pathname;

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, label, detail) {
    if (cond) {
        passed++;
        console.log(`ok   ${label}`);
    } else {
        failed++;
        failures.push(label);
        console.log(`FAIL ${label}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
    }
}

async function cli(...args) {
    const {stdout} = await execFileP(process.execPath, [CLI, ...args], {maxBuffer: 64 * 1024 * 1024});
    return JSON.parse(stdout);
}

async function cliExpectFail(...args) {
    try {
        await execFileP(process.execPath, [CLI, ...args], {maxBuffer: 64 * 1024 * 1024});
    } catch (e) {
        return JSON.parse(e.stdout || '{}');
    }
    throw new Error(`expected failure but succeeded: ${args.join(' ')}`);
}

const tgt = (state, name) => state.targets.find(t => t.name === name && !t.isClone);

async function main() {
    // 0. fixtures build
    await execFileP(process.execPath, [new URL('./make-fixtures.mjs', import.meta.url).pathname]);

    // 1. check passes on all fixtures
    for (const f of ['greenflag', 'keys', 'clones', 'click', 'touch', 'ask', 'lists', 'glide']) {
        const r = await cli('check', `${FIX}/${f}.sb3`);
        assert(r.ok === true && r.errors.length === 0, `check ${f}.sb3 clean`, r);
    }

    // 2. greenflag: after 1s x==10 and bubble Hello!; broadcast fires after the 2s say
    {
        const r = await cli('run', `${FIX}/greenflag.sb3`, '--seconds', '1');
        const s = tgt(r, 'Sprite1');
        assert(s.x === 10, 'greenflag x==10', s.x);
        assert(s.bubble?.text === 'Hello!', 'greenflag bubble Hello!', s.bubble);
        assert(r.frames === 30, 'greenflag 30 frames', r.frames);
        const r2 = await cli('run', `${FIX}/greenflag.sb3`, '--frames', '75');
        const bc = r2.broadcasts.find(b => b.name === 'done');
        assert(bc !== undefined && bc.frame === 60, 'greenflag broadcast done at frame 60', r2.broadcasts);
    }
    // say clears after 2 virtual seconds (61 frames: 30 + margin)
    {
        const r = await cli('run', `${FIX}/greenflag.sb3`, '--frames', '75');
        const s = tgt(r, 'Sprite1');
        assert(s.bubble === null, 'greenflag bubble cleared after 2s', s.bubble);
    }

    // 3. keys: hold right arrow 30 frames -> x >= 100; Ball stays in stage for 600 frames
    {
        mkdirSync('/tmp/vmrun-test', {recursive: true});
        writeFileSync('/tmp/vmrun-test/keys-input.json', JSON.stringify([
            {frame: 0, type: 'keydown', key: 'ArrowRight'},
            {frame: 30, type: 'keyup', key: 'ArrowRight'},
        ]));
        const r = await cli('run', `${FIX}/keys.sb3`, '--frames', '30', '--input', '/tmp/vmrun-test/keys-input.json');
        const s = tgt(r, 'Sprite1');
        assert(s.x >= 100, 'keys right-arrow moves cat >= 100px', s.x);
        const r2 = await cli('run', `${FIX}/keys.sb3`, '--frames', '600');
        const ball = tgt(r2, 'Ball');
        assert(Math.abs(ball.x) <= 240 && Math.abs(ball.y) <= 180,
            'keys Ball stays in stage for 600 frames', {x: ball.x, y: ball.y});
    }

    // 4. clones: 3 clones spawned, clone says "clone"
    {
        const r = await cli('run', `${FIX}/clones.sb3`, '--frames', '60');
        assert(r.clones.Sprite1 === 3, 'clones count == 3', r.clones);
        const saidClone = r.sayEvents.some(e => e.text === 'clone');
        assert(saidClone, 'clones say "clone"', r.sayEvents);
    }

    // 5. click: one click -> score == 1
    {
        writeFileSync('/tmp/vmrun-test/click-input.json', JSON.stringify([
            {frame: 5, type: 'click', sprite: 'Cookie'},
        ]));
        const r = await cli('run', `${FIX}/click.sb3`, '--frames', '30', '--input', '/tmp/vmrun-test/click-input.json');
        const cookie = tgt(r, 'Cookie');
        assert(cookie.variables.score === 1, 'click score == 1', cookie.variables);
        assert(r.monitors !== undefined, 'click monitors dumped', r.monitors);
    }

    // 6. touch: chaser reaches target via bbox fallback, says hit
    {
        const r = await cli('run', `${FIX}/touch.sb3`, '--frames', '120');
        const chaser = tgt(r, 'Chaser');
        assert(chaser.bubble?.text === 'hit', 'touch chaser says hit', chaser.bubble);
        const saidHit = r.sayEvents.some(e => e.text === 'hit' && e.target === 'Chaser');
        assert(saidHit, 'touch sayEvents records hit with frame', r.sayEvents);
    }

    // 7. probes + trace
    {
        const r = await cli('run', `${FIX}/greenflag.sb3`, '--seconds', '1',
            '--probe', 'Sprite1.x', '--trace', 'Sprite1');
        assert(r.probes?.['Sprite1.x'] === 10, 'probe Sprite1.x == 10', r.probes);
        assert(Array.isArray(r.trace) && r.trace.length === 30, 'trace has 30 frames', r.trace?.length);
        assert(r.trace[0].targets[0].x === 10, 'trace frame0 x==10', r.trace[0]);
    }

    // 8. layout: report shape + cleanup removes overlaps
    {
        const r = await cli('layout', `${FIX}/greenflag.sb3`);
        assert(typeof r.score === 'number' && r.scriptCount >= 1, 'layout report shape', r);
        const out = '/tmp/vmrun-test/greenflag-clean.sb3';
        const c = await cli('layout', `${FIX}/greenflag.sb3`, '--cleanup', out);
        assert(c.cleaned === out && c.after.overlapPairs === 0, 'layout cleanup no overlaps', c.after);
        const chk = await cli('check', out);
        assert(chk.ok === true, 'cleaned sb3 still valid', chk);
    }

    // 9. check catches broken projects
    {
        // craft a broken sb3: dangling next + missing asset
        const {default: JSZip} = await import('jszip');
        const {readFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/greenflag.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const sprite = proj.targets.find(t => !t.isStage);
        const ids = Object.keys(sprite.blocks);
        sprite.blocks[ids[1]].next = 'nonexistent-block';
        zip.file('project.json', JSON.stringify(proj));
        // remove an asset
        const names = Object.keys(zip.files).filter(n => n !== 'project.json');
        zip.remove(names[0]);
        const {writeFile} = await import('node:fs/promises');
        await writeFile('/tmp/vmrun-test/broken.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const r = await cliExpectFail('check', '/tmp/vmrun-test/broken.sb3');
        assert(r.ok === false && r.errors.length >= 2, 'check flags dangling ref + missing asset', r);
    }

    // 10. unknown opcode warns but passes
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/greenflag.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const sprite = proj.targets.find(t => !t.isStage);
        const ids = Object.keys(sprite.blocks);
        sprite.blocks[ids[1]].opcode = 'frobnicator_do_thing';
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/unknown.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const r = await cli('check', '/tmp/vmrun-test/unknown.sb3');
        assert(r.ok === true && r.warnings.length >= 1, 'unknown opcode warns only', r);
    }

    // 11. run dump: lists live under `lists`, broadcasts are not variables
    {
        const r = await cli('run', `${FIX}/lists.sb3`, '--frames', '5');
        const s = tgt(r, 'Sprite1');
        assert(s.variables.score === 7 && !('items' in s.variables),
            'lists fixture scalar under variables only', s.variables);
        assert(JSON.stringify(s.lists.items) === JSON.stringify(['a']),
            'lists fixture list under lists', s.lists);
        assert(!('go' in s.variables), 'broadcast not exposed as variable', s.variables);
        assert(Array.isArray(r.vmWarnings), 'run output carries vmWarnings', r.vmWarnings);
    }

    // 12. input scripts: broadcast / greenflag / stop / answer
    {
        writeFileSync('/tmp/vmrun-test/broadcast-input.json', JSON.stringify([
            {frame: 5, type: 'broadcast', name: 'done'},
        ]));
        const r = await cli('run', `${FIX}/greenflag.sb3`, '--frames', '75',
            '--input', '/tmp/vmrun-test/broadcast-input.json');
        const frames = r.broadcasts.filter(b => b.name === 'done').map(b => b.frame);
        assert(frames.includes(5) && frames.includes(60),
            'injected broadcast delivered at frame 5 (project one at 60)', frames);
    }
    {
        writeFileSync('/tmp/vmrun-test/flag-input.json', JSON.stringify([
            {frame: 30, type: 'greenflag'},
        ]));
        const r = await cli('run', `${FIX}/greenflag.sb3`, '--frames', '40',
            '--input', '/tmp/vmrun-test/flag-input.json');
        const flags = r.hats.filter(h => h.hat === 'event_whenflagclicked').map(h => h.frame);
        assert(flags.length >= 2 && flags.includes(30),
            'greenflag input restarts hats at frame 30', flags);
    }
    {
        writeFileSync('/tmp/vmrun-test/stop-input.json', JSON.stringify([
            {frame: 0, type: 'keydown', key: 'ArrowRight'},
            {frame: 10, type: 'stop'},
        ]));
        const r = await cli('run', `${FIX}/keys.sb3`, '--frames', '30',
            '--input', '/tmp/vmrun-test/stop-input.json');
        const s = tgt(r, 'Sprite1');
        assert(s.x === 50, 'stop input freezes motion at frame 10 (x==50)', s.x);
    }
    {
        writeFileSync('/tmp/vmrun-test/answer-input.json', JSON.stringify([
            {frame: 2, type: 'answer', text: 'Ada'},
        ]));
        const r = await cli('run', `${FIX}/ask.sb3`, '--frames', '30',
            '--input', '/tmp/vmrun-test/answer-input.json');
        const s = tgt(r, 'Sprite1');
        assert(s.bubble?.text === 'Ada', 'answer input resolves ask with text', s.bubble);
        assert(r.sayEvents.some(e => e.text === 'Ada'), 'answer recorded in sayEvents', r.sayEvents);
    }

    // 13. key names: Scratch menu names and DOM names both drive key hats
    {
        writeFileSync('/tmp/vmrun-test/scratch-keys.json', JSON.stringify([
            {frame: 0, type: 'keydown', key: 'right arrow'},
            {frame: 30, type: 'keyup', key: 'right arrow'},
        ]));
        const r = await cli('run', `${FIX}/keys.sb3`, '--frames', '30',
            '--input', '/tmp/vmrun-test/scratch-keys.json');
        const s = tgt(r, 'Sprite1');
        assert(s.x >= 100, "Scratch key name 'right arrow' moves cat", s.x);
        writeFileSync('/tmp/vmrun-test/space-key.json', JSON.stringify([
            {frame: 0, type: 'keydown', key: 'space'},
            {frame: 1, type: 'keyup', key: 'space'},
        ]));
        const r2 = await cli('run', `${FIX}/keys.sb3`, '--frames', '2',
            '--input', '/tmp/vmrun-test/space-key.json');
        assert(r2.ok === true, "Scratch key name 'space' accepted", r2.ok);
    }

    // 14. check: menu opcodes are known (no unknown-opcode warnings)
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/greenflag.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const sprite = proj.targets.find(t => !t.isStage);
        for (const [i, op] of ['music_menu_DRUM', 'music_menu_INSTRUMENT', 'note',
            'sensing_of_object_menu', 'motion_glideto_menu', 'looks_costume',
            'looks_backdrops', 'sound_sounds_menu', 'pen_menu_colorParam'].entries()) {
            sprite.blocks[`menu${i}`] = {
                opcode: op, next: null, parent: null, inputs: {}, fields: {},
                shadow: true, topLevel: false,
            };
        }
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/menus.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const r = await cli('check', '/tmp/vmrun-test/menus.sb3');
        assert(r.ok === true && !r.warnings.some(w => /unknown opcode/.test(w.message)),
            'menu opcodes known (music/note/sensing/motion/looks/sound/pen)', r.warnings);
    }

    // 15. check: invalid input names warn (OPERAND1 on operator_subtract)
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/greenflag.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const sprite = proj.targets.find(t => !t.isStage);
        const sub = Object.values(sprite.blocks).find(b => !Array.isArray(b) && b.opcode === 'motion_movesteps');
        sub.inputs.OPERAND1 = [1, [4, '1']];
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/badinput.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const r = await cli('check', '/tmp/vmrun-test/badinput.sb3');
        assert(r.ok === true && r.warnings.some(w => /OPERAND1.*motion_movesteps/.test(w.message)),
            'invalid input name warns with opcode', r.warnings);
    }

    // 16. check: broadcast menu with undeclared id warns (does not fail)
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/greenflag.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const sprite = proj.targets.find(t => !t.isStage);
        const bcast = Object.entries(sprite.blocks).find(([, b]) => !Array.isArray(b) && b.opcode === 'event_broadcast');
        sprite.blocks.menumine = {
            opcode: 'event_broadcast_menu', next: null, parent: bcast[0],
            inputs: {}, fields: {BROADCAST_OPTION: ['missing', 'bogus-id']},
            shadow: true, topLevel: false,
        };
        bcast[1].inputs.BROADCAST_INPUT = [3, 'menumine'];
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/badbroadcast.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const r = await cli('check', '/tmp/vmrun-test/badbroadcast.sb3');
        assert(r.ok === true && r.warnings.some(w => /broadcast menu references undeclared/.test(w.message)),
            'undeclared broadcast id warns, still passes', r.warnings);
    }

    // 17. check: variable/list from another sprite warns (does not fail)
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/click.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const cookie = proj.targets.find(t => t.name === 'Cookie');
        const varId = Object.keys(cookie.variables)[0];
        const stage = proj.targets.find(t => t.isStage);
        stage.blocks.s1 = {
            opcode: 'event_whenflagclicked', next: 's2', parent: null,
            inputs: {}, fields: {}, shadow: false, topLevel: true, x: 20, y: 20,
        };
        stage.blocks.s2 = {
            opcode: 'data_changevariableby', next: null, parent: 's1',
            inputs: {VALUE: [1, [4, '1']]}, fields: {VARIABLE: ['score', varId]},
            shadow: false, topLevel: false,
        };
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/crossvar.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const r = await cli('check', '/tmp/vmrun-test/crossvar.sb3');
        assert(r.ok === true && r.warnings.some(w => /declared on sprite "Cookie"/.test(w.message)),
            'cross-sprite variable warns with owner', r.warnings);
    }

    // 18. run captures scratch-vm warnings as vmWarnings (deduped, stderr clean)
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/click.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        for (const i of [1, 2]) {
            proj.monitors.push({
                id: `ghost${i}`, mode: 'default', opcode: 'data_variable',
                params: {VARIABLE: 'score'}, spriteName: 'Ghost', value: 0,
                width: 0, height: 0, x: 5, y: 5, visible: true,
            });
        }
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/ghostmon.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const {execFile: ef} = await import('node:child_process');
        const {promisify: pz} = await import('node:util');
        const ep = pz(ef);
        const {stdout, stderr} = await ep(process.execPath, [CLI, 'run', '/tmp/vmrun-test/ghostmon.sb3', '--frames', '3']);
        const r = JSON.parse(stdout);
        assert(r.vmWarnings.some(w => w.count === 2 && /could not find sprite Ghost/.test(w.message)),
            'vmWarnings dedupes repeated VM warning with count', r.vmWarnings);
        assert(stderr === '', 'VM warnings do not spam stderr', JSON.stringify(stderr).slice(0, 120));
    }

    // 19. costumes command reports parsed dims + rotation centers
    {
        const r = await cli('costumes', `${FIX}/greenflag.sb3`);
        const stage = r.targets.find(t => t.isStage);
        const spr = r.targets.find(t => t.name === 'Sprite1');
        assert(stage.costumes[0].width === 480 && stage.costumes[0].height === 360,
            'costumes stage backdrop dims', stage.costumes);
        assert(spr.costumes[0].width === 100 && spr.costumes[0].height === 100 &&
            spr.costumes[0].rotationCenterX === 50 && spr.costumes[0].rotationCenterY === 50 &&
            spr.costumes[0].collisionWidth === 100,
            'costumes sprite dims + rotation center + collision size', spr.costumes);
    }

    // 20. run --until stops early and reports the frame
    {
        const r = await cli('run', `${FIX}/greenflag.sb3`,
            '--until', 'Sprite1.x == 10', '--max-frames', '100');
        assert(r.until?.met === true && r.until?.frame === 0 && r.frames === 1,
            'until met at frame 0 stops after 1 frame', {until: r.until, frames: r.frames});
        const r2 = await cli('run', `${FIX}/greenflag.sb3`,
            '--until', 'Sprite1.x > 99999', '--max-frames', '20');
        assert(r2.until?.met === false && r2.frames === 20,
            'unmet until runs the full cap', {until: r2.until, frames: r2.frames});
    }

    // 21. trace shape matches the documented schema
    {
        const r = await cli('run', `${FIX}/greenflag.sb3`, '--seconds', '1', '--trace', 'Sprite1');
        const snap = r.trace[0];
        const row = snap.targets[0];
        assert(typeof snap.frame === 'number' &&
            ['x', 'y', 'direction', 'size', 'visible', 'costumeIndex', 'costumeName', 'bubble'].every(k => k in row),
            'trace rows carry documented keys', row);
    }

    // 22. check flags malformed variable/list declaration shapes (run would crash on them)
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/greenflag.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const sprite = proj.targets.find(t => !t.isStage);
        sprite.lists = {badlist: ['items']}; // missing items array: old packer bug shape
        sprite.variables = {badvar: 'oops'}; // not a [name, value] pair
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/badshapes.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const r = await cliExpectFail('check', '/tmp/vmrun-test/badshapes.sb3');
        assert(r.ok === false && r.errors.some(e => /list id "badlist" must be/.test(e.message)),
            'malformed list shape fails check', r.errors);
        assert(r.errors.some(e => /variable id "badvar" must be/.test(e.message)),
            'malformed variable shape fails check', r.errors);
    }

    // 23. length of a valid empty list at green flag returns 0 (no crash)
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const raw = await readFile(`${FIX}/greenflag.sb3`);
        const zip = await JSZip.loadAsync(raw);
        const proj = JSON.parse(await zip.file('project.json').async('string'));
        const sprite = proj.targets.find(t => !t.isStage);
        sprite.lists = {L1: ['empty', []]};
        const ids = Object.keys(sprite.blocks);
        const say = Object.values(sprite.blocks).find(b => !Array.isArray(b) && b.opcode === 'looks_sayforsecs');
        const lenId = 'lenblock';
        sprite.blocks[lenId] = {
            opcode: 'data_lengthoflist', next: null, parent: say ? Object.keys(sprite.blocks).find(k => sprite.blocks[k] === say) : ids[0],
            inputs: {}, fields: {LIST: ['empty', 'L1']}, shadow: false, topLevel: false,
        };
        if (say) say.inputs.MESSAGE = [2, lenId];
        zip.file('project.json', JSON.stringify(proj));
        await writeFile('/tmp/vmrun-test/emptylen.sb3', await zip.generateAsync({type: 'nodebuffer'}));
        const chk = await cli('check', '/tmp/vmrun-test/emptylen.sb3');
        assert(chk.ok === true, 'valid empty list passes check', chk);
        const r = await cli('run', '/tmp/vmrun-test/emptylen.sb3', '--frames', '5');
        const s = tgt(r, 'Sprite1');
        assert(s.bubble?.text === '0', 'length of empty list says "0"', s.bubble);
    }

    // 24. glide finishes on virtual time under clone load (N = 0/50/200)
    // A 0.8 s glide is 24 virtual frames on screen; it must finish in 24
    // frames here too, no matter how many clone threads are alive. Every
    // live clone thread must also advance exactly once per frame (fairness),
    // and repeated runs must be byte-identical (determinism).
    {
        const {default: JSZip} = await import('jszip');
        const {readFile, writeFile} = await import('node:fs/promises');
        const glideVariant = async (n) => {
            const raw = await readFile(`${FIX}/glide.sb3`);
            const zip = await JSZip.loadAsync(raw);
            const proj = JSON.parse(await zip.file('project.json').async('string'));
            const cloner = proj.targets.find(t => t.name === 'Cloner');
            const rep = Object.values(cloner.blocks).find(b => !Array.isArray(b) && b.opcode === 'control_repeat');
            rep.inputs.TIMES = [1, [4, String(n)]];
            zip.file('project.json', JSON.stringify(proj));
            const out = `/tmp/vmrun-test/glide-n${n}.sb3`;
            await writeFile(out, await zip.generateAsync({type: 'nodebuffer'}));
            return out;
        };
        for (const n of [0, 50, 200]) {
            const f = await glideVariant(n);
            const r = await cli('run', f, '--until', 'Glider.x == 200', '--max-frames', '600',
                '--probe', 'Glider.x', '--probe', 'Glider.variables.done', '--probe', 'Horn.variables.played');
            assert(r.until?.met === true && r.until?.frame === 24,
                `glide N=${n} finishes at frame 24 (0.8 virtual s)`, r.until);
            assert(r.probes?.['Glider.variables.done'] === 1,
                `glide N=${n} runs the block after the glide`, r.probes);
            assert(r.probes?.['Horn.variables.played'] === 1,
                `glide N=${n} play-until-done stub never blocks`, r.probes);
        }
        // fairness: 1 clone spawns per frame (redraw-gated, as on screen) and
        // every live clone moves exactly 1 step per frame.
        {
            const f = await glideVariant(200);
            const r = await cli('run', f, '--frames', '30');
            const xs = r.targets.filter(t => t.name === 'Cloner' && t.isClone).map(t => t.x).sort((a, b) => a - b);
            assert(xs.length === 30 && xs.every((x, i) => x === i + 1),
                '200-clone spawner: every live thread steps once per frame (xs 1..30)', xs);
        }
        // determinism: same file twice => byte-identical stdout.
        {
            const f = await glideVariant(50);
            const a = await execFileP(process.execPath, [CLI, 'run', f, '--frames', '60', '--probe', 'Glider.x'], {maxBuffer: 64 * 1024 * 1024});
            const b = await execFileP(process.execPath, [CLI, 'run', f, '--frames', '60', '--probe', 'Glider.x'], {maxBuffer: 64 * 1024 * 1024});
            assert(a.stdout === b.stdout, 'repeated glide runs are byte-identical');
        }
    }

    // 25. --max-ms reports slow frames without changing results
    {
        const r = await cli('run', `${FIX}/glide.sb3`, '--frames', '10',
            '--max-ms', '100000', '--probe', 'Glider.x');
        assert(Array.isArray(r.slowFrames) && r.slowFrames.length === 0,
            '--max-ms with huge budget reports no slow frames', r.slowFrames);
        assert(Math.abs(tgt(r, 'Glider').x - (-50)) < 1e-6,
            '--max-ms does not change simulation results', tgt(r, 'Glider').x);
        const r2 = await cli('run', `${FIX}/glide.sb3`, '--frames', '10');
        assert(!('slowFrames' in r2), 'no slowFrames key without --max-ms');
        const r3 = await cli('run', `${FIX}/glide.sb3`, '--frames', '10', '--max-ms', '0');
        assert(r3.slowFrames.length === 10 && r3.slowFrames[0].frame === 0 &&
            typeof r3.slowFrames[0].ms === 'number',
            '--max-ms 0 flags every frame with {frame, ms}', r3.slowFrames.length);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('failures:', failures);
        process.exit(1);
    }
}

main().catch(e => {
    console.error('TEST HARNESS ERROR:', e);
    process.exit(1);
});
