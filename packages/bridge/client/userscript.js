/* Stable TurboWarp loader. The bridge serves the versioned panel bundle. */
(() => {
  const load = config => {
    try {
      const url = new URL(config.url || config.bridgeUrl);
      if (!['http:', 'https:'].includes(url.protocol) || !config.token) throw Error('Invalid connection');
      window.AGENTWARP = {url: url.origin, token: String(config.token)};
      const script = document.createElement('script');
      script.src = `${url.origin}/client.js?token=${encodeURIComponent(config.token)}`;
      script.onerror = () => alert('Could not load AgentWarp from the bridge.');
      document.head.append(script);
    } catch (error) { alert(error.message); }
  };
  let config = window.AGENTWARP;
  try { config ||= JSON.parse(localStorage.getItem('agentwarp')); } catch (_) {}
  if (config) return load(config);
  const show = () => {
    const form = document.createElement('form');
    Object.assign(form.style, {position:'fixed', right:'12px', bottom:'12px', zIndex:'2147483647', padding:'16px', background:'white', color:'#222', border:'1px solid #aaa', borderRadius:'8px', boxShadow:'0 2px 16px #0003', font:'13px sans-serif'});
    form.innerHTML = '<strong>Connect AgentWarp</strong><p><label>Bridge URL<br><input name="url" type="url" placeholder="http://127.0.0.1:8765" required></label></p><p><label>Token<br><input name="token" type="password" required></label></p><button>Connect</button>';
    form.onsubmit = event => { event.preventDefault(); const next = {url:form.elements.url.value,token:form.elements.token.value}; try {localStorage.setItem('agentwarp',JSON.stringify(next));} catch (_) {} form.remove(); load(next); };
    document.body.append(form);
  };
  if (document.body) show(); else addEventListener('DOMContentLoaded',show,{once:true});
})();
