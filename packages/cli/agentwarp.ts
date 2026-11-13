#!/usr/bin/env node
// agentwarp — work on Scratch projects as text.  (prototype CLI for format evaluation)
//
//   agentwarp new <dir> [--format F]            new project (Stage + Sprite1 cat) as a text project dir
//   agentwarp unpack <file.sb3> <dir> [--format F]
//   agentwarp pack [dir] [-o out.sb3]           text dir -> sb3 (default <dir>/.agentwarp/build.sb3)
//   agentwarp check [dir]                       parse + reconcile + structural check, errors with file:line
//   agentwarp run [dir] [vmrun run options…]    pack, then run headless (see tools/vmrun/README.md)
//   agentwarp layout [dir]                      overlap report of the packed project
//   agentwarp serve [dir] [--port N]            live-sync bridge for TurboWarp (see docs/P4-DESIGN.md)
//
// Formats: ts | sbpy | scratchblocks | ir-json   (stored in <dir>/.agentwarp/format)
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packDir, unpackSb3} from '../core/project-dir.ts';
import type {Diagnostic, Format} from '../core/ir.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VMRUN = join(ROOT, 'tools/vmrun/cli.mjs');
const TEMPLATE = join(ROOT, 'packages/cli/template.sb3');
const FORMATS = ['ts', 'sbpy', 'scratchblocks', 'ir-json'];

async function loadFormat(name: string): Promise<Format> {
    if (!FORMATS.includes(name)) die(`unknown format "${name}" (choose: ${FORMATS.join(', ')})`);
    const m: any = await import(join(ROOT, 'formats', name, 'index.ts'));
    const f = m.default ?? m.format ?? Object.values(m).find((v: any) => v && typeof v === 'object' && 'print' in v && 'parse' in v);
    if (!f) die(`format "${name}" exports no Format`);
    return f as Format;
}

function die(msg: string, code = 2): never {
    process.stderr.write(`agentwarp: ${msg}\n`);
    process.exit(code);
}

function parseArgs(argv: string[]) {
    const pos: string[] = [];
    const opts: Record<string, string | true> = {};
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
        if (a === '--format' || a === '-o') opts[a.replace(/^-+/, '')] = argv[++i];
        else if (a.startsWith('--')) rest.push(...argv.slice(i)), (i = argv.length);
        else pos.push(a);
    }
    return {pos, opts, rest};
}

async function formatOf(dir: string): Promise<Format> {
    const f = join(dir, '.agentwarp', 'format');
    if (!existsSync(f)) die(`${dir} is not an agentwarp project (missing .agentwarp/format)`);
    return loadFormat((await readFile(f, 'utf8')).trim());
}

function printDiags(diags: Diagnostic[], dir: string): number {
    let errors = 0;
    for (const d of diags) {
        if (d.severity === 'error') errors++;
        const file = d.file ? relative(process.cwd(), resolve(dir, d.file)) : '';
        const where = file ? `${file}${d.line ? `:${d.line}${d.col ? `:${d.col}` : ''}` : ''}: ` : '';
        process.stdout.write(`${where}${d.severity}: ${d.message}\n`);
    }
    return errors;
}

/** ts format: regenerate .agentwarp/types/<Target>.d.ts (costume/sound/variable/broadcast name unions). */
async function tsTypes(dir: string): Promise<void> {
    const {generateDts} = await import(join(ROOT, 'formats/ts/index.ts'));
    await generateDts(dir);
}

/** ts format: type-check every target's scripts.ts against its generated d.ts. Returns error count. */
async function tsCheck(dir: string): Promise<number> {
    if ((await readFile(join(dir, '.agentwarp', 'format'), 'utf8')).trim() !== 'ts') return 0;
    await tsTypes(dir);
    const {readdir} = await import('node:fs/promises');
    const tsc = join(ROOT, 'formats/ts/node_modules/.bin/tsc');
    let errors = 0;
    for (const e of await readdir(join(dir, '.agentwarp', 'types'))) {
        if (!e.endsWith('.d.ts')) continue;
        const dts = join(dir, '.agentwarp', 'types', e);
        const tname = e.slice(0, -5);
        const scripts = join(dir, tname, 'scripts.ts');
        if (!existsSync(scripts)) continue;
        try {
            execFileSync(tsc, ['--noEmit', '--target', 'es2020', '--skipLibCheck', relative(dir, scripts), relative(dir, dts)], {encoding: 'utf8', cwd: dir});
        } catch (err: any) {
            const out = String(err.stdout ?? '');
            for (const line of out.split('\n').filter(Boolean)) {
                process.stdout.write(line + '\n');
                if (/error TS\d+/.test(line)) errors++;
            }
        }
    }
    return errors;
}

