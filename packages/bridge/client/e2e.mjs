import {chromium} from 'playwright';
import {createMock} from './mock-server.mjs';
import {readFile, mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root = dirname(fileURLToPath(import.meta.url));
const screens = join(root, 'e2e-screens');
await mkdir(screens, {recursive:true});
const temp = await mkdtemp(join(tmpdir(), 'agentwarp-e2e-'));
let browser, mock, page;
const wait = (fn, message, timeout = 20000) => new Promise((resolve, reject) => { const start = Date.now(); const tick = () => { if (fn()) resolve(); else if (Date.now()-start > timeout) reject(new Error(message)); else setTimeout(tick, 100); }; tick(); });
try {
  browser = await chromium.launch({headless: process.env.HEADED !== '1', args:['--no-sandbox']});
  page = await browser.newPage({viewport:{width:1440,height:900}, permissions:['local-network-access']});
  page.on('console', m => { if (m.type() === 'error') console.log('browser:', m.text()); });
  await page.goto('https://turbowarp.org/editor', {waitUntil:'domcontentloaded', timeout:60000});
  await page.waitForFunction(() => window.vm && window.ScratchBlocks?.getMainWorkspace(), null, {timeout:60000});
  await page.waitForTimeout(2500);
  // The editor supplies assets and a valid sb3. Add a known script to the sprite.
  await page.evaluate(() => {
    const w = ScratchBlocks.getMainWorkspace();
    const xml = ScratchBlocks.Xml.textToDom('<xml><block type="motion_movesteps" x="100" y="100"><value name="STEPS"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block></xml>');
    ScratchBlocks.Xml.domToWorkspace(xml, w);
  });
  await page.waitForFunction(() => Object.values(vm.editingTarget.blocks._blocks).some(b => b.opcode === 'motion_movesteps'));
  const original = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await vm.saveProjectSb3()).arrayBuffer()))));
  await writeFile(join(temp,'initial.sb3'), original);
  // Change one literal while preserving IDs and all assets.
  execFileSync('python3', ['-c', `import zipfile,json,sys\na,b=sys.argv[1:]\nwith zipfile.ZipFile(a) as z: files={n:z.read(n) for n in z.namelist()}\np=json.loads(files['project.json'])\nfor t in p['targets']:\n for block in t['blocks'].values():\n  if block.get('opcode')=='motion_movesteps':\n   block['inputs']['STEPS']=[1,[4,'25']]\nfiles['project.json']=json.dumps(p).encode()\nwith zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:\n for n,data in files.items(): z.writestr(n,data)`, join(temp,'initial.sb3'),join(temp,'changed.sb3')]);
  mock = await createMock({project:original});
  await page.evaluate(({port, token}) => { window.AGENTWARP = {url:`http://127.0.0.1:${port}`, token}; }, {port:mock.port, token:mock.token});
  await page.addScriptTag({path:join(root,'agentwarp-client.js')});
  await wait(() => mock.acks.includes(1), 'initial load not acknowledged');
  await page.waitForFunction(() => !window.__agentwarpClient.loading);
  const before = await page.evaluate(() => {
    const w = ScratchBlocks.getMainWorkspace(); w.setScale(0.8); w.scrollbar.set(100,80);
    return {target:vm.editingTarget.getName(), scale:w.scale, x:w.scrollX, y:w.scrollY};
  });
  mock.push(await readFile(join(temp,'changed.sb3')));
  await wait(() => mock.acks.includes(2), 'revision 2 not acknowledged');
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => { const w = ScratchBlocks.getMainWorkspace(); const b = w.getAllBlocks().find(b => b.type === 'motion_movesteps'); return {target:vm.editingTarget.getName(), scale:w.scale, x:w.scrollX, y:w.scrollY, value:b?.getInputTargetBlock('STEPS')?.getFieldValue('NUM')}; });
  assert.equal(after.value,'25'); assert.equal(after.target,before.target); assert.equal(after.scale,before.scale);
  assert.ok(Math.abs(after.x-before.x) < 2 && Math.abs(after.y-before.y) < 2, `scroll ${JSON.stringify({before,after})}`);
  assert.equal(mock.posts.length, 0, 'load echoed to bridge');
  await page.screenshot({path:join(screens,'01-load.png')});
  await page.evaluate(() => { const b = ScratchBlocks.getMainWorkspace().getAllBlocks().find(b => b.type === 'motion_movesteps'); b.getInputTargetBlock('STEPS').setFieldValue('42','NUM'); });
  await wait(() => mock.posts.length >= 1, 'human edit was not uploaded');
  await page.waitForTimeout(1600);
  assert.equal(mock.posts.length,1); assert.equal(mock.posts[0].baseRev,'2');
  await writeFile(join(temp,'posted.sb3'),mock.posts[0].data);
  const contents = execFileSync('python3',['-c',"import json,zipfile,sys; p=json.loads(zipfile.ZipFile(sys.argv[1]).read('project.json')); print(json.dumps(p))",join(temp,'posted.sb3')],{encoding:'utf8'});
  assert.match(contents, /"42"/);
  await page.screenshot({path:join(screens,'02-edit.png')});
  const port = mock.port, project = mock.project, rev = mock.rev; await mock.close();
  await page.waitForFunction(() => !window.__agentwarpClient.connected);
  mock = await createMock({project, port, rev});
  await page.waitForFunction(() => window.__agentwarpClient.connected, null, {timeout:20000});
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__agentwarpClient.rev), rev);
  await page.screenshot({path:join(screens,'03-reconnect.png')});
  console.log('PASS: load, target/scroll/zoom, no echo, single editor POST, reconnect');
} catch (error) {
  if (page) await page.screenshot({path:join(screens,'failure.png')}).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { if (mock) await mock.close().catch(() => {}); if (browser) await browser.close(); await rm(temp,{recursive:true,force:true}); }
