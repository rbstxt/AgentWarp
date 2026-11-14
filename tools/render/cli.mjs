#!/usr/bin/env node
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import gifenc from 'gifenc';
const {GIFEncoder, quantize, applyPalette} = gifenc;
import {PNG} from 'pngjs';
const root = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
function parse(args) {
    const [cmd, file, ...rest] = args;
    if (!['shot', 'compare'].includes(cmd) || !file) throw Error('usage: cli.mjs shot|compare <file.sb3> --frames N [--input file] [--seed N] [--at f1,f2] [--out dir] [--gif] [--timeout seconds]');
    const opts = {};
    for (let i=0; i<rest.length; i++) {
        const key = rest[i];
        if (!key.startsWith('--') || !['--frames','--input','--seed','--at','--out','--gif','--timeout'].includes(key)) throw Error(`unknown option ${key}`);
        if (key === '--gif') opts.gif = true;
        else { if (!rest[i+1] || rest[i+1].startsWith('--')) throw Error(`${key} needs a value`); opts[key.slice(2)] = rest[++i]; }
    }
    const frames = Number(opts.frames), seed = opts.seed === undefined ? 1 : Number(opts.seed);
    const timeout = opts.timeout === undefined ? 120 : Number(opts.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2147483647) throw Error('--timeout must be a positive number of seconds');
    if (opts.frames === undefined || !Number.isSafeInteger(frames) || frames < 0) throw Error('--frames must be a nonnegative integer');
    if (opts.gif && frames === 0) throw Error('--gif requires at least one frame');
    if (!Number.isFinite(seed)) throw Error('--seed must be a number');
    const at = opts.at === undefined ? (frames ? [frames-1] : []) : opts.at.split(',').map(x => { if (!/^\d+$/.test(x)) throw Error('invalid --at frame'); return Number(x); });
    if (at.some(x => !Number.isSafeInteger(x) || x >= frames)) throw Error('--at frames must be in [0, frames)');
    return {cmd,file,opts,frames,seed,timeout,at:[...new Set(at)]};
}
function diff(a,b,path='',out=[]) {
    if (Object.is(a,b)) return out;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key],b[key],path ? `${path}.${key}` : key,out);
    } else out.push({path, rendered:a ?? null, vmrun:b ?? null});
    return out;
}
async function main() {
    const {cmd,file,opts,frames,seed,timeout,at} = parse(process.argv.slice(2));
    let phase = 'loading', assets = 0, frame = 0, browser;
    const progress = () => console.error(phase === 'loading' ? `loading project, loaded ${assets} assets` : phase === 'frames' ? `frame ${frame} of ${frames}` : phase);
    progress();
    const progressTimer = setInterval(progress, 1000);
    let timedOut = false;
    const deadline = setTimeout(() => {
        timedOut = true;
        clearInterval(progressTimer);
        console.error(`render timed out after ${timeout} seconds (${phase}; frame ${frame} of ${frames}). Captured frames remain in ${resolve(opts.out || 'render-output')}`);
        // Closing Chromium is best effort. Do not let a stuck browser delay exit.
        if (browser) browser.close().catch(() => {});
        setTimeout(() => process.exit(1), 250).unref();
        process.exitCode = 1;
    }, timeout * 1000);
    try {
    const input = opts.input ? JSON.parse(await readFile(opts.input,'utf8')) : [];
    const inputs = Array.isArray(input) ? input : input?.inputs;
    if (!Array.isArray(inputs)) throw Error('--input must be a JSON array or {inputs: [...]}');
    const out = resolve(opts.out || 'render-output'); await mkdir(out,{recursive:true});
    const bundle = await build({entryPoints:[join(root,'browser.mjs')], bundle:true, write:false, platform:'browser', define:{global:'globalThis'}, format:'iife', logLevel:'silent', plugins:[{name:'fonts',setup(b){b.onResolve({filter:/^(worker-loader|.*tw-load-script-as-plain-text!)/},()=>({path:'unsupported',namespace:'unsupported'}));b.onLoad({filter:/.*/,namespace:'unsupported'},()=>({contents:'module.exports = class { constructor() { throw new Error("External extensions are unavailable") } }',loader:'js'}));b.onResolve({filter:/^base64-loader!/},a=>({path:resolve(a.resolveDir,a.path.slice(14)),namespace:'font-base64'}));b.onLoad({filter:/.*/,namespace:'font-base64'},async a=>({contents:`module.exports=${JSON.stringify((await readFile(a.path)).toString('base64'))}`,loader:'js'}));}}], loader:{'.mp3':'dataurl','.wav':'dataurl','.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'}});
    // Playwright's own Chromium when installed (development), else the user's Chrome / Edge
    // (the AgentWarp desktop app ships no browser of its own).
    const launchOptions = {headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']};
    let lastError;
    for (const channel of [undefined, 'chrome', 'msedge', 'chromium']) {
      try { browser = await chromium.launch(channel ? {...launchOptions, channel} : launchOptions); break; }
      catch (e) { lastError = e; }
    }
    if (!browser) throw new Error(`agentwarp shot needs Chromium: install Google Chrome, or run \`npx playwright install chromium\` (${String(lastError?.message || lastError).split('\n')[0]})`);
    let state;
    try {
        const page = await browser.newPage({viewport:{width:480,height:360},deviceScaleFactor:1});
        const warnings = new Map();
        page.on('console', m => { const progressMatch = m.text().match(/^RENDER_PROGRESS (assets|ready|frame) (\d+)$/); if (progressMatch) { const n = Number(progressMatch[2]); if (progressMatch[1] === 'frame') { phase = 'frames'; frame = n; } else { assets = n; if (progressMatch[1] === 'ready') { console.error(`loaded ${assets} assets`); phase = 'frames'; } } return; } const match = m.text().match(/^(?:\S+ )?vm\s+(?:warn|warning|error)\s+(.+)$/i); if (match && !/No audio engine/i.test(match[1])) { const message=match[1]; const old=warnings.get(message); if (old) old.count++; else warnings.set(message,{message,count:1}); } });
        let rejectPageError;
        const pageError = new Promise((_, reject) => { rejectPageError = reject; });
        pageError.catch(() => {});
        page.on('pageerror', e => rejectPageError(new Error(`renderer/VM failed: ${e.stack || e}`)));
        page.on('crash', () => rejectPageError(new Error('renderer/VM failed: browser page crashed')));
        await page.route('**/*', route => route.abort());
        try {
            await Promise.race([pageError, page.setContent('<!doctype html><style>html,body{margin:0} canvas{width:480px;height:360px}</style><canvas width="480" height="360"></canvas>')]);
            await Promise.race([pageError, page.addScriptTag({content:bundle.outputFiles[0].text})]);
        } catch (e) { throw new Error(`renderer/VM failed to initialize: ${e.message}`, {cause:e}); }
        const encoder = opts.gif ? GIFEncoder() : null;
        await page.exposeFunction('saveFrame', async (f, uri, save) => {
            const data = Buffer.from(uri.slice(uri.indexOf(',')+1),'base64');
            if (save) await writeFile(join(out,`frame-${String(f).padStart(6,'0')}.png`), data);
            if (encoder) { const png=PNG.sync.read(data); const palette=quantize(png.data,256); encoder.writeFrame(applyPalette(png.data,palette),png.width,png.height,{palette,delay:(Math.round((f+1)*100/30)-Math.round(f*100/30))*10}); }
        });
        state = await Promise.race([pageError, page.evaluate(async x => { if (typeof window.runProject !== 'function') throw new Error('renderer/VM failed to initialize'); return window.runProject(x); }, {bytes:(await readFile(file)).toString('base64'), frames, seed, inputs, captures:at, gif:!!opts.gif, file})]);
        progress();
        phase = 'finishing';
        state.vmWarnings = [...warnings.values()];
        if (encoder && frames) { encoder.finish(); await writeFile(join(out,'run.gif'),encoder.bytes()); }
    } finally { await browser.close(); }
    await writeFile(join(out,'state.json'), JSON.stringify(state,null,2)+'\n');
    if (cmd === 'compare') {
        const args = [join(root,'../vmrun/cli.mjs'),'run',file,'--frames',String(frames),'--seed',String(seed)];
        if (opts.input) args.push('--input',opts.input);
        const {stdout} = await exec(process.execPath,args,{maxBuffer:100*1024*1024});
        const baseline = JSON.parse(stdout);
        const differences = diff(state,baseline);
        console.log(JSON.stringify({file,frames, equal:differences.length===0,differences,rendered:state},null,2));
    } else console.log(JSON.stringify(state,null,2));
    } finally { clearInterval(progressTimer); if (!timedOut) clearTimeout(deadline); }
}
main().catch(e => { console.error(JSON.stringify({ok:false,error:e.stack || String(e)})); process.exitCode=1; });
