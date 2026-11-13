#!/usr/bin/env node
// agentwarp — work on Scratch projects as text.
//
//   agentwarp new <dir> [--format F]            new project (Stage + Sprite1 cat) as a text project dir
//   agentwarp unpack <file.sb3> <dir> [--format F]
//   agentwarp pack [dir] [-o out.sb3]           text dir -> sb3 (default <dir>/.agentwarp/build.sb3)
//   agentwarp check [dir] [--json]             parse + reconcile + core validate + lint + vmrun structural
//                                              check (+ tsc for ts format); human lines to stderr,
//                                              machine JSON to stdout with --json; exit 1 on errors only
//   agentwarp run [dir] [vmrun run options…]   pack, then run headless (see tools/vmrun/README.md);
//                                              pure JSON on stdout, block ids mapped to file:line
//   agentwarp layout [dir]                     overlap report of the packed project (JSON on stdout)
//   agentwarp tidy [dir] [--target NAME]       Clean-up-Plus all (or one) target's layout in place
//   agentwarp costumes [dir]                   collision sizes of every costume (JSON on stdout)
//   agentwarp serve [dir] [--port N]           live-sync bridge for TurboWarp (see docs/P4-DESIGN.md)
//   agentwarp help | --help | -h
//
// Diagnostics always go to stderr; stdout carries only command results
// (human one-liners for pack/unpack/tidy, pure JSON for run/layout/costumes
// and check --json). Formats: ts | sbpy | scratchblocks | ir-json
// (stored in <dir>/.agentwarp/format).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlaps } from '../core/layout.ts';
import { packDir, unpackSb3 } from '../core/project-dir.ts';
import { loadSb3File, saveSb3File } from '../core/sb3.ts';
import type { Diagnostic, Format } from '../core/ir.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VMRUN = join(ROOT, 'tools/vmrun/cli.mjs');
const TEMPLATE = join(ROOT, 'packages/cli/template.sb3');
const FORMATS = ['ts', 'sbpy', 'scratchblocks', 'ir-json'];

const USAGE = `usage: agentwarp <command> [args]
  new <dir> [--format F]          new text project from the template
  unpack <file.sb3> <dir> [--format F]
  pack [dir] [-o out.sb3]        text dir -> sb3 (warns about NEW overlaps)
  check [dir] [--json]           pack + core validate + lint + vmrun check (+ tsc);
                                 human file:line:col lines on stderr, exit 1 on errors
  run [dir] [vmrun options…]     pack + headless run; pure JSON on stdout
  layout [dir]                   overlap report (JSON on stdout)
  tidy [dir] [--target NAME]     Clean-up-Plus layout in place
  costumes [dir]                  costume collision sizes (JSON on stdout)
  serve [dir] [--port N]         live-sync bridge for TurboWarp
  help                           this text`;

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

/** Parse our own flags; unknown --flags are caller's problem (run passes everything through). */
function parseArgs(argv: string[]): { pos: string[]; opts: Record<string, string | boolean> } {
    const pos: string[] = [];
    const opts: Record<string, string | boolean> = {};
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a === '--') {
            pos.push(...argv.slice(i + 1));
            break;
        }
        if (a === '-o' && i + 1 < argv.length) {
            opts.o = argv[++i];
        } else if (a === '-h') {
            opts.help = true;
        } else if (a.startsWith('--') && a.length > 2) {
            const eq = a.indexOf('=');
            if (eq >= 0) {
                opts[a.slice(2, eq)] = a.slice(eq + 1);
            } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
                opts[a.slice(2)] = argv[++i];
            } else {
                opts[a.slice(2)] = true;
            }
        } else if (a.startsWith('-') && a.length > 1) {
            die(`unknown flag "${a}"\n${USAGE}`);
        } else {
            pos.push(a);
        }
        i++;
    }
    return { pos, opts };
}

async function formatOf(dir: string): Promise<Format> {
    const f = join(dir, '.agentwarp', 'format');
    if (!existsSync(f)) die(`${dir} is not an agentwarp project (missing .agentwarp/format)`);
    return loadFormat((await readFile(f, 'utf8')).trim());
}

