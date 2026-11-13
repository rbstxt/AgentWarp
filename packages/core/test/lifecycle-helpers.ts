/**
 * Shared helpers for core lifecycle tests: tiny synthetic projects packed
 * through unpackInto/packAgainst with the ir-json format (fast, no tsc).
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packAgainst } from '../project-dir.ts';
import { md5extFor } from '../assets.ts';
import { irJson } from '../../../formats/ir-json/index.ts';

export { irJson };

let idCounter = 0;
/** Deterministic stand-in block ids (20 chars). */
export function nid(prefix = 'id'): string {
    idCounter++;
    const base = `${prefix}${String(idCounter).padStart(16, '0')}`;
    return base.slice(0, 20).padEnd(20, 'x');
}

export function resetIds(): void {
    idCounter = 0;
}

export const BACKDROP_SVG = '<svg width="480" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="360" fill="white"/></svg>';
export const CAT_SVG = '<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50" fill="red"/></svg>';

function stdBlock(opcode: string, extra: any = {}): any {
    return { opcode, next: null, parent: null, inputs: {}, fields: {}, shadow: false, ...extra };
}

/**
 * Minimal project: Stage (var Score, broadcast go, backdrop, one script
 * referencing Cat via a `go to` menu) + Cat (one script, one costume).
 */
export function tinyProject(): { project: any; files: Map<string, Uint8Array> } {
    resetIds();
    const stageTop = nid('stag-top');
    const catTop = nid('cat-top-');
    const catMove = nid('cat-move');
    const stageGoto = nid('stge-goto');
    const stageMenu = nid('stge-menu');
    const backdropMd5 = md5extFor(Buffer.from(BACKDROP_SVG), 'svg');
    const catMd5 = md5extFor(Buffer.from(CAT_SVG), 'svg');
    const files = new Map<string, Uint8Array>([
        [backdropMd5, Buffer.from(BACKDROP_SVG)],
        [catMd5, Buffer.from(CAT_SVG)],
    ]);
    const project = {
        targets: [
            {
                name: 'Stage',
                isStage: true,
                currentCostume: 0,
                volume: 100,
                layerOrder: 0,
                tempo: 60,
                videoTransparency: 50,
                videoState: 'on',
                textToSpeechLanguage: null,
                variables: { var1: ['Score', 0] },
                lists: {},
                broadcasts: { bc1: 'go' },
                costumes: [
                    {
                        assetId: backdropMd5.slice(0, backdropMd5.indexOf('.')),
                        name: 'backdrop1',
                        md5ext: backdropMd5,
                        dataFormat: 'svg',
                        rotationCenterX: 240,
                        rotationCenterY: 180,
                    },
                ],
                sounds: [],
                blocks: {
                    [stageTop]: {
                        ...stdBlock('event_whenflagclicked'),
                        topLevel: true,
                        x: 10,
                        y: 10,
                        next: stageGoto,
                    },
                    [stageGoto]: {
                        ...stdBlock('motion_goto'),
                        topLevel: false,
                        parent: stageTop,
                        inputs: { TO: [1, stageMenu] },
                    },
                    [stageMenu]: {
                        opcode: 'motion_goto_menu',
                        next: null,
                        parent: stageGoto,
                        inputs: {},
                        fields: { TO: ['Cat', null] },
                        shadow: true,
                        topLevel: false,
                    },
                },
                comments: {},
            },
            {
                name: 'Cat',
                isStage: false,
                currentCostume: 0,
                volume: 100,
                layerOrder: 1,
                visible: true,
                x: 0,
                y: 0,
                size: 100,
                direction: 90,
                draggable: false,
                rotationStyle: 'all around',
                variables: {},
                lists: { list1: ['things', ['a', 'b']] },
                broadcasts: {},
                costumes: [
                    {
                        assetId: catMd5.slice(0, catMd5.indexOf('.')),
                        name: 'cat',
                        md5ext: catMd5,
                        dataFormat: 'svg',
                        rotationCenterX: 50,
                        rotationCenterY: 25,
                    },
                ],
                sounds: [],
                blocks: {
                    [catTop]: {
                        ...stdBlock('event_whenflagclicked'),
                        topLevel: true,
                        x: 400,
                        y: 10,
                        next: catMove,
                    },
                    [catMove]: {
                        ...stdBlock('motion_movesteps'),
                        topLevel: false,
                        parent: catTop,
                        inputs: { STEPS: [1, [4, 10]] },
                    },
                },
                comments: {},
            },
        ],
        monitors: [],
        extensions: [],
        meta: { semver: '3.0.0', vm: '2.3.0', agent: 'me' },
    };
    return { project, files };
}

/** Fresh temp dir; caller runs unpackInto. */
export async function freshDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'aw-life-'));
}

export async function readJson(p: string): Promise<any> {
    return JSON.parse(await readFile(p, 'utf8'));
}

/** Pack the dir against its own base.json (like packDir but in-memory). */
export async function packSelf(dir: string): Promise<Awaited<ReturnType<typeof packAgainst>>> {
    const baseText = await readFile(join(dir, '.agentwarp', 'base.json'), 'utf8');
    const anchors = JSON.parse(await readFile(join(dir, '.agentwarp', 'anchors.json'), 'utf8'));
    return packAgainst(dir, irJson, { baseProject: JSON.parse(baseText), baseText, anchors });
}
