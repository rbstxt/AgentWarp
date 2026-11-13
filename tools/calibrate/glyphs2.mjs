import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Measure glyph widths for chars missing from glyphs.json (CJK/symbols seen
// in fixtures). Merges into packages/core/metrics/glyphs.json under "extra".
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = process.argv[2] ?? '';
const CHARS = arg === '@file' ? await readFile('/tmp/missing.txt', 'utf8') : arg;
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
  await page.goto(process.env.EDITOR_URL||'https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.ScratchBlocks?.getMainWorkspace(),{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  const widths = await page.evaluate((chars)=>{
    const NS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('style','position:absolute;visibility:hidden');
    document.body.appendChild(svg);
    const t=document.createElementNS(NS,'text');
    t.setAttribute('class','blocklyText');
    svg.appendChild(t);
    const out={};
    for(const ch of chars) { t.textContent=ch; out[ch]=t.getComputedTextLength(); }
    // contextual checks for a few strings
    const ctx={};
    for(const s of ['おとはっめ','じゅげむ','🎥スタート']) { t.textContent=s; ctx[s]=t.getComputedTextLength(); }
    svg.remove();
    return {out,ctx};
  }, CHARS);
  const g = JSON.parse(await readFile(path.join(root,'packages/core/metrics/glyphs.json'),'utf8'));
  g.extra = {...(g.extra||{}), ...widths.out};
  await writeFile(path.join(root,'packages/core/metrics/glyphs.json'),JSON.stringify(g,null,1)+'\n');
  console.log('measured', Object.keys(widths.out).length, 'chars; ctx:', JSON.stringify(widths.ctx));
} finally { await browser.close(); }
