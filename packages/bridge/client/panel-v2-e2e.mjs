import {chromium} from 'playwright';
import {createMock} from './mock-server.mjs';
import {mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=dirname(fileURLToPath(import.meta.url));
await mkdir(join(root,'e2e-screens'),{recursive:true});
let browser,mock;
try {
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const seed=await browser.newPage();
 await seed.goto('https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:60000});
 await seed.waitForFunction(()=>window.vm?.runtime?.targets?.some(t=>t.isStage)&&window.ScratchBlocks?.getMainWorkspace(),null,{timeout:60000});
 await seed.evaluate(()=>ScratchBlocks.Xml.domToWorkspace(ScratchBlocks.Xml.textToDom('<xml><block type="motion_movesteps" x="1600" y="1200"><value name="STEPS"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block></xml>'),ScratchBlocks.getMainWorkspace()));
 await seed.waitForFunction(()=>Object.values(vm.editingTarget.blocks._blocks).some(b=>b.opcode==='motion_movesteps'));
 let blockId=await seed.evaluate(()=>Object.values(vm.editingTarget.blocks._blocks).find(b=>b.opcode==='motion_movesteps').id);
 const project=Buffer.from(await seed.evaluate(async()=>Array.from(new Uint8Array(await (await vm.saveProjectSb3()).arrayBuffer()))));
 await seed.evaluate(id=>ScratchBlocks.getMainWorkspace().getBlockById(id).getInputTargetBlock('STEPS').setFieldValue('25','NUM'),blockId);
 const changedProject=Buffer.from(await seed.evaluate(async()=>Array.from(new Uint8Array(await (await vm.saveProjectSb3()).arrayBuffer()))));
 await seed.evaluate(async bytes=>vm.loadProject(new Uint8Array(bytes).buffer),Array.from(changedProject));
 blockId=await seed.evaluate(()=>Object.values(vm.runtime.targets.find(t=>t.getName()==='Sprite1').blocks._blocks).find(b=>b.opcode==='motion_movesteps').id);
 await seed.close();mock=await createMock({project,changedProject,blockId});
 for(const locale of ['en','ja']) {
  mock.push(project);
  const context=await browser.newContext({locale,viewport:{width:1280,height:900},permissions:['local-network-access']});
  await context.addInitScript(({port,token})=>{window.AGENTWARP={url:`http://127.0.0.1:${port}`,token}},mock);
  await context.addInitScript({path:join(root,'agentwarp-client.js')});
  const page=await context.newPage();page.on('pageerror',e=>console.error('page error:',e.message));
  await page.goto(`https://turbowarp.org/editor?locale=${locale}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#agentwarp-toggle').waitFor({timeout:60000});await page.locator('#agentwarp-toggle').click();
  const panel=page.locator('#agentwarp-panel');
  await page.waitForFunction(()=>window.__agentwarpClient?.rev != null);
  await panel.getByRole('button',{name:locale==='ja'?'モデルを選択':'Choose model'}).waitFor();
  await page.waitForTimeout(200);
  const input=panel.locator('textarea');
  // Exercise the picker from the keyboard, including both columns and focus return.
  await input.focus();await page.keyboard.press('ControlOrMeta+Shift+M');
  const search=panel.getByRole('textbox',{name:locale==='ja'?'モデルを検索':'Search models'});
  await search.waitFor();await search.fill('Mock model');await panel.getByRole('button',{name:'Mock model',exact:true}).waitFor();await search.press('ArrowDown');
  assert.equal(await panel.getByRole('button',{name:'Mock model',exact:true}).evaluate(el=>el.getRootNode().activeElement===el),true);
  await page.keyboard.press('ArrowRight');assert.equal(await panel.locator('.model-settings').evaluate(el=>el.contains(el.getRootNode().activeElement)),true);
  await page.keyboard.press('ArrowLeft');assert.equal(await panel.locator('.model-list').evaluate(el=>el.contains(el.getRootNode().activeElement)),true);
  await page.keyboard.press('Escape');await search.waitFor({state:'hidden'});
  await panel.getByRole('button',{name:locale==='ja'?'モデルを選択':'Choose model'}).click();
  await panel.locator('.model-group').filter({hasText:'Codex'}).waitFor();await panel.locator('.model-group').filter({hasText:'OpenCode'}).waitFor();
  assert.equal(await panel.getByText('Not installed',{exact:true}).count(),1);
  assert.ok(mock.acpMessages.some(m=>m.type==='acp/options'&&m.agentId==='codex'));
  assert.ok(mock.acpMessages.some(m=>m.type==='acp/options'&&m.agentId==='opencode'));
  await page.keyboard.press('Escape');
  const screenshotMatrix=async state=>{
   await page.setViewportSize({width:1920,height:900});
   for(const width of [300,600]){
    await page.waitForFunction(()=>document.querySelector('#agentwarp-panel').getBoundingClientRect().width === Number(localStorage.getItem('agentwarp.panel.width')));
    let current=await panel.evaluate(el=>el.getBoundingClientRect().width);
    await panel.locator('.resize').focus();
    while(current!==width){const next=current+(current<width?20:-20);await panel.locator('.resize').focus();await page.keyboard.press(current<width?'ArrowLeft':'ArrowRight');await page.waitForFunction(w=>document.querySelector('#agentwarp-panel').getBoundingClientRect().width===w,next);current=next;}

    for(const theme of ['light','dark']){
     if(theme==='dark') {await page.getByText(locale==='ja'?'設定':'Settings',{exact:true}).first().click();await page.getByText(locale==='ja'?'ダークモードに切り替える':'Switch To Dark Mode',{exact:true}).click();}
     if(state==='picker'){await panel.getByRole('button',{name:locale==='ja'?'モデルを選択':'Choose model'}).click();await panel.getByRole('button',{name:'Mock model',exact:true}).waitFor();}
     await panel.screenshot({path:join(root,'e2e-screens',`p7-composer2-${state}-${locale}-${theme}-${width}.png`)});
     if(state==='picker')await page.keyboard.press('Escape');
     if(theme==='dark') {await page.getByText(locale==='ja'?'設定':'Settings',{exact:true}).first().click();await page.getByText(locale==='ja'?'ライトモードに切り替える':'Switch To Light Mode',{exact:true}).click();}
    }
   }
   await page.setViewportSize({width:1280,height:900});
  };
  await screenshotMatrix('idle');
  await input.fill('Make a change');await screenshotMatrix('typing');
  await screenshotMatrix('picker');
  const setTheme=async theme=>{await page.getByText(locale==='ja'?'設定':'Settings',{exact:true}).first().click();await page.getByText(theme==='dark'?(locale==='ja'?'ダークモードに切り替える':'Switch To Dark Mode'):(locale==='ja'?'ライトモードに切り替える':'Switch To Light Mode'),{exact:true}).click();};
  const capture=async name=>{await page.screenshot({path:join(root,'e2e-screens',`p7-composer-${name}-${locale}-light.png`)});await setTheme('dark');await page.screenshot({path:join(root,'e2e-screens',`p7-composer-${name}-${locale}-dark.png`)});await setTheme('light');};
  await input.fill('Make a change @Sprite');await panel.locator('.mention-menu').waitFor();
  await capture('mention');
  await input.press('ArrowDown');await input.press('ArrowUp');await input.press('Tab');

  await input.press('Enter');
  await screenshotMatrix('running');
  await input.fill('Queued first');await input.press('Enter');
  await input.fill('Queued second');await input.press('Enter');
  assert.equal(await panel.locator('.queue-row').count(),2);
  await screenshotMatrix('queued');
  await capture('queue');
  await panel.locator('.queue-row').last().getByTitle(locale==='ja'?'削除':'Remove').click();await panel.locator('.queue-row').last().getByTitle(locale==='ja'?'削除':'Remove').click();

  await panel.locator('.changes[data-final="false"]').waitFor({timeout:15000});
  await panel.getByRole('button',{name:locale==='ja'?'確認':'Review',exact:true}).click();
  await panel.locator('.block-preview svg').waitFor(); assert.match(await panel.locator('.block-preview').textContent(),/15/);
  await panel.locator('.permission').waitFor({timeout:15000});
  assert.equal(await panel.getByRole('button',{name:locale==='ja'?'今回だけ許可':'Allow once'}).count(),1);
  assert.equal(await panel.getByRole('button',{name:locale==='ja'?'常に許可':'Always allow'}).count(),1);
  assert.equal(await panel.getByRole('button',{name:locale==='ja'?'拒否':'Deny'}).count(),1);
  assert.equal(await panel.locator('.thought [data-slot=trace-collapsible-content]').isVisible(),false);
  await panel.locator('.tool summary').click();assert.match(await panel.locator('.tool-content').innerText(),/move\(25\)/);
  await page.screenshot({path:join(root,'e2e-screens',`p7-${locale}-conversation.png`)});
  await panel.locator('.permission').press('Enter');
  await panel.locator('.changes[data-final="true"]').waitFor();
  await input.fill('/h');await panel.locator('.mention-menu').waitFor();
  await capture('slash');
  await input.press('Tab');assert.equal(await input.inputValue(),'/help ');await page.waitForTimeout(100);await input.press('ControlOrMeta+A');await input.press('Backspace');
  await page.waitForTimeout(100);assert.equal(await input.inputValue(),'');await input.press('ArrowUp');assert.match(await input.inputValue(),/Make a change/);await input.fill('');
  await page.setViewportSize({width:1024,height:900});await page.waitForFunction(()=>document.querySelector('#agentwarp-panel').classList.contains('aw-overlay'));await page.screenshot({path:join(root,'e2e-screens',`p7-composer-overlay-${locale}-light.png`)});await page.setViewportSize({width:1280,height:900});await setTheme('dark');await page.setViewportSize({width:1024,height:900});await page.screenshot({path:join(root,'e2e-screens',`p7-composer-overlay-${locale}-dark.png`)});await page.setViewportSize({width:1280,height:900});await setTheme('light');
  await page.setViewportSize({width:1280,height:900});await page.waitForFunction(()=>!document.querySelector('#agentwarp-panel').classList.contains('aw-overlay'));

  await panel.locator('.block-preview svg').waitFor(); assert.match(await panel.locator('.block-preview').textContent(),/25/);
  assert.match(await panel.locator('.script-header').innerText(),locale==='ja'?/緑の旗が押されたとき/:/when green flag clicked/);
  await page.waitForFunction(()=>!window.__agentwarpClient.loading);
  await page.evaluate(()=>vm.setEditingTarget(vm.runtime.targets.find(t=>t.isStage).id));
  const beforeScroll=await page.evaluate(()=>({x:ScratchBlocks.getMainWorkspace().scrollX,y:ScratchBlocks.getMainWorkspace().scrollY}));
  await panel.locator('.script').click();
  await page.waitForFunction(id=>vm.editingTarget.getName()==='Sprite1' && !!ScratchBlocks.getMainWorkspace().getBlockById(id)?.getSvgRoot()?.classList.contains('aw-glow'),blockId,{timeout:10000});
  const afterScroll=await page.evaluate(()=>({x:ScratchBlocks.getMainWorkspace().scrollX,y:ScratchBlocks.getMainWorkspace().scrollY})); assert.notDeepEqual(afterScroll,beforeScroll,'jump must change workspace scroll');
  for(const width of [300,380,600]) {
   await panel.locator('.resize').focus();
   const current=Number(await page.evaluate(()=>localStorage.getItem('agentwarp.panel.width')));
   for(let n=current;n!==width;n+=n<width?20:-20) await page.keyboard.press(n<width?'ArrowLeft':'ArrowRight');
   assert.ok(await page.locator('[class*=gui_flex-wrapper_]').first().evaluate(el=>el.getBoundingClientRect().width)>=856, 'editor must retain 856px');
   assert.equal(await panel.locator('.model-trigger').count(),1);
   if(width===380) {assert.equal(await panel.locator('.model-trigger .provider-icon').isVisible(),true);continue;}
   for(const theme of ['light','dark']) {
    if(theme==='dark') { await page.getByText(locale==='ja'?'設定':'Settings',{exact:true}).first().click(); await page.getByText(locale==='ja'?'ダークモードに切り替える':'Switch To Dark Mode',{exact:true}).click(); }
    await page.screenshot({path:join(root,'e2e-screens',`p7-changes-${locale}-${theme}-${width}.png`)});
    if(theme==='dark') { await page.getByText(locale==='ja'?'設定':'Settings',{exact:true}).first().click(); await page.getByText(locale==='ja'?'ライトモードに切り替える':'Switch To Light Mode',{exact:true}).click(); }
   }
  }
  await panel.getByRole('button',{name:locale==='ja'?'元に戻す':'Undo turn'}).click();
  await panel.getByRole('dialog').getByRole('button',{name:locale==='ja'?'復元':'Restore',exact:true}).click();
  await panel.getByText(locale==='ja'?'チェックポイントを復元しました':'Checkpoint restored').waitFor();
  await page.waitForFunction(()=>!window.__agentwarpClient.loading && ScratchBlocks.getMainWorkspace().getAllBlocks().some(b=>b.type==='motion_movesteps'&&b.getInputTargetBlock('STEPS')?.getFieldValue('NUM')==='10'),null,{timeout:20000});
  await input.fill('Change again');await input.press('Enter');
  await panel.locator('.permission').waitFor();await panel.locator('.permission').press('Enter');
  await panel.locator('.changes[data-final="true"]').waitFor();
  await page.waitForFunction(()=>!window.__agentwarpClient.loading && ScratchBlocks.getMainWorkspace().getAllBlocks().some(b=>b.type==='motion_movesteps'&&b.getInputTargetBlock('STEPS')?.getFieldValue('NUM')==='25'),null,{timeout:20000});
  await panel.locator('.entry.user').last().hover();
  await panel.locator('.entry.user').last().getByTitle(locale==='ja'?'チェックポイントに戻す':'Restore checkpoint').click();
  await panel.getByRole('dialog').getByRole('button',{name:locale==='ja'?'復元':'Restore',exact:true}).click();
  await page.waitForFunction(()=>!window.__agentwarpClient.loading && ScratchBlocks.getMainWorkspace().getAllBlocks().some(b=>b.type==='motion_movesteps'&&b.getInputTargetBlock('STEPS')?.getFieldValue('NUM')==='10'),null,{timeout:20000});
  assert.ok(mock.acpMessages.some(m=>m.type==='acp/permission'&&m.optionId==='allow'));
  assert.ok(mock.acpMessages.some(m=>m.type==='acp/prompt'&&m.context.editingTarget));
  assert.ok(mock.acpMessages.some(m=>m.type==='acp/prompt'&&m.mentions?.some(x=>x.kind==='sprite')));
  const sessionId=JSON.parse(await page.evaluate(()=>localStorage.getItem('agentwarp.panel.session'))).sessionId;
  const received=()=>mock.acpMessages.filter(m=>m.sessionId===sessionId);
  const waitReceived=async pred=>{const end=Date.now()+15000;while(!pred()){if(Date.now()>end)throw Error('Timed out waiting for mock message');await new Promise(r=>setTimeout(r,50));}};
  await input.fill('Queue turn');await input.press('Enter');
  for(const text of ['First queued','Drop queued','Second queued']){await input.fill(text);await input.press('Enter');}
  assert.equal(await panel.locator('.queue-row').count(),3);
  await panel.locator('.queue-row').nth(1).getByTitle(locale==='ja'?'削除':'Remove').click();
  await panel.locator('.permission').waitFor();await panel.locator('.permission').press('Enter');
  await waitReceived(()=>received().some(m=>m.type==='acp/prompt'&&m.text==='First queued'));
  await panel.locator('.permission').waitFor();await panel.locator('.permission').press('Enter');
  await waitReceived(()=>received().some(m=>m.type==='acp/prompt'&&m.text==='Second queued'));
  await panel.locator('.permission').waitFor();await panel.locator('.permission').press('Enter');
  const sent=received().filter(m=>m.type==='acp/prompt').map(m=>m.text);
  assert.deepEqual(sent.filter(t=>['First queued','Drop queued','Second queued'].includes(t)),['First queued','Second queued']);
  const paste=async data=>input.evaluate((el,data)=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(data)],'paste.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,composed:true}));},data);
  await paste([1,2,3]);await panel.locator('.thumbnail').waitFor();
  await paste([4,5,6]);await panel.locator('.thumbnail').nth(1).waitFor();
  await panel.locator('.thumbnail').first().locator('..').click();
  await input.fill('Pasted image');await input.press('Enter');
  await waitReceived(()=>received().some(m=>m.type==='acp/prompt'&&m.text==='Pasted image'));
  assert.deepEqual(received().find(m=>m.type==='acp/prompt'&&m.text==='Pasted image').images,[{mimeType:'image/png',data:'BAUG'}]);
  await input.fill('@Sprite');await panel.locator('.mention-menu').waitFor();
  const cancellations=received().filter(m=>m.type==='acp/cancel').length;
  await input.press('Escape');assert.equal(await panel.locator('.mention-menu').count(),0);assert.equal(received().filter(m=>m.type==='acp/cancel').length,cancellations);
  await input.fill('/h');await panel.locator('.mention-menu').waitFor();await input.press('Escape');assert.equal(await panel.locator('.mention-menu').count(),0);assert.equal(received().filter(m=>m.type==='acp/cancel').length,cancellations);
  await input.press('Escape');await waitReceived(()=>received().filter(m=>m.type==='acp/cancel').length===cancellations+1);
  await input.fill('');await input.press('ArrowUp');assert.equal(await input.inputValue(),'Pasted image');await input.fill('');
  // Open a real Blockly context menu on the script and exercise both actions.
  await page.waitForFunction(()=>!window.__agentwarpClient.loading);
  await page.evaluate(id=>{const w=ScratchBlocks.getMainWorkspace();w.centerOnBlock(id);w.getBlockById(id).select();},blockId);
  const block=page.locator(`[data-id="${blockId}"]`).first();
  await block.click({button:'right'});
  const ask=page.getByText(locale==='ja'?'エージェントに聞く':'Ask agent about this',{exact:true});
  const fix=page.getByText(locale==='ja'?'エージェントで直す':'Fix with agent',{exact:true});
  await ask.waitFor();assert.equal(await fix.count(),1);
  assert.ok(await page.locator('.blocklyContextMenu > *').count()>2,'native block actions remain');
  await page.screenshot({path:join(root,'e2e-screens',`p7-composer-context-${locale}-light.png`)});await setTheme('dark');await block.click({button:'right'});await ask.waitFor();await page.screenshot({path:join(root,'e2e-screens',`p7-composer-context-${locale}-dark.png`)});await setTheme('light');
  await panel.getByRole('button',{name:locale==='ja'?'閉じる':'Close'}).click();
  await block.click({button:'right'});await ask.click();
  await panel.waitFor({state:'visible'});assert.ok(await panel.locator('.chips button').filter({hasText:'@'}).count());
  await panel.locator('.chips button').filter({hasText:'@'}).last().click();
  await block.click({button:'right'});await fix.click();
  await page.waitForFunction(expected=>document.querySelector('#agentwarp-panel').shadowRoot.querySelector('textarea').value===expected,locale==='ja'?'このスクリプトを直して':'Fix this script');assert.equal(await input.inputValue(),locale==='ja'?'このスクリプトを直して':'Fix this script');assert.ok(await panel.locator('.chips button').filter({hasText:'@'}).count());
  await input.fill('');
  await page.keyboard.press('ControlOrMeta+L');await panel.waitFor({state:'hidden'});
  await page.keyboard.press('ControlOrMeta+L');await panel.waitFor({state:'visible'});
  await page.waitForFunction(()=>{const root=document.querySelector('#agentwarp-panel').shadowRoot;return root.activeElement===root.querySelector('textarea')});assert.equal(await input.evaluate(el=>el.getRootNode().activeElement===el),true);
  await page.evaluate(id=>ScratchBlocks.getMainWorkspace().getBlockById(id).select(),blockId);
  const chips=await panel.locator('.chips button').filter({hasText:'@'}).count();
  await page.keyboard.press('ControlOrMeta+Shift+L');assert.equal(await panel.locator('.chips button').filter({hasText:'@'}).count(),chips+1);
  await input.fill('Script context');await input.press('Enter');await waitReceived(()=>received().some(m=>m.type==='acp/prompt'&&m.text==='Script context'));assert.ok(received().find(m=>m.type==='acp/prompt'&&m.text==='Script context').mentions.some(m=>m.kind==='script'&&m.topBlockId===blockId));await input.press('Escape');await waitReceived(()=>received().filter(m=>m.type==='acp/cancel').length===cancellations+2);
  await context.close();
 }
 console.log('PASS: panel v2 in English/Japanese, composer, queue, images, menus, shortcuts, width, changes and restore');
} catch(e){console.error(e);process.exitCode=1} finally {await mock?.close();await browser?.close()}
