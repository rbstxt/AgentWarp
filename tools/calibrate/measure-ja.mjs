// Run against an already-open agent-browser session at editor?locale=ja.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
const dir=process.env.CALIBRATE_OUT || 'eval/calibration/ja'; mkdirSync(dir,{recursive:true});
const existing=readdirSync('eval/calibration/holdout').filter(f=>f.endsWith('.measured.json'));
const files=[...existing.map(f=>({name:f.replace('.measured.json',''),file:JSON.parse(readFileSync(`eval/calibration/holdout/${f}`)).fixture})),...readdirSync('eval/calibration').filter(f=>f.endsWith('.measured.json')).map(f=>({name:f.replace('.measured.json',''),file:JSON.parse(readFileSync(`eval/calibration/${f}`)).fixture}))];
function evalPage(code) {const result=JSON.parse(execFileSync('agent-browser',['--session','calibration-ja','eval','--stdin','--json'],{input:code,encoding:'utf8',maxBuffer:64*1024*1024})); if(!result.success) throw Error(JSON.stringify(result.error)); return result.data.result;}
for(const {name,file} of files) {
 if(process.env.CALIBRATE_ONLY && name !== process.env.CALIBRATE_ONLY) continue;
 if(!file || !file.endsWith('.sb3')) continue;
 if(process.env.RESUME && await import('node:fs').then(fs=>fs.existsSync(`${dir}/${name}.measured.json`))) continue;
 console.error(name,file);
 try {
 const source = file.includes('/') ? file : (name.includes('-') ? `eval/fixtures/${file}` : `tools/vmrun/test-fixtures/${file}`);
 const bytes=readFileSync(source).toString('base64');
 const load=`(async()=>{window.confirm=()=>false; const b=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)); await vm.loadProject(b.buffer); await new Promise(r=>setTimeout(r,800)); return vm.runtime.targets.filter(t=>t.isOriginal).map(t=>({id:t.id,name:t.getName(),isStage:t.isStage}));})()`;
 const targets=evalPage(load), phases={measured:[],cleanup:[]};
 for(const t of targets) {
 const result=evalPage(`(async()=>{vm.setEditingTarget(${JSON.stringify(t.id)}); await new Promise(r=>setTimeout(r,400)); const collect=()=>{const w=ScratchBlocks.getMainWorkspace(); const block=b=>{const p=b.getRelativeToSurfaceXY(),d=b.getHeightWidth(),r=b.getBoundingRectangle();return {id:b.id,opcode:b.type,x:p.x,y:p.y,w:d.width,h:d.height,rectangle:{topLeft:r.topLeft,bottomRight:r.bottomRight},next:b.getNextBlock()?.id||null,parent:b.getParent()?.id||null}}; const comments=[...new Set([...Object.values(w.commentDB_||{}),...w.getAllBlocks(false).map(b=>b.comment).filter(Boolean)])].map(c=>{const p=c.getRelativeToSurfaceXY?.()||c.getXY?.()||{};return {id:c.id,blockId:c.blockId_||c.block_?.id||null,x:p.x,y:p.y,width:c.getWidth?.()??c.width_,height:c.getHeight?.()??c.height_,minimized:c.isCollapsed?.()??c.isMinimized?.()??c.minimized_??null}});return {scripts:w.getTopBlocks(false).map(block),blocks:w.getAllBlocks(false).map(block),comments}};const measured=collect();wCleanup: {ScratchBlocks.getMainWorkspace().cleanUp()};await new Promise(r=>setTimeout(r,350));return {measured,cleanup:collect()}})()`);
 for(const p of ['measured','cleanup']) phases[p].push({...t,...result[p]});
 }
 for(const p of ['measured','cleanup']) writeFileSync(`${dir}/${name}.${p}.json`,JSON.stringify({fixture:source,editor:process.env.EDITOR_URL || 'https://turbowarp.org/editor?locale=ja',targets:phases[p]},null,2)+'\n');
 } catch(e){console.error('FAILED',name,e.message)}
}
