/**
 * Unpack: .sb3 -> project directory (format plug-in renders script text).
 * Pack: project directory -> .sb3 (format plug-in parses, reconcile merges).
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
 *
 * Sprite lifecycle is directory-driven: adding a directory with a minimal
 * target.json (+ asset files) adds a sprite (defaults filled like Scratch);
 * changing `name` in target.json renames it (blocks/ids kept, menu
 * references in other targets updated); removing the directory deletes it
 * (references in other targets produce warnings).
 */
import { placeNew } from './layout.ts';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Diagnostic, Format, Loc, Script } from './ir.ts';
import { extractTarget, stabilizeAnchors, type AnchorMap } from './extract.ts';
import {
    collectAnchorLabels,
    reconcileProject,
    rewriteSpriteName,
    type Placement,
    type TargetDecls,
} from './reconcile.ts';
import { assetFileName, md5extFor, probeImageSize, probeWavInfo, sanitizeSegment } from './assets.ts';
import { collectUsedIds, makeId } from './ids.ts';
import { loadSb3File, saveSb3File } from './sb3.ts';

export interface PackResult {
    diagnostics: Diagnostic[];
    placements: Placement[];
    /** False when the output project.json is byte-identical to the base. */
    changed: boolean;
    /** Ids minted for id-less/duplicate declarations, already written back into target.json files. */
    mintedIds: MintedId[];
}

/** One id minted at pack for an id-less (or duplicate-id) declaration. */
export interface MintedId {
    /** Final target name (after renames). */
    target: string;
    /** Target directory entry (for persisting). */
    dir: string;
    kind: 'variable' | 'list' | 'broadcast';
    /** Declared name. */
    name: string;
    /** Index into target.json's `variables` / `lists` / `broadcasts` array. */
    index: number;
    id: string;
}

export interface PackAgainstOptions {
    baseProject: any;
    /** Original base bytes; the output reuses them verbatim when unchanged. */
    baseText?: string;
    /** Per-target anchor maps; defaults to <dir>/.agentwarp/anchors.json. */
    anchors?: Record<string, Record<string, string>>;
}

export interface PackAgainstResult {
    project: any;
    projectText: string;
    files: Map<string, Uint8Array>;
    diagnostics: Diagnostic[];
    placements: Placement[];
    sourcemap: Record<string, Loc>;
    changed: boolean;
    mintedIds: MintedId[];
}

export interface UnpackIntoOptions {
    /** Previous anchors for label stability; defaults to the dir's anchors.json. */
    prevAnchors?: Record<string, AnchorMap>;
}

export interface UnpackIntoResult {
    diagnostics: Diagnostic[];
    anchors: Record<string, Record<string, string>>;
}

export interface ReadTargetDirOptions {
    /** Shared id pool, seeded from the base project (minted ids are added). */
    usedIds?: Set<string>;
    /** Ids already claimed by declarations in this pack (catches duplicates). */
    seenIds?: Set<string>;
    /** What each claimed id was first seen as (kind + name). */
    seenDetail?: Map<string, { kind: string; name: string }>;
    /** Receives one entry per minted id. */
    mintedIds?: MintedId[];
    /**
     * True when the target is new (no base target with this name): Sprite
     * defaults are filled and derivation applies. Base-matched targets pass
     * scalars through verbatim for lossless round trips (even real projects
     * omit keys like `size` or `direction`).
     */
    isNew?: boolean;
}

