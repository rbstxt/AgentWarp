export interface SyncState {
  rev: number | null; connected: boolean; dirty: boolean; loading: boolean;
  diagnostics: string; stopped: boolean; status?: string; session?: string;
  /** first sync with a bridge finished (load, adopt or switch) */ synced?: boolean;
  /** the user opened another project while the bridge was unreachable */ switchPending?: boolean;
  /** the bridge cannot switch projects: stop syncing rather than overwrite the user's project */ detached?: boolean;
  /** a switch/adopt was sent; no uploads until the new bridge says hello */ switching?: boolean;
  /** desktop app: the engine keeps stopping (details + log location from the app) */ engineError?: string;
  disconnect?: () => void;
}
type Connection = {url: string; token: string};
type Panel = {update?: () => void; message?: (message: any) => void; connected?: () => void};
type Mount = (api: any) => Promise<Panel>;

export function startSync(mount: Mount) {
  'use strict';
  if (window.__agentwarpClient) return;
  const state: SyncState = window.__agentwarpClient = { rev: null, connected: false, dirty: false, loading: false, diagnostics: '', stopped: false };
  let vm: any; // TurboWarp does not publish VM types.
  let socket: WebSocket | undefined, config: Connection | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 500, queue = Promise.resolve(), generation = 0;
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  // AgentWarp desktop app (TurboWarp fork): the app runs the engine and hands us the connection;
  // there is no connect dialog and no status pill (the panel shows the status).
  const desktop: any = (window as any).AgentWarpDesktop;
  const workspace = () => window.ScratchBlocks && (window.ScratchBlocks.getMainWorkspace?.() || window.ScratchBlocks.mainWorkspace);
  const pill = document.createElement('button');
  pill.id = 'agentwarp-status'; pill.type = 'button';
  Object.assign(pill.style, {position:'fixed', right:'8px', bottom:'3px', zIndex:'2147483646', font:'11px sans-serif', padding:'3px 7px', border:'0', borderRadius:'9px', color:'#fff', background:'#555', cursor:'pointer', opacity:'.9'});
  function status(label: string, detail = '') {
    state.status = label; state.diagnostics = detail;
    pill.textContent = `AgentWarp: ${label}`; pill.title = detail || 'Click to change connection';
    pill.style.background = label === 'connected' ? '#277a50' : label === 'error' ? '#a13b32' : '#665a35';
    try { panelApi?.update?.(); } catch (_) {}
  }
  function attachPill() { if (!desktop && document.body && !pill.isConnected) document.body.appendChild(pill); }
  attachPill();
  function normalize(value: any): Connection | null {
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
    try { return normalize(JSON.parse(localStorage.getItem('agentwarp') || 'null')); } catch (_) { return null; }
  }
  function dialog() {
    const box = document.createElement('form');
    Object.assign(box.style, {position:'fixed', right:'10px', bottom:'30px', zIndex:'2147483647', background:'white', color:'#222', padding:'12px', border:'1px solid #aaa', borderRadius:'6px', boxShadow:'0 2px 12px #0004', font:'13px sans-serif'});
    box.innerHTML = '<strong>Connect AgentWarp</strong><br><label>Bridge URL<br><input name="url" type="url" required placeholder="http://127.0.0.1:PORT"></label><br><label>Token<br><input name="token" type="password" required></label><br><button type="submit">Connect</button> <button type="button">Cancel</button>';
    const urlInput = box.elements.namedItem('url') as HTMLInputElement;
    const tokenInput = box.elements.namedItem('token') as HTMLInputElement;
    if (config) { urlInput.value = config.url; tokenInput.value = config.token; }
    box.querySelector<HTMLButtonElement>('button[type=button]')!.onclick = () => box.remove();
    box.onsubmit = event => { event.preventDefault(); const next = normalize({url:urlInput.value, token:tokenInput.value}); if (!next) return; try { localStorage.setItem('agentwarp', JSON.stringify(next)); } catch (_) {} box.remove(); changeConnection(next); };
    document.body.appendChild(box);
  }
  pill.onclick = dialog;
  /** Title + (desktop app) path of the open file, sent along with adopt/switch so the engine picks the right mirror. */
  async function projectMeta(url: URL) {
    const field = document.querySelector('[class*="title-field"]') as HTMLInputElement | null;
    url.searchParams.set('title', (field?.value || '').trim());
    try { const key = await desktop?.projectKey?.(); if (typeof key === 'string' && key) url.searchParams.set('key', key); } catch (_) {}
    return url.href;
  }
  let loadSeq = 0; // counts project loads (ours and the user's)
  function endpoint(path: string, rev?: number | null) { const u = new URL(path, config!.url); u.searchParams.set('token', config!.token); if (rev != null) u.searchParams.set('rev', String(rev)); return u.href; }
  function send(message: unknown) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  function enqueue(fn: () => Promise<void>) { queue = queue.then(fn).catch(error => { status('error', error.message || String(error)); console.error('[AgentWarp]', error); }); return queue; }
  function dragging() { const w = workspace(); return !!(w && (w.isDragging?.() || w.currentGesture_?.isDragging?.())); }
  function schedule() {
    clearTimeout(timer);
    if (!state.dirty || state.loading || !state.connected) return;
    timer = setTimeout(() => { if (dragging()) { schedule(); return; } enqueue(flush); }, 1000);
  }
  // Adopt mode (serve on an empty folder): send the project open in the editor so it becomes the
  // bridge project. Nothing is loaded back: the real bridge restarts with this exact project at rev 0.
  async function adopt() {
    status('syncing', 'Sending the open project to the bridge');
    // The app opens a file just after start-up: let a load in progress finish first.
    // (TurboWarp shows its loading screen while a project loads.)
    if (desktop) { await sleep(600); for (let i = 0; i < 600 && document.querySelector('[class*="loader_background"]'); i++) await sleep(100); await sleep(300); }
    const seq = loadSeq;
    try {
      const zip = vm._saveProjectZip();
      zip.file('project.json', vm.toJSON(undefined, {allowOptimization:false}));
      const blob = await zip.generateAsync({type:'blob', mimeType:'application/x.scratch.sb3'});
      const response = await fetch(await projectMeta(new URL(endpoint('/adopt.sb3'))), {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:blob});
      if (!response.ok) throw new Error(`Adopting the editor project failed: HTTP ${response.status}`);
      state.rev = 0; state.session = undefined; state.dirty = false; state.synced = true;
      // A project opened while we were sending: switch to it once the engine is up.
      if (loadSeq !== seq) state.switchPending = true;
      status('syncing', 'Project sent; waiting for the bridge');
    } catch (error) { status('error', error instanceof Error ? error.message : String(error)); }
  }
  /** Does the editor hold a real project (not the pristine default one)? */
  function editorHasContent() {
    const targets = vm.runtime.targets.filter((t: any) => t.isOriginal);
    const blocks = targets.reduce((n: number, t: any) => n + Object.keys(t.blocks?._blocks || {}).length, 0);
    const sprites = targets.filter((t: any) => !t.isStage).length;
    const stage = targets.find((t: any) => t.isStage);
    return blocks > 0 || sprites > 1 || (stage?.sprite?.costumes?.length || 0) > 1;
  }
  /** The user opened another project (File > New / Load / a file opened at startup): give it its
   *  own workspace instead of syncing it into the current one as an edit. */
  /** firstRev: set when called for the first hello (editor already had a project at connect time). */
  async function switchProject(firstRev?: number) {
    if (state.detached) return;
    clearTimeout(timer); state.dirty = false;
    status('syncing', 'Opening this project as a new workspace');
    await sleep(600); // TurboWarp sets the title (file name) just after the load finishes
    try {
      const zip = vm._saveProjectZip();
      zip.file('project.json', vm.toJSON(undefined, {allowOptimization:false}));
      const blob = await zip.generateAsync({type:'blob', mimeType:'application/x.scratch.sb3'});
      const response = await fetch(await projectMeta(new URL(endpoint('/switch.sb3'))), {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:blob});
      if (response.status === 404 && firstRev != null) {
        // Older bridge without switching, at connect time: previous behaviour (load the workspace).
        state.switchPending = false; await load(firstRev); return;
      }
      if (response.status === 404) {
        state.detached = true;
        status('error', 'This bridge cannot switch projects, so syncing is paused to keep the project you opened. Restart agentwarp serve (new version) and reload the editor.');
        return;
      }
      if (!response.ok) throw new Error(`Switching workspace failed: HTTP ${response.status}`);
      const result = await response.json().catch(() => ({}));
      if (result.same) {
        // The editor already holds this workspace's project: keep syncing, nothing reloads.
        state.rev = Number.isInteger(result.rev) ? result.rev : state.rev; state.switchPending = false; state.synced = true;
        updateControls(); status('connected'); return;
      }
      state.rev = 0; state.session = undefined; state.dirty = false; state.switchPending = false; state.synced = true; state.switching = true;
      status('syncing', 'Project sent; the bridge is moving to a new workspace');
    } catch (error) { state.switchPending = true; status('error', error instanceof Error ? error.message : String(error)); }
  }
  async function flush() {
    if (!state.dirty || !state.connected || state.loading || state.detached || state.switching) return;
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
    } catch (error) { state.dirty = true; status('error', error instanceof Error ? error.message : String(error)); schedule(); return; }
    schedule();
  }
  function capture() {
    const w = workspace(), target = vm.editingTarget;
    return {id:target?.id, name:target?.getName?.(), stage:target?.isStage, scale:w?.scale, x:w?.scrollX, y:w?.scrollY, running:vm.runtime.threads.some((t: any) => !t.isKilled)};
  }
  let ownLoad = false;
  async function load(rev: number) {
    if (state.rev === rev) return;
    if (state.dirty) { await flush(); if (state.dirty) throw new Error('Local edits could not be sent; postponed incoming project'); }
    rev = Math.max(rev, state.rev ?? rev);
    const old = capture(); const beforeScripts = panelState.running ? scriptSnapshot() : null; state.loading = true; clearTimeout(timer); status('syncing', `Loading revision ${rev}`);
    try {
      const response = await fetch(endpoint('/project.sb3', rev));
      if (!response.ok) throw new Error(`Project download failed: HTTP ${response.status}`);
      // Only this exact call is ours: a PROJECT_LOADED outside it is the user opening a project,
      // even during the settle time after a load (state.loading stays set for ~1 s).
      const bytes = await response.arrayBuffer(); ownLoad = true;
      try { await vm.loadProject(bytes); } finally { ownLoad = false; }
      const targets = vm.runtime.targets.filter((t: any) => t.isOriginal);
      const target = targets.find((t: any) => t.id === old.id) || targets.find((t: any) => t.isStage === old.stage && t.getName() === old.name);
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
      state.rev = rev; state.synced = true; updateControls(); send({type:'ack', rev}); status('connected');
    } finally { state.loading = false; schedule(); }
  }
  const panelState = {running:false};
  let panelApi: Panel | null = null;
  const updateControls = () => panelApi?.update?.();
  const handleAcp = (msg: any) => { try { panelApi?.message?.(msg); } catch (error) { console.error('[AgentWarp panel]', error); } };
  const acpConnected = () => { send({type:'acp/agents'}); panelApi?.connected?.(); };
  function scriptSnapshot() {
    const blocks: Record<string, {topLevel?: boolean; next?: string; inputs?: Record<string, {block?: string; shadow?: string}>}> = vm.editingTarget?.blocks?._blocks || {}; const result = new Map<string, string>();
    for (const [id, block] of Object.entries(blocks)) if (block.topLevel) { const seen = new Set<string>(); const collect = (key?: string) => { if (!key || seen.has(key) || !blocks[key]) return; seen.add(key); const b = blocks[key]; collect(b.next); for (const input of Object.values(b.inputs || {})) { collect(input.block); collect(input.shadow); } }; collect(id); result.set(id,JSON.stringify([...seen].sort().map(key => [key,blocks[key]]))); }
    return result;
  }
  function highlightChanges(before: Map<string, string>) { const after = scriptSnapshot(), w = workspace(); for (const [id, value] of after) if (before.get(id) !== value) { const root = w?.getBlockById?.(id)?.getSvgRoot?.(); if (root) { root.classList.add('aw-glow'); setTimeout(() => root.classList.remove('aw-glow'),1500); } } }

  function changeConnection(next: Connection) {
    config = next; generation++; clearTimeout(reconnectTimer); if (socket) socket.close(); state.connected = false; reconnectDelay = 500; connect(generation);
  }
  function connect(gen: number) {
    if (gen !== generation || state.stopped) return;
    status('syncing', 'Connecting to bridge');
    const u = new URL(endpoint('/ws')); u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    try { socket = new WebSocket(u.href); } catch (error) { status('error', error instanceof Error ? error.message : String(error)); reconnectTimer = setTimeout(() => connect(gen), reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 15000); return; }
    const current = socket;
    current.onopen = () => { if (gen !== generation) return; state.connected = true; state.engineError = undefined; reconnectDelay = 500; status('connected'); send({type:'hello', client:'turbowarp', version:'1'}); acpConnected(); schedule(); };
    current.onmessage = event => {
      if (gen !== generation) return;
      let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type.startsWith('acp/')) handleAcp(msg);
      else if (msg.type === 'hello' && msg.adopt) { enqueue(adopt); }
      else if (msg.type === 'hello' && state.switching) { state.switching = false; if (msg.session) state.session = msg.session; schedule(); }
      else if (msg.type === 'hello' && Number.isInteger(msg.rev) && !state.detached && (state.switchPending || (!state.synced && editorHasContent()))) { if (msg.session) state.session = msg.session; const first = state.synced ? undefined : msg.rev; enqueue(() => switchProject(first)); }
      else if (msg.type === 'hello' && Number.isInteger(msg.rev) && state.detached) { /* paused: keep the user's project */ }
      else if (msg.type === 'hello' && Number.isInteger(msg.rev)) { if (msg.session && state.session && msg.session !== state.session) { state.rev = null; } if (msg.session) state.session = msg.session; if (state.rev !== msg.rev) enqueue(() => load(msg.rev)); }
      else if (msg.type === 'load' && Number.isInteger(msg.rev)) enqueue(() => load(msg.rev));
      else if (msg.type === 'status') { const detail = [msg.message, ...(msg.diagnostics || []).map((d: any) => typeof d === 'string' ? d : `${d.file || ''}${d.line != null ? ':' + d.line : ''}${d.col != null ? ':' + d.col : ''}: ${d.message}`), ...(msg.conflicts || []).map((d: any) => typeof d === 'string' ? d : JSON.stringify(d))].filter(Boolean).join('\n'); status(msg.ok === false || (msg.conflicts || []).length ? 'error' : 'connected', detail); }
    };
    current.onerror = () => { if (gen !== generation) return; if (desktop) checkEngine(); else status('error', 'Bridge connection failed. Check URL, token, browser Local Network Access permission and CORS.'); };
    current.onclose = () => { if (gen !== generation || state.stopped) return; state.connected = false; updateControls(); if (desktop) checkEngine(); else status('error', 'Disconnected; reconnecting'); reconnectTimer = setTimeout(() => connect(gen), reconnectDelay); reconnectDelay = Math.min(reconnectDelay * (desktop ? 1.5 : 2), desktop ? 3000 : 15000); };
  }
  /** Desktop app: the engine is still starting, or the app reports it keeps stopping. */
  function noteEngine(value: any) {
    const error = value && typeof value.error === 'string' ? value.error : '';
    if (error === (state.engineError || '')) return;
    state.engineError = error || undefined;
    if (error) status('error', error); else if (!state.connected) status('syncing', 'Starting AgentWarp');
  }
  function checkEngine() {
    if (!state.engineError) status('syncing', 'Starting AgentWarp');
    desktop.config().then(noteEngine, () => undefined);
  }
  async function start() {
    while (!window.vm || !window.vm.runtime || !document.body) await sleep(100);
    vm = window.vm; attachPill();
    // UI initialization is isolated from project synchronization.
    try { panelApi = await mount({state, send, endpoint, workspace, getVM: () => vm, panelState, pill}); } catch (error) { console.error('[AgentWarp panel]', error); }
    vm.on('PROJECT_CHANGED', () => { if (!state.loading) { state.dirty = true; schedule(); } });
    // Our own loads set state.loading; any other load is the user opening a project.
    vm.runtime.on('PROJECT_LOADED', () => { loadSeq++; if (ownLoad || !state.synced || state.detached) return; clearTimeout(timer); state.dirty = false; if (state.connected) enqueue(switchProject); else state.switchPending = true; });
    if (desktop) {
      // The app starts the engine for this window; ask until it is ready.
      for (;;) { let value: any = null; try { value = await desktop.config(); } catch (_) {} config = normalize(value); noteEngine(value); if (config) break; if (!state.engineError) status('syncing', 'Starting AgentWarp'); await sleep(500); }
      changeConnection(config); return;
    }
    config = normalize(window.AGENTWARP) || savedConfig();
    if (config) changeConnection(config); else { status('error', 'Configure the bridge connection'); dialog(); }
  }
  state.disconnect = () => { state.stopped = true; generation++; clearTimeout(timer); clearTimeout(reconnectTimer); if (socket) socket.close(); };
  start().catch(error => status('error', error.message));
}