async function doPack(dir: string, out?: string): Promise<string> {
    const format = await formatOf(dir);
    const target = out ? resolve(out) : join(dir, '.agentwarp', 'build.sb3');
    await mkdir(dirname(target), {recursive: true});
    const r = await packDir(dir, target, format);
    const errors = printDiags(r.diagnostics, dir);
    if (errors) die(`${errors} error(s); sb3 not trustworthy`, 1);
    return target;
}

function vmrun(args: string[]): string {
    try {
        return execFileSync('node', [VMRUN, ...args], {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
    } catch (e: any) {
        process.stdout.write(e.stdout ?? '');
        process.exit(1);
    }
}

async function main() {
    const [cmd, ...argv] = process.argv.slice(2);
    const {pos, opts, rest} = parseArgs(argv);
    switch (cmd) {
        case 'new':
        case 'unpack': {
            const [src, dir] = cmd === 'new' ? [TEMPLATE, pos[0]] : pos;
            if (!src || !dir) die(`usage: agentwarp ${cmd === 'new' ? 'new <dir>' : 'unpack <file.sb3> <dir>'} [--format F]`);
            const name = typeof opts.format === 'string' ? opts.format : 'ts';
            const format = await loadFormat(name);
            const r = await unpackSb3(resolve(src), resolve(dir), format);
            await writeFile(join(dir, '.agentwarp', 'format'), name + '\n');
            if (name === 'ts') await tsTypes(resolve(dir));
            printDiags(r.diagnostics.filter(d => d.severity === 'error'), dir);
            process.stdout.write(`unpacked to ${dir} (format ${name})\n`);
            return;
        }
        case 'pack': {
            const dir = resolve(pos[0] ?? '.');
            const out = await doPack(dir, typeof opts.o === 'string' ? opts.o : undefined);
            process.stdout.write(`packed ${relative(process.cwd(), out)}\n`);
            return;
        }
        case 'check': {
            const dir = resolve(pos[0] ?? '.');
            const out = await doPack(dir);
            const tsErrors = await tsCheck(dir);
            const res = JSON.parse(vmrun(['check', out]));
            for (const e of res.errors) process.stdout.write(`error: [${e.target}] ${e.opcode ?? ''} ${e.message}\n`);
            for (const w of res.warnings) process.stdout.write(`warning: [${w.target}] ${w.opcode ?? ''} ${w.message}\n`);
            const ok = res.ok && tsErrors === 0;
            process.stdout.write(ok ? 'check ok\n' : 'check FAILED\n');
            process.exit(ok ? 0 : 1);
        }
        case 'run': {
            const dir = resolve(pos[0] ?? '.');
            const out = await doPack(dir);
            process.stdout.write(vmrun(['run', out, ...rest]));
            return;
        }
        case 'layout': {
            const dir = resolve(pos[0] ?? '.');
            const out = await doPack(dir);
            const {overlaps} = await import('../core/layout.ts');
            const {loadSb3File} = await import('../core/sb3.ts');
            const {project} = await loadSb3File(out);
            const report: Record<string, number> = {};
            for (const t of project.targets) report[t.name] = overlaps(t).length;
            process.stdout.write(JSON.stringify({overlapPairs: report}, null, 2) + '\n');
            return;
        }
        case 'serve': {
            const dir = resolve(pos[0] ?? '.');
            let port: number | undefined;
            for (let i = 0; i < rest.length; i++) {
                if (rest[i] === '--port') port = Number(rest[++i]);
            }
            const {startServe} = await import('../bridge/server.ts');
            const h = await startServe(dir, port != null && Number.isFinite(port) ? {port} : {});
            process.stdout.write(`bridge ${h.url}\n`);
            await new Promise(() => undefined); // run until killed
            return;
        }
        default:
            die('usage: agentwarp <new|unpack|pack|check|run|layout|serve> …  (see packages/cli/agentwarp.ts header)');
    }
}

main();
