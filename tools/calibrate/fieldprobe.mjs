import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';

// Focused probes for field types with no fixture coverage / unclear rules.
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});
  await page.goto(process.env.EDITOR_URL||'https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.ScratchBlocks?.getMainWorkspace(),{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  const result = await page.evaluate(()=>{
    const B=ScratchBlocks, w=B.getMainWorkspace(); B.Events.disable();
    const out={};
    try {
      const fieldInfo=(b)=>{
        return b.inputList.map(inp=>({input:inp.name, type:inp.type,
          fields:inp.fieldRow.map(fl=>{
            let size=null; try{const s=fl.getSize(); size={w:s.width,h:s.height};}catch(e){size={error:String(e)};}
            let textLen=null, cls=null, content=null;
            try{const te=fl.getSvgRoot(); if(te){cls=te.getAttribute&&te.getAttribute('class'); content=te.textContent;
              if(te.getComputedTextLength) textLen=te.getComputedTextLength();}}catch(e){}
            return {ctor:fl.constructor.name, name:fl.name, text:fl.getText?fl.getText():null,
              display:fl.getDisplayText_?fl.getDisplayText_():null, size, textLen, cls, content,
              editable:fl.EDITABLE, hasBox:!!fl.box_, hasArrow:!!fl.positionArrow, arrowSize:fl.arrowSize_??null};
          })}));
      };
      // colour picker shadow
      let b=w.newBlock('colour_picker'); b.initSvg(); b.render();
      out.colour={hw:b.getHeightWidth(), fields:fieldInfo(b)}; b.dispose();
      // music note shadow + note field on playNote block
      try{let n=w.newBlock('note'); n.initSvg(); n.render(); out.noteShadow={hw:n.getHeightWidth(), fields:fieldInfo(n)}; n.dispose();}catch(e){out.noteShadow={error:String(e)};}
      try{let m=w.newBlock('music_playNoteForBeats'); m.initSvg(); m.render(); out.playNote={hw:m.getHeightWidth(), fields:fieldInfo(m)}; m.dispose();}catch(e){out.playNote={error:String(e)};}
      // matrix (microbit display?) - try type name
      for(const t of ['microbit_display','matrix','led_matrix']){
        try{let m=w.newBlock(t); m.initSvg(); m.render(); out['matrix_'+t]={hw:m.getHeightWidth(), fields:fieldInfo(m)}; m.dispose();}catch(e){out['matrix_'+t]={error:String(e)};}
      }
      // checkbox: try a block with checkbox (procedures declaration not renderable; try 'control_stop' has dropdown; use text2speech?)
      // dropdown non-shadow widths for many option lengths
      try{let s=w.newBlock('control_stop'); s.initSvg(); s.render(); out.stop={hw:s.getHeightWidth(), fields:fieldInfo(s)}; s.dispose();}catch(e){out.stop={error:String(e)};}
      // sensing keypressed (boolean with menu input, empty slot)
      try{let s=w.newBlock('sensing_keypressed'); s.initSvg(); s.render(); out.keypressed={hw:s.getHeightWidth(), fields:fieldInfo(s)}; s.dispose();}catch(e){out.keypressed={error:String(e)};}
      // operator equals empty (boolean with 2 empty hex? round slots)
      for(const t of ['operator_equals','operator_gt','operator_lt','operator_and','operator_or','operator_not','sensing_touchingobject','operator_contains','operator_mathop']){
        try{let x=w.newBlock(t); x.initSvg(); x.render(); out[t]={hw:x.getHeightWidth(), fields:fieldInfo(x)}; x.dispose();}catch(e){out[t]={error:String(e)};}
      }
      // reporter with dropdown field non-shadow: looks_costume? data_variable? music instrument?
      for(const t of ['data_variable','looks_costume','music_getTempo','music_midiSetInstrument','sensing_current']){
        try{let x=w.newBlock(t); x.initSvg(); x.render(); out[t]={hw:x.getHeightWidth(), fields:fieldInfo(x)}; x.dispose();}catch(e){out[t]={error:String(e)};}
      }
      // procedures_call with args: build define first? Just newBlock call (no mutation -> empty)
      try{let x=w.newBlock('procedures_call'); x.initSvg(); x.render(); out.callEmpty={hw:x.getHeightWidth(), fields:fieldInfo(x)}; x.dispose();}catch(e){out.callEmpty={error:String(e)};}
      // argument reporters
      for(const t of ['argument_reporter_string_number','argument_reporter_boolean']){
        try{let x=w.newBlock(t); x.initSvg(); x.render(); out[t]={hw:x.getHeightWidth(), fields:fieldInfo(x)}; x.dispose();}catch(e){out[t]={error:String(e)};}
      }
      // data_listcontents
      try{let x=w.newBlock('data_listcontents'); x.initSvg(); x.render(); out.listcontents={hw:x.getHeightWidth(), fields:fieldInfo(x), list:x.getFieldValue?null:null}; x.dispose();}catch(e){out.listcontents={error:String(e)};}
      // text_join / operator with 2 inputs empty
      try{let x=w.newBlock('operator_add'); x.initSvg(); x.render(); out.add={hw:x.getHeightWidth(), fields:fieldInfo(x)}; x.dispose();}catch(e){out.add={error:String(e)};}
      // vertical separator / iconmenu examples: looks backdrop switch (menu input empty)
      try{let x=w.newBlock('looks_switchbackdropto'); x.initSvg(); x.render(); out.switchbackdrop={hw:x.getHeightWidth(), fields:fieldInfo(x)}; x.dispose();}catch(e){out.switchbackdrop={error:String(e)};}
    } finally {B.Events.enable();}
    return out;
  });
  await writeFile('eval/calibration/probe3.json',JSON.stringify(result,null,1)+'\n');
  console.log(JSON.stringify(result,null,1).slice(0,3000));
} finally { await browser.close(); }
