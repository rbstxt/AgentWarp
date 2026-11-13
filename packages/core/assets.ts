/**
 * Costume/sound file bytes <-> md5ext, never re-encoded.
 * Asset bytes in the directory are the ORIGINAL bytes; packs hash them.
 */
import { createHash } from 'node:crypto';

export function md5(buf: Uint8Array): string {
    return createHash('md5').update(buf).digest('hex');
}

/** "abc123.svg" -> { assetId: "abc123", dataFormat: "svg" }. Null when unparseable. */
export function parseMd5ext(md5ext: string): { assetId: string; dataFormat: string } | null {
    const dot = md5ext.lastIndexOf('.');
    if (dot <= 0) return null;
    const assetId = md5ext.slice(0, dot);
    const dataFormat = md5ext.slice(dot + 1);
    if (!/^[0-9a-f]{32}$/.test(assetId) || !/^[a-z0-9]+$/i.test(dataFormat)) return null;
    return { assetId, dataFormat };
}

/** Hash content bytes into a conventional md5ext name with the given extension. */
export function md5extFor(buf: Uint8Array, ext: string): string {
    const clean = ext.replace(/^\./, '').toLowerCase();
    return `${md5(buf)}.${clean}`;
}

/**
 * Asset file name for a costume/sound inside its target directory.
 * `<sanitized name>.<dataFormat>`, e.g. `costumes/backdrop1.svg`.
 */
export function assetFileName(kind: 'costumes' | 'sounds', name: string, dataFormat: string): string {
    return `${kind}/${sanitizeFileStem(name)}.${dataFormat}`;
}

const RESERVED = new Set(['.', '..']);

/** Sanitize one path segment: keep Unicode, strip only / \ NUL and leading dots. */
export function sanitizeSegment(name: string): string {
    let s = name.replace(/[/\\\0]/g, '_');
    s = s.replace(/^\.+/, (m) => '_'.repeat(m.length));
    if (s === '' || RESERVED.has(s)) s = '_';
    return s;
}

export function sanitizeFileStem(name: string): string {
    return sanitizeSegment(name);
}
