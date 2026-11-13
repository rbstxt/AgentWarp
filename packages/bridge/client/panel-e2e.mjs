import {chromium} from 'playwright';
import {createMock} from './mock-server.mjs';
import {mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root = dirname(fileURLToPath(import.meta.url));
const screens = join(root,'e2e-screens'); await mkdir(screens,{recursive:true});
let browser, mock;
try {
  browser = await chromium.launch({headless:process.env.HEADED !== '1',args:['--no-sandbox']});
  const seed = await browser.newPage();
  await seed.goto('https://turbowarp.org/editor',{waitUntil:'domcontentloaded',timeout:60000});
  await seed.waitForFunction(() => window.vm?.runtime?.targets?.some(t => t.isStage) && window.ScratchBlocks?.getMainWorkspace(),null,{timeout:60000});
  const project = Buffer.from(await seed.evaluate(async () => Array.from(new Uint8Array(await (await vm.saveProjectSb3()).arrayBuffer()))));
  await seed.close(); mock = await createMock({project});
  for (const locale of ['en','ja']) {
    const context = await browser.newContext({locale,viewport:{width:1440,height:900},permissions:['local-network-access']});
    await context.addInitScript(({port,token}) => { window.AGENTWARP = {url:`http://127.0.0.1:${port}`,token}; },{port:mock.port,token:mock.token});
    await context.addInitScript({path:join(root,'agentwarp-client.js')});
    const page = await context.newPage(); page.on('console', m => { if (m.type() === 'error') console.log('browser:',m.text()); }); page.on('pageerror', e => console.log('page error:',e.message));
    await page.goto(`https://turbowarp.org/editor?locale=${locale}`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForSelector('#agentwarp-toggle',{timeout:60000});
    if (locale === 'en') { await page.getByText('Settings',{exact:true}).first().click(); await page.getByText('Switch To Dark Mode',{exact:true}).click(); await page.waitForFunction(() => document.querySelector('#agentwarp-panel').classList.contains('aw-dark')); }
    await page.locator('#agentwarp-toggle').click();
    assert.equal(await page.locator('#agentwarp-panel').evaluate(el => el.getBoundingClientRect().right),1440);
    await page.locator('#agentwarp-panel select').selectOption('mock');
    const input = page.locator('#agentwarp-panel textarea'); await input.waitFor({state:'visible'}); await page.waitForFunction(() => !document.querySelector('#agentwarp-panel textarea').disabled);
    await input.fill('Make a change'); await input.press('Enter');
    await page.locator('.aw-permission button').first().waitFor();
    assert.equal(await page.locator('.aw-agent_thought_chunk').getAttribute('open'),null);
    assert.match(await page.locator('.aw-agent_message_chunk pre').innerText(),/const answer = 42/);
    assert.equal(await page.locator('.aw-agent_message_chunk ul li').count(),2);
    await page.locator('.aw-tool summary').click();
    assert.match(await page.locator('.aw-diff').innerText(),/- move\(10\)[\s\S]*\+ move\(25\)/);
    await page.locator('.aw-permission button').first().click();
    await page.locator('#agentwarp-panel button', {hasText: locale === 'ja' ? '停止' : 'Stop'}).click();
    await page.waitForFunction(() => !document.querySelector('#agentwarp-panel textarea').disabled);
    const promptCount = mock.acpMessages.filter(m => m.type === 'acp/prompt').length;
    await input.fill('composing'); await input.dispatchEvent('compositionstart'); await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}); await input.dispatchEvent('compositionend');
    assert.equal(mock.acpMessages.filter(m => m.type === 'acp/prompt').length,promptCount);
    await page.screenshot({path:join(screens,`panel-${locale}${locale === 'en' ? '-dark' : ''}.png`)});
    await page.reload({waitUntil:'domcontentloaded'}); await page.waitForSelector('.aw-agent_message_chunk pre',{timeout:60000});
    assert.match(await page.locator('.aw-agent_message_chunk pre').innerText(),/const answer = 42/);
    assert.equal(await page.locator('#agentwarp-panel').isVisible(),true);
    const lastPrompt = mock.acpMessages.filter(m => m.type === 'acp/prompt').at(-1); assert.ok(lastPrompt.context.editingTarget); assert.ok(Number.isInteger(lastPrompt.context.rev));
    await context.close();
  }
  assert.ok(mock.acpMessages.some(m => m.type === 'acp/permission' && m.optionId === 'allow'));
  assert.ok(mock.acpMessages.some(m => m.type === 'acp/cancel'));
  console.log('PASS: ACP panel in English and Japanese, streaming, permission, cancel, history and IME');
} catch (error) { console.error(error); process.exitCode=1; }
finally { await mock?.close(); await browser?.close(); }
