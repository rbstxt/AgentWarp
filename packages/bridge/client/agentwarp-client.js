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
      const blob = await vm.saveProjectSb3();
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
    if (state.dirty) { await flush(); if (state.dirty) throw new Error('Local edits could not be sent; postponed incoming project'); }
    const old = capture(); state.loading = true; clearTimeout(timer); status('syncing', `Loading revision ${rev}`);
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
      state.rev = rev; send({type:'ack', rev}); status('connected');
    } finally { state.loading = false; schedule(); }
  }
  function changeConnection(next) {
    config = next; generation++; clearTimeout(reconnectTimer); if (socket) socket.close(); state.connected = false; reconnectDelay = 500; connect(generation);
  }
  function connect(gen) {
    if (gen !== generation || state.stopped) return;
    status('syncing', 'Connecting to bridge');
    const u = new URL(endpoint('/ws')); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    try { socket = new WebSocket(u.href); } catch (error) { status('error', error.message); reconnectTimer = setTimeout(() => connect(gen), reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); return; }
    const current = socket;
    current.onopen = () => { if (gen !== generation) return; state.connected = true; reconnectDelay = 500; status('connected'); send({type:'hello', client:'turbowarp', version:'1'}); schedule(); };
    current.onmessage = event => {
      if (gen !== generation) return;
      let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === 'hello' && Number.isInteger(msg.rev)) { if (state.rev !== msg.rev) enqueue(() => load(msg.rev)); }
      else if (msg.type === 'load' && Number.isInteger(msg.rev)) enqueue(() => load(msg.rev));
      else if (msg.type === 'status') { const detail = [msg.message, ...(msg.diagnostics || []).map(d => typeof d === 'string' ? d : JSON.stringify(d)), ...(msg.conflicts || []).map(d => typeof d === 'string' ? d : JSON.stringify(d))].filter(Boolean).join('\n'); status(msg.ok === false || detail ? 'error' : 'connected', detail); }
    };
    current.onerror = () => { if (gen === generation) status('error', 'Bridge connection failed. Check URL, token, browser Local Network Access permission and CORS.'); };
    current.onclose = () => { if (gen !== generation || state.stopped) return; state.connected = false; status('error', 'Disconnected; reconnecting'); reconnectTimer = setTimeout(() => connect(gen), reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); };
  }
  async function start() {
    while (!window.vm || !window.vm.runtime || !document.body) await sleep(100);
    vm = window.vm; attachPill();
    vm.on('PROJECT_CHANGED', () => { if (!state.loading) { state.dirty = true; schedule(); } });
    config = normalize(window.AGENTWARP) || savedConfig();
    if (config) changeConnection(config); else { status('error', 'Configure the bridge connection'); dialog(); }
  }
  state.disconnect = () => { state.stopped = true; generation++; clearTimeout(timer); clearTimeout(reconnectTimer); if (socket) socket.close(); };
  start().catch(error => status('error', error.message));
})();
