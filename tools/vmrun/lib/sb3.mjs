import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

/** Load an .sb3 from a Buffer. Returns {project, files: Map<filename, Buffer>}. */
export async function loadSb3FromBuffer(data) {
    const zip = await JSZip.loadAsync(data);
    const files = new Map();
    for (const name of Object.keys(zip.files)) {
        const entry = zip.files[name];
        if (!entry.dir) files.set(name, await entry.async('nodebuffer'));
    }
    const raw = files.get('project.json');
    if (!raw) throw new Error('sb3 missing project.json');
    return {project: JSON.parse(raw.toString('utf8')), files};
}

/** Load an .sb3 file. Returns {project, files: Map<filename, Buffer>}. */
export async function loadSb3(path) {
    return loadSb3FromBuffer(await readFile(path));
}

/** Pack {project, files} into an .sb3 at path. files: Map<filename, Buffer>. */
export async function saveSb3(path, project, files) {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(project));
    for (const [name, buf] of files) {
        if (name === 'project.json') continue;
        zip.file(name, buf);
    }
    const out = await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'});
    await writeFile(path, out);
}

export function md5(buf) {
    return createHash('md5').update(buf).digest('hex');
}

/** Asset descriptor of a costume/sound: {assetId, dataFormat, md5ext}. */
export function assetName(a) {
    if (a.md5ext) return a.md5ext;
    if (a.assetId && a.dataFormat) return `${a.assetId}.${a.dataFormat}`;
    return null;
}
