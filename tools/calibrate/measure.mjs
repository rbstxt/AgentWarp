import {chromium} from 'playwright';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = process.argv[2];
if (!file) throw Error('Usage: node tools/calibrate/measure.mjs <sb3>');
const name = path.basename(file, '.sb3');
const out = path.join(root, 'eval/calibration');
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
try {
 const page = await browser.newPage({viewport:{width:1440,height:900}, locale:'en-US'});
 page.on('pageerror', e=>console.error('page error:', e.message));
 await page.goto(process.env.EDITOR_URL || 'https://turbowarp.org/editor', {waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(() => window.vm && window.ScratchBlocks?.getMainWorkspace(), {timeout:90000});
 await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),x=>x.charCodeAt(0)); await window.vm.loadProject(bytes.buffer);}, (await readFile(file)).toString('base64'));
 await page.waitForTimeout(1000);
 const targets=await page.evaluate(()=>vm.runtime.targets.filter(t=>t.isOriginal).map(t=>({id:t.id,name:t.getName(),isStage:t.isStage})));
 const phases={measured:[],cleanup:[]};
 for (const t of targets) {
  console.error(name, t.name);
  await page.evaluate(id=>vm.setEditingTarget(id),t.id);
  await page.waitForTimeout(350);
  const collect=()=>{
   const w=ScratchBlocks.getMainWorkspace();
   const block=b=>{const p=b.getRelativeToSurfaceXY(),d=b.getHeightWidth(),r=b.getBoundingRectangle(); return {id:b.id,opcode:b.type,x:p.x,y:p.y,w:d.width,h:d.height,rectangle:{topLeft:r.topLeft,bottomRight:r.bottomRight},next:b.getNextBlock()?.id||null,parent:b.getParent()?.id||null};};
   const allComments=[...Object.values(w.commentDB_||{}), ...w.getAllBlocks(false).map(b=>b.comment).filter(Boolean)];
   const comments=[...new Set(allComments)].map(c=>{const p=c.getRelativeToSurfaceXY?.()||c.getXY?.()||{};return {id:c.id,blockId:c.blockId_||c.block_?.id||null,x:p.x,y:p.y,width:c.getWidth?.()??c.width_,height:c.getHeight?.()??c.height_,minimized:c.isCollapsed?.()??c.isMinimized?.()??c.minimized_??null};});
   return {scripts:w.getTopBlocks(false).map(block), blocks:w.getAllBlocks(false).map(block),comments};
  };
  phases.measured.push({...t,...await page.evaluate(collect)});
  await page.evaluate(()=>ScratchBlocks.getMainWorkspace().cleanUp());
  await page.waitForTimeout(350);
  phases.cleanup.push({...t,...await page.evaluate(collect)});
 }
 for(const phase of Object.keys(phases)) await writeFile(path.join(out,`${name}.${phase}.json`),JSON.stringify({fixture:path.basename(file),editor:page.url(),targets:phases[phase]},null,2)+'\n');
 const bytes=await page.evaluate(async()=>{const b=await vm.saveProjectSb3();const a=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s)});
 await writeFile(path.join(out,`${name}.cleanup.sb3`),Buffer.from(bytes,'base64'));
} finally { await browser.close(); }
