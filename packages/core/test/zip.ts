/**
 * Minimal ZIP reader (sb3 files are zips; project.json is deflated).
 * Only supports what we need: list entries + inflate a stored/deflated file.
 */
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';

export function readSb3Json(sb3Path: string, entry = 'project.json'): unknown {
    const buf = readFileSync(sb3Path);
    // Find End Of Central Directory.
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('no EOCD in ' + sb3Path);
    const count = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16);
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('bad central directory');
        const method = buf.readUInt16LE(ptr + 10);
        const compSize = buf.readUInt32LE(ptr + 24);
        const nameLen = buf.readUInt16LE(ptr + 28);
        const extraLen = buf.readUInt16LE(ptr + 30);
        const commentLen = buf.readUInt16LE(ptr + 32);
        const localOff = buf.readUInt32LE(ptr + 42);
        const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
        ptr += 46 + nameLen + extraLen + commentLen;
        if (name !== entry) continue;
        if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('bad local header');
        const ln = buf.readUInt16LE(localOff + 26);
        const le = buf.readUInt16LE(localOff + 28);
        const start = localOff + 30 + ln + le;
        const raw = buf.subarray(start, start + compSize);
        const text = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
        return JSON.parse(text);
    }
    throw new Error(`entry ${entry} not found in ${sb3Path}`);
}
