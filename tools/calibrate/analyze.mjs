import {readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const dir='eval/calibration';
const names=(await readdir(dir)).filter(x=>x.endsWith('.measured.json')).map(x=>x.replace('.measured.json',''));
const all={width:[],height:[],dx:[],dy:[]}, rows=[], opcodes={};
const summary=a=>({count:a.length,mean:a.length?a.reduce((s,n)=>s+Math.abs(n),0)/a.length:null,max:a.length?Math.max(...a.map(Math.abs)):null});
for (const name of names) {
 const input=(await Promise.all(['eval/fixtures','tools/vmrun/test-fixtures'].map(async d=>{let p=`${d}/${name}.sb3`;try{await readFile(p);return p}catch{return null}}))).find(Boolean);
 if(!input) continue;
 const temp=`tools/calibrate/${name}.estimate.sb3`;
 const report=JSON.parse(execFileSync('node',['tools/vmrun/cli.mjs','layout',input,'--cleanup',temp],{encoding:'utf8',maxBuffer:100*1024*1024}));
 const cleanReport=JSON.parse(execFileSync('node',['tools/vmrun/cli.mjs','layout',temp],{encoding:'utf8',maxBuffer:100*1024*1024}));
 await rm(temp,{force:true});
 const measured=JSON.parse(await readFile(`${dir}/${name}.measured.json`));
 const cleaned=JSON.parse(await readFile(`${dir}/${name}.cleanup.json`));
 const values={width:[],height:[],dx:[],dy:[]}; let missing=0;
 for(let i=0;i<measured.targets.length;i++){
  const target=measured.targets[i], est=report.targets[target.name], estClean=cleanReport.targets[target.name];
  for(const b of target.scripts){
   const e=est?.scripts.find(x=>x.blockId===b.id), c=cleaned.targets[i].scripts.find(x=>x.id===b.id), ce=estClean?.scripts.find(x=>x.blockId===b.id);
   if(!e||!c||!ce){missing++;continue;}
   values.width.push(e.w-b.w); values.height.push(e.h-b.h); values.dx.push(ce.x-c.x); values.dy.push(ce.y-c.y);
  }
  for(const b of target.blocks){
   const o=opcodes[b.opcode]??={occurrences:0,terminalSamples:[],stackSamples:[]}; o.occurrences++;
   if(!b.next && o.terminalSamples.length<20)o.terminalSamples.push({w:b.w,h:b.h,fixture:name});
   if(!b.parent && o.stackSamples.length<20)o.stackSamples.push({w:b.w,h:b.h,fixture:name});
  }
 }
 for(const key of Object.keys(values))all[key].push(...values[key]);
 rows.push({fixture:name,missing,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,summary(v)]))});
}
await writeFile(`${dir}/comparison.json`,JSON.stringify({units:'workspace pixels',method:'absolute error; cleanup is vmrun minus editor',rows,total:Object.fromEntries(Object.entries(all).map(([k,v])=>[k,summary(v)]))},null,2)+'\n');
const renderProbes=await readFile(`${dir}/render-probes.json`,'utf8').then(JSON.parse).catch(()=>null);
await writeFile(`${dir}/block-metrics.json`,JSON.stringify({renderProbes,method:'Fixture observations from getHeightWidth(). A terminal sample has no next block but may contain inputs or nested substacks; stack samples include the complete stack. Values are not default-input or isolated-block metrics.',opcodes},null,2)+'\n');
console.log(JSON.stringify({rows,total:Object.fromEntries(Object.entries(all).map(([k,v])=>[k,summary(v)]))},null,2));
