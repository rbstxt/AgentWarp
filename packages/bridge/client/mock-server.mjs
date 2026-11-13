import http from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';

// Test-only mock. The control methods are deliberately not exposed over HTTP.
export async function createMock({project, token = 'test-token', port = 0, rev = 1} = {}) {
  let data = Buffer.isBuffer(project) ? project : await readFile(project);
  const posts = [], acks = [], clients = new Set();
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
    ws.on('message', data => { try { const msg = JSON.parse(data); if (msg.type === 'ack') acks.push(msg.rev); } catch {} });
    ws.on('close', () => clients.delete(ws));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    port:server.address().port, token, posts, acks, get rev() { return rev; }, get project() { return data; },
    push(project) { data = Buffer.from(project); rev++; for (const ws of clients) ws.send(JSON.stringify({type:'load', rev})); return rev; },
    async close() { for (const ws of clients) ws.terminate(); await new Promise(resolve => server.close(resolve)); wss.close(); }
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
