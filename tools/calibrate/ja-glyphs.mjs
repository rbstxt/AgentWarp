import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync('packages/core/catalog/blocks.json','utf8'));
const existing=JSON.parse(readFileSync('packages/core/metrics/glyphs.json','utf8'));
const ranges=[[0x3000,0x30ff],[0xff01,0xff60]];
const corpus=JSON.stringify(catalog)+JSON.stringify(existing.jp)+ranges.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>String.fromCodePoint(a+i))).join('');
const chars=[...new Set([...corpus].filter(c=>c.codePointAt(0)>=0x3000 && c.codePointAt(0)<=0xffff))];
const js=`(()=>{let svg=document.querySelector('.blocklySvg');let t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('style','font: 500 16px "Helvetica Neue", Helvetica, sans-serif');svg.appendChild(t);let out={};for(const c of ${JSON.stringify(chars)}){t.textContent=c;out[c]=t.getComputedTextLength()}t.remove();return out})()`;
const r=JSON.parse(execFileSync('agent-browser',['--session','calibration-ja','eval','--stdin','--json'],{input:js,encoding:'utf8',maxBuffer:10000000}));if(!r.success)throw Error(JSON.stringify(r.error));Object.assign(existing.jp,r.data.result);writeFileSync('packages/core/metrics/glyphs.json',JSON.stringify(existing,null,2)+'\n');
