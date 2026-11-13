// Parse intrinsic costume dimensions from raw asset bytes.
// Used by the headless collision fallback (no renderer available).
// Returns {w, h} in Scratch units for SVG, or pixels for bitmaps,
// or null when the size cannot be determined.

export function svgDims(buf) {
    const s = buf.toString('utf8', 0, Math.min(buf.length, 65536));
    // viewBox="minX minY w h"
    let m = s.match(/viewBox\s*=\s*["']\s*[-\d.eE+]+\s+[-\d.eE+]+\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s*["']/);
    if (m) {
        const w = parseFloat(m[1]);
        const h = parseFloat(m[2]);
        if (w > 0 && h > 0) return {w, h};
    }
    // width="..." height="..." (ignore percentages)
    const w = s.match(/(?<![-\w])width\s*=\s*["']([\d.eE]+)(?:px)?["']/);
    const h = s.match(/(?<![-\w])height\s*=\s*["']([\d.eE]+)(?:px)?["']/);
    if (w && h) {
        const pw = parseFloat(w[1]);
        const ph = parseFloat(h[1]);
        if (pw > 0 && ph > 0) return {w: pw, h: ph};
    }
    return null;
}

export function pngDims(buf) {
    // IHDR width/height at bytes 16..24 (big-endian), PNG signature check
    if (buf.length < 26) return null;
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
    return {w: buf.readUInt32BE(16), h: buf.readUInt32BE(20)};
}

export function gifDims(buf) {
    if (buf.length < 10) return null;
    const sig = buf.toString('ascii', 0, 6);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
    return {w: buf.readUInt16LE(6), h: buf.readUInt16LE(8)};
}

export function bmpDims(buf) {
    if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
    return {w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22))};
}

export function jpegDims(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 8 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        // SOF markers (except DHT/DAC/DNL): C0-C3, C5-C7, C9-CB, CD-CF
        const isSOF = (marker >= 0xc0 && marker <= 0xcf) &&
            marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
            return {h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7)};
        }
        if (len < 2) break;
        i += 2 + len;
    }
    return null;
}

export function assetDims(buf, ext) {
    const e = (ext || '').toLowerCase();
    try {
        if (e === 'svg') return svgDims(buf);
        if (e === 'png') return pngDims(buf);
        if (e === 'gif') return gifDims(buf);
        if (e === 'bmp') return bmpDims(buf);
        if (e === 'jpg' || e === 'jpeg') return jpegDims(buf);
    } catch {
        return null;
    }
    return null;
}
