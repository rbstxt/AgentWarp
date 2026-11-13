import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Measure whole-string widths for every static label + static dropdown option,
// so metrics.ts can use exact widths instead of glyph sums. Writes
// packages/core/metrics/labels.json {label: width}.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const structure = JSON.parse(await readFile(path.join(root,'packages/core/metrics/structure.json'),'utf8'));
const catalog = JSON.parse(await readFile(path.join(root,'packages/core/catalog/blocks.json'),'utf8')).blocks;
const strings = new Set();
for (const op of Object.values(structure))
  for (const i of op.inputs)
    for (const f of i.fields)
      if (f.k === 'label') strings.add(f.t);
for (const b of Object.values(catalog))
  for (const f of b.fields ?? [])
    for (const [label] of f.options ?? []) strings.add(label);
// dropdown display uses nbsp; measure both variants when they differ
const list = [...strings];
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
  await page.goto(process.env.EDITOR_URL||'https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.ScratchBlocks?.getMainWorkspace(),{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  const widths = await page.evaluate((list)=>{
    const NS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('style','position:absolute;visibility:hidden');
    document.body.appendChild(svg);
    const t=document.createElementNS(NS,'text');
    t.setAttribute('class','blocklyText');
    svg.appendChild(t);
    const out={};
    for(const s of list){
      t.textContent=s; out[s]=t.getComputedTextLength();
      const nb=s.replace(/ /g,' ');
      if(nb!==s){ t.textContent=nb; out[nb]=t.getComputedTextLength(); }
    }
    svg.remove();
    return out;
  }, list);
  await writeFile(path.join(root,'packages/core/metrics/labels.json'),JSON.stringify(widths,null,1)+'\n');
  console.log('measured', Object.keys(widths).length, 'strings from', list.length, 'labels');
} finally { await browser.close(); }
