/**
 * Unpack: .sb3 -> project directory (format plugin renders script text).
 * Pack: project directory -> .sb3 (format plugin parses, reconcile merges).
 *
 * Directory layout:
 *   agentwarp.json            project meta: extensions, monitors, meta
 *   Stage/                    one dir per target (sanitized; real name in target.json)
 *     scripts.<ext>           every script + workspace comment, in reading order
 *     target.json             variables, lists, broadcasts, costumes/sounds list,
 *                             layer/volume/tempo/etc (everything but blocks/comments)
 *     costumes/<name>.<ext>   original bytes
 *     sounds/<name>.<ext>     original bytes
 *   .agentwarp/               machine-managed, agents never edit
 *     base.json               last synced project.json (the reconcile base)
 *     anchors.json            per target: anchor label -> top-level block/comment id
 *     sourcemap.json          block id -> file:line:col (written by pack)
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostic, Format } from './ir.ts';
import { extractTarget } from './extract.ts';
import { reconcileProject, type Placement, type TargetDecls } from './reconcile.ts';
import { assetFileName, md5extFor, sanitizeSegment } from './assets.ts';
import { loadSb3File, saveSb3File } from './sb3.ts';

export interface PackResult {
    diagnostics: Diagnostic[];
    placements: Placement[];
    /** False when the output project.json is byte-identical to the base. */
    changed: boolean;
}

interface AgentwarpJson {
    formatVersion: 1;
    meta: any;
    extensions: any[];
    monitors: any[];
    extraTopLevel: Record<string, any>;
}

const TARGET_JSON = 'target.json';
const KNOWN_TOP_LEVEL = new Set(['targets', 'monitors', 'extensions', 'meta']);

function scriptsFileName(format: Format): string {
    return `scripts.${format.ext}`;
}

function targetDirName(name: string, taken: Set<string>): string {
    let base = sanitizeSegment(name);
    if (!taken.has(base)) {
        taken.add(base);
        return base;
    }
    let i = 2;
    while (taken.has(`${base} ~${i}`)) i++;
    const out = `${base} ~${i}`;
    taken.add(out);
    return out;
}

/** Split a base target into target.json content + asset file writes. */
function splitTargetForUnpack(
    target: any,
): { targetJson: any; assets: Array<{ file: string; md5ext: string }> } {
    const { blocks, comments, variables, lists, broadcasts, costumes, sounds, name, ...scalars } = target ?? {};
    void blocks;
    void comments;
    const targetJson: any = { name, ...scalars };
    targetJson.variables = [];
    for (const [id, v] of Object.entries<any>(variables ?? {})) {
        const arr = Array.isArray(v) ? v : [v];
        targetJson.variables.push({ name: String(arr[0] ?? id), id, value: arr[1], ...(arr[2] === true ? { cloud: true } : {}) });
    }
    targetJson.lists = [];
    for (const [id, v] of Object.entries<any>(lists ?? {})) {
        const arr = Array.isArray(v) ? v : [v];
        targetJson.lists.push({ name: String(arr[0] ?? id), id, items: arr.slice(1) });
    }
    targetJson.broadcasts = [];
    for (const [id, bname] of Object.entries<any>(broadcasts ?? {})) {
        targetJson.broadcasts.push({ name: String(bname), id });
    }
    const assets: Array<{ file: string; md5ext: string }> = [];
    const assetNames = new Set<string>();
    const claimFile = (kind: 'costumes' | 'sounds', cname: string, dataFormat: string): string => {
        let file = assetFileName(kind, cname, dataFormat);
        let i = 2;
        while (assetNames.has(file)) {
            file = `${kind}/${sanitizeSegment(cname)} ~${i}.${dataFormat}`;
            i++;
        }
        assetNames.add(file);
        return file;
    };
    targetJson.costumes = [];
    for (const c of costumes ?? []) {
        const dataFormat = String(c?.dataFormat ?? 'svg');
        const file = claimFile('costumes', String(c?.name ?? 'costume'), dataFormat);
        assets.push({ file, md5ext: String(c?.md5ext ?? '') });
        const { assetId, dataFormat: _df, md5ext, ...rest } = c ?? {};
        void assetId;
        void _df;
        void md5ext;
        targetJson.costumes.push({ ...rest, name: c?.name, file });
    }
    targetJson.sounds = [];
    for (const s of sounds ?? []) {
        const dataFormat = String(s?.dataFormat ?? 'wav');
        const file = claimFile('sounds', String(s?.name ?? 'sound'), dataFormat);
        assets.push({ file, md5ext: String(s?.md5ext ?? '') });
        const { assetId, dataFormat: _df, md5ext, ...rest } = s ?? {};
        void assetId;
        void _df;
        void md5ext;
        targetJson.sounds.push({ ...rest, name: s?.name, file });
    }
    return { targetJson, assets };
}

