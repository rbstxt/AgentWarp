import {readFileSync, readdirSync} from 'node:fs';
import {readSb3Json} from '../../packages/core/test/zip.ts';
import {measureScript} from '../../packages/core/metrics.ts';
import catalog from '../../packages/core/catalog/blocks.json' with {type:'json'};
const locale = process.env.CALIBRATE_LOCALE === 'ja' ? 'ja' : 'en';
const dir=locale === 'ja' ? 'eval/calibration/ja' : 'eval/calibration/holdout';
const rows: any[]=[]; const missing: string[]=[]; const invalid: string[]=[]; const quirks: string[]=[];
for (const file of readdirSync(dir).filter(f=>f.endsWith('.measured.json') && (locale === 'en' || f === 'allblocks.measured.json' || /^(agentic-scratch|goboscript|hikkaku|raw-json)-L[1-6]\.measured\.json$/.test(f)))) {
 const data=JSON.parse(readFileSync(`${dir}/${file}`,'utf8'));
 const project=readSb3Json(data.fixture) as any;
 for (const target of data.targets) {
  const orig=project.targets.find((t:any)=>t.name===target.name);
  if (!orig) { missing.push(`${file} target ${target.name}`); continue; }
  const returned = new Set(target.scripts.map((s:any) => s.id));
  for (const [id, block] of Object.entries(orig.blocks) as Array<[string, any]>) {
   if (!Array.isArray(block) && block?.topLevel && block.parent == null && !returned.has(id)) {
    const description = `${file} ${target.name} ${id}: root absent from editor`;
    if (file === 'raw-json-L6.measured.json' && target.name === 'player' && id === 'Yt{7~R5HQLmO$dUww)Gx') quirks.push(description);
    else missing.push(description);
   }
  }
  for (const s of target.scripts) {
   const b=orig.blocks[s.id];
   if (!b || Array.isArray(b)) { missing.push(`${file} ${target.name} ${s.id} ${s.opcode}`); continue; }
   if (b.parent != null || !b.topLevel) { invalid.push(`${file} ${target.name} ${s.id} ${s.opcode}: editor returned non-root`); continue; }
   if (!(s.w > 0 && s.h > 0)) { invalid.push(`${file} ${target.name} ${s.id} ${s.opcode}: editor returned zero size`); continue; }
   const m=measureScript(orig.blocks,s.id,{locale}); const spec=(catalog.blocks as any)[s.opcode];
   rows.push({file,target:target.name,id:s.id,opcode:s.opcode,category:spec?.category??'unknown',widthError:Math.abs(m.width-s.w),heightError:Math.abs(m.height-s.h),actual:[s.w,s.h],predicted:[m.width,m.height]});
  }
 }
}
const summarize=(a:any[])=>({n:a.length,heightExact:a.filter(x=>x.heightError<.005).length, widthMean:a.reduce((s,x)=>s+x.widthError,0)/a.length,widthMax:Math.max(0,...a.map(x=>x.widthError))});
const categories=Object.fromEntries([...new Set(rows.map(x=>x.category))].sort().map(c=>[c,summarize(rows.filter(x=>x.category===c))]));
const report={total:summarize(rows),categories,missing,invalid,quirks,worst:rows.sort((a,b)=>Math.max(b.heightError,b.widthError)-Math.max(a.heightError,a.widthError)).slice(0,20)};
console.log(JSON.stringify(report,null,2));
