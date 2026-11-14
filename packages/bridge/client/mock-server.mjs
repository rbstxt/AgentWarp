import http from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';

// Test-only mock. The control methods are deliberately not exposed over HTTP.
export async function createMock({project, token = 'test-token', port = 0, rev = 1, changedProject, blockId = 'mock'} = {}) {
  let data = Buffer.isBuffer(project) ? project : await readFile(project);
  const posts = [], acks = [], clients = new Set(), acpMessages = [], sessions = new Map(), timers = new Set();
  let nextSession = 0, permissionSession; const checkpoints = new Map(), turns = new Map(), activeTurns = new Map(), changeFactories = new Map();
  const push = project => { data = Buffer.from(project); rev++; for (const client of clients) if (client.readyState === client.OPEN) client.send(JSON.stringify({type:'load', rev})); return rev; };
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Base-Rev');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('token') !== token) return res.writeHead(403).end();
    if (req.method === 'GET' && url.pathname === '/project.sb3') return res.writeHead(200, {'Content-Type':'application/octet-stream'}).end(data);
    if (req.method === 'GET' && url.pathname === '/client.js') return res.writeHead(200, {'Content-Type':'text/javascript', 'Cache-Control':'no-store'}).end(await readFile(new URL('../../panel/dist/agentwarp-client.js', import.meta.url)));
    if (req.method === 'GET' && url.pathname === '/file') { if (url.searchParams.get('path') !== 'demo.png') return res.writeHead(404).end(); return res.writeHead(200, {'Content-Type':'image/png'}).end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=','base64')); }
    if (req.method === 'GET' && url.pathname === '/status') return res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({rev}));
    if (req.method === 'POST' && url.pathname === '/editor.sb3') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      data = Buffer.concat(chunks); posts.push({baseRev: req.headers['x-base-rev'], data}); rev++;
      return res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({rev}));
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({noServer:true});
  server.on('upgrade', (req, sock, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) return sock.destroy();
    wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    clients.add(ws); ws.send(JSON.stringify({type:'hello', rev, name:'Mock'}));
    ws.on('message', raw => { try {
      const msg = JSON.parse(raw); if (msg.type === 'ack') acks.push(msg.rev);
      if (!msg.type?.startsWith('acp/')) return;
      acpMessages.push(msg);
      const reply = value => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value)); };
      const configOptions = (initial = []) => [
        {id:'model',name:'Model',category:'model',type:'select',currentValue:'mock',options:[{value:'mock',name:'Mock model'},{value:'opus',name:'Opus 5.5'}]},
        {id:'effort',name:'Effort',category:'thought_level',type:'select',currentValue:'high',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]},
        {id:'mode',name:'Mode',category:'mode',type:'select',currentValue:'agent',options:[{value:'agent',name:'Agent'},{value:'ask',name:'Ask'}]},
        {id:'speed',name:'Fast mode',category:'model_config',type:'select',currentValue:'off',options:[{value:'off',name:'Off'},{value:'on',name:'On'}]},
      ].map(o => ({...o,currentValue:initial.find(x=>x.configId===o.id)?.value ?? o.currentValue}));
      if (msg.type === 'acp/agents') reply({type:'acp/agents',list:[{id:'mock',label:'Mock agent',available:true},{id:'missing',label:'Unavailable',available:false}]});
      else if (msg.type === 'acp/options') reply({type:'acp/options',agentId:msg.agentId,promptCapabilities:{image:true},configOptions:configOptions()});
      else if (msg.type === 'acp/start') { const sessionId = `mock-${++nextSession}`; sessions.set(sessionId,[]); reply({type:'acp/session',sessionId,agentId:msg.agentId,promptCapabilities:{image:true},modes:{currentModeId:'agent',availableModes:[{id:'agent',name:'Agent'},{id:'ask',name:'Ask'}]},configOptions:configOptions(msg.configOptions)}); }
      else if (msg.type === 'acp/sessions') reply({type:'acp/sessions',list:[...sessions.keys()].map(sessionId=>({sessionId,agentId:'mock',title:'Mock chat',updatedAt:new Date().toISOString(),turns:1}))});
      else if (msg.type === 'acp/load') { for (const event of sessions.get(msg.sessionId)||[]) reply(event); reply({type:'acp/session',sessionId:msg.sessionId,agentId:'mock',promptCapabilities:{image:true}}); }
      else if (msg.type === 'acp/set-config') reply({type:'acp/config',sessionId:msg.sessionId,configOptions:configOptions([{configId:msg.optionId,value:msg.value}])});
      else if (msg.type === 'acp/set-mode') reply({type:'acp/mode',sessionId:msg.sessionId,currentModeId:msg.modeId});
      else if (msg.type === 'acp/restore') { const snapshot = checkpoints.get(`${msg.sessionId}:${msg.turnId}`); if (snapshot) { push(snapshot); for (const client of clients) if (client.readyState === client.OPEN) client.send(JSON.stringify({type:'acp/restored',sessionId:msg.sessionId,turnId:msg.turnId,rev})); } }
      else if (msg.type === 'acp/history') { for (const event of sessions.get(msg.sessionId)||[]) reply(event); }
      else if (msg.type === 'acp/changes') { const final=activeTurns.get(msg.sessionId)!==msg.turnId; const change=changeFactories.get(`${msg.sessionId}:${msg.turnId}`); if(change) reply(change(final)); else reply({type:'acp/error',sessionId:msg.sessionId,message:'unknown checkpoint'}); }
      else if (msg.type === 'acp/prompt') {
        const history = sessions.get(msg.sessionId); if (!history) return; permissionSession = msg.sessionId;
        const record = update => { const event = {type:'acp/update',sessionId:msg.sessionId,update}; history.push(event); reply(event); };
        history.push({type:'acp/update',sessionId:msg.sessionId,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:msg.text}}});
        const turnId = `turn-${history.length}`; activeTurns.set(msg.sessionId, turnId); checkpoints.set(`${msg.sessionId}:${turnId}`, Buffer.from(data)); turns.set(msg.sessionId, turnId); reply({type:'acp/turn-start',sessionId:msg.sessionId,turnId,rev});
        const change = final => ({type:'acp/changes',sessionId:msg.sessionId,turnId,final,targets:[{name:'Sprite1',isStage:false,scripts:[{status:'changed',topBlockId:blockId,anchor:'a1',label:'when green flag clicked · 2 blocks',summary:{opcode:'event_whenflagclicked',fields:{},blockCount:2},scratchblocks:final?'when green flag clicked\nmove (25) steps':'when green flag clicked\nmove (15) steps',file:'Sprite1/scripts.ts',line:1}]}]});
        changeFactories.set(`${msg.sessionId}:${turnId}`,change);
        const steps = [
          () => { if (changedProject) push(changedProject); reply(change(false)); },
          () => record({sessionUpdate:'usage_update',used:2000,size:10000}),
          () => record({sessionUpdate:'session_info_update',title:'Improve the project'}),
          () => record({sessionUpdate:'available_commands_update',availableCommands:[{name:'help',description:'Show help'}]}),
          () => record({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Hello **agent**.\n\n- First item\n- Second item\n\n```js\n'}}),
          () => record({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'const answer = 42;\n```\n\nUse `answer`.'}}),
          () => record({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Thinking privately.'}}),
          () => record({sessionUpdate:'tool_call',toolCallId:'edit-1',title:'Edit scripts',kind:'edit',status:'in_progress',content:[{type:'diff',path:'sprite/scripts.ts',oldText:'move(10)',newText:'move(25)'}]}),
          () => record({sessionUpdate:'tool_call_update',toolCallId:'edit-1',status:'completed'}),
          () => record({sessionUpdate:'plan',entries:[{content:'Update script',status:'completed'},{content:'Check project',status:'in_progress'}]}),
          () => reply({type:'acp/permission-request',requestId:'permission-1',sessionId:msg.sessionId,toolCall:{title:'Run check'},options:[{optionId:'allow',kind:'allow_once',name:'Allow'},{optionId:'always',kind:'allow_always',name:'Always'},{optionId:'deny',kind:'reject_once',name:'Deny'}]})
        ];
        steps.forEach((step,i) => { const timer = setTimeout(() => { timers.delete(timer); if (activeTurns.get(msg.sessionId) === turnId) step(); }, 100*(i+1)); timers.add(timer); });
      } else if (msg.type === 'acp/permission') { activeTurns.delete(permissionSession); reply({type:'acp/done',sessionId:permissionSession,stopReason:'end_turn'}); reply({type:'acp/changes',sessionId:permissionSession,turnId:turns.get(permissionSession),final:true,targets:[{name:'Sprite1',isStage:false,scripts:[{status:'changed',topBlockId:blockId,anchor:'a1',label:'when green flag clicked · 2 blocks',summary:{opcode:'event_whenflagclicked',fields:{},blockCount:2},scratchblocks:'when green flag clicked\nmove (25) steps',file:'Sprite1/scripts.ts',line:1}]}]}); } else if (msg.type === 'acp/cancel') { activeTurns.delete(msg.sessionId); reply({type:'acp/done',sessionId:msg.sessionId,stopReason:'cancelled'}); }
    } catch {} });
    ws.on('close', () => clients.delete(ws));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    port:server.address().port, token, posts, acks, acpMessages, get rev() { return rev; }, get project() { return data; },
    push,
    async close() { for (const timer of timers) clearTimeout(timer); for (const ws of clients) ws.terminate(); await new Promise(resolve => server.close(resolve)); wss.close(); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [project, port = '8765', token = 'test-token'] = process.argv.slice(2);
  if (!project) { console.error('Usage: node mock-server.mjs project.sb3 [port] [token]'); process.exit(1); }
  const mock = await createMock({project, port:Number(port), token});
  console.log(`Mock bridge: http://127.0.0.1:${mock.port}, token: ${mock.token}`);
  console.log('Type a path to another sb3 and press Enter to push it.');
  process.stdin.setEncoding('utf8'); let input = '';
  process.stdin.on('data', async chunk => { input += chunk; while (input.includes('\n')) { const index = input.indexOf('\n'), path = input.slice(0,index).trim(); input = input.slice(index+1); if (path) try { console.log(`Pushed revision ${mock.push(await readFile(path))}`); } catch (error) { console.error(error.message); } } });
}
