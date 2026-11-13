import {chromium} from '../client/node_modules/playwright/index.mjs';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {spawn, execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../../..');
const dir=await mkdtemp(join(tmpdir(),'agentwarp-e2e-')); const screens=join(here,'screens');
await mkdir(screens,{recursive:true});
const file=join(dir,'player/scripts.ts'); let server,browser,page;
const waitFor=async(fn,ms=2000)=>{let end=Date.now()+ms; while(Date.now()<end){if(await fn())return; await new Promise(r=>setTimeout(r,40));} throw Error('timed out after '+ms+'ms');};
try {
 execFileSync(join(root,'bin/agentwarp'),['unpack',join(root,'eval/fixtures/scrolltutorial-378587848.sb3'),dir,'--format','ts']);
 server=spawn(join(root,'bin/agentwarp'),['serve',dir],{stdio:['ignore','pipe','pipe']}); server.stderr.on('data',b=>process.stderr.write(b));
 await waitFor(async()=>{try{return !!JSON.parse(await readFile(join(dir,'.agentwarp/serve.json'),'utf8')).port}catch{return false}},10000);
 const {port,token}=JSON.parse(await readFile(join(dir,'.agentwarp/serve.json'),'utf8'));
 browser=await chromium.launch({headless:process.env.HEADED!=='1',args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1440,height:900},permissions:['local-network-access']});
 page.on('console',m=>{if(m.type()==='error')console.error('browser:',m.text())});
 await page.goto('https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.vm&&window.ScratchBlocks?.getMainWorkspace(),null,{timeout:60000});
 await page.evaluate(({port,token})=>window.AGENTWARP={url:`http://127.0.0.1:${port}`,token},{port,token});
 await page.addScriptTag({path:join(root,'packages/bridge/client/agentwarp-client.js')});
 await page.waitForFunction(()=>window.__agentwarpClient?.rev===0&&!window.__agentwarpClient.loading,null,{timeout:20000});
 const before=await page.evaluate(()=>{const t=vm.runtime.targets.find(t=>t.isOriginal&&t.getName()==='player');vm.setEditingTarget(t.id);const w=ScratchBlocks.getMainWorkspace();w.setScale(.8);w.scrollbar.set(100,80);return {target:t.getName(),x:w.scrollX,y:w.scrollY,scale:w.scale}});
 let source=await readFile(file,'utf8'); source=source.replace('vars["speed y"], "17"','vars["speed y"], "19"')+'\nscript(() => {\n  // Integration comment\n  moveSteps("10");\n});\n';
 let start=Date.now(); await writeFile(file,source);
 await page.waitForFunction(()=>Object.values(vm.editingTarget?.blocks?._blocks || {}).some(b=>b.opcode==='motion_movesteps' && b.topLevel),null,{timeout:2000});
 console.log('agent edit visible in',Date.now()-start,'ms');
 const after=await page.evaluate(()=>{const w=ScratchBlocks.getMainWorkspace();return {target:vm.editingTarget.getName(),x:w.scrollX,y:w.scrollY,scale:w.scale}});assert.equal(after.target,before.target); assert.equal(after.scale,before.scale); assert.ok(Math.abs(after.x-before.x)<1 && Math.abs(after.y-before.y)<1);
 await page.waitForFunction(()=>!window.__agentwarpClient.loading);
 const info=await page.evaluate(()=>{const w=ScratchBlocks.getMainWorkspace();const b=w.getAllBlocks().find(b=>b.type==='motion_movesteps' && b.getInputTargetBlock('STEPS')?.getFieldValue('NUM')==='10');w.centerOnBlock(b.id);return {id:b.id,xy:b.getRelativeToSurfaceXY()}});
 await page.waitForTimeout(300); await page.screenshot({path:join(screens,'web-agent.png')});
 const oldAnchors=JSON.parse(await readFile(join(dir,'.agentwarp/anchors.json'),'utf8')); const oldBase=JSON.parse(await readFile(join(dir,'.agentwarp/base.json'),'utf8'));
 let box=await page.evaluate(id=>{const r=ScratchBlocks.getMainWorkspace().getBlockById(id).getSvgRoot().getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}},info.id);
 console.log('block',info,box);
 start=Date.now(); await page.mouse.move(box.x+20,box.y+10); await page.mouse.down(); await page.mouse.move(box.x+85,box.y+50,{steps:8}); await page.mouse.up();
 await waitFor(async()=>{const b=JSON.parse(await readFile(join(dir,'.agentwarp/base.json'),'utf8'));const t=b.targets.find(t=>t.name==='player');return t.blocks[info.id]?.x!==oldBase.targets.find(t=>t.name==='player').blocks[info.id]?.x},2000);
 console.log('drag persisted in',Date.now()-start,'ms'); assert.deepEqual(JSON.parse(await readFile(join(dir,'.agentwarp/anchors.json'),'utf8')).player,oldAnchors.player);
 await page.screenshot({path:join(screens,'web-drag.png')});
 // Edit the numeric shadow through Blockly's actual input widget.
 async function editNumber(value) {
   const rect=await page.evaluate(id=>{const b=ScratchBlocks.getMainWorkspace().getBlockById(id); const field=b.getInputTargetBlock('STEPS').getField('NUM'); const r=field.getSvgRoot().getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}},info.id);
   await page.mouse.click(rect.x,rect.y); const input=page.locator('input.blocklyHtmlInput'); await input.waitFor({state:'visible'}); await input.fill(value); await input.press('Enter');
 }
 start=Date.now(); await editNumber('42'); await waitFor(async()=> (await readFile(file,'utf8')).includes('moveSteps("42")'),2000); console.log('number persisted in',Date.now()-start,'ms');
 await page.screenshot({path:join(screens,'web-human.png')});
 // A human edit remains pending while the agent edits another existing script.
 await editNumber('43'); source=await readFile(file,'utf8'); assert.ok(source.includes('vars["speed y"], "19"')); start=Date.now(); await writeFile(file,source.replace('vars["speed y"], "19"','vars["speed y"], "21"'));
 await waitFor(async()=>{const s=await readFile(file,'utf8'); return s.includes('moveSteps("43")')&&s.includes('vars["speed y"], "21"')},5000);
 await page.waitForFunction(()=>!window.__agentwarpClient.loading && window.__agentwarpClient.status==='connected',null,{timeout:5000});
 assert.equal(await page.evaluate(id=>ScratchBlocks.getMainWorkspace().getBlockById(id)?.getInputTargetBlock('STEPS')?.getFieldValue('NUM'),info.id),'43');
 await page.waitForFunction(()=>JSON.stringify(vm.editingTarget?.blocks?._blocks || {}).includes('21'),null,{timeout:5000});
 console.log('concurrent changes survived in',Date.now()-start,'ms'); await page.screenshot({path:join(screens,'web-concurrent.png')});
 source=await readFile(file,'utf8'); const rev=await page.evaluate(()=>window.__agentwarpClient.rev); await writeFile(file,source+'\nconst = ;\n');
 await page.waitForFunction(()=>window.__agentwarpClient.status==='error' && /player\/scripts\.ts:\d+/.test(window.__agentwarpClient.diagnostics),null,{timeout:3000});
 assert.equal(await page.evaluate(()=>window.__agentwarpClient.rev),rev); await page.screenshot({path:join(screens,'web-error.png')});
 await writeFile(file,source); await page.waitForFunction(()=>window.__agentwarpClient.status==='connected',null,{timeout:3000});
 console.log('PASS agent edit, real drag and number edit, concurrency, diagnostics and recovery');
} catch(e){console.error(e);if(page)await page.screenshot({path:join(screens,'failure.png')}).catch(()=>{});process.exitCode=1}
finally{await browser?.close();server?.kill();await rm(dir,{recursive:true,force:true});}
