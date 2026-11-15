// Onboarding: no agent ready -> setup guide by plan (Claude / ChatGPT / none = OpenCode free); "Check again" re-asks the engine (refresh) and the
// panel switches to the normal start screen once an agent is ready. Screenshots: p8-setup-*.
import {chromium} from 'playwright';
import {createMock} from './mock-server.mjs';
import {mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root = dirname(fileURLToPath(import.meta.url));
await mkdir(join(root, 'e2e-screens'), {recursive: true});
const cli = (id, name, bin, state) => ({
  name, path: state === 'missing' ? null : `/usr/local/bin/${bin}`, version: state === 'missing' ? undefined : `${bin} 1.0.0`,
  auth: state === 'ready' ? 'authenticated' : state === 'signin' ? 'unauthenticated' : 'unknown',
  install: `npm install -g ${bin}@latest`, login: `${bin} login`, docs: 'https://example.com/docs'
});
const notReady = [
  {id: 'claude', label: 'Claude', available: false, cli: cli('claude', 'Claude Code', 'claude', 'missing')},
  {id: 'codex', label: 'Codex', available: true, cli: cli('codex', 'Codex CLI', 'codex', 'signin')},
  {id: 'opencode', label: 'OpenCode', available: false, cli: cli('opencode', 'OpenCode', 'opencode', 'missing')}
];
const openCodeReady = {...notReady[2], available: true, cli: {...cli('opencode', 'OpenCode', 'opencode', 'ready'), auth: 'unknown'}};
const ready = [
  {id: 'mock', label: 'Mock agent', available: true},
  {...notReady[0], available: true, cli: cli('claude', 'Claude Code', 'claude', 'ready')},
  notReady[1], openCodeReady
];
let browser, mock;
try {
  browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  const seed = await browser.newPage();
  await seed.goto('https://turbowarp.org/editor', {waitUntil: 'domcontentloaded', timeout: 60000});
  await seed.waitForFunction(() => window.vm?.runtime?.targets?.some(t => t.isStage), null, {timeout: 60000});
  const project = Buffer.from(await seed.evaluate(async () => Array.from(new Uint8Array(await (await vm.saveProjectSb3()).arrayBuffer()))));
  await seed.close();
  mock = await createMock({project, agents: notReady});
  for (const locale of ['ja', 'en']) {
    mock.agents = notReady;
    const context = await browser.newContext({locale, viewport: {width: 1280, height: 900}, permissions: ['local-network-access']});
    await context.addInitScript(({port, token}) => { window.AGENTWARP = {url: `http://127.0.0.1:${port}`, token}; localStorage.setItem('agentwarp.panel.open', 'true'); localStorage.setItem('agentwarp.panel.width', '380'); }, mock);
    await context.addInitScript({path: join(root, 'agentwarp-client.js')});
    const page = await context.newPage();
    page.on('pageerror', e => console.error('page error:', e.message));
    await page.goto(`https://turbowarp.org/editor?locale=${locale}`, {waitUntil: 'domcontentloaded', timeout: 60000});
    const panel = page.locator('#agentwarp-panel');
    const ja = locale === 'ja';
    await panel.getByText(ja ? 'エージェントを準備しましょう' : 'Set up an agent').waitFor({timeout: 60000});
    // One card per plan; Claude is missing, Codex needs sign-in (opened), OpenCode is the free way in.
    await panel.getByText(ja ? 'Claude Pro / Max を持っている' : 'I have Claude Pro or Max').waitFor();
    assert.equal(await panel.getByText(ja ? '未インストール' : 'Not installed', {exact: true}).count(), 1);
    assert.equal(await panel.getByText(ja ? 'サインインが必要' : 'Sign-in required', {exact: true}).count(), 1);
    assert.equal(await panel.locator('.setup-badge.free').count(), 1);
    await panel.getByText('codex login', {exact: true}).waitFor();
    // No subscription: OpenCode, install only, no sign-in step.
    await panel.getByRole('button', {name: ja ? /サブスクなし/ : /No subscription/}).click();
    await panel.getByText('npm install -g opencode@latest', {exact: true}).waitFor();
    await panel.getByText(ja ? 'サインインは不要です。OpenCode の無料モデルがすぐ使えます。' : "No sign-in needed: OpenCode's free models work right away.").waitFor();
    assert.equal(await panel.getByText('opencode login', {exact: true}).count(), 0);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') { await page.getByText(ja ? '設定' : 'Settings', {exact: true}).first().click(); await page.getByText(ja ? 'ダークモードに切り替える' : 'Switch To Dark Mode', {exact: true}).click(); await page.waitForTimeout(300); }
      await panel.screenshot({path: join(root, 'e2e-screens', `p8-setup-${locale}-${theme}.png`)});
    }
    // The user installed OpenCode: "Check again" asks the engine to re-check.
    mock.agents = ready;
    const before = mock.acpMessages.filter(m => m.type === 'acp/agents' && m.refresh === true).length;
    await panel.getByRole('button', {name: ja ? 'もう一度確認' : 'Check again'}).click();
    await page.waitForFunction(n => true, before);
    assert.ok(mock.acpMessages.filter(m => m.type === 'acp/agents' && m.refresh === true).length > before);
    await panel.getByText(ja ? '何を作りましょう？' : 'What should we build?').waitFor();
    assert.ok(mock.acpMessages.some(m => m.type === 'acp/options' && (m.agentId === 'mock' || m.agentId === 'claude')));
    // Setup again: "Start with a free model" picks OpenCode with a free model.
    await panel.getByRole('button', {name: ja ? 'エージェントの設定' : 'Agent setup'}).click();
    await panel.getByText(ja ? '準備OK' : 'Ready', {exact: true}).first().waitFor();
    await panel.getByRole('button', {name: ja ? /サブスクなし/ : /No subscription/}).click();
    await panel.screenshot({path: join(root, 'e2e-screens', `p8-setup-compact-${locale}-dark.png`)});
    await panel.getByRole('button', {name: ja ? '無料モデルで始める' : 'Start with a free model'}).click();
    await panel.locator('.model-trigger').filter({hasText: 'GLM-5.3-Flash Free'}).waitFor({timeout: 15000});
    // The free badge in the model list.
    await panel.locator('.model-trigger').click();
    await panel.locator('.model-free').first().waitFor();
    await page.keyboard.press('Escape');
    // Sending shows the conversation at once (before the session exists) with a working button.
    await panel.locator('.composer textarea').fill(ja ? 'こんにちは' : 'Hello');
    await panel.locator('.composer textarea').press('Enter');
    await panel.locator('.send.working').waitFor({timeout: 3000});
    await panel.locator('.user-bubble').filter({hasText: ja ? 'こんにちは' : 'Hello'}).waitFor({timeout: 3000});
    assert.equal(await panel.getByText(ja ? '何を作りましょう？' : 'What should we build?').count(), 0);
    assert.ok(mock.acpMessages.some(m => m.type === 'acp/start' && m.agentId === 'opencode' && m.configOptions?.some(c => c.configId === 'model' && c.value === 'opencode/glm-5.3-flash-free')));
    await context.close();
  }
  console.log('PASS: onboarding (plans, free OpenCode path, check again, compact setup, free model, instant send view) in Japanese and English');
} finally {
  await mock?.close();
  await browser?.close();
}
