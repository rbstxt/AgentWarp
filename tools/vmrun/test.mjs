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
    for (const f of ['greenflag', 'keys', 'clones', 'click', 'touch']) {
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