export async function unpackProject(
    project: any,
    files: Map<string, Uint8Array>,
    outDir: string,
    format: Format,
): Promise<{ diagnostics: Diagnostic[] }> {
    const diagnostics: Diagnostic[] = [];
    await rm(outDir, { recursive: true, force: true });
    await mkdir(join(outDir, '.agentwarp'), { recursive: true });
    const meta: AgentwarpJson = {
        formatVersion: 1,
        meta: project?.meta,
        extensions: project?.extensions ?? [],
        monitors: project?.monitors ?? [],
        extraTopLevel: {},
    };
    for (const [k, v] of Object.entries(project ?? {})) {
        if (!KNOWN_TOP_LEVEL.has(k)) meta.extraTopLevel[k] = v;
    }
    await writeFile(join(outDir, 'agentwarp.json'), JSON.stringify(meta, null, 2) + '\n');
    const taken = new Set<string>();
    const anchors: Record<string, Record<string, string>> = {};
    for (const target of project?.targets ?? []) {
        const dir = targetDirName(String(target?.name ?? 'target'), taken);
        const tdir = join(outDir, dir);
        await mkdir(join(tdir, 'costumes'), { recursive: true });
        await mkdir(join(tdir, 'sounds'), { recursive: true });
        const { targetJson, assets } = splitTargetForUnpack(target);
        for (const a of assets) {
            const buf = files.get(a.md5ext);
            if (!buf) {
                diagnostics.push({ message: `target "${target?.name}": asset file "${a.md5ext}" missing from zip`, severity: 'error' });
                continue;
            }
            await writeFile(join(tdir, a.file), buf);
        }
        await writeFile(join(tdir, TARGET_JSON), JSON.stringify(targetJson, null, 2) + '\n');
        const file = `${dir}/${scriptsFileName(format)}`;
        const extracted = extractTarget(target, project, { file });
        diagnostics.push(...extracted.diagnostics);
        anchors[String(target?.name ?? dir)] = extracted.anchors;
        await writeFile(join(tdir, scriptsFileName(format)), format.print(extracted.scripts, { targetName: String(target?.name), file, targetJson, isStage: target?.isStage === true }));
    }
    await writeFile(join(outDir, '.agentwarp', 'anchors.json'), JSON.stringify(anchors, null, 2) + '\n');
    return { diagnostics };
}

export async function unpackSb3(sb3Path: string, outDir: string, format: Format): Promise<{ diagnostics: Diagnostic[] }> {
    const { projectText, project, files } = await loadSb3File(sb3Path);
    const r = await unpackProject(project, files, outDir, format);
    await writeFile(join(outDir, '.agentwarp', 'base.json'), projectText);
    return r;
}

/** Build reconcile declarations + asset files for one target directory. */
async function readTargetDir(
    tdir: string,
    targetName: string,
    format: Format,
    diagnostics: Diagnostic[],
): Promise<{
    scripts: ReturnType<Format['parse']>['scripts'];
    decls: TargetDecls;
    files: Map<string, Uint8Array>;
} | null> {
    let targetJson: any;
    try {
        targetJson = JSON.parse(await readFile(join(tdir, TARGET_JSON), 'utf8'));
    } catch (e) {
        diagnostics.push({ message: `target "${targetName}": cannot read target.json: ${(e as Error)?.message}`, severity: 'error' });
        return null;
    }
    const scriptsPath = join(tdir, scriptsFileName(format));
    let text: string;
    try {
        text = await readFile(scriptsPath, 'utf8');
    } catch (e) {
        diagnostics.push({
            message: `target "${targetName}": cannot read ${scriptsFileName(format)}: ${(e as Error)?.message}`,
            severity: 'error',
        });
        return null;
    }
    const parsed = format.parse(text, { targetName, file: scriptsPath, targetJson, isStage: targetJson?.isStage === true });
    diagnostics.push(...parsed.diagnostics);
    const decls: TargetDecls = {
        variables: [],
        lists: [],
        broadcasts: [],
        costumes: [],
        sounds: [],
        scalars: {},
    };
    for (const v of Array.isArray(targetJson.variables) ? targetJson.variables : []) {
        decls.variables.push({
            name: String(v?.name ?? ''),
            id: String(v?.id ?? ''),
            value: v?.value,
            ...(v?.cloud === true ? { cloud: true as const } : {}),
        });
    }
    for (const v of Array.isArray(targetJson.lists) ? targetJson.lists : []) {
        decls.lists.push({ name: String(v?.name ?? ''), id: String(v?.id ?? ''), items: Array.isArray(v?.items) ? v.items : [] });
    }
    for (const v of Array.isArray(targetJson.broadcasts) ? targetJson.broadcasts : []) {
        decls.broadcasts.push({ name: String(v?.name ?? ''), id: String(v?.id ?? '') });
    }
    const files = new Map<string, Uint8Array>();
    for (const c of targetJson.costumes ?? []) {
        const file = String(c?.file ?? '');
        let buf: Uint8Array | null = null;
        try {
            buf = await readFile(join(tdir, file));
        } catch {
            buf = null;
        }
        if (!buf) {
            diagnostics.push({ message: `target "${targetName}": costume file "${file}" missing`, severity: 'error' });
            continue;
        }
        const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : 'svg';
        const md5ext = md5extFor(buf, ext);
        const { file: _f, ...rest } = c ?? {};
        void _f;
        decls.costumes.push({ ...rest, assetId: md5ext.slice(0, md5ext.lastIndexOf('.')), dataFormat: ext, md5ext });
        files.set(md5ext, buf);
    }
    for (const s of targetJson.sounds ?? []) {
        const file = String(s?.file ?? '');
        let buf: Uint8Array | null = null;
        try {
            buf = await readFile(join(tdir, file));
        } catch {
            buf = null;
        }
        if (!buf) {
            diagnostics.push({ message: `target "${targetName}": sound file "${file}" missing`, severity: 'error' });
            continue;
        }
        const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : 'wav';
        const md5ext = md5extFor(buf, ext);
        const { file: _f, ...rest } = s ?? {};
        void _f;
        decls.sounds.push({ ...rest, assetId: md5ext.slice(0, md5ext.lastIndexOf('.')), dataFormat: ext, md5ext });
        files.set(md5ext, buf);
    }
    for (const [k, v] of Object.entries(targetJson)) {
        if (!['variables', 'lists', 'broadcasts', 'costumes', 'sounds'].includes(k)) decls.scalars[k] = v;
    }
    return { scripts: parsed.scripts, decls, files };
}

