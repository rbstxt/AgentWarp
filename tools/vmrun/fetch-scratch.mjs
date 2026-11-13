#!/usr/bin/env node
// Fetch a public Scratch project by ID and pack it as .sb3.
// Usage: node fetch-scratch.mjs <project-id> <out.sb3>
// Steps: api.scratch.mit.edu/projects/<id> -> project_token, then
// projects.scratch.mit.edu/<id>?token=... for project.json, then
// assets.scratch.mit.edu/internalapi/asset/<md5ext>/get/ per asset.

const [id, outPath] = process.argv.slice(2);
if (!id || !outPath) {
    console.error('usage: node fetch-scratch.mjs <project-id> <out.sb3>');
    process.exit(2);
}

async function get(url, kind) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${kind} fetch failed: ${res.status} ${url}`);
    return res;
}

const meta = await (await get(`https://api.scratch.mit.edu/projects/${id}`, 'meta')).json();
console.log(`#${id}: "${meta.title}" by ${meta.author?.username}`);
const token = meta.project_token;
if (!token) throw new Error('no project_token (project may be unshared)');

const projRes = await get(`https://projects.scratch.mit.edu/${id}?token=${token}`, 'project');
const project = await projRes.json();

const {default: JSZip} = await import('jszip');
const zip = new JSZip();
zip.file('project.json', JSON.stringify(project));

const assets = new Map();
for (const t of project.targets ?? []) {
    for (const c of [...(t.costumes ?? []), ...(t.sounds ?? [])]) {
        const md5ext = c.md5ext ?? (c.assetId && c.dataFormat ? `${c.assetId}.${c.dataFormat}` : null);
        if (md5ext) assets.set(md5ext, c.name);
    }
}
console.log(`${project.targets?.length} targets, ${assets.size} assets`);
let i = 0;
for (const md5ext of assets.keys()) {
    const res = await get(`https://assets.scratch.mit.edu/internalapi/asset/${md5ext}/get/`, 'asset');
    const buf = Buffer.from(await res.arrayBuffer());
    zip.file(md5ext, buf);
    if (++i % 20 === 0) console.log(`  ${i}/${assets.size} assets`);
}
// meta sidecar (not part of sb3)
const {writeFileSync} = await import('node:fs');
const sb3 = await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'});
writeFileSync(outPath, sb3);
console.log(`wrote ${outPath} (${(sb3.length / 1024).toFixed(0)} KB)`);
console.log(JSON.stringify({
    id: Number(id), title: meta.title, author: meta.author?.username,
    instructions: (meta.instructions ?? '').slice(0, 200),
    description: (meta.description ?? '').slice(0, 200),
}, null, 2));
