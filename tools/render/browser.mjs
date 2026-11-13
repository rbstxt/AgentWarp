import {Buffer} from 'buffer';
import VM from 'scratch-vm';
import Render from 'scratch-render/dist/web/scratch-render.js';
import Storage from 'scratch-storage';
import * as SVGRenderer from '@turbowarp/scratch-svg-renderer';
import {createRenderedVM, stepFrames, dumpState, FPS, FRAME_MS} from './harness.mjs';

globalThis.Buffer = Buffer;
window.runProject = async ({bytes, frames, seed, inputs, captures, gif, file}) => {
    const canvas = document.querySelector('canvas');
    let vm, renderer;
    try {
        vm = new VM();
        renderer = new Render(canvas);
    } catch (e) {
        throw new Error(`renderer/VM failed to initialize: ${e.message}`, {cause:e});
    }
    vm.attachRenderer(renderer);
    const storage = new Storage();
    const createAsset = storage.createAsset.bind(storage);
    let loadedAssets = 0;
    storage.createAsset = (...args) => {
        const asset = createAsset(...args);
        console.log(`RENDER_PROGRESS assets ${++loadedAssets}`);
        return asset;
    };
    vm.attachStorage(storage);
    vm.attachV2BitmapAdapter(new SVGRenderer.BitmapAdapter());
    const {clock} = createRenderedVM(vm, seed);
    const raw = Uint8Array.from(atob(bytes), c => c.charCodeAt(0));
    try { await vm.loadProject(raw.buffer); }
    catch (e) { throw new Error(`renderer/VM failed to load project: ${e.message}`, {cause:e}); }
    // Empty SVG skins never set _svgImageLoaded, even after their load event.
    // Check complete first so we do not wait for an event that already fired.
    await Promise.all(renderer._allSkins.filter(s => s?._svgImage && !s._svgImageLoaded).map(s => new Promise((resolve, reject) => {
        const img = s._svgImage;
        const finish = () => {
            if (s._svgImageLoaded || s._size[0] === 0 || s._size[1] === 0) resolve();
            else reject(new Error('SVG costume failed to decode'));
        };
        if (img.complete && (s._size[0] === 0 || s._size[1] === 0)) resolve();
        else if (img.complete && !img.naturalWidth) reject(new Error('SVG costume failed to decode'));
        else {
            img.addEventListener('load', finish, {once:true});
            img.addEventListener('error', () => reject(new Error('SVG costume failed to decode')), {once:true});
        }
    })));
    console.log(`RENDER_PROGRESS ready ${loadedAssets}`);
    const wanted = new Set(captures);
    let lastProgress = 0;
    const result = await stepFrames(vm, clock, frames, inputs, async f => {
        if (gif || wanted.has(f)) {
            renderer.draw();
            await window.saveFrame(f, canvas.toDataURL('image/png'), wanted.has(f));
        }
        const now = performance.now();
        if (f + 1 === frames || now - lastProgress >= 250) {
            console.log(`RENDER_PROGRESS frame ${f + 1}`);
            lastProgress = now;
        }
    });
    return {file, ok: true, frames: result.framesRun, requestedFrames: frames, fps: FPS,
        virtualSeconds: result.framesRun * (FRAME_MS / 1000), ...dumpState(vm),
        broadcasts: result.timeline.filter(e => e.hat === 'event_whenbroadcastreceived').map(e => ({frame:e.frame, name:e.fields?.BROADCAST_OPTION ?? null, target:e.target})),
        hats: result.timeline, hatsDropped: result.hatsDropped, sayEvents: result.sayEvents,
        sayDropped: result.sayDropped, vmWarnings: []};
};
