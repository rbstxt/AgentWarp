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
//   agentwarp test [dir] [pattern] [--json]    pack once, run tests/*.test.json scenarios headless;
//                                              compact table to stderr (JSON to stdout with --json);
//                                              exit 1 on failure
//   agentwarp layout [dir]                     overlap report of the packed project (JSON on stdout)
//   agentwarp tidy [dir] [--target NAME]       Clean-up-Plus all (or one) target's layout in place
//   agentwarp costumes [dir]                   collision sizes of every costume (JSON on stdout)
//   agentwarp serve [dir] [--port N] [--token T] live-sync bridge for TurboWarp (see docs/P4-DESIGN.md)
//   agentwarp help | --help | -h
//
// Diagnostics always go to stderr; stdout carries only command results
// (human one-liners for pack/unpack/tidy, pure JSON for run/layout/costumes
// and check --json). Formats: ts | sbpy | scratchblocks | ir-json
// (stored in <dir>/.agentwarp/format).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
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
  test [dir] [pattern] [--json]  pack once + run tests/*.test.json; table on stderr
  layout [dir]                   overlap report (JSON on stdout)
  tidy [dir] [--target NAME] [--dry-run]     Clean-up-Plus layout in place
  costumes [dir]                  costume collision sizes (JSON on stdout)
  shot [dir] --frames N [--at f1,f2] [--input in.json] [--seed S] [--out DIR] [--gif]
                                 render the stage with the real renderer (PNG frames / GIF,
                                 pixel-accurate touching & pen); prints image paths + final state
  serve [dir] [--port N] [--token T]  live-sync bridge for TurboWarp (default port 8765; token: --token, AGENTWARP_TOKEN, or ~/.config/agentwarp/token)
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

// ---------------------------------------------------------------------------
// test: scenario files under <dir>/tests/*.test.json
// ---------------------------------------------------------------------------

interface TestExpect {
    at?: number | 'end';
    probe: string;
    op?: string;
    value: unknown;
}

interface TestScenario {
    name?: string;
    seconds?: number;
    frames?: number;
    input?: unknown[];
    seed?: number;
    until?: string;
    expect?: TestExpect[];
}

interface TestExpectResult extends TestExpect {
    ok: boolean;
    actual: unknown;
    hint?: string;
    /** file:line suspects that write the probed variable/list (best effort). */
    locations?: string[];
}

function cmpTestValue(actual: unknown, op: string, expected: unknown): boolean {
    if (op === '=' || op === '==') return actual === expected || String(actual) === String(expected);
    if (op === '!=') return actual !== expected && String(actual) !== String(expected);
    if (typeof actual !== 'number' || typeof expected !== 'number') return false;
    if (op === '>') return actual > expected;
    if (op === '<') return actual < expected;
    if (op === '>=') return actual >= expected;
    if (op === '<=') return actual <= expected;
    return false;
}

/**
 * Best-effort writer lookup for a failed probe: when the probe addresses a
 * variable or list (`Sprite.vars.score`, `Sprite.variables.score`,
 * `Sprite.lists.items`), list the scripts that write it as file:line via
 * the pack sourcemap. Anything else (x/y/costume/…) has no static writers.
 */
function probeWriters(
    project: any,
    probe: string,
    sourcemap: Record<string, { file: string; line: number; col: number }>,
    dir: string,
): string[] {
    const parts = String(probe).split('.');
    if (parts.length < 2) return [];
    const target = (project?.targets ?? []).find((t: any) => String(t?.name) === parts[0]);
    if (!target) return [];
    let kind: 'variable' | 'list' | null = null;
    let name: string | null = null;
    if ((parts[1] === 'variables' || parts[1] === 'vars') && parts[2] !== undefined) {
        kind = 'variable';
        name = parts[2];
    } else if (parts[1] === 'lists' && parts[2] !== undefined) {
        kind = 'list';
        name = parts[2];
    } else if (parts.length === 2) {
        const vnames = Object.values<any>(target.variables ?? {}).map((v) => String(Array.isArray(v) ? v[0] : v));
        const lnames = Object.values<any>(target.lists ?? {}).map((v) => String(Array.isArray(v) ? v[0] : v));
        if (vnames.includes(parts[1])) {
            kind = 'variable';
            name = parts[1];
        } else if (lnames.includes(parts[1])) {
            kind = 'list';
            name = parts[1];
        } else return [];
    } else return [];
    const ids = new Set<string>();
    for (const [id, v] of Object.entries<any>((kind === 'variable' ? target.variables : target.lists) ?? {})) {
        if (String(Array.isArray(v) ? v[0] : v) === name) ids.add(id);
    }
    const WRITERS = kind === 'variable'
        ? new Set(['data_setvariableto', 'data_changevariableby'])
        : new Set(['data_addtolist', 'data_insertatlist', 'data_replaceitemoflist', 'data_deleteoflist', 'data_deletealloflist']);
    const field = kind === 'variable' ? 'VARIABLE' : 'LIST';
    const out: string[] = [];
    const seen = new Set<string>();
    for (const [bid, b] of Object.entries<any>(target.blocks ?? {})) {
        if (!b || Array.isArray(b) || !WRITERS.has(b.opcode)) continue;
        const f = b.fields?.[field];
        const fid = Array.isArray(f) ? f[1] : null;
        if (typeof fid !== 'string' || !ids.has(fid)) continue;
        const loc = sourcemap[bid];
        const key = loc ? `${loc.file}:${loc.line}:${loc.col}` : `(block ${bid})`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(loc ? relPath(dir, loc.file) + `:${loc.line}:${loc.col}` : key);
        }
        if (out.length >= 3) break;
    }
    return out;
}

