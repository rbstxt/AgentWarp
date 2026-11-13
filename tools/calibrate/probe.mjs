import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
 await page.goto(process.env.EDITOR_URL||'https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>window.ScratchBlocks?.getMainWorkspace(),{timeout:90000});
 await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(()=>{
  const B=ScratchBlocks,w=B.getMainWorkspace(); B.Events.disable();
  try {
   const shapes={};
   for(const type of ['event_whenflagclicked','motion_movesteps','control_repeat','control_if_else','control_forever','control_stop','operator_add','math_number','text']){
    try{const b=w.newBlock(type);b.initSvg();b.render();const d=b.getHeightWidth();shapes[type]={width:d.width,height:d.height,note:'newBlock, empty inputs, no toolbox shadow XML'};b.dispose();}catch(e){shapes[type]={error:String(e)}}
   }
   const b=w.newBlock('motion_movesteps');b.initSvg();b.render();const label=b.getSvgRoot().querySelector('text'), style=getComputedStyle(label);
   const text={font:style.font,samples:{}}; const saved=label.textContent;
   for(const s of ['i','iiiiiiiiii','W','WWWWWWWWWW','0','0000000000','move','hello world']){label.textContent=s;text.samples[s]=label.getComputedTextLength()}
   label.textContent=saved;b.dispose();return {shapes,text};
  } finally {B.Events.enable()}
 });
 await writeFile('eval/calibration/render-probes.json',JSON.stringify(result,null,2)+'\n');
} finally {await browser.close()}
