#!/usr/bin/env node
// vmrun: headless Scratch verification harness.
// All output is JSON on stdout; exits non-zero on failure.

import {readFile, writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {loadSb3, saveSb3} from './lib/sb3.mjs';
import {validateProject} from './lib/validate.mjs';
import {layoutReport, cleanupLayout} from './lib/layout.mjs';
import {diffProjects} from './lib/diff.mjs';
import {FPS, FRAME_MS, buildDimsMap, createHeadlessVM, loadProjectHeadless, stepFrames, dumpState, resolveProbe} from './lib/harness.mjs';

function usageError(msg) {
    process.stderr.write(JSON.stringify({ok: false, error: msg}) + '\n');
    process.exit(2);
}

/** Synchronous stdout write: console.log + process.exit truncates big piped output. */
function emit(obj) {
    writeFileSync(1, JSON.stringify(obj, null, 2) + '\n');
}

function parseArgs(argv) {
    const positional = [];
    const opts = {};
    const multi = {probe: []};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--probe') {
            if (i + 1 >= argv.length) usageError('missing value for --probe');
            multi.probe.push(argv[++i]);
        } else if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq >= 0) {
                opts[a.slice(2, eq)] = a.slice(eq + 1);
            } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
                opts[a.slice(2)] = argv[++i];
            } else {
                opts[a.slice(2)] = true;
            }
        } else {
            positional.push(a);
        }
    }
    return {positional, opts, multi};
}

async function cmdCheck(file) {
    const {project, files} = await loadSb3(file);
    const {errors, warnings} = validateProject(project, files);
    const out = {file, ok: errors.length === 0, errors, warnings};
    emit(out);
    process.exit(errors.length === 0 ? 0 : 1);
}

async function cmdRun(file, positional, opts, multi) {
    let totalFrames = null;
    if (opts.frames !== undefined) totalFrames = Math.max(0, Math.round(Number(opts.frames)));
    else if (opts.seconds !== undefined) totalFrames = Math.max(0, Math.round(Number(opts.seconds) * FPS));
    if (totalFrames === null || !Number.isFinite(totalFrames)) {
        usageError('run requires --seconds N or --frames N');
    }
    let inputs = [];
    if (opts.input) {
        const raw = JSON.parse(await readFile(opts.input, 'utf8'));
        inputs = Array.isArray(raw) ? raw : (raw.inputs ?? []);
        if (!Array.isArray(inputs)) usageError('--input must be a JSON array or {inputs: [...]}');
    }
    const seed = opts.seed !== undefined ? Number(opts.seed) : 1;
    const traceNames = opts.trace ? String(opts.trace).split(',').map(s => s.trim()).filter(Boolean) : [];

    const {files} = await loadSb3(file);
    const dims = buildDimsMap(files);
    // Load the original sb3 bytes for the VM (assets resolve from the zip).
    const sb3bytes = await readFile(file);
    const arrayBuffer = sb3bytes.buffer.slice(sb3bytes.byteOffset, sb3bytes.byteOffset + sb3bytes.byteLength);

    const {vm, clock, restoreRandom} = createHeadlessVM({seed, dims});
    try {
        await loadProjectHeadless(vm, arrayBuffer);
    } catch (e) {
        restoreRandom();
        emit({file, ok: false, error: `loadProject failed: ${e?.message ?? e}`});
        process.exit(1);
    }
    const traced = [];
    let timeline, sayEvents, hatsDropped, sayDropped;
    try {
        ({timeline, sayEvents, hatsDropped, sayDropped} = stepFrames(vm, clock, totalFrames, inputs, (frame, v) => {
        if (traceNames.length === 0) return;
        const snap = {frame, targets: []};
        for (const t of v.runtime.targets) {
            const name = (() => {
                try {
                    return t.getName();
                } catch {
                    return '?';
                }
            })();
            if (!traceNames.includes(name)) continue;
            let bubble = null;
            try {
                const st = t.getCustomState('Scratch.looks');
                if (st && st.text) bubble = {type: st.type || 'say', text: String(st.text)};
            } catch { /* ignore */ }
            snap.targets.push({
                name, isStage: !!t.isStage, isClone: !t.isStage && !t.isOriginal,
                x: t.x, y: t.y, direction: t.direction, size: t.size, visible: !!t.visible,
                costumeIndex: t.currentCostume ?? 0,
                costumeName: t.sprite?.costumes?.[t.currentCostume]?.name ?? null,
                bubble,
            });
        }
        traced.push(snap);
        }));
    } finally {
        restoreRandom();
    }
    const state = dumpState(vm);
    const out = {
        file, ok: true,
        frames: totalFrames, fps: FPS, virtualSeconds: totalFrames * (FRAME_MS / 1000),
        ...state,
        broadcasts: timeline.filter(e => e.hat === 'event_whenbroadcastreceived')
            .map(e => ({frame: e.frame, name: e.fields?.BROADCAST_OPTION ?? null, target: e.target})),
        hats: timeline,
        hatsDropped,
        sayEvents,
        sayDropped,
    };
    if (traceNames.length > 0) out.trace = traced;
    if (multi.probe.length > 0) {
        out.probes = {};
        for (const p of multi.probe) out.probes[p] = resolveProbe(out, p) ?? null;
    }
    emit(out);
    process.exit(0);
}

async function cmdLayout(file, opts, extra) {
    const {project, files} = await loadSb3(file);
    const report = layoutReport(project);
    const out = {file, ...report};
    if (opts.cleanup !== undefined) {
        const outPath = typeof opts.cleanup === 'string' ? opts.cleanup : extra[0];
        if (!outPath) usageError('layout --cleanup requires an output path: --cleanup <out.sb3>');
        cleanupLayout(project);
        await saveSb3(outPath, project, files);
        out.cleaned = outPath;
        const after = layoutReport(project);
        out.after = {overlapPairs: after.overlapPairs, score: after.score};
    }
    emit(out);
    process.exit(0);
}

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    if (!cmd || cmd === '--help' || cmd === '-h') {
        emit({
            usage: 'cli.mjs <check|run|layout> ...',
            commands: {
                check: 'check <file.sb3>',
                run: 'run <file.sb3> --seconds N|--frames N [--input script.json] [--probe expr...] [--trace A,B] [--seed N]',
                layout: 'layout <file.sb3> [--cleanup <out.sb3>]',
                diff: 'diff <original.sb3> <edited.sb3>  (preservation report: unchanged/moved/changed scripts, comments)',
            },
        });
        process.exit(cmd ? 0 : 2);
    }
    const {positional, opts, multi} = parseArgs(rest);
    try {
        if (cmd === 'check') {
            if (positional.length !== 1) usageError('check requires exactly one <file.sb3>');
            await cmdCheck(positional[0]);
        } else if (cmd === 'run') {
            if (positional.length !== 1) usageError('run requires exactly one <file.sb3>');
            await cmdRun(positional[0], positional, opts, multi);
        } else if (cmd === 'layout') {
            if (positional.length < 1) usageError('layout requires <file.sb3>');
            await cmdLayout(positional[0], opts, positional.slice(1));
        } else if (cmd === 'diff') {
            if (positional.length !== 2) usageError('diff requires <original.sb3> <edited.sb3>');
            const [a, b] = await Promise.all(positional.map(loadSb3));
            emit(diffProjects(a.project, b.project));
            process.exit(0);
        } else {
            usageError(`unknown command "${cmd}"`);
        }
    } catch (e) {
        emit({ok: false, error: e?.message ?? String(e)});
        process.exit(1);
    }
}

main();