/** file:line:col: severity rule: message — to stderr. Returns error count. */
function printDiags(diags: Diagnostic[], dir: string): number {
    let errors = 0;
    for (const d of diags) {
        if (d.severity === 'error') errors++;
        const file = d.file ? relative(process.cwd(), resolve(dir, d.file)) : '';
        const where = file ? `${file}${d.line != null ? `:${d.line}${d.col != null ? `:${d.col}` : ''}` : ''}: ` : '';
        const rule = d.rule ? ` ${d.rule}` : '';
        const hint = d.hint ? ` (fix: ${d.hint})` : '';
        process.stderr.write(`${where}${d.severity}${rule}: ${d.message}${hint}\n`);
    }
    return errors;
}

async function readSourcemap(dir: string): Promise<Record<string, { file: string; line: number; col: number }>> {
    try {
        return JSON.parse(await readFile(join(dir, '.agentwarp', 'sourcemap.json'), 'utf8'));
    } catch {
        return {};
    }
}

/** ts format: regenerate .agentwarp/types/<Target>.d.ts (costume/sound/variable/broadcast name unions). */
async function tsTypes(dir: string): Promise<void> {
    const { generateDts } = await import(join(ROOT, 'formats/ts/index.ts'));
    await generateDts(dir);
}

/** ts format: type-check every target's scripts.ts against its generated d.ts. Returns diagnostics. */
async function tsCheck(dir: string): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];
    if ((await readFile(join(dir, '.agentwarp', 'format'), 'utf8')).trim() !== 'ts') return out;
    await tsTypes(dir);
    const { readdir } = await import('node:fs/promises');
    const tsc = join(ROOT, 'formats/ts/node_modules/.bin/tsc');
    for (const e of await readdir(join(dir, '.agentwarp', 'types'))) {
        if (!e.endsWith('.d.ts')) continue;
        const dts = join(dir, '.agentwarp', 'types', e);
        const tname = e.slice(0, -5);
        const scripts = join(dir, tname, 'scripts.ts');
        if (!existsSync(scripts)) continue;
        try {
            execFileSync(tsc, ['--noEmit', '--target', 'es2020', '--skipLibCheck', relative(dir, scripts), relative(dir, dts)], {
                encoding: 'utf8',
                cwd: dir,
            });
        } catch (err: any) {
            const text = String(err.stdout ?? '');
            for (const line of text.split('\n').filter(Boolean)) {
                const m = line.match(/^(.*?)\((\d+),(\d+)\): error (TS\d+): ([\s\S]*)$/);
                if (m) {
                    out.push({
                        file: m[1],
                        line: Number(m[2]),
                        col: Number(m[3]),
                        severity: 'error',
                        rule: m[4],
                        message: m[5],
                    });
                } else if (/error TS\d+/.test(line)) {
                    out.push({ severity: 'error', rule: 'tsc', message: line });
                }
            }
        }
    }
    return out;
}

async function doPack(dir: string, out?: string): Promise<string> {
    const format = await formatOf(dir);
    const target = out ? resolve(out) : join(dir, '.agentwarp', 'build.sb3');
    await mkdir(dirname(target), { recursive: true });
    const r = await packDir(dir, target, format);
    const errors = printDiags(r.diagnostics, dir);
    if (errors) die(`${errors} error(s); sb3 not trustworthy`, 1);
    return target;
}

