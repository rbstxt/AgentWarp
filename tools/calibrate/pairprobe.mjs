import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Measure whole widths for adjacent char pairs (in the editor label font) to
// derive kerning corrections: corr(pair) = width(pair) - (w1 + w2).
// Writes packages/core/metrics/pairs.json with entries |corr| > 0.2.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pairs = (await readFile('/tmp/pairs.txt', 'utf8')).split('\n').filter(s => s.length === 2);
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
  await page.goto(process.env.EDITOR_URL||'https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.ScratchBlocks?.getMainWorkspace(),{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  const widths = await page.evaluate((pairs)=>{
    const NS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('style','position:absolute;visibility:hidden');
    document.body.appendChild(svg);
    const t=document.createElementNS(NS,'text');
    t.setAttribute('class','blocklyText');
    svg.appendChild(t);
    const m=s=>{t.textContent=s;return t.getComputedTextLength();};
    const out={};
    for(const s of pairs) out[s]=m(s);
    svg.remove();
    return out;
  }, pairs);
  const g = JSON.parse(await readFile(path.join(root,'packages/core/metrics/glyphs.json'),'utf8'));
  const A=g.ascii, X=g.extra??{}, J=g.jp, L=g.latin??{};
  const w1 = (ch) => ch===' '||ch===' ' ? g.probes.space : (A[ch] ?? J[ch] ?? X[ch] ?? L[ch] ?? (ch.codePointAt(0) > 0x3000 ? g.avgJp : g.avgAscii));
  const corr = {};
  for(const p of pairs){
    const c = widths[p] - (w1(p[0]) + w1(p[1]));
    corr[p] = Math.round(c*1000000)/1000000;
  }
  await writeFile(path.join(root,'packages/core/metrics/pairs.json'),JSON.stringify(corr,null,1)+'\n');
  console.log('pairs measured:', pairs.length, 'kept:', Object.keys(corr).length);
} finally { await browser.close(); }
