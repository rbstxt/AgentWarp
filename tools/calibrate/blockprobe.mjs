import {chromium} from 'playwright';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Deep dump of every rendered block+field in every fixture, for fitting metrics.ts.
// New file only; does not modify existing calibration outputs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sb3s = [];
for (const d of ['eval/fixtures', 'tools/vmrun/test-fixtures']) {
  let names = [];
  try { names = await readdir(path.join(root, d)); } catch {}
  for (const n of names) if (n.endsWith('.sb3')) sb3s.push(`${d}/${n}`);
}
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
  page.on('pageerror', e=>console.error('page error:', e.message));
  await page.goto(process.env.EDITOR_URL || 'https://turbowarp.org/editor', {waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(() => window.vm && window.ScratchBlocks?.getMainWorkspace(), {timeout:90000});
  const all = {};
  for (const f of sb3s) {
    console.error(f);
    await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),x=>x.charCodeAt(0)); await window.vm.loadProject(bytes.buffer);}, (await readFile(path.join(root,f))).toString('base64'));
    await page.waitForTimeout(800);
    const dumpFn = `(()=>{
      const w=ScratchBlocks.getMainWorkspace();
      const dumpBlock=b=>{
        const d=b.getHeightWidth();
        const inputs=b.inputList.map(inp=>{
          const conn=inp.connection;
          return {
            name:inp.name, type:inp.type,
            hasConnection:!!conn,
            connType:conn?conn.type:null,
            check:conn?(conn.check_??null):null,
            outputShape:conn?(conn.getOutputShape?conn.getOutputShape():null):null,
            connected:conn&&conn.targetBlock()?conn.targetBlock().type:null,
            renderWidth:inp.renderWidth, renderHeight:inp.renderHeight, fieldWidth:inp.fieldWidth,
            fields:inp.fieldRow.map(fl=>({
              ctor:fl.constructor.name, name:fl.name,
              text:fl.getText?fl.getText():fl.getValue?String(fl.getValue()):null,
              display:fl.getDisplayText_?fl.getDisplayText_():null,
              size:(()=>{try{const s=fl.getSize();return {w:s.width,h:s.height};}catch(e){return {error:String(e)}}})(),
              editable:fl.EDITABLE, hasBox:!!fl.box_, hasArrow:!!fl.positionArrow,
              arrowSize:fl.arrowSize_??null, className:fl.className_??null,
            })),
          };
        });
        return {
          id:b.id, type:b.type, isShadow:b.isShadow(),
          hasPrev:!!b.previousConnection, hasNext:!!b.nextConnection,
          hasOutput:!!b.outputConnection, outputShape:b.getOutputShape?b.getOutputShape():null,
          isExtension:!!b.isScratchExtension,
          startHat:!!b.startHat_, w:d.width, h:d.height,
          ownW:b.width, ownH:b.height,
          inputs,
        };
      };
      return w.getAllBlocks(false).map(dumpBlock);
    })()`;
    const ids = await page.evaluate(()=>vm.runtime.targets.filter(t=>t.isOriginal).map(t=>({id:t.id,name:t.getName()})));
    const targets = [];
    for (const t of ids) {
      await page.evaluate(id=>vm.setEditingTarget(id), t.id);
      await page.waitForTimeout(300);
      targets.push({name:t.name, blocks:await page.evaluate(dumpFn)});
    }
    all[path.basename(f)] = {targets};
  }
  await mkdir(path.join(root,'eval/calibration'),{recursive:true});
  await writeFile(path.join(root,'eval/calibration/probe2.json'),JSON.stringify(all,null,1)+'\n');
  console.log('wrote probe2.json with', Object.keys(all).length, 'fixtures');
} finally { await browser.close(); }
