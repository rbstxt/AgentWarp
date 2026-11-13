import {Buffer} from 'buffer';
import VM from 'scratch-vm';
import Render from 'scratch-render/dist/web/scratch-render.js';
import Storage from 'scratch-storage';
import * as SVGRenderer from '@turbowarp/scratch-svg-renderer';
import {createRenderedVM, stepFrames, dumpState, FPS, FRAME_MS} from './harness.mjs';

globalThis.Buffer = Buffer;
window.runProject = async ({bytes, frames, seed, inputs, captures, gif, file}) => {
    const canvas = document.querySelector('canvas');
    const vm = new VM();
    const renderer = new Render(canvas);
    vm.attachRenderer(renderer);
    vm.attachStorage(new Storage());
    vm.attachV2BitmapAdapter(new SVGRenderer.BitmapAdapter());
    const {clock} = createRenderedVM(vm, seed);
    const raw = Uint8Array.from(atob(bytes), c => c.charCodeAt(0));
    await vm.loadProject(raw.buffer);
    // scratch-render creates SVG skins synchronously but decodes their images asynchronously.
    await Promise.all(renderer._allSkins.filter(s => s?._svgImage && !s._svgImageLoaded).map(s => new Promise((resolve, reject) => {
        const img = s._svgImage;
        img.addEventListener('load', resolve, {once:true});
        img.addEventListener('error', () => reject(new Error('SVG costume failed to decode')), {once:true});
    })));
    const wanted = new Set(captures);
    const result = await stepFrames(vm, clock, frames, inputs, async f => {
        if (gif || wanted.has(f)) {
            renderer.draw();
            await window.saveFrame(f, canvas.toDataURL('image/png'), wanted.has(f));
        }
    });
    return {file, ok: true, frames: result.framesRun, requestedFrames: frames, fps: FPS,
        virtualSeconds: result.framesRun * (FRAME_MS / 1000), ...dumpState(vm),
        broadcasts: result.timeline.filter(e => e.hat === 'event_whenbroadcastreceived').map(e => ({frame:e.frame, name:e.fields?.BROADCAST_OPTION ?? null, target:e.target})),
        hats: result.timeline, hatsDropped: result.hatsDropped, sayEvents: result.sayEvents,
        sayDropped: result.sayDropped, vmWarnings: []};
};
