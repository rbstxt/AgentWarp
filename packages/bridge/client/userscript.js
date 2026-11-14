/* AgentWarp loader for TurboWarp (Desktop userscript or devtools paste).
 * Stays tiny and stable: the bridge serves the real client at GET /client.js, so
 * updating AgentWarp never requires touching this file again.
 * - No saved connection: shows a small connect form.
 * - Bridge not running: waits quietly (small pill, no alerts) and loads when it comes up.
 * - Wrong token: asks again. Click the pill to change the connection. */
(() => {
  if (window.__agentwarpLoader) return;
  window.__agentwarpLoader = true;
  const ja = (() => { try { return (localStorage.getItem('tw:language') || navigator.language || '').startsWith('ja'); } catch (_) { return false; } })();
  const t = (en, jp) => ja ? jp : en;
  const read = () => { try { return JSON.parse(localStorage.getItem('agentwarp') || 'null'); } catch (_) { return null; } };
  const save = config => { try { localStorage.setItem('agentwarp', JSON.stringify(config)); } catch (_) {} };
  let pill = null, form = null, timer = 0, delay = 2000, loaded = false;

  const ui = el => { if (document.body) document.body.append(el); else addEventListener('DOMContentLoaded', () => document.body.append(el), {once: true}); };
  const setPill = text => {
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      Object.assign(pill.style, {position: 'fixed', right: '8px', bottom: '3px', zIndex: '2147483646', padding: '2px 10px', border: '0', borderRadius: '10px', background: 'var(--ui-black-transparent, #0002)', color: 'var(--text-primary, #575e75)', font: '12px "Helvetica Neue", Helvetica, Arial, sans-serif', cursor: 'pointer', opacity: '0.85'});
      pill.onclick = () => showForm();
      ui(pill);
    }
    pill.textContent = text;
    pill.title = t('Click to change the AgentWarp connection', 'クリックで AgentWarp の接続先を変更');
  };

  const showForm = (message = '') => {
    clearTimeout(timer);
    form?.remove();
    const saved = read() || {};
    form = document.createElement('form');
    Object.assign(form.style, {position: 'fixed', right: '12px', bottom: '28px', zIndex: '2147483647', width: '280px', padding: '16px', background: 'var(--ui-modal-background, #fff)', color: 'var(--text-primary, #575e75)', border: '1px solid var(--ui-black-transparent, #0002)', borderRadius: '8px', boxShadow: '0 4px 24px #0003', font: '13px "Helvetica Neue", Helvetica, Arial, sans-serif'});
    const field = 'display:block;width:100%;box-sizing:border-box;margin:4px 0 10px;padding:6px 8px;border:1px solid var(--ui-black-transparent,#0002);border-radius:4px;background:var(--input-background,#fff);color:inherit;font:inherit';
    const button = 'padding:6px 14px;border:0;border-radius:4px;font:inherit;font-weight:bold;cursor:pointer';
    form.innerHTML = `<strong style="display:block;margin-bottom:10px">${t('Connect AgentWarp', 'AgentWarp に接続')}</strong>`
      + (message ? `<div style="margin-bottom:10px;color:var(--error-primary,#e65c00)"></div>` : '')
      + `<label>${t('Bridge URL', 'Bridge の URL')}<input name="url" type="url" required placeholder="http://127.0.0.1:8765" style="${field}"></label>`
      + `<label>${t('Token', 'トークン')}<input name="token" type="password" required style="${field}"></label>`
      + `<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-cancel style="${button};background:transparent;color:inherit">${t('Cancel', 'キャンセル')}</button><button style="${button};background:var(--looks-secondary,#ff4c4c);color:#fff">${t('Connect', '接続')}</button></div>`;
    if (message) form.querySelector('div').textContent = message;
    form.elements.url.value = saved.url || 'http://127.0.0.1:8765';
    form.elements.token.value = saved.token || '';
    form.querySelector('[data-cancel]').onclick = () => { form.remove(); form = null; if (!loaded && read()) attempt(); };
    form.onsubmit = event => {
      event.preventDefault();
      const next = {url: form.elements.url.value.trim(), token: form.elements.token.value.trim()};
      save(next); form.remove(); form = null; delay = 2000; attempt();
    };
    ui(form);
    form.elements[saved.token ? 'url' : 'token'].focus();
  };

  const retry = () => { clearTimeout(timer); timer = setTimeout(attempt, delay); delay = Math.min(delay * 2, 30000); };

  async function attempt() {
    if (loaded) return;
    const config = window.AGENTWARP || read();
    if (!config) { setPill(t('AgentWarp: not connected', 'AgentWarp：未接続')); showForm(); return; }
    let origin;
    try {
      const url = new URL(config.url || config.bridgeUrl);
      if (!['http:', 'https:'].includes(url.protocol) || !config.token) throw new Error();
      origin = url.origin;
    } catch (_) { showForm(t('The saved connection is invalid.', '保存された接続先が正しくありません。')); return; }
    const token = encodeURIComponent(String(config.token));
    let res;
    try { res = await fetch(`${origin}/status?token=${token}`, {cache: 'no-store'}); }
    catch (_) { setPill(t('AgentWarp: waiting for bridge…', 'AgentWarp：bridge を待機中…')); retry(); return; }
    if (res.status === 401) { setPill(t('AgentWarp: wrong token', 'AgentWarp：トークンが違います')); showForm(t('The bridge rejected the token.', 'bridge がトークンを受け付けませんでした。')); return; }
    if (!res.ok) { setPill(t('AgentWarp: bridge error', 'AgentWarp：bridge エラー')); retry(); return; }
    window.AGENTWARP = {url: origin, token: String(config.token)};
    const script = document.createElement('script');
    script.src = `${origin}/client.js?token=${token}`;
    script.onload = () => { loaded = true; pill?.remove(); pill = null; };
    script.onerror = () => { script.remove(); setPill(t('AgentWarp: waiting for bridge…', 'AgentWarp：bridge を待機中…')); retry(); };
    document.head.append(script);
  }

  attempt();
})();
