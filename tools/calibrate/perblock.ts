import {readSb3Json} from '../../packages/core/test/zip.ts';
// @ts-ignore
import {Measurer} from '../../packages/core/metrics.ts';
import {readFileSync} from 'node:fs';
// usage: perblock.ts <sb3> <target> <measured.json> [minErr]
const [sb3, targetName, probePath, minErr] = process.argv.slice(2);
const project = readSb3Json(sb3) as any;
const t = project.targets.find((x: any) => x.name === targetName);
const probeRaw = JSON.parse(readFileSync(probePath, 'utf8'));
// probe2.json is keyed by fixture filename; measured.json has .targets directly.
const probeKey = Object.keys(probeRaw).find(k => typeof k === 'string' && sb3.endsWith(k));
const probeData = probeKey ? probeRaw[probeKey] : probeRaw;
const target = probeData.targets.find((x: any) => x.name === targetName);
const pmap = new Map(target.blocks.map((b: any) => [b.id, b]));
const mz = new Measurer(t.blocks);
const thresh = Number(minErr ?? 0.5);
for (const [id, b] of Object.entries(t.blocks) as any[]) {
  const bb = b as any;
  if (!bb || Array.isArray(bb) || bb.parent !== null || !bb.topLevel) continue;
  const m = mz.measure(id as string, null);
  if (!m) continue;
  const walk = (n: any) => {
    if (!n) return;
    if (n.id) {
      const p = pmap.get(n.id) as any;
      if (p && Math.abs(n.ownW - p.ownW) > thresh)
        console.log(`${n.plan.opcode} ${(n.id as string).slice(0, 10)} mine=${n.ownW.toFixed(2)} exp=${p.ownW.toFixed(2)}`);
    }
    for (const c of n.kids.values()) walk(c);
    if (n.next) walk(n.next);
  };
  walk(m);
}
