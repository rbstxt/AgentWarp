/**
 * .sb3 zip in/out. JSZip with fixed entry dates for deterministic output;
 * content equality (project.json bytes + asset bytes) is what round-trip
 * tests assert — the zip container itself carries timestamps.
 */
import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';

// Fixed date so re-packing the same content yields identical bytes.
const FIXED_DATE = new Date('2020-01-01T00:00:00Z');

export interface Sb3Contents {
    /** Raw project.json bytes (preserved verbatim for byte-identical round trips). */
    projectText: string;
    project: any;
    /** filename -> bytes, excluding project.json. */
    files: Map<string, Uint8Array>;
}

export async function loadSb3Buffer(data: Uint8Array): Promise<Sb3Contents> {
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files).sort();
    const files = new Map<string, Uint8Array>();
    for (const name of names) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        files.set(name, await entry.async('uint8array'));
    }
    const raw = files.get('project.json');
    if (!raw) throw new Error('sb3 missing project.json');
    const projectText = Buffer.from(raw).toString('utf8');
    files.delete('project.json');
    return { projectText, project: JSON.parse(projectText), files };
}

export async function loadSb3File(path: string): Promise<Sb3Contents> {
    return loadSb3Buffer(await readFile(path));
}

export async function saveSb3File(path: string, projectText: string, files: Map<string, Uint8Array>): Promise<void> {
    const zip = new JSZip();
    zip.file('project.json', projectText, { date: FIXED_DATE, compression: 'DEFLATE' });
    const names = [...files.keys()].sort();
    for (const name of names) {
        if (name === 'project.json') continue;
        zip.file(name, files.get(name) as Uint8Array, { date: FIXED_DATE, compression: 'STORE' });
    }
    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    await writeFile(path, out);
}