/** Run vmrun, capturing its stdout JSON even on failure. */
function vmrunJson(args: string[]): { res: any; code: number } {
    try {
        const out = execFileSync('node', [VMRUN, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        return { res: JSON.parse(out), code: 0 };
    } catch (e: any) {
        const out = String(e.stdout ?? '');
        try {
            return { res: JSON.parse(out), code: e.status ?? 1 };
        } catch {
            die(`vmrun produced no JSON: ${out.slice(0, 500)}`);
        }
    }
}

function displayPath(p: string): string {
    const rel = relative(process.cwd(), p);
    return rel.startsWith('..') ? p : rel;
}

function relPath(dir: string, file: string): string {
    return displayPath(resolve(dir, file));
}

/** Map block ids in vmrun diagnostics to file:line via the pack sourcemap. */
function withLoc(
    entries: any[],
    sourcemap: Record<string, { file: string; line: number; col: number }>,
    dir: string,
    severity: 'error' | 'warning',
): Diagnostic[] {
    return (entries ?? []).map((e) => {
        const loc = (e.blockId && sourcemap[e.blockId]) || undefined;
        return {
            file: loc ? relPath(dir, loc.file) : undefined,
            line: loc?.line,
            col: loc?.col,
            severity,
            rule: 'vmrun',
            message: `[${e.target ?? '?'}]${e.opcode ? ` ${e.opcode}` : ''}: ${e.message}${e.blockId ? ` (block ${e.blockId})` : ''}`,
        } as Diagnostic;
    });
}

/** Append file:line locations to a bare `run` error string where block ids are mentioned. */
function mapRunError(error: string, sourcemap: Record<string, { file: string; line: number; col: number }>, dir: string): string {
    let mapped = error;
    const seen = new Set<string>();
    for (const m of error.matchAll(/[A-Za-z0-9_$!{}-]{8,}/g)) {
        const id = m[0];
        if (seen.has(id) || !sourcemap[id]) continue;
        seen.add(id);
        const l = sourcemap[id];
        mapped += ` [${id} at ${relPath(dir, l.file)}:${l.line}:${l.col}]`;
    }
    if (!seen.size && /loadProject failed|should NOT have/.test(error)) {
        mapped += ` (tip: 'agentwarp check' reports structural problems, including malformed list shapes)`;
    }
    return mapped;
}

/** Warn about overlap pairs the pack introduced (base vs packed, per target). */
async function overlapWarnings(dir: string, packedSb3: string): Promise<Diagnostic[]> {
    const out: Diagnostic[] = [];
    let base: any;
    try {
        base = JSON.parse(await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8'));
    } catch {
        return out;
    }
    const { project } = await loadSb3File(packedSb3);
    const baseByName = new Map<string, any>();
    for (const t of base?.targets ?? []) baseByName.set(String(t?.name), t);
    for (const t of project?.targets ?? []) {
        const b = baseByName.get(String(t?.name));
        if (!b) continue;
        const before = overlaps(b).length;
        const after = overlaps(t).length;
        if (after > before) {
            out.push({
                severity: 'warning',
                rule: 'new-overlap',
                message: `pack introduced ${after - before} new script overlap(s) in target "${t.name}" (${before} -> ${after} pairs); run 'tidy' to re-lay the target`,
            });
        }
    }
    return out;
}

async function main() {
    const [cmd, ...argv] = process.argv.slice(2);
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
        process.stdout.write(USAGE + '\n');
        process.exit(cmd ? 0 : 2);
    }
    const { pos, opts } = parseArgs(argv);
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
            printDiags(
                r.diagnostics.filter((d) => d.severity === 'error'),
                dir,
            );
            process.stdout.write(`unpacked to ${dir} (format ${name})\n`);
            return;
        }
        case 'pack': {
            const dir = resolve(pos[0] ?? '.');
            const out = await doPack(dir, typeof opts.o === 'string' ? opts.o : undefined);
            printDiags(await overlapWarnings(dir, out), dir);
            process.stdout.write(`packed ${displayPath(out)}\n`);
            return;
        }
        case 'check': {
            const dir = resolve(pos[0] ?? '.');
            const json = !!opts.json;
            const out = await doPack(dir);
            const { project } = await loadSb3File(out);
            const sourcemap = await readSourcemap(dir);
            const { validateProject } = await import('../core/validate.ts');
            const { lintProject } = await import('../core/lint.ts');
            const diags: Diagnostic[] = [
                ...validateProject(project, sourcemap),
                ...lintProject(project, sourcemap),
            ];
            const vmres = vmrunJson(['check', out]);
            diags.push(...withLoc(vmres.res.errors, sourcemap, dir, 'error'));
            diags.push(...withLoc(vmres.res.warnings, sourcemap, dir, 'warning'));
            diags.push(...(await tsCheck(dir)));
            if (json) {
                const errors = diags.filter((d) => d.severity === 'error').length;
                const warnings = diags.filter((d) => d.severity === 'warning').length;
                process.stdout.write(
                    JSON.stringify({ ok: errors === 0, errors, warnings, diagnostics: diags }, null, 2) + '\n',
                );
                process.exit(errors === 0 ? 0 : 1);
            }
            const errors = printDiags(diags, dir);
            process.stderr.write(errors === 0 ? 'check ok\n' : 'check FAILED\n');
            process.exit(errors === 0 ? 0 : 1);
        }
        case 'run': {
            // run [dir] [vmrun options…]: first non-flag arg is the dir, rest passes through verbatim.
            let dir = '.';
            let vmArgs = argv;
            const dashdash = argv.indexOf('--');
            if (dashdash >= 0) {
                const before = argv.slice(0, dashdash);
                vmArgs = argv.slice(dashdash + 1);
                if (before.length && !before[0].startsWith('-')) dir = before[0];
            } else if (argv.length && !argv[0].startsWith('-')) {
                dir = argv[0];
                vmArgs = argv.slice(1);
            }
            dir = resolve(dir);
            const out = await doPack(dir);
            const sourcemap = await readSourcemap(dir);
            const { res, code } = vmrunJson(['run', out, ...vmArgs]);
            if (Array.isArray(res.vmWarnings)) {
                for (const w of res.vmWarnings) {
                    const loc = w.blockId && sourcemap[w.blockId];
                    if (loc) {
                        w.file = relPath(dir, loc.file);
                        w.line = loc.line;
                        w.col = loc.col;
                    }
                }
            }
            if (!res.ok && typeof res.error === 'string') {
                res.error = mapRunError(res.error, sourcemap, dir);
            }
            process.stdout.write(JSON.stringify(res, null, 2) + '\n');
            process.exit(res.ok ? 0 : code || 1);
        }
        case 'layout': {
            const dir = resolve(pos[0] ?? '.');
            const out = await doPack(dir);
            const { res, code } = vmrunJson(['layout', out]);
            process.stdout.write(JSON.stringify(res, null, 2) + '\n');
            process.exit(code);
        }
        case 'tidy': {
            const dir = resolve(pos[0] ?? '.');
            const only = typeof opts.target === 'string' ? opts.target : undefined;
            const format = await formatOf(dir);
            const out = await doPack(dir);
            const { project, files } = await loadSb3File(out);
            const { cleanUpPlus } = await import('../core/layout.ts');
            const names: string[] = project.targets.map((t: any) => String(t?.name));
            if (only && !names.includes(only)) die(`no target "${only}" (have: ${names.join(', ')})`);
            for (const t of project.targets ?? []) {
                if (only && String(t?.name) !== only) continue;
                const placed = cleanUpPlus(t);
                for (const [id, p] of placed.blocks) {
                    const b = t.blocks?.[id];
                    if (b && !Array.isArray(b)) {
                        b.x = Math.round(p.x);
                        b.y = Math.round(p.y);
                    }
                }
                for (const [id, p] of placed.comments) {
                    const c = t.comments?.[id];
                    if (c) {
                        c.x = Math.round(p.x);
                        c.y = Math.round(p.y);
                    }
                }
            }
            // Persist positions by re-unpacking the cleaned sb3 into a temp dir
            // and copying the machine-managed files back (script text is unchanged).
            const tmp = await mkdtemp(join(tmpdir(), 'agentwarp-tidy-'));
            try {
                const tmpSb3 = join(tmp, 'clean.sb3');
                await saveSb3File(tmpSb3, JSON.stringify(project), files);
                const tmpDir = join(tmp, 'proj');
                await unpackSb3(tmpSb3, tmpDir, format);
                await cp(join(tmpDir, '.agentwarp', 'base.json'), join(dir, '.agentwarp', 'base.json'));
                await cp(join(tmpDir, '.agentwarp', 'anchors.json'), join(dir, '.agentwarp', 'anchors.json'));
            } finally {
                await rm(tmp, { recursive: true, force: true });
            }
            process.stdout.write(`tidied ${only ?? 'all targets'} in ${displayPath(dir)} (positions saved in .agentwarp/base.json)\n`);
            return;
        }
        case 'costumes': {
            const dir = resolve(pos[0] ?? '.');
            const out = await doPack(dir);
            const { res, code } = vmrunJson(['costumes', out]);
            process.stdout.write(JSON.stringify(res, null, 2) + '\n');
            process.exit(code);
        }
        case 'serve': {
            const dir = resolve(pos[0] ?? '.');
            const port = typeof opts.port === 'string' ? Number(opts.port) : undefined;
            const { startServe } = await import('../bridge/server.ts');
            const h = await startServe(dir, port != null && Number.isFinite(port) ? { port } : {});
            process.stdout.write(`bridge ${h.url}\n`);
            await new Promise(() => undefined); // run until killed
            return;
        }
        default:
            die(`unknown command "${cmd}"\n${USAGE}`);
    }
}

main();