function fmtActual(v: unknown): string {
    return v === undefined ? 'missing' : JSON.stringify(v) ?? String(v);
}

async function runTestCommand(dir: string, pattern: string | undefined, json: boolean): Promise<void> {
    const testsDir = join(dir, 'tests');
    let files: string[];
    try {
        files = (await readdir(testsDir)).filter((f) => f.endsWith('.test.json')).sort();
    } catch {
        process.stderr.write(`test: no tests directory (${displayPath(join(dir, 'tests'))}); add tests/*.test.json\n`);
        if (json) process.stdout.write(JSON.stringify({ ok: false, error: 'no tests directory', scenarios: [] }) + '\n');
        process.exit(1);
    }
    const sb3 = await doPack(dir);
    const { project } = await loadSb3File(sb3);
    const sourcemap = await readSourcemap(dir);
    const tmp = await mkdtemp(join(tmpdir(), 'agentwarp-test-'));
    try {
        const results: Array<{
            file: string; name: string; ok: boolean; frames?: number;
            error?: string; expects: TestExpectResult[];
        }> = [];
        for (const f of files) {
            let raw: any;
            try {
                raw = JSON.parse(await readFile(join(testsDir, f), 'utf8'));
            } catch (e: any) {
                results.push({ file: f, name: f, ok: false, error: `cannot parse ${f}: ${e?.message}`, expects: [] });
                continue;
            }
            const scenarios: TestScenario[] = Array.isArray(raw) ? raw : [raw];
            for (const sc of scenarios) {
                const name = String(sc?.name ?? f);
                if (pattern && !`${f} ${name}`.toLowerCase().includes(pattern.toLowerCase())) continue;
                const totalFrames = sc?.frames !== undefined ? Math.max(0, Math.round(Number(sc.frames)))
                    : sc?.seconds !== undefined ? Math.max(0, Math.round(Number(sc.seconds) * 30))
                    : 300;
                if (!Number.isFinite(totalFrames)) {
                    results.push({ file: f, name, ok: false, error: 'seconds/frames must be a number', expects: [] });
                    continue;
                }
                const expects: TestExpect[] = Array.isArray(sc?.expect) ? sc.expect : [];
                // Group expects by `at`: one headless run per distinct frame count.
                const groups = new Map<string, { frames: number; list: TestExpect[] }>();
                for (const e of expects) {
                    const key = e?.at === undefined || e?.at === 'end' ? 'end' : String(Math.max(0, Math.round(Number(e.at))));
                    const frames = key === 'end' ? totalFrames : Number(key);
                    if (!groups.has(key)) groups.set(key, { frames, list: [] });
                    groups.get(key)!.list.push({ at: e?.at ?? 'end', probe: String(e?.probe ?? ''), op: e?.op ?? '==', value: e?.value });
                }
                let inputArg: string | null = null;
                if (sc?.input !== undefined) {
                    inputArg = join(tmp, `${results.length}.input.json`);
                    await writeFile(inputArg, JSON.stringify(Array.isArray(sc.input) ? sc.input : []));
                }
                const seedArg = sc?.seed !== undefined ? String(Number(sc.seed)) : undefined;
                const res: TestExpectResult[] = [];
                let runError: string | undefined;
                let ranFrames: number | undefined;
                for (const [key, g] of groups) {
                    if (runError) {
                        for (const e of g.list) res.push({ ...e, ok: false, actual: undefined });
                        continue;
                    }
                    const args = ['run', sb3, '--frames', String(g.frames)];
                    if (inputArg) args.push('--input', inputArg);
                    if (seedArg !== undefined) args.push('--seed', seedArg);
                    // `until` stops the full-length run early (only meaningful at end).
                    if (typeof sc?.until === 'string' && key === 'end') args.push('--until', sc.until);
                    for (const e of g.list) args.push('--probe', e.probe);
                    const { res: out } = vmrunJson(args);
                    if (!out?.ok) {
                        runError = mapRunError(String(out?.error ?? 'run failed'), sourcemap, dir);
                        for (const e of g.list) res.push({ ...e, ok: false, actual: undefined });
                        continue;
                    }
                    ranFrames = out.frames;
                    for (const e of g.list) {
                        const actual = out.probes?.[e.probe] ?? null;
                        const ok = actual !== undefined && actual !== null || e.value === null
                            ? cmpTestValue(actual, e.op ?? '==', e.value)
                            : false;
                        const r: TestExpectResult = { ...e, ok, actual: actual ?? null };
                        if (!ok && out.probeHints?.[e.probe]) r.hint = out.probeHints[e.probe];
                        if (!ok) {
                            const locs = probeWriters(project, e.probe, sourcemap, dir);
                            if (locs.length) r.locations = locs;
                        }
                        res.push(r);
                    }
                }
                const ok = runError === undefined && res.every((r) => r.ok);
                results.push({ file: f, name, ok, frames: ranFrames, ...(runError ? { error: runError } : {}), expects: res });
            }
        }
        const passed = results.filter((r) => r.ok).length;
        const failedExpects = results.flatMap((r) => r.expects).filter((e) => !e.ok).length;
        for (const r of results) {
            const n = r.expects.length;
            const okN = r.expects.filter((e) => e.ok).length;
            process.stderr.write(`${r.ok ? 'PASS' : 'FAIL'} ${r.file} :: ${r.name} (${okN}/${n})\n`);
            if (r.error) process.stderr.write(`  error: ${r.error}\n`);
            for (const e of r.expects) {
                if (e.ok) continue;
                process.stderr.write(`  [${e.at}] ${e.probe} ${e.op} ${fmtActual(e.value)} (actual: ${fmtActual(e.actual)})\n`);
                if (e.hint) process.stderr.write(`    hint: ${e.hint}\n`);
                for (const l of e.locations ?? []) process.stderr.write(`    written at ${l}\n`);
            }
        }
        process.stderr.write(`${passed} passed, ${results.length - passed} failed (${failedExpects} failing expects)\n`);
        if (json) {
            process.stdout.write(JSON.stringify({
                ok: failedExpects === 0 && results.every((r) => r.ok),
                passed,
                failed: results.length - passed,
                scenarios: results,
            }, null, 2) + '\n');
        }
        process.exit(results.length > 0 && results.every((r) => r.ok) ? 0 : 1);
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
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
            // Project-level agent docs (P5: the bridge runs agents with
            // cwd = project dir). Never overwrite the author's own files.
            const agentsMd = join(resolve(dir), 'AGENTS.md');
            if (!existsSync(agentsMd)) {
                await writeFile(agentsMd,
                    `# ${basename(resolve(dir))} — agentwarp text project (format: ${name})\n` +
                    `\n` +
                    `This directory is a text mirror of a Scratch project. Edit the text files; the tool packs them\n` +
                    `back into an .sb3. Never hand-edit \`.agentwarp/\` (machine-managed).\n` +
                    `\n` +
                    `Tool: \`${join(ROOT, 'bin/agentwarp')}\` (call it \`agentwarp\` below; run from this directory).\n` +
                    `Read BEFORE editing:\n` +
                    `- Workflow guide: ${join(ROOT, 'skill/agentwarp/SKILL.md')}\n` +
                    `- Format reference (${name}): ${join(ROOT, 'formats', name, 'AGENTS.md')}\n` +
                    `\n` +
                    `Layout: \`Stage/\` + one dir per sprite (\`scripts.<ext>\`, \`target.json\`, \`costumes/\`, \`sounds/\`);\n` +
                    `project-wide \`agentwarp.json\` (extensions, monitors); \`tests/*.test.json\` (headless scenarios).\n` +
                    `\n` +
                    `Loop: edit → \`agentwarp check\` → \`agentwarp test\` / \`agentwarp run --until …\` → \`agentwarp shot\` to look → fix.\n` +
                    `Write a test for every feature. Keep diffs small; if a human has the project open in TurboWarp\n` +
                    `(\`agentwarp serve\`), files may be rewritten by the bridge — re-read before editing.\n`);
            }
            const claudeMd = join(resolve(dir), 'CLAUDE.md');
            if (!existsSync(claudeMd)) {
                await writeFile(claudeMd, `@AGENTS.md\n`);
            }
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
        case 'test': {
            // test [dir] [pattern] [--json]: first non-flag arg is the dir,
            // second (if any) filters scenarios by file/name substring.
            const nonFlags = argv.filter((a) => !a.startsWith('-'));
            const dir = resolve(nonFlags[0] ?? '.');
            const pattern = nonFlags.length > 1 ? nonFlags[1] : undefined;
            await runTestCommand(dir, pattern, !!opts.json);
            return;
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
            const dryRun = opts['dry-run'] === true;
            const moves: Record<string, number> = {};
            for (const t of project.targets ?? []) {
                if (only && String(t?.name) !== only) continue;
                const placed = cleanUpPlus(t);
                moves[String(t?.name)] = 0;
                for (const [id, p] of placed.blocks) {
                    const b = t.blocks?.[id];
                    if (b && !Array.isArray(b)) {
                        if (Math.round(p.x) !== Math.round(b.x) || Math.round(p.y) !== Math.round(b.y)) moves[String(t?.name)]++;
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
            if (dryRun) {
                for (const [n, k] of Object.entries(moves)) process.stderr.write(`${n}: ${k} script(s) would move\n`);
                process.stderr.write('dry run: nothing written. Note: tidy re-lays out the WHOLE target (human placement is lost);\n' +
                    'new scripts are already placed cleanly by pack without tidy.\n');
                return;
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
        case 'shot': {
            // shot [dir] [render options…]: like run, first non-flag arg is the dir, the rest passes through.
            const raw = argv.filter(a => a !== '--');
            const dir = resolve(raw.length && !raw[0].startsWith('-') ? raw[0] : '.');
            const flags = raw.length && !raw[0].startsWith('-') ? raw.slice(1) : raw;
            const out = await doPack(dir);
            const oi = flags.indexOf('--out');
            const outDir = resolve(oi >= 0 ? flags[oi + 1] : join(dir, '.agentwarp', 'shots'));
            const passthrough = flags.filter((a, i) => !(i === oi || i === oi + 1) || oi < 0);
            if (!passthrough.includes('--frames')) passthrough.push('--frames', '30');
            try {
                // stderr inherited: the renderer's progress lines (loading / frame k of N) show live.
                const json = execFileSync('node', [join(ROOT, 'tools/render/cli.mjs'), 'shot', out, ...passthrough, '--out', outDir],
                    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit']});
                const {readdir} = await import('node:fs/promises');
                const images = (await readdir(outDir)).filter(f => /\.(png|gif)$/.test(f)).sort().map(f => join(outDir, f));
                process.stderr.write(images.map(f => `image: ${f}`).join('\n') + '\n');
                process.stdout.write(json);
            } catch (e: any) {
                process.stderr.write(String(e.stderr ?? e.message ?? e) + '\n');
                process.exit(1);
            }
            return;
        }
        case 'serve': {
            const dir = resolve(pos[0] ?? '.');
            // Stable defaults so a TurboWarp userscript's saved connection keeps working:
            // port 8765 and a per-user token in ~/.config/agentwarp/token (created once, 0600).
            const port = typeof opts.port === 'string' ? Number(opts.port) : 8765;
            if (!Number.isInteger(port) || port < 0 || port > 65535) die('serve: --port must be 0-65535');
            let token = typeof opts.token === 'string' ? opts.token : process.env.AGENTWARP_TOKEN || undefined;
            if (token == null) {
                const tokenFile = join(homedir(), '.config', 'agentwarp', 'token');
                try {
                    token = (await readFile(tokenFile, 'utf8')).trim();
                } catch {
                    token = randomBytes(16).toString('hex');
                    await mkdir(dirname(tokenFile), { recursive: true });
                    await writeFile(tokenFile, token + '\n', { mode: 0o600 });
                }
            }
            if (token.length < 16) die('serve: --token must be at least 16 characters');
            const { startServe } = await import('../bridge/server.ts');
            let h;
            try {
                h = await startServe(dir, { port, token });
            } catch (e) {
                if ((e as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
                    die(`serve: port ${port} is in use (another agentwarp serve?). Stop it or pass --port N.`);
                }
                throw e;
            }
            process.stdout.write(`bridge ${h.url}\n`);
            process.stdout.write(`TurboWarp connect dialog: URL http://127.0.0.1:${h.port}  token ${h.token}\n`);
            await new Promise(() => undefined); // run until killed
            return;
        }
        default:
            die(`unknown command "${cmd}"\n${USAGE}`);
    }
}

main();
