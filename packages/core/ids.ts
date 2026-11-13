/**
 * Scratch-style block/comment ids: 20 chars from Scratch's uid() alphabet.
 * (scratch-vm src/util/uid.js)
 */
import { randomBytes } from 'node:crypto';

const SOUP =
    '!#%()*+,-./:;=?@[]^_`{|}~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const ID_LENGTH = 20;

export function makeId(used?: Set<string>): string {
    for (;;) {
        const bytes = randomBytes(ID_LENGTH);
        let id = '';
        for (let i = 0; i < ID_LENGTH; i++) id += SOUP[bytes[i] % SOUP.length];
        if (!used || !used.has(id)) return id;
    }
}

/** Collect every block/comment/variable/list/broadcast id in a project. */
export function collectUsedIds(project: any): Set<string> {
    const used = new Set<string>();
    for (const t of project?.targets ?? []) {
        for (const id of Object.keys(t?.blocks ?? {})) used.add(id);
        for (const id of Object.keys(t?.comments ?? {})) used.add(id);
        for (const id of Object.keys(t?.variables ?? {})) used.add(id);
        for (const id of Object.keys(t?.lists ?? {})) used.add(id);
        for (const id of Object.keys(t?.broadcasts ?? {})) used.add(id);
        for (const c of t?.costumes ?? []) {
            if (typeof c?.assetId === 'string') used.add(c.assetId);
        }
        for (const s of t?.sounds ?? []) {
            if (typeof s?.assetId === 'string') used.add(s.assetId);
        }
    }
    for (const m of project?.monitors ?? []) {
        if (typeof m?.id === 'string') used.add(m.id);
    }
    return used;
}
