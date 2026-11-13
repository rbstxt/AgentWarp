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

/**
 * Best-effort image dimensions from raw bytes (used when a costume list is
 * derived from files: rotation center = image center). Supports PNG, GIF,
 * SVG (width/height attributes or viewBox). Null when unparseable.
 */
export function probeImageSize(buf: Uint8Array, ext: string): { w: number; h: number } | null {
    const e = ext.replace(/^\./, '').toLowerCase();
    try {
        if (e === 'png') {
            if (buf.length < 26) return null;
            if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
            const w = (buf[16] * 2 ** 24 + buf[17] * 2 ** 16 + buf[18] * 2 ** 8 + buf[19]) >>> 0;
            const h = (buf[20] * 2 ** 24 + buf[21] * 2 ** 16 + buf[22] * 2 ** 8 + buf[23]) >>> 0;
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
            return { w, h };
        }
        if (e === 'gif') {
            if (buf.length < 10) return null;
            const sig = String.fromCharCode(buf[0], buf[1], buf[2]);
            if (sig !== 'GIF') return null;
            const w = buf[6] + buf[7] * 256;
            const h = buf[8] + buf[9] * 256;
            if (w <= 0 || h <= 0) return null;
            return { w, h };
        }
        if (e === 'svg') {
            const text = Buffer.from(buf).toString('utf8', 0, Math.min(buf.length, 65536));
            const num = (s: string | undefined): number | null => {
                if (s === undefined) return null;
                const n = parseFloat(s);
                return Number.isFinite(n) && n > 0 ? n : null;
            };
            const wAttr = /<svg\b[^>]*?\bwidth\s*=\s*["']?([\d.]+)/i.exec(text)?.[1];
            const hAttr = /<svg\b[^>]*?\bheight\s*=\s*["']?([\d.]+)/i.exec(text)?.[1];
            const w = num(wAttr);
            const h = num(hAttr);
            if (w !== null && h !== null) return { w, h };
            const vb = /<svg\b[^>]*?\bviewBox\s*=\s*["']([^"']+)["']/i.exec(text)?.[1];
            if (vb) {
                const parts = vb.trim().split(/[\s,]+/).map(Number);
                if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
                    return { w: parts[2], h: parts[3] };
                }
            }
            return null;
        }
        if (e === 'jpg' || e === 'jpeg') {
            // Scan for a Start-Of-Frame marker (SOF0-SOF3, SOF5-SOF15).
            let i = 2;
            while (i + 8 < buf.length) {
                if (buf[i] !== 0xff) {
                    i++;
                    continue;
                }
                const m = buf[i + 1];
                if (m === 0xff) {
                    i++;
                    continue;
                }
                if (m === 0xd8 || (m >= 0xd0 && m <= 0xd9) || m === 0x01) {
                    i += 2;
                    continue;
                }
                const len = buf[i + 2] * 256 + buf[i + 3];
                if (len < 2) return null;
                if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xcf)) {
                    const h = buf[i + 5] * 256 + buf[i + 6];
                    const w = buf[i + 7] * 256 + buf[i + 8];
                    if (w > 0 && h > 0) return { w, h };
                    return null;
                }
                i += 2 + len;
            }
            return null;
        }
    } catch {
        return null;
    }
    return null;
}

/** Best-effort WAV sample rate + frame count from a RIFF header. Null when unparseable. */
export function probeWavInfo(buf: Uint8Array): { rate: number; sampleCount: number } | null {
    try {
        if (buf.length < 44) return null;
        const head = String.fromCharCode(...buf.slice(0, 4));
        const wave = String.fromCharCode(...buf.slice(8, 12));
        if (head !== 'RIFF' || wave !== 'WAVE') return null;
        let i = 12;
        let rate: number | null = null;
        let channels = 1;
        let bitsPerSample = 16;
        let dataBytes: number | null = null;
        const u16 = (o: number): number => buf[o] + buf[o + 1] * 256;
        const u32 = (o: number): number => buf[o] + buf[o + 1] * 256 + buf[o + 2] * 65536 + buf[o + 3] * 16777216;
        while (i + 8 <= buf.length) {
            const id = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
            const size = u32(i + 4);
            if (id === 'fmt ' && i + 8 + size <= buf.length + 1) {
                rate = u32(i + 12);
                channels = u16(i + 10);
                if (size >= 16) bitsPerSample = u16(i + 22);
            } else if (id === 'data') {
                dataBytes = Math.min(size, buf.length - (i + 8));
            }
            i += 8 + size + (size % 2);
        }
        if (rate === null || rate <= 0 || dataBytes === null) return null;
        const bytesPerFrame = Math.max(1, channels * Math.max(1, Math.round(bitsPerSample / 8)));
        return { rate, sampleCount: Math.floor(dataBytes / bytesPerFrame) };
    } catch {
        return null;
    }
}