export async function packDir(dir: string, outSb3Path: string, format: Format): Promise<PackResult> {
    const diagnostics: Diagnostic[] = [];
    const baseText = await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8');
    const base = JSON.parse(baseText);
    const anchors: Record<string, Record<string, string>> = JSON.parse(
        await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'),
    );
    const meta: AgentwarpJson = JSON.parse(await readFile(join(dir, 'agentwarp.json'), 'utf8'));
    const entries = (await readdir(dir)).filter((e) => e !== '.agentwarp' && e !== 'agentwarp.json');
    // Map directories to target names via their target.json.
    const perTarget: Record<string, { scripts: any; anchors: Record<string, string> }> = {};
    const declsByTarget: Record<string, TargetDecls> = {};
    const allFiles = new Map<string, Uint8Array>();
    const seenNames = new Set<string>();
    for (const e of entries.sort()) {
        const tdir = join(dir, e);
        let tj: any = null;
        try {
            tj = JSON.parse(await readFile(join(tdir, TARGET_JSON), 'utf8'));
        } catch {
            continue; // not a target dir
        }
        const name = String(tj?.name ?? e);
        if (seenNames.has(name)) {
            diagnostics.push({ message: `duplicate target "${name}" (directory "${e}"); only one kept`, severity: 'error' });
            continue;
        }
        seenNames.add(name);
        const r = await readTargetDir(tdir, name, format, diagnostics);
        if (!r) continue;
        perTarget[name] = { scripts: r.scripts, anchors: anchors[name] ?? {} };
        declsByTarget[name] = r.decls;
        for (const [k, v] of r.files) {
            if (!allFiles.has(k)) allFiles.set(k, v);
        }
    }
    const reconciled = reconcileProject(base, perTarget, declsByTarget, { file: undefined });
    diagnostics.push(...reconciled.diagnostics);
    // Top-level meta comparison (monitors/extensions/meta/extra).
    const baseTop = {
        meta: base?.meta,
        extensions: base?.extensions ?? [],
        monitors: base?.monitors ?? [],
        extraTopLevel: Object.fromEntries(Object.entries(base ?? {}).filter(([k]) => !KNOWN_TOP_LEVEL.has(k))),
    };
    const newTop = {
        meta: meta?.meta,
        extensions: meta?.extensions ?? [],
        monitors: meta?.monitors ?? [],
        extraTopLevel: meta?.extraTopLevel ?? {},
    };
    const metaSame = JSON.stringify(baseTop) === JSON.stringify(newTop);
    let project = reconciled.project;
    let changed = !reconciled.unchanged;
    if (!metaSame) {
        project = {
            ...project,
            meta: newTop.meta,
            extensions: newTop.extensions,
            monitors: newTop.monitors,
            ...newTop.extraTopLevel,
        };
        changed = true;
    }
    const projectText = changed ? JSON.stringify(project) : baseText;
    await saveSb3File(outSb3Path, projectText, allFiles);
    await writeFile(join(dir, '.agentwarp', 'sourcemap.json'), JSON.stringify(reconciled.sourcemap, null, 2) + '\n');
    return { diagnostics, placements: reconciled.placements, changed };
}
