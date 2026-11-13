import {chromium} from 'playwright';
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Measure per-character SVG text widths under the exact editor label font,
// plus CJK samples. Writes packages/core/metrics/glyphs.json.
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
  await page.goto(process.env.EDITOR_URL||'https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.ScratchBlocks?.getMainWorkspace(),{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  const result = await page.evaluate(()=>{
    const NS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('style','position:absolute;visibility:hidden');
    document.body.appendChild(svg);
    const t=document.createElementNS(NS,'text');
    t.setAttribute('class','blocklyText');
    svg.appendChild(t);
    const font=getComputedStyle(t).font;
    const measure=s=>{t.textContent=s;return t.getComputedTextLength();};
    const widths={};
    // ASCII printable
    for(let c=32;c<127;c++) widths[String.fromCharCode(c)]=measure(String.fromCharCode(c));
    // Latin-1 supplement commonly seen
    for(const s of ['é','è','ê','ü','ö','ä','ß','ñ','°','©','×','÷','−','’','“','”','…','★','→','•']) widths[s]=measure(s);
    // Japanese: hiragana/katakana/kanji + fullwidth digits/punct
    const jp='あいうえおかきくけこさしすせそたちつてとなにぬねのアイウエオカキクケコサシスセソたちツテト0123456789０１２３　、。！？「」〜ー・ィュョッャュョんン日本語歩動クローン';
    const jpWidths={};
    for(const ch of jp) jpWidths[ch]=measure(ch);
    const cjkSamples={
      hiragana:'あいうえお',
      katakana:'アイウエオ',
      kanji:'日本語歩動',
      hangul:'한글테스트',
      hanzi:'中文测试走',
      fullwidth:'０１２３',
    };
    const cjk={};
    for(const [k,s] of Object.entries(cjkSamples)) cjk[k]={text:s,width:measure(s),perChar:measure(s)/[...s].length};
    const out={font,ascii:{},latin:{},jp:jpWidths,cjk,
      probes:{
        space:measure('a a')-measure('aa'),
        digit0:measure('0'), i:measure('i'), W:measure('W'),
        helloWorld:measure('hello world'), move:measure('move'),
        tenI:measure('iiiiiiiiii'), tenW:measure('WWWWWWWWWW'),
      }};
    for(let c=32;c<127;c++) out.ascii[String.fromCharCode(c)]=widths[String.fromCharCode(c)];
    for(const s of ['é','è','ê','ü','ö','ä','ß','ñ','°','©','×','÷','−','’','“','”','…','★','→','•']) out.latin[s]=widths[s];
    svg.remove();
    return out;
  });
  // aggregate
  const ascVals=Object.values(result.ascii);
  const jpVals=Object.values(result.jp);
  const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
  let prev={};
  try { prev=JSON.parse(await readFile(path.join(root,'packages/core/metrics/glyphs.json'),'utf8')); } catch {}
  const doc={
    extra: prev.extra ?? {},
    font:result.font,
    note:'SVG getComputedTextLength per char, class blocklyText, TurboWarp editor 2026-11-13. Model sums per-char widths.',
    ascii:result.ascii, latin:result.latin, jp:result.jp, cjk:result.cjk, probes:result.probes,
    avgAscii:avg(ascVals),
    avgJp:avg(jpVals),
  };
  await mkdir(path.join(root,'packages/core/metrics'),{recursive:true});
  await writeFile(path.join(root,'packages/core/metrics/glyphs.json'),JSON.stringify(doc,null,1)+'\n');
  console.log('font:',result.font,'avgAscii:',doc.avgAscii.toFixed(3),'avgJp:',doc.avgJp.toFixed(3));
} finally { await browser.close(); }