export interface ReadTargetDirResult {
    scripts: Script[];
    decls: TargetDecls;
    files: Map<string, Uint8Array>;
    targetJson: any;
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

/** Map existing target directories to target names via their target.json. */
async function scanTargetDirs(dir: string): Promise<Map<string, string>> {
    const out = new Map<string, string>(); // targetName -> dirEntry
    let entries: string[];
    try {
        entries = (await readdir(dir)).sort();
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e === '.agentwarp' || e === 'agentwarp.json') continue;
        try {
            const tj = JSON.parse(await readFile(join(dir, e, TARGET_JSON), 'utf8'));
            if (typeof tj?.name === 'string' && !out.has(tj.name)) out.set(tj.name, e);
        } catch {
            /* not a target dir */
        }
    }
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
        // sb3 list = [name, [item, …]] (+ rare extra trailing entries, kept for losslessness).
        const entry: any = { name: String(arr[0] ?? id), id, items: Array.isArray(arr[1]) ? arr[1] : [] };
        if (!Array.isArray(arr[1]) || arr.length > 2) entry.raw = arr.slice(1);
        targetJson.lists.push(entry);
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

function isScalar(v: unknown): boolean {
    const t = typeof v;
    return t === 'string' || t === 'number' || t === 'boolean';
}

function extOfFile(file: string, fallback: string): string {
    const dot = file.lastIndexOf('.');
    if (dot < 0 || dot === file.length - 1) return fallback;
    return file.slice(dot + 1).toLowerCase();
}

/** Non-hidden regular files directly inside a subdir, sorted by name. */
async function listAssetFiles(tdir: string, sub: string): Promise<string[]> {
    let entries;
    try {
        entries = await readdir(join(tdir, sub), { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
}

/** Build reconcile declarations + asset files for one target directory. */
export async function readTargetDir(
    tdir: string,
    targetName: string,
    format: Format,
    diagnostics: Diagnostic[],
    stageJson?: any,
    opts: ReadTargetDirOptions = {},
): Promise<ReadTargetDirResult | null> {
    const targetFile = join(tdir, TARGET_JSON);
    let targetJson: any;
    try {
        targetJson = JSON.parse(await readFile(targetFile, 'utf8'));
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
    const parsed = format.parse(text, { targetName, file: scriptsPath, targetJson, isStage: targetJson?.isStage === true, stageJson });
    diagnostics.push(...parsed.diagnostics);
    const used = opts.usedIds ?? new Set<string>();
    const seen = opts.seenIds ?? new Set<string>();
    const detail = opts.seenDetail ?? new Map<string, { kind: string; name: string }>();

    // Id-less (or duplicate-id) declarations get fresh Scratch-style ids.
    // An id is kept when it is missing-free and either unseen in this pack or
    // the exact same declaration repeated (e.g. one broadcast declared on two
    // targets, as real projects do). A second, conflicting use of the same id
    // (different kind or name) is a duplicate: mint a fresh id with a warning.
    // A variable/list/broadcast rename keeps its id (single use, new name).
    const claimId = (kind: MintedId['kind'], name: string, index: number, rawId: unknown): string => {
        const id = String(rawId ?? '');
        if (id === '') {
            const fresh = makeId(used);
            used.add(fresh);
            if (!seen.has(fresh)) {
                seen.add(fresh);
                detail.set(fresh, { kind, name });
            }
            opts.mintedIds?.push({ target: targetName, dir: basename(tdir), kind, name, index, id: fresh });
            return fresh;
        }
        const prev = detail.get(id);
        if (!seen.has(id) || (prev && prev.kind === kind && prev.name === name)) {
            seen.add(id);
            if (!prev) detail.set(id, { kind, name });
            used.add(id);
            return id;
        }
        diagnostics.push({
            message: `target "${targetName}": ${kind} "${name}" has a duplicate id; minted a fresh one`,
            file: targetFile,
            severity: 'warning',
        });
        const fresh = makeId(used);
        used.add(fresh);
        seen.add(fresh);
        detail.set(fresh, { kind, name });
        opts.mintedIds?.push({ target: targetName, dir: basename(tdir), kind, name, index, id: fresh });
        return fresh;
    };

    // Shape validation (clear file + json-path diagnostics; pack continues).
    const mustArray = (key: string): any[] => {
        const v = targetJson[key];
        if (v === undefined || v === null) return [];
        if (!Array.isArray(v)) {
            diagnostics.push({ message: `target "${targetName}": target.json "${key}" must be an array`, file: targetFile, severity: 'error' });
            return [];
        }
        return v;
    };
    const variablesRaw = mustArray('variables');
    variablesRaw.forEach((v, i) => {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
            diagnostics.push({
                message: `target "${targetName}": target.json variables[${i}] must be an object with name/value`,
                file: targetFile,
                severity: 'error',
            });
            return;
        }
        if (!isScalar(v.value)) {
            diagnostics.push({
                message: `target "${targetName}": target.json variables[${i}].value must be a scalar (string/number/boolean), got ${v.value === null ? 'null' : Array.isArray(v.value) ? 'array' : typeof v.value}`,
                file: targetFile,
                severity: 'error',
            });
        }
    });
    const listsRaw = mustArray('lists');
    listsRaw.forEach((v, i) => {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
            diagnostics.push({
                message: `target "${targetName}": target.json lists[${i}] must be an object with name/items`,
                file: targetFile,
                severity: 'error',
            });
            return;
        }
        if (!Array.isArray(v.items)) {
            diagnostics.push({
                message: `target "${targetName}": target.json lists[${i}].items must be an array of scalars`,
                file: targetFile,
                severity: 'error',
            });
        } else {
            v.items.forEach((item: unknown, j: number) => {
                if (!isScalar(item)) {
                    diagnostics.push({
                        message: `target "${targetName}": target.json lists[${i}].items[${j}] must be a scalar (string/number/boolean), got ${item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item}`,
                        file: targetFile,
                        severity: 'error',
                    });
                }
            });
        }
    });
    const broadcastsRaw = mustArray('broadcasts');

    const decls: TargetDecls = {
        variables: [],
        lists: [],
        broadcasts: [],
        costumes: [],
        sounds: [],
        scalars: {},
    };
    variablesRaw.forEach((v, i) => {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return;
        decls.variables.push({
            name: String(v?.name ?? ''),
            id: claimId('variable', String(v?.name ?? ''), i, (v as any)?.id),
            value: (v as any)?.value,
            ...((v as any)?.cloud === true ? { cloud: true as const } : {}),
        });
    });
    listsRaw.forEach((v, i) => {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return;
        decls.lists.push({
            name: String(v?.name ?? ''),
            id: claimId('list', String(v?.name ?? ''), i, (v as any)?.id),
            items: Array.isArray((v as any)?.items) ? (v as any).items : [],
            ...(Array.isArray((v as any)?.raw) ? { raw: (v as any).raw } : {}),
        });
    });
    broadcastsRaw.forEach((v, i) => {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return;
        decls.broadcasts.push({
            name: String(v?.name ?? ''),
            id: claimId('broadcast', String(v?.name ?? ''), i, (v as any)?.id),
        });
    });

    // Costumes/sounds: an omitted list is derived from the files on disk
    // (name order); rotation center = image center, bitmapResolution 1 for
    // vector, 2 for bitmap. Present lists are used as-is.
    const deriveCostumes = targetJson.costumes == null;
    const deriveSounds = targetJson.sounds == null;
    if (targetJson.costumes != null && !Array.isArray(targetJson.costumes)) {
        diagnostics.push({ message: `target "${targetName}": target.json "costumes" must be an array`, file: targetFile, severity: 'error' });
    }
    if (targetJson.sounds != null && !Array.isArray(targetJson.sounds)) {
        diagnostics.push({ message: `target "${targetName}": target.json "sounds" must be an array`, file: targetFile, severity: 'error' });
    }
    let costumeEntries: any[] = Array.isArray(targetJson.costumes) ? targetJson.costumes : [];
    if (deriveCostumes) {
        costumeEntries = [];
        for (const fname of await listAssetFiles(tdir, 'costumes')) {
            const file = `costumes/${fname}`;
            const ext = extOfFile(fname, 'svg');
            const stem = fname.includes('.') ? fname.slice(0, fname.lastIndexOf('.')) : fname;
            costumeEntries.push({ name: stem, file, _deriveExt: ext });
        }
        if (costumeEntries.length === 0) {
            diagnostics.push({ message: `target "${targetName}": no costumes found (add files under costumes/)`, file: targetFile, severity: 'warning' });
        }
    }
    let soundEntries: any[] = Array.isArray(targetJson.sounds) ? targetJson.sounds : [];
    if (deriveSounds) {
        soundEntries = [];
        for (const fname of await listAssetFiles(tdir, 'sounds')) {
            soundEntries.push({ name: fname.includes('.') ? fname.slice(0, fname.lastIndexOf('.')) : fname, file: `sounds/${fname}`, _deriveExt: extOfFile(fname, 'wav') });
        }
    }
    const files = new Map<string, Uint8Array>();
    for (const c of costumeEntries) {
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
        const ext = extOfFile(file, String((c as any)?._deriveExt ?? 'svg'));
        const md5ext = md5extFor(buf, ext);
        const { file: _f, _deriveExt: _d, ...rest } = c ?? {};
        void _f;
        void _d;
        // Derived entries fill rotation center from the image itself.
        let entry: any = { ...rest };
        if (deriveCostumes) {
            const size = probeImageSize(buf, ext);
            if (size) {
                entry.rotationCenterX = Math.round(size.w / 2);
                entry.rotationCenterY = Math.round(size.h / 2);
            } else {
                entry.rotationCenterX = 0;
                entry.rotationCenterY = 0;
                diagnostics.push({
                    message: `target "${targetName}": costume "${entry.name}": cannot determine image size; rotation center set to 0,0`,
                    file: targetFile,
                    severity: 'warning',
                });
            }
            if (entry.bitmapResolution === undefined) entry.bitmapResolution = ext === 'svg' ? 1 : 2;
        }
        decls.costumes.push({ ...entry, assetId: md5ext.slice(0, md5ext.lastIndexOf('.')), dataFormat: ext, md5ext });
        files.set(md5ext, buf);
    }
    for (const s of soundEntries) {
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
        const ext = extOfFile(file, String((s as any)?._deriveExt ?? 'wav'));
        const md5ext = md5extFor(buf, ext);
        const { file: _f, _deriveExt: _d, ...rest } = s ?? {};
        void _f;
        void _d;
        let entry: any = { ...rest };
        if (deriveSounds) {
            if (entry.format === undefined) entry.format = '';
            const info = ext === 'wav' ? probeWavInfo(buf) : null;
            if (entry.rate === undefined) entry.rate = info?.rate ?? 44100;
            if (entry.sampleCount === undefined) entry.sampleCount = info?.sampleCount ?? 0;
        }
        decls.sounds.push({ ...entry, assetId: md5ext.slice(0, md5ext.lastIndexOf('.')), dataFormat: ext, md5ext });
        files.set(md5ext, buf);
    }
    // Scalars: everything but the collections. Only NEW targets get
    // Scratch-like defaults (existing targets pass through verbatim, even
    // when keys are missing, so machine-made projects round-trip exactly).
    for (const [k, v] of Object.entries(targetJson)) {
        if (!['variables', 'lists', 'broadcasts', 'costumes', 'sounds'].includes(k)) decls.scalars[k] = v;
    }
    const isStage = (decls.scalars as any).isStage === true;
    if (opts.isNew === true && !isStage) {
        const d = decls.scalars as any;
        if (d.name === undefined) d.name = targetName;
        if (d.isStage === undefined) d.isStage = false;
        if (typeof d.x !== 'number') d.x = 0;
        if (typeof d.y !== 'number') d.y = 0;
        if (typeof d.size !== 'number') d.size = 100;
        if (typeof d.direction !== 'number') d.direction = 90;
        if (typeof d.visible !== 'boolean') d.visible = true;
        if (typeof d.draggable !== 'boolean') d.draggable = false;
        if (typeof d.rotationStyle !== 'string') d.rotationStyle = 'all around';
        if (typeof d.currentCostume !== 'number') d.currentCostume = 0;
        if (typeof d.volume !== 'number') d.volume = 100;
    }
    return { scripts: parsed.scripts, decls, files, targetJson };
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
    const stageTarget = (project?.targets ?? []).find((t: any) => t?.isStage === true);
    const stageJson = stageTarget ? splitTargetForUnpack(stageTarget).targetJson : undefined;
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
        await writeFile(join(tdir, scriptsFileName(format)), format.print(extracted.scripts, { targetName: String(target?.name), file, targetJson, isStage: target?.isStage === true, stageJson }));
    }
    await writeFile(join(outDir, '.agentwarp', 'anchors.json'), JSON.stringify(anchors, null, 2) + '\n');
    return { diagnostics };
}

/**
 * Rewrite the text dir in place from a project (no rm -rf): existing target
 * directories are matched by target.json `name` and reused, new targets get
 * new directories, removed targets have their directory deleted. Asset
 * files are rewritten; stale files are pruned only inside each target's own
 * `costumes/` and `sounds/` subdirs. `.agentwarp/format`,
 * `.agentwarp/serve.json`, and any non-target files are left alone.
 * `.agentwarp/base.json` is NOT written (unpackSb3 does that).
 *
 * Anchors stay stable: ids the previous anchors.json already knows keep
 * their old labels even when a human moved the scripts; genuinely new ids
 * get the next free numbers; deleted labels are never reused.
 */
export async function unpackInto(
    project: any,
    files: Map<string, Uint8Array>,
    outDir: string,
    format: Format,
    opts: UnpackIntoOptions = {},
): Promise<UnpackIntoResult> {
    const diagnostics: Diagnostic[] = [];
    await mkdir(join(outDir, '.agentwarp'), { recursive: true });
    let prevAnchors = opts.prevAnchors;
    if (!prevAnchors) {
        try {
            prevAnchors = JSON.parse(await readFile(join(outDir, '.agentwarp', 'anchors.json'), 'utf8'));
        } catch {
            prevAnchors = {};
        }
    }
    const existing = await scanTargetDirs(outDir);
    const taken = new Set<string>([...existing.values(), '.agentwarp', 'agentwarp.json']);
    const anchors: Record<string, Record<string, string>> = {};
    const wantedDirs = new Set<string>();
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
    const stageTarget = (project?.targets ?? []).find((t: any) => t?.isStage === true);
    const stageJson = stageTarget ? splitTargetForUnpack(stageTarget).targetJson : undefined;
    for (const target of project?.targets ?? []) {
        const name = String(target?.name ?? 'target');
        let dirName = existing.get(name);
        if (!dirName) dirName = targetDirName(name, taken);
        else taken.add(dirName);
        wantedDirs.add(dirName);
        const tdir = join(outDir, dirName);
        await mkdir(join(tdir, 'costumes'), { recursive: true });
        await mkdir(join(tdir, 'sounds'), { recursive: true });
        const { targetJson, assets } = splitTargetForUnpack(target);
        const wantedAssetFiles = new Set<string>();
        for (const a of assets) {
            wantedAssetFiles.add(a.file);
            const buf = files.get(a.md5ext);
            if (!buf) {
                diagnostics.push({ message: `target "${name}": asset file "${a.md5ext}" missing from zip`, severity: 'error' });
                continue;
            }
            await writeFile(join(tdir, a.file), buf);
        }
        // Prune stale files only inside this target's own asset dirs.
        for (const sub of ['costumes', 'sounds']) {
            let names: string[] = [];
            try {
                const ents = await readdir(join(tdir, sub), { withFileTypes: true });
                names = ents.filter((e) => e.isFile()).map((e) => e.name);
            } catch {
                continue;
            }
            for (const n of names) {
                if (!wantedAssetFiles.has(`${sub}/${n}`)) {
                    try {
                        await rm(join(tdir, sub, n));
                    } catch {
                        /* already gone */
                    }
                }
            }
        }
        await writeFile(join(tdir, TARGET_JSON), JSON.stringify(targetJson, null, 2) + '\n');
        // Remove a stale scripts file from a previous format, if any.
        try {
            for (const n of await readdir(tdir)) {
                if (n !== scriptsFileName(format) && n.startsWith('scripts.')) {
                    try {
                        await rm(join(tdir, n));
                    } catch {
                        /* ignore */
                    }
                }
            }
        } catch {
            /* ignore */
        }
        const file = `${dirName}/${scriptsFileName(format)}`;
        const extracted = extractTarget(target, project, { file });
        diagnostics.push(...extracted.diagnostics);
        const prev = (prevAnchors as Record<string, AnchorMap>)[name] ?? {};
        const stable = stabilizeAnchors(extracted.scripts, extracted.anchors, prev);
        anchors[name] = stable.anchors;
        await writeFile(
            join(tdir, scriptsFileName(format)),
            format.print(stable.scripts, { targetName: name, file, targetJson, isStage: target?.isStage === true, stageJson }),
        );
    }
    // Remove target dirs whose target is gone — but only when the dir still
    // parses as that deleted target (nameless/corrupt dirs and agent scratch
    // files are left alone).
    const liveNames = new Set((project?.targets ?? []).map((t: any) => String(t?.name ?? 'target')));
    for (const [, dirEntry] of existing) {
        if (wantedDirs.has(dirEntry)) continue;
        try {
            const tj = JSON.parse(await readFile(join(outDir, dirEntry, TARGET_JSON), 'utf8'));
            if (typeof tj?.name !== 'string' || liveNames.has(tj.name)) continue;
            await rm(join(outDir, dirEntry), { recursive: true, force: true });
        } catch {
            /* not a target dir (agent scratch files): leave alone */
        }
    }
    await writeFile(join(outDir, '.agentwarp', 'anchors.json'), JSON.stringify(anchors, null, 2) + '\n');
    return { diagnostics, anchors };
}

export async function unpackSb3(sb3Path: string, outDir: string, format: Format): Promise<{ diagnostics: Diagnostic[] }> {
    const { projectText, project, files } = await loadSb3File(sb3Path);
    const r = await unpackInto(project, files, outDir, format);
    await writeFile(join(outDir, '.agentwarp', 'base.json'), projectText);
    return { diagnostics: r.diagnostics };
}

/**
 * Pack the text dir against an arbitrary base project (the bridge's two
 * extra modes: the in-memory base, or the editor's project for merges).
 * packDir is a thin wrapper that reads .agentwarp/base.json and writes the
 * .sb3 + sourcemap, and persists minted ids back into target.json files.
 */
export async function packAgainst(dir: string, format: Format, opts: PackAgainstOptions): Promise<PackAgainstResult> {
    const { baseProject, baseText } = opts;
    const diagnostics: Diagnostic[] = [];
    let anchors: Record<string, Record<string, string>> = opts.anchors ?? {};
    if (!opts.anchors) {
        try {
            anchors = JSON.parse(await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'));
        } catch {
            anchors = {};
        }
    }
    const meta: AgentwarpJson = JSON.parse(await readFile(join(dir, 'agentwarp.json'), 'utf8'));
    const entries = (await readdir(dir)).filter((e) => e !== '.agentwarp' && e !== 'agentwarp.json');
    // Map directories to target names via their target.json.
    const usedIds = collectUsedIds(baseProject);
    const seenIds = new Set<string>();
    const seenDetail = new Map<string, { kind: string; name: string }>();
    const mintedIds: MintedId[] = [];
    const baseNames = new Set<string>((baseProject?.targets ?? []).map((t: any) => String(t?.name)));
    const perTarget: Record<string, { scripts: Script[]; anchors: Record<string, string> }> = {};
    const declsByTarget: Record<string, TargetDecls> = {};
    const dirOf: Record<string, string> = {}; // text target name -> dir entry
    const allFiles = new Map<string, Uint8Array>();
    const seenNames = new Set<string>();
    let stageJson: any = undefined;
    for (const e of entries) {
        try {
            const tj = JSON.parse(await readFile(join(dir, e, TARGET_JSON), 'utf8'));
            if (tj?.isStage === true) stageJson = tj;
        } catch {
            /* not a target dir */
        }
    }
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
        const r = await readTargetDir(tdir, name, format, diagnostics, stageJson, { usedIds, seenIds, seenDetail, mintedIds, isNew: !baseNames.has(name) });
        if (!r) continue;
        perTarget[name] = { scripts: r.scripts, anchors: anchors[name] ?? {} };
        declsByTarget[name] = r.decls;
        dirOf[name] = e;
        for (const [k, v] of r.files) {
            if (!allFiles.has(k)) allFiles.set(k, v);
        }
    }
    // layerOrder = next free slot for NEW sprites that don't declare one.
    // Existing targets pass through verbatim (even when the key is missing).
    {
        let maxLayer = -1;
        for (const t of baseProject?.targets ?? []) {
            if (typeof t?.layerOrder === 'number') maxLayer = Math.max(maxLayer, t.layerOrder);
        }
        for (const d of Object.values(declsByTarget)) {
            if (typeof (d.scalars as any).layerOrder === 'number') maxLayer = Math.max(maxLayer, (d.scalars as any).layerOrder);
        }
        for (const e of entries.sort()) {
            const name = Object.keys(dirOf).find((n) => dirOf[n] === e);
            if (!name || baseNames.has(name)) continue;
            const d = declsByTarget[name];
            if ((d.scalars as any).isStage === true) {
                if (typeof (d.scalars as any).layerOrder !== 'number') (d.scalars as any).layerOrder = 0;
            } else if (typeof (d.scalars as any).layerOrder !== 'number') {
                (d.scalars as any).layerOrder = ++maxLayer;
            }
        }
    }
    // Sprite renames (target.json `name` changed, directory may stay or go):
    // an extra text name whose anchors resolve into a missing base target's
    // ids is that target renamed. Re-key to the old name for reconcile (the
    // new name travels in scalars) and rewrite menu references everywhere.
    const renameNewToOld = new Map<string, string>(); // new -> old
    {
        const textNames = new Set(Object.keys(perTarget));
        const missingBase = [...baseNames].filter((n) => !textNames.has(n));
        const extraText = [...textNames].filter((n) => !baseNames.has(n));
        if (missingBase.length > 0 && extraText.length > 0) {
            const baseIds = new Map<string, Set<string>>();
            for (const t of baseProject?.targets ?? []) {
                baseIds.set(
                    String(t?.name),
                    new Set([...Object.keys(t?.blocks ?? {}), ...Object.keys(t?.comments ?? {})]),
                );
            }
            const claimedOld = new Set<string>();
            for (const n of extraText) {
                const labels = collectAnchorLabels(perTarget[n].scripts);
                let best: string | null = null;
                let bestScore = 0;
                for (const b of missingBase) {
                    if (claimedOld.has(b)) continue;
                    const am = anchors[b] ?? {};
                    const ids = baseIds.get(b) ?? new Set();
                    let score = 0;
                    for (const lab of labels) {
                        const id = am[lab];
                        if (id && ids.has(id)) score++;
                    }
                    if (score > bestScore) {
                        bestScore = score;
                        best = b;
                    }
                }
                if (best && bestScore > 0) {
                    renameNewToOld.set(n, best);
                    claimedOld.add(best);
                }
            }
        }
        for (const [n, b] of renameNewToOld) {
            perTarget[b] = { scripts: perTarget[n].scripts, anchors: anchors[b] ?? {} };
            declsByTarget[b] = declsByTarget[n];
            (declsByTarget[b].scalars as any).name = n;
            dirOf[b] = dirOf[n];
            delete perTarget[n];
            delete declsByTarget[n];
            delete dirOf[n];
            for (const per of Object.values(perTarget)) rewriteSpriteName(per.scripts, b, n);
        }
    }
    const reconciled = reconcileProject(baseProject, perTarget, declsByTarget, { file: undefined });
    diagnostics.push(...reconciled.diagnostics);
    // Top-level meta comparison (monitors/extensions/meta/extra).
    const baseTop = {
        meta: baseProject?.meta,
        extensions: baseProject?.extensions ?? [],
        monitors: baseProject?.monitors ?? [],
        extraTopLevel: Object.fromEntries(Object.entries(baseProject ?? {}).filter(([k]) => !KNOWN_TOP_LEVEL.has(k))),
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
    // Remap placements through renames (reconcile saw old names).
    const renameOldToNew = new Map([...renameNewToOld].map(([n, b]) => [b, n]));
    const placements = reconciled.placements.map((p) => ({
        ...p,
        target: renameOldToNew.get(p.target) ?? p.target,
    }));
    // Final placement of new scripts/comments with the real block-size model (existing ones stay fixed).
    for (const pl of placements) {
        if (!pl.newScriptIds.length && !pl.newCommentIds.length) continue;
        const target = project?.targets?.find((t: any) => t?.name === pl.target);
        if (!target) continue;
        const pos = placeNew(target, pl.newScriptIds, pl.newCommentIds);
        for (const [id, p] of pos.blocks) {
            const b = target.blocks?.[id];
            if (b && !Array.isArray(b)) { b.x = Math.round(p.x); b.y = Math.round(p.y); }
        }
        for (const [id, p] of pos.comments) {
            const c = target.comments?.[id];
            if (c) { c.x = Math.round(p.x); c.y = Math.round(p.y); }
        }
    }
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
    const projectText = changed ? JSON.stringify(project) : (baseText ?? JSON.stringify(baseProject));
    return { project, projectText, files: allFiles, diagnostics, placements, sourcemap: reconciled.sourcemap, changed, mintedIds };
}

export async function packDir(dir: string, outSb3Path: string, format: Format): Promise<PackResult> {
    const baseText = await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8');
    const base = JSON.parse(baseText);
    let anchors: Record<string, Record<string, string>> = {};
    try {
        anchors = JSON.parse(await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'));
    } catch {
        anchors = {};
    }
    const r = await packAgainst(dir, format, { baseProject: base, baseText, anchors });
    // Persist minted ids back into target.json (unpack prints them naturally).
    if (r.mintedIds.length > 0) {
        const byDir = new Map<string, MintedId[]>();
        for (const m of r.mintedIds) {
            const list = byDir.get(m.dir) ?? [];
            list.push(m);
            byDir.set(m.dir, list);
        }
        const kindKey: Record<MintedId['kind'], string> = { variable: 'variables', list: 'lists', broadcast: 'broadcasts' };
        for (const [dirEntry, list] of byDir) {
            const p = join(dir, dirEntry, TARGET_JSON);
            try {
                const tj = JSON.parse(await readFile(p, 'utf8'));
                for (const m of list) {
                    const arr = (tj as any)?.[kindKey[m.kind]];
                    if (Array.isArray(arr) && arr[m.index] && typeof arr[m.index] === 'object') arr[m.index].id = m.id;
                }
                await writeFile(p, JSON.stringify(tj, null, 2) + '\n');
            } catch {
                /* leave diagnostics from the pack; don't add new ones */
            }
        }
    }
    await saveSb3File(outSb3Path, r.projectText, r.files);
    await writeFile(join(dir, '.agentwarp', 'sourcemap.json'), JSON.stringify(r.sourcemap, null, 2) + '\n');
    return { diagnostics: r.diagnostics, placements: r.placements, changed: r.changed, mintedIds: r.mintedIds };
}
