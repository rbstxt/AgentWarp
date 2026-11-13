import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Audit every glyph-table char in the REAL in-block context (variable getter
// field) and report entries that disagree with the detached table.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const g = JSON.parse(await readFile(path.join(root,'packages/core/metrics/glyphs.json'),'utf8'));
const chars = [...Object.keys(g.ascii), ...Object.keys(g.jp), ...Object.keys(g.extra ?? {})];
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
  await page.goto(process.env.EDITOR_URL||'https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.ScratchBlocks?.getMainWorkspace(),{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  const got = await page.evaluate((chars)=>{
    const B=ScratchBlocks,w=B.getMainWorkspace(); B.Events.disable();
    const out={};
    try{
     const b=w.newBlock('data_variable'); b.initSvg();
     const v=w.createVariable('x','',B.utils.genUid());
     b.setFieldValue(v.getId(),'VARIABLE');
     b.render();
     const te=[...b.inputList[0].fieldRow[0].getSvgRoot().querySelectorAll('text')][0];
     for(const s of chars){ te.textContent='a'+s+'a'; out[s]=te.getComputedTextLength(); }
     b.dispose();
    }finally{B.Events.enable();}
    return out;
  }, chars);
  // in-context width of char s = width('a'+s+'a') - width('aaa')... need baseline
  const base = await page.evaluate(()=>{
    const B=ScratchBlocks,w=B.getMainWorkspace(); B.Events.disable();
    let r=0;
    try{
     const b=w.newBlock('data_variable'); b.initSvg();
     const v=w.createVariable('x','',B.utils.genUid());
     b.setFieldValue(v.getId(),'VARIABLE');
     b.render();
     const te=[...b.inputList[0].fieldRow[0].getSvgRoot().querySelectorAll('text')][0];
     te.textContent='aaa'; r=te.getComputedTextLength();
     b.dispose();
    }finally{B.Events.enable();}
    return r;
  });
  const A=g.ascii;
  const rows=[];
  for(const s of chars){
    const table = A[s] ?? g.jp[s] ?? g.extra[s];
    // estimate in-block single width via sandwich (kerning with 'a' both sides may bias; report anyway)
    const sandwich = got[s] - base + 2*8.90625 - 8.90625; // rough
    void sandwich;
    rows.push({s, table, ctxTriple: got[s], base});
  }
  await writeFile('/tmp/glyph-audit.json', JSON.stringify({base, got}, null, 1));
  console.log('base aaa =', base);
  for(const r of rows){
    if(Math.abs(r.ctxTriple - base) < 0.001) continue;
  }
  // print chars whose triple differs most from base+table (rough in-context estimate)
  const est = rows.map(r=>({s:r.s, table:r.table, inctx: r.ctxTriple - base + 8.90625, diff: (r.ctxTriple - base + 8.90625) - r.table}));
  est.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
  console.log(est.slice(0,30).map(e=>JSON.stringify(e)).join('\n'));
} finally { await browser.close(); }
