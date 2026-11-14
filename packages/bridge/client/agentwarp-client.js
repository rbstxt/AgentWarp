/* AgentWarp browser client. This file is also a TurboWarp Desktop userscript. */
(() => {
  'use strict';
  if (window.__agentwarpClient) return;
  const state = window.__agentwarpClient = { rev: null, connected: false, dirty: false, loading: false, diagnostics: '', stopped: false };
  let vm, socket, config, timer, reconnectTimer, reconnectDelay = 500, queue = Promise.resolve(), generation = 0;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const workspace = () => window.ScratchBlocks && (window.ScratchBlocks.getMainWorkspace?.() || window.ScratchBlocks.mainWorkspace);
  const pill = document.createElement('button');
  pill.id = 'agentwarp-status'; pill.type = 'button';
  Object.assign(pill.style, {position:'fixed', right:'8px', bottom:'3px', zIndex:'2147483646', font:'11px sans-serif', padding:'3px 7px', border:'0', borderRadius:'9px', color:'#fff', background:'#555', cursor:'pointer', opacity:'.9'});
  function status(label, detail = '') {
    state.status = label; state.diagnostics = detail;
    pill.textContent = `AgentWarp: ${label}`; pill.title = detail || 'Click to change connection';
    pill.style.background = label === 'connected' ? '#277a50' : label === 'error' ? '#a13b32' : '#665a35';
  }
  function attachPill() { if (document.body && !pill.isConnected) document.body.appendChild(pill); }
  attachPill();
  function normalize(value) {
    if (!value || typeof value !== 'object') return null;
    try {
      const url = new URL(value.url || value.bridgeUrl);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !value.token) return null;
      url.protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
      url.pathname = '/'; url.search = ''; url.hash = '';
      return {url: url.origin, token: String(value.token)};
    } catch (_) { return null; }
  }
  function savedConfig() {
    try { return normalize(JSON.parse(localStorage.getItem('agentwarp'))); } catch (_) { return null; }
  }
  function dialog() {
    const box = document.createElement('form');
    Object.assign(box.style, {position:'fixed', right:'10px', bottom:'30px', zIndex:'2147483647', background:'white', color:'#222', padding:'12px', border:'1px solid #aaa', borderRadius:'6px', boxShadow:'0 2px 12px #0004', font:'13px sans-serif'});
    box.innerHTML = '<strong>Connect AgentWarp</strong><br><label>Bridge URL<br><input name="url" type="url" required placeholder="http://127.0.0.1:PORT"></label><br><label>Token<br><input name="token" type="password" required></label><br><button type="submit">Connect</button> <button type="button">Cancel</button>';
    if (config) { box.elements.url.value = config.url; box.elements.token.value = config.token; }
    box.querySelector('button[type=button]').onclick = () => box.remove();
    box.onsubmit = event => { event.preventDefault(); const next = normalize({url:box.elements.url.value, token:box.elements.token.value}); if (!next) return; try { localStorage.setItem('agentwarp', JSON.stringify(next)); } catch (_) {} box.remove(); changeConnection(next); };
    document.body.appendChild(box);
  }
  pill.onclick = dialog;
  function endpoint(path, rev) { const u = new URL(path, config.url); u.searchParams.set('token', config.token); if (rev != null) u.searchParams.set('rev', rev); return u.href; }
  function send(message) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  function enqueue(fn) { queue = queue.then(fn).catch(error => { status('error', error.message || String(error)); console.error('[AgentWarp]', error); }); return queue; }
  function dragging() { const w = workspace(); return !!(w && (w.isDragging?.() || w.currentGesture_?.isDragging?.())); }
  function schedule() {
    clearTimeout(timer);
    if (!state.dirty || state.loading || !state.connected) return;
    timer = setTimeout(() => { if (dragging()) { schedule(); return; } enqueue(flush); }, 1000);
  }
  async function flush() {
    if (!state.dirty || !state.connected || state.loading) return;
    if (dragging()) { schedule(); return; }
    state.dirty = false; const base = state.rev; status('syncing', 'Sending editor changes');
    try {
      // TurboWarp's default export compacts block IDs, breaking bridge anchors.
      // Replace only project.json in its asset ZIP with the unoptimized form.
      const zip = vm._saveProjectZip();
      zip.file('project.json', vm.toJSON(undefined, {allowOptimization:false}));
      const blob = await zip.generateAsync({type:'blob', mimeType:'application/x.scratch.sb3'});
      const response = await fetch(endpoint('/editor.sb3'), {method:'POST', headers:{'Content-Type':'application/octet-stream', 'X-Base-Rev': String(base ?? 0)}, body:blob});
      if (!response.ok) throw new Error(`Editor upload failed: HTTP ${response.status}`);
      const type = response.headers.get('content-type') || '';
      if (type.includes('json')) { const result = await response.json(); if (Number.isInteger(result.rev)) state.rev = Math.max(state.rev ?? 0, result.rev); }
      status('connected');
    } catch (error) { state.dirty = true; status('error', error.message); schedule(); return; }
    schedule();
  }
  function capture() {
    const w = workspace(), target = vm.editingTarget;
    return {id:target?.id, name:target?.getName?.(), stage:target?.isStage, scale:w?.scale, x:w?.scrollX, y:w?.scrollY, running:vm.runtime.threads.some(t => !t.isKilled)};
  }
  async function load(rev) {
    if (state.rev === rev) return;
    if (state.dirty) { await flush(); if (state.dirty) throw new Error('Local edits could not be sent; postponed incoming project'); }
    rev = Math.max(rev, state.rev ?? rev);
    const old = capture(); const beforeScripts = panelState.running ? scriptSnapshot() : null; state.loading = true; clearTimeout(timer); status('syncing', `Loading revision ${rev}`);
    try {
      const response = await fetch(endpoint('/project.sb3', rev));
      if (!response.ok) throw new Error(`Project download failed: HTTP ${response.status}`);
      await vm.loadProject(await response.arrayBuffer());
      const targets = vm.runtime.targets.filter(t => t.isOriginal);
      const target = targets.find(t => t.id === old.id) || targets.find(t => t.isStage === old.stage && t.getName() === old.name);
      if (target) vm.setEditingTarget(target.id);
      await sleep(300);
      const w = workspace();
      if (w && Number.isFinite(old.scale)) {
        w.scrollX = old.x; w.scrollY = old.y; w.scale = old.scale;
        w.resize();
      }
      if (old.running) vm.greenFlag();
      // VM and Blockly can emit asynchronously as the replacement workspace renders.
      await sleep(700);
      if (beforeScripts) highlightChanges(beforeScripts);
      state.rev = rev; updateControls(); send({type:'ack', rev}); status('connected');
    } finally { state.loading = false; schedule(); }
  }
  // ACP panel shares the bridge connection and remains part of this userscript.
  const panelState = {sessionId: null, agentId: '', running: false, entries: [], tools: new Map(), composing: false};
  const storageGet = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
  const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };
  const ja = () => /(^|[-_])ja\b/i.test(new URLSearchParams(location.search).get('locale') || document.documentElement.lang || navigator.language || '');
  const tr = (en, jp) => ja() ? jp : en;
  let panel, panelToggle, agentSelect, configBar, messages, input, sendButton, stopButton, restoreStage = false;
  function resizeEditor() { window.dispatchEvent(new Event('resize')); workspace()?.resize?.(); }
  // [small, large]. TurboWarp Desktop's hide-stage addon prepends a third button.
  function stageToggles() { return [...document.querySelectorAll('[class*="stage-header_"] [class*="toggle-buttons_button_"]')].filter(b => !b.classList.contains('sa-hide-stage-button')).slice(-2); }
  function setOpen(open) {
    if (!panel) return;
    const stageButtons = stageToggles();
    if (open && panel.hidden && stageButtons.length >= 2 && stageButtons[1].getAttribute('aria-pressed') === 'true') { restoreStage = true; stageButtons[0].click(); }
    if (!open && !panel.hidden && restoreStage) { if (stageButtons[0]?.getAttribute('aria-pressed') === 'true') stageButtons[1]?.click(); restoreStage = false; }
    panel.hidden = !open; panelToggle.setAttribute('aria-expanded', String(open));
    pill.style.bottom = '3px'; pill.style.left = open ? '8px' : 'auto'; pill.style.right = open ? 'auto' : '8px';
    storageSet('agentwarp.panel.open', String(open)); resizeEditor();
  }
  function updateControls() {
    if (!panel) return;
    input.disabled = !panelState.sessionId || panelState.running || !state.connected || state.rev == null;
    sendButton.disabled = input.disabled; stopButton.hidden = !panelState.running;
    agentSelect.disabled = !state.connected;
  }
  function node(tag, className, content) { const el = document.createElement(tag); if (className) el.className = className; if (content != null) el.textContent = content; return el; }
  function inlineMarkdown(parent, text) {
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
    let last = 0; for (const match of String(text).matchAll(pattern)) { parent.appendChild(document.createTextNode(text.slice(last,match.index))); const part = match[0]; let el;
      if (part[0] === '`') el = node('code','',part.slice(1,-1));
      else if (part[0] === '[') { const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/); el = node('a','',link[1]); el.href = link[2]; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      else { const strong = part.startsWith('**') || part.startsWith('__'); el = node(strong ? 'strong' : 'em','',part.slice(strong ? 2 : 1,strong ? -2 : -1)); }
      parent.appendChild(el); last = match.index + part.length; } parent.appendChild(document.createTextNode(String(text).slice(last)));
  }
  function renderConfig(options) {
    configBar.replaceChildren();
    for (const option of options || []) { if (option.type !== 'select') continue; const select = node('select'); select.setAttribute('aria-label',option.name || option.id); select.title = option.description || option.name || '';
      for (const item of option.options || []) { const items = item.options || [item]; for (const value of items) { const el = node('option','',value.name || value.value); el.value = value.value; select.appendChild(el); } }
      select.value = option.currentValue; select.onchange = () => send({type:'acp/set-config',sessionId:panelState.sessionId,optionId:option.id,value:select.value}); configBar.appendChild(select);
    } configBar.hidden = !configBar.childElementCount;
  }
  function markdown(container, source) {
    container.replaceChildren(); const lines = String(source).split('\n'); let paragraph = [], list = null, code = null;
    const flush = () => { if (paragraph.length) { const p = node('p'); inlineMarkdown(p, paragraph.join('\n')); container.appendChild(p); paragraph = []; } };
    for (const line of lines) {
      if (/^\s*```/.test(line)) { flush(); list = null; if (code) { container.appendChild(code); code = null; } else { code = node('pre'); code.appendChild(node('code')); } continue; }
      if (code) { code.firstChild.textContent += (code.firstChild.textContent ? '\n' : '') + line; continue; }
      const item = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)/);
      if (item) { flush(); const ordered = /^\s*\d/.test(line); if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) { list = node(ordered ? 'ol' : 'ul'); container.appendChild(list); } const li = node('li'); inlineMarkdown(li,item[1]); list.appendChild(li); }
      else { list = null; if (!line.trim()) flush(); else paragraph.push(line); }
    }
    flush(); if (code) container.appendChild(code);
  }
  function scrollMessages() { messages.scrollTop = messages.scrollHeight; }
  function chunkText(content) { if (typeof content === 'string') return content; if (Array.isArray(content)) return content.map(chunkText).join(''); return content?.text || ''; }
  function entryForChunk(kind) {
    let entry = panelState.entries[panelState.entries.length-1];
    if (!entry || entry.kind !== kind) {
      const outer = node(kind === 'agent_thought_chunk' ? 'details' : 'div', 'aw-entry aw-' + kind);
      if (kind === 'agent_thought_chunk') outer.appendChild(node('summary','',tr('Thought','思考')));
      const body = node('div','aw-markdown'); outer.appendChild(body); messages.appendChild(outer);
      entry = {kind, outer, body, text:''}; panelState.entries.push(entry);
    }
    return entry;
  }
  function renderToolContent(body, content) {
    body.replaceChildren();
    for (const item of (Array.isArray(content) ? content : content ? [content] : [])) {
      if (item.type === 'diff' || item.oldText != null || item.newText != null) {
        if (item.path) body.appendChild(node('div','aw-path',item.path));
        const pre = node('pre','aw-diff');
        for (const line of String(item.oldText ?? '').split('\n')) if (line) pre.appendChild(node('div','aw-minus','- ' + line));
        for (const line of String(item.newText ?? '').split('\n')) if (line) pre.appendChild(node('div','aw-plus','+ ' + line));
        body.appendChild(pre);
      } else { const text = chunkText(item.content || item); if (text) { const div = node('div','aw-markdown'); markdown(div,text); body.appendChild(div); } }
    }
  }
  function renderUpdate(update) {
    if (!update) return;
    const kind = update.sessionUpdate || update.type;
    if (kind === 'config_option_update') { renderConfig(update.configOptions); return; }
    if (['agent_message_chunk','agent_thought_chunk','user_message_chunk'].includes(kind)) { const e = entryForChunk(kind); e.text += chunkText(update.content); markdown(e.body,e.text); }
    else if (kind === 'tool_call' || kind === 'tool_call_update') {
      const id = update.toolCallId; let e = panelState.tools.get(id);
      if (!e) { const outer = node('details','aw-entry aw-tool'); const summary = node('summary'); const body = node('div','aw-tool-content'); outer.append(summary,body); messages.appendChild(outer); e = {kind:'tool', outer, summary, body, data:{}}; panelState.tools.set(id,e); panelState.entries.push(e); }
      Object.assign(e.data,update); const icons = {read:'◉',edit:'✎',delete:'−',move:'↪',search:'⌕',execute:'▶',think:'◌',fetch:'↓',switch_mode:'⇄',other:'◇'};
      const statusIcons = {pending:'○',in_progress:'◌',completed:'✓',failed:'✕'};
      e.summary.textContent = `${icons[e.data.kind] || '◇'} ${e.data.title || tr('Tool call','ツール呼び出し')} ${statusIcons[e.data.status] || '○'} ${e.data.status || 'pending'}`;
      renderToolContent(e.body,e.data.content);
    } else if (kind === 'plan') {
      const outer = node('div','aw-entry aw-plan'); outer.appendChild(node('strong','',tr('Plan','プラン'))); const ul = node('ul');
      for (const item of update.entries || []) { const icon = item.status === 'completed' ? '☑' : item.status === 'in_progress' ? '◉' : '☐'; ul.appendChild(node('li','',`${icon} ${item.content} (${item.status})`)); } outer.appendChild(ul); messages.appendChild(outer); panelState.entries.push({kind,outer});
    }
    scrollMessages();
  }
  function permission(msg) {
    const card = node('div','aw-entry aw-permission'); card.appendChild(node('strong','',tr('Permission required','許可が必要です'))); card.appendChild(node('p','',msg.toolCall?.title || tr('Allow this action?','この操作を許可しますか？')));
    for (const option of msg.options || []) { const button = node('button','',option.name || option.label || option.optionId); button.type = 'button'; button.onclick = () => { send({type:'acp/permission',requestId:msg.requestId,optionId:option.optionId}); for (const b of card.querySelectorAll('button')) b.disabled = true; }; card.appendChild(button); }
    messages.appendChild(card); panelState.entries.push({kind:'permission',outer:card}); scrollMessages();
  }
  function clearMessages() { messages.replaceChildren(); panelState.entries = []; panelState.tools.clear(); }
  function handleAcp(msg) {
    if (!panel) return;
    if (msg.type === 'acp/agents') { const selected = panelState.agentId || agentSelect.value; agentSelect.replaceChildren(); agentSelect.appendChild(node('option','',tr('Choose an agent','エージェントを選択'))); agentSelect.firstChild.value = ''; for (const agent of msg.list || []) { const opt = node('option','',agent.label || agent.id); opt.value = agent.id; opt.disabled = agent.available === false; agentSelect.appendChild(opt); } agentSelect.value = selected; }
    else if (msg.type === 'acp/session') { panelState.sessionId = msg.sessionId; panelState.agentId = msg.agentId; storageSet('agentwarp.panel.session', JSON.stringify({sessionId:msg.sessionId,agentId:msg.agentId})); agentSelect.value = msg.agentId; clearMessages(); renderConfig(msg.configOptions); updateControls(); }
    else if (msg.type === 'acp/config' && msg.sessionId === panelState.sessionId) renderConfig(msg.configOptions);
    else if (msg.type === 'acp/history' && msg.sessionId === panelState.sessionId) { clearMessages(); for (const item of msg.messages || msg.history || msg.entries || []) { if (item.type === 'acp/update') renderUpdate(item.update); else if (item.type === 'acp/permission-request') permission(item); else if (item.update) renderUpdate(item.update); else renderUpdate(item); } }
    else if (msg.type === 'acp/update' && msg.sessionId === panelState.sessionId) renderUpdate(msg.update);
    else if (msg.type === 'acp/permission-request' && msg.sessionId === panelState.sessionId) permission(msg);
    else if (msg.type === 'acp/done' && msg.sessionId === panelState.sessionId) { panelState.running = false; stopButton.disabled = false; updateControls(); }
    else if (msg.type === 'acp/error') { const error = node('div','aw-entry aw-error',msg.message || tr('Agent error','エージェントエラー')); messages.appendChild(error); panelState.entries.push({kind:'error',outer:error}); panelState.running = false; stopButton.disabled = false; updateControls(); scrollMessages(); }
  }
  function editorContext() {
    const selected = window.ScratchBlocks?.selected || window.ScratchBlocks?.common?.getSelected?.();
    const stageButtons = stageToggles();
    return {editingTarget: vm.editingTarget?.getName?.(), selectedBlockId: selected?.id || null, stageSize: stageButtons.length >= 2 ? (stageButtons[0].getAttribute('aria-pressed') === 'true' ? 'small' : 'large') : undefined, running: vm.runtime.threads.some(t => !t.isKilled), rev: state.rev};
  }
  function submitPrompt() { const text = input.value.trim(); if (!text || input.disabled || panelState.composing) return; input.value = ''; renderUpdate({sessionUpdate:'user_message_chunk',content:{type:'text',text}}); panelState.running = true; updateControls(); send({type:'acp/prompt',sessionId:panelState.sessionId,text,context:editorContext()}); }
  function createPanel() {
    const body = document.querySelector('[class*="gui_body-wrapper_"]'), menu = document.querySelector('[class*="menu-bar_main-menu_"]'); if (!body || !menu) return false;
    const style = node('style'); style.textContent = `
      #agentwarp-panel [hidden],#agentwarp-panel[hidden]{display:none!important} #agentwarp-panel{--aw-bg:#fff;--aw-fg:#242832;--aw-border:#d5dae2;--aw-card:#f2f4f8; display:flex;flex-direction:column;flex:0 0 var(--aw-width,360px);width:var(--aw-width,360px);min-width:240px;max-width:65vw;min-height:0;position:relative;background:var(--aw-bg);color:var(--aw-fg);border-left:1px solid var(--aw-border);font:13px/1.45 sans-serif;box-sizing:border-box} #agentwarp-panel.aw-dark{--aw-bg:#252b35;--aw-fg:#eee;--aw-border:#4a5362;--aw-card:#333b48} #agentwarp-panel *{box-sizing:border-box} #agentwarp-panel button,#agentwarp-panel select,#agentwarp-panel textarea{font:inherit;color:inherit;background:var(--aw-card);border:1px solid var(--aw-border);border-radius:4px;padding:6px} #agentwarp-panel button{cursor:pointer} #agentwarp-panel button:disabled{opacity:.5;cursor:default} #agentwarp-panel button:focus-visible,#agentwarp-panel textarea:focus-visible,#agentwarp-panel select:focus-visible,#agentwarp-toggle:focus-visible{outline:2px solid #4c97ff;outline-offset:2px} #agentwarp-panel .aw-resize{position:absolute;left:-5px;top:0;bottom:0;width:10px;cursor:col-resize;z-index:2;touch-action:none} #agentwarp-panel .aw-header,#agentwarp-panel .aw-compose{padding:10px;display:flex;gap:6px;border-bottom:1px solid var(--aw-border)} #agentwarp-panel .aw-header select{min-width:0;flex:1} #agentwarp-panel .aw-messages{overflow:auto;flex:1;min-height:0;padding:10px} #agentwarp-panel .aw-entry{background:var(--aw-card);border-radius:6px;padding:9px;margin-bottom:9px;overflow-wrap:anywhere} #agentwarp-panel .aw-user_message_chunk{border-left:3px solid #4c97ff} #agentwarp-panel summary{cursor:pointer} #agentwarp-panel p{white-space:pre-wrap;margin:0 0 7px} #agentwarp-panel p:last-child{margin-bottom:0} #agentwarp-panel pre{overflow:auto;white-space:pre;background:#0002;padding:7px;border-radius:4px} #agentwarp-panel ul,#agentwarp-panel ol{padding-left:22px} #agentwarp-panel .aw-plan ul{list-style:none;padding:0} #agentwarp-panel .aw-minus{color:#c84545} #agentwarp-panel .aw-plus{color:#168651} #agentwarp-panel .aw-error{border-left:3px solid #d44} #agentwarp-panel .aw-permission button{margin:3px} #agentwarp-panel .aw-compose{border-top:1px solid var(--aw-border);border-bottom:0;align-items:end} #agentwarp-panel textarea{resize:vertical;min-height:60px;max-height:180px;flex:1;min-width:0} #agentwarp-toggle{align-self:center;margin:0 6px;padding:5px 9px;border:1px solid #ffffff88;border-radius:4px;background:transparent;color:white;cursor:pointer} .aw-glow>.blocklyPath{filter:drop-shadow(0 0 6px #ffcc00);stroke:#ffcc00!important;stroke-width:3px!important}
    `; document.head.appendChild(style);
    body.style.display = 'flex'; body.style.flexDirection = 'row'; body.style.minWidth = '0'; const editor = body.querySelector('[class*="gui_flex-wrapper_"]'); if (editor) { editor.style.flex = '1 1 0'; editor.style.minWidth = '0'; }
    panel = node('aside'); panel.hidden = true; panel.id = 'agentwarp-panel'; panel.setAttribute('aria-label',tr('Agent chat','エージェントチャット')); panel.style.setProperty('--aw-width',`${Math.max(240,Math.min(900,Number(storageGet('agentwarp.panel.width')) || 360))}px`);
    const refreshTheme = () => { const value = getComputedStyle(document.documentElement).getPropertyValue('--ui-primary').trim(); const hex = value.match(/^#([0-9a-f]{6})$/i); const dark = hex && [0,2,4].reduce((sum,i) => sum + parseInt(hex[1].slice(i,i+2),16),0) < 384; panel.classList.toggle('aw-dark', !!dark || /dark/i.test(document.documentElement.className + ' ' + document.body.className)); };
    refreshTheme(); new MutationObserver(refreshTheme).observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
    const grip = node('div','aw-resize'); grip.setAttribute('role','separator'); grip.setAttribute('aria-orientation','vertical'); grip.setAttribute('aria-label',tr('Resize panel','パネルの幅を変更')); grip.tabIndex = 0;
    function width(value) { const w = Math.round(Math.max(240,Math.min(innerWidth*.65,value))); panel.style.setProperty('--aw-width',w+'px'); storageSet('agentwarp.panel.width',String(w)); resizeEditor(); }
    grip.onpointerdown = e => { e.preventDefault(); grip.setPointerCapture(e.pointerId); }; grip.onpointermove = e => { if (grip.hasPointerCapture(e.pointerId)) width(innerWidth-e.clientX); }; grip.onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); width(panel.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 20 : -20)); } };
    const header = node('div','aw-header'); agentSelect = node('select'); agentSelect.setAttribute('aria-label',tr('Agent','エージェント')); agentSelect.onchange = () => { if (agentSelect.value) send({type:'acp/start',agentId:agentSelect.value}); }; const newChat = node('button','',tr('New chat','新しいチャット')); newChat.type='button'; newChat.onclick = () => { if (agentSelect.value) send({type:'acp/start',agentId:agentSelect.value}); }; header.append(agentSelect,newChat);
    configBar = node('div','aw-header'); configBar.hidden = true; messages = node('div','aw-messages'); messages.setAttribute('aria-live','polite'); const compose = node('div','aw-compose'); input = node('textarea'); input.placeholder = tr('Message the agent','エージェントにメッセージ'); input.setAttribute('aria-label',input.placeholder); input.oncompositionstart = () => { panelState.composing = true; }; input.oncompositionend = () => { panelState.composing = false; }; input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !panelState.composing && e.keyCode !== 229) { e.preventDefault(); submitPrompt(); } }; sendButton = node('button','',tr('Send','送信')); sendButton.type='button'; sendButton.onclick = submitPrompt; stopButton = node('button','',tr('Stop','停止')); stopButton.type='button'; stopButton.onclick = () => { send({type:'acp/cancel',sessionId:panelState.sessionId}); stopButton.disabled = true; }; compose.append(input,sendButton,stopButton); panel.append(grip,header,configBar,messages,compose); body.appendChild(panel);
    panelToggle = node('button','',tr('Agent','エージェント')); panelToggle.id='agentwarp-toggle'; panelToggle.type='button'; panelToggle.setAttribute('aria-controls','agentwarp-panel'); panelToggle.onclick = () => setOpen(panel.hidden); menu.appendChild(panelToggle); setOpen(storageGet('agentwarp.panel.open') === 'true');
    try { const saved = JSON.parse(storageGet('agentwarp.panel.session')); if (saved?.sessionId) Object.assign(panelState,saved); } catch (_) {} updateControls(); return true;
  }
  function acpConnected() { stopButton.disabled = false; send({type:'acp/agents'}); if (panelState.sessionId) send({type:'acp/history',sessionId:panelState.sessionId}); updateControls(); }
  function scriptSnapshot() {
    const blocks = vm.editingTarget?.blocks?._blocks || {}; const result = new Map();
    for (const [id, block] of Object.entries(blocks)) if (block.topLevel) { const seen = new Set(); const collect = key => { if (!key || seen.has(key) || !blocks[key]) return; seen.add(key); const b = blocks[key]; collect(b.next); for (const input of Object.values(b.inputs || {})) { collect(input.block); collect(input.shadow); } }; collect(id); result.set(id,JSON.stringify([...seen].sort().map(key => [key,blocks[key]]))); }
    return result;
  }
  function highlightChanges(before) { const after = scriptSnapshot(), w = workspace(); for (const [id, value] of after) if (before.get(id) !== value) { const root = w?.getBlockById?.(id)?.getSvgRoot?.(); if (root) { root.classList.add('aw-glow'); setTimeout(() => root.classList.remove('aw-glow'),1500); } } }

  function changeConnection(next) {
    config = next; generation++; clearTimeout(reconnectTimer); if (socket) socket.close(); state.connected = false; reconnectDelay = 500; connect(generation);
  }
  function connect(gen) {
    if (gen !== generation || state.stopped) return;
    status('syncing', 'Connecting to bridge');
    const u = new URL(endpoint('/ws')); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    try { socket = new WebSocket(u.href); } catch (error) { status('error', error.message); reconnectTimer = setTimeout(() => connect(gen), reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); return; }
    const current = socket;
    current.onopen = () => { if (gen !== generation) return; state.connected = true; reconnectDelay = 500; status('connected'); send({type:'hello', client:'turbowarp', version:'1'}); acpConnected(); schedule(); };
    current.onmessage = event => {
      if (gen !== generation) return;
      let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type.startsWith('acp/')) handleAcp(msg);
      else if (msg.type === 'hello' && Number.isInteger(msg.rev)) { if (msg.session && state.session && msg.session !== state.session) { state.rev = null; } if (msg.session) state.session = msg.session; if (state.rev !== msg.rev) enqueue(() => load(msg.rev)); }
      else if (msg.type === 'load' && Number.isInteger(msg.rev)) enqueue(() => load(msg.rev));
      else if (msg.type === 'status') { const detail = [msg.message, ...(msg.diagnostics || []).map(d => typeof d === 'string' ? d : `${d.file || ''}${d.line != null ? ':' + d.line : ''}${d.col != null ? ':' + d.col : ''}: ${d.message}`), ...(msg.conflicts || []).map(d => typeof d === 'string' ? d : JSON.stringify(d))].filter(Boolean).join('\n'); status(msg.ok === false || (msg.conflicts || []).length ? 'error' : 'connected', detail); }
    };
    current.onerror = () => { if (gen === generation) status('error', 'Bridge connection failed. Check URL, token, browser Local Network Access permission and CORS.'); };
    current.onclose = () => { if (gen !== generation || state.stopped) return; state.connected = false; updateControls(); status('error', 'Disconnected; reconnecting'); reconnectTimer = setTimeout(() => connect(gen), reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); };
  }
  async function start() {
    while (!window.vm || !window.vm.runtime || !document.body) await sleep(100);
    vm = window.vm; attachPill();
    while (!createPanel()) await sleep(100);
    vm.on('PROJECT_CHANGED', () => { if (!state.loading) { state.dirty = true; schedule(); } });
    config = normalize(window.AGENTWARP) || savedConfig();
    if (config) changeConnection(config); else { status('error', 'Configure the bridge connection'); dialog(); }
  }
  state.disconnect = () => { state.stopped = true; generation++; clearTimeout(timer); clearTimeout(reconnectTimer); if (socket) socket.close(); };
  start().catch(error => status('error', error.message));
})();
