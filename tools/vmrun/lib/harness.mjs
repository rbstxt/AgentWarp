// Headless Scratch VM harness: deterministic virtual-time stepping,
// input injection, state dumps.
//
// Time model: fixed 30fps virtual time. Before every frame we advance a
// virtual clock by 1000/30 ms and override runtime.updateCurrentMSecs so
// ALL block timing (wait, say-for-secs, glide, timer) follows virtual time
// instead of the wall clock. No setInterval/frameLoop is ever started; we
// call runtime._step() manually. The only remaining wall-clock use is the
// sequencer's per-step work budget (bounds how many threads run per step),
// which does not affect simulated results for ordinary projects.
//
// Randomness: Math.random is replaced with a seeded mulberry32 PRNG for the
// duration of a run (seed configurable, default 1).

import VirtualMachine from 'scratch-vm';
import RenderedTarget from 'scratch-vm/src/sprites/rendered-target.js';
import {assetDims} from './dims.mjs';

export const FPS = 30;
export const FRAME_MS = 1000 / FPS;

function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Collision fallback (bounding boxes).
//
// Without a renderer every `touching` predicate returns false, so medium
// projects (bounce off edge, bullet hits enemy) cannot run headless. We
// patch RenderedTarget with an AABB fallback derived from costume intrinsic
// sizes (parsed from the sb3 assets, no native GL/canvas needed):
//   - sprite box: costume w/h scaled by size/100, centered on x/y.
//     Rotation is ignored (documented limitation).
//   - bitmap costumes: pixels / bitmapResolution (Scratch resolution 1 or 2).
//
// Per-target dims live on the runtime (runtime._vmrunDims: Map<key, {w,h}>)
// so several VMs in one process stay independent. Keys tried in order:
// `${assetId}.${dataFormat}`, costume.md5, md5ext file names.

function costumeKeys(costume) {
    const keys = [];
    if (costume.assetId && costume.dataFormat) keys.push(`${costume.assetId}.${costume.dataFormat}`);
    if (costume.md5) keys.push(costume.md5);
    if (costume.md5ext) keys.push(costume.md5ext);
    return keys;
}

function dimsFor(target) {
    const map = target.runtime?._vmrunDims;
    const costumes = target.sprite?.costumes;
    if (!map || !costumes || costumes.length === 0) return {w: 0, h: 0};
    const costume = costumes[target.currentCostume] ?? costumes[0];
    for (const k of costumeKeys(costume)) {
        const d = map.get(k);
        if (d) {
            const res = costume.dataFormat === 'svg' ? 1 : (costume.bitmapResolution || 2);
            return {w: d.w / res, h: d.h / res};
        }
    }
    return {w: 0, h: 0};
}

function aabbOf(target) {
    const d = dimsFor(target);
    const s = target.size / 100;
    const w = d.w * s;
    const h = d.h * s;
    return {left: target.x - w / 2, right: target.x + w / 2, top: target.y + h / 2, bottom: target.y - h / 2};
}

function boxesOverlap(a, b) {
    return a.left <= b.right && a.right >= b.left && a.bottom <= b.top && a.top >= b.bottom;
}

let touchingPatched = false;
let redrawPatched = false;
function patchTouching() {
    if (touchingPatched) return;
    touchingPatched = true;
    RenderedTarget.prototype.getBounds = function () {
        if (this.isStage) {
            const w = this.runtime.stageWidth / 2;
            const h = this.runtime.stageHeight / 2;
            return {left: -w, right: w, top: h, bottom: -h};
        }
        return aabbOf(this);
    };
    RenderedTarget.prototype.isTouchingEdge = function () {
        if (this.isStage) return false;
        const b = aabbOf(this);
        return b.left < -this.runtime.stageWidth / 2 ||
            b.right > this.runtime.stageWidth / 2 ||
            b.top > this.runtime.stageHeight / 2 ||
            b.bottom < -this.runtime.stageHeight / 2;
    };
    RenderedTarget.prototype.isTouchingPoint = function (x, y) {
        if (this.isStage) return false;
        const b = aabbOf(this);
        return x >= b.left && x <= b.right && y >= b.bottom && y <= b.top;
    };
    RenderedTarget.prototype.isTouchingSprite = function (spriteName) {
        const name = String(spriteName);
        for (const t of this.runtime.targets) {
            if (t === this || t.isStage) continue;
            if (t.sprite?.name !== name) continue;
            if (boxesOverlap(aabbOf(this), aabbOf(t))) return true;
        }
        return false;
    };
    RenderedTarget.prototype.isTouchingObject = function (requestedObject) {
        if (requestedObject === '_mouse_') {
            const mouse = this.runtime.ioDevices?.mouse;
            if (!mouse) return false;
            return this.isTouchingPoint(mouse.getScratchX(), mouse.getScratchY());
        } else if (requestedObject === '_edge_') {
            return this.isTouchingEdge();
        }
        return this.isTouchingSprite(requestedObject);
    };
    // Color touching needs pixel data; cannot work without a renderer.
    RenderedTarget.prototype.isTouchingColor = function () {
        return false;
    };
    RenderedTarget.prototype.colorIsTouchingColor = function () {
        return false;
    };
}

// ---------------------------------------------------------------------------
// Redraw gating.
//
// The sequencer runs threads in a tight loop until the wall-clock work budget
// (75% of a frame) expires OR something requests a redraw. With a renderer,
// every visual mutation (move, turn, show, costume, say, pen draw, …) calls
// runtime.requestRedraw(), so typical game loops execute ~once per frame.
// Headless, nothing requests redraws and spin-loops would execute thousands
// of iterations per virtual frame in a machine-speed-dependent way.
//
// Fix: mirror the renderer's gating by requesting a redraw from the same
// visual entry points (same `visible` conditions as the real code). Pure
// compute loops still spin to the work budget — exactly like real Scratch —
// but motion/looks scripts now advance deterministically, one iteration per
// virtual frame, matching TurboWarp-on-screen behavior.
const VISUAL_METHODS = [
    'setXY', 'setDirection', 'setVisible', 'setSize', 'setEffect',
    'clearEffects', 'setCostume', 'setRotationStyle',
    'goToFront', 'goToBack', 'goForwardLayers', 'goBackwardLayers', 'goBehindOther',
];

function patchRedrawGating() {
    if (redrawPatched) return;
    redrawPatched = true;
    for (const m of VISUAL_METHODS) {
        const orig = RenderedTarget.prototype[m];
        if (typeof orig !== 'function') continue;
        RenderedTarget.prototype[m] = function (...args) {
            const r = orig.apply(this, args);
            if (!this.isStage && this.visible) {
                this.runtime.requestRedraw();
            }
            return r;
        };
    }
}

function patchBubbleRedraw(vm) {
    // Say/think bubbles reposition every frame on screen (requesting redraws);
    // mirror that headless so bubble loops gate like the real thing.
    const looks = vm.runtime.ext_scratch3_looks;
    if (looks && !looks._vmrunBubbleWrapped) {
        looks._vmrunBubbleWrapped = true;
        const orig = looks._updateBubble.bind(looks);
        looks._updateBubble = (target, type, text) => {
            orig(target, type, text);
            if (target && !target.isStage && target.visible) {
                vm.runtime.requestRedraw();
            }
        };
    }
    const pen = vm.runtime.ext_pen;
    if (pen && !pen._vmrunPenWrapped) {
        pen._vmrunPenWrapped = true;
        for (const m of ['clear', '_stamp']) {
            if (typeof pen[m] !== 'function') continue;
            const orig = pen[m].bind(pen);
            pen[m] = (...args) => {
                const r = orig(...args);
                vm.runtime.requestRedraw();
                return r;
            };
        }
    }
}

// ---------------------------------------------------------------------------
// Virtual-time say/think-for-secs.
//
// Upstream implements these with wall-clock setTimeout, so bubble lifetimes
// would ignore virtual time. Reimplement on the stack timer (same mechanism
// as `control_wait`), which follows runtime.currentMSecs.

function patchSaySecs(vm) {
    const runtime = vm.runtime;
    const looks = runtime.ext_scratch3_looks;
    const mkSecs = (type) => function (args, util) {
        if (util.stackTimerNeedsInit()) {
            if (type === 'say') looks._say(args.MESSAGE, util.target);
            else looks._think(args.MESSAGE, util.target);
            util.startStackTimer(1000 * Number(args.SECS));
            util.yield();
        } else if (util.stackTimerFinished()) {
            looks._updateBubble(util.target, type, '');
        } else {
            util.yield();
        }
    };
    runtime._primitives.looks_sayforsecs = mkSecs('say');
    runtime._primitives.looks_thinkforsecs = mkSecs('think');
}

// ---------------------------------------------------------------------------

function targetName(t) {
    try {
        return t.getName();
    } catch {
        return t.sprite?.name ?? 'Stage';
    }
}

function bubbleOf(t) {
    try {
        const st = t.getCustomState('Scratch.looks');
        if (st && st.text) return {type: st.type || 'say', text: String(st.text)};
    } catch {
        // ignore
    }
    return null;
}

function dumpTarget(t) {
    const variables = {};
    const lists = {};
    for (const v of Object.values(t.variables ?? {})) {
        // In scratch-vm, target.variables holds scalars (type ''), lists
        // (type 'list') and broadcasts (type 'broadcast_msg') together.
        if (v.type === 'broadcast_msg') continue; // broadcasts are not variables
        if (v.type === 'list') lists[v.name] = Array.from(v.value ?? []);
        else variables[v.name] = v.value;
    }
    const sprite = t.sprite;
    return {
        name: targetName(t),
        isStage: !!t.isStage,
        isClone: !t.isStage && !t.isOriginal,
        x: t.x,
        y: t.y,
        direction: t.direction,
        size: t.size,
        visible: !!t.visible,
        costumeIndex: t.currentCostume ?? 0,
        costumeName: sprite?.costumes?.[t.currentCostume]?.name ?? sprite?.costumes?.[0]?.name ?? null,
        variables,
        lists,
        bubble: bubbleOf(t),
    };
}

export function dumpState(vm) {
    const targets = vm.runtime.targets.map(dumpTarget);
    const clones = {};
    for (const t of vm.runtime.targets) {
        if (!t.isStage && !t.isOriginal) {
            const n = targetName(t);
            clones[n] = (clones[n] ?? 0) + 1;
        }
    }
    const monitors = {};
    try {
        const map = vm.runtime.getMonitorState?.().map;
        if (map) {
            for (const [id, rec] of map) {
                monitors[id] = {
                    opcode: rec.opcode ?? null,
                    spriteName: rec.spriteName ?? null,
                    value: rec.value ?? null,
                    params: rec.params ?? null,
                };
            }
        }
    } catch {
        // ignore
    }
    return {targets, clones, monitors};
}

/** Build costume dims map from sb3 file map (filename -> Buffer). */
export function buildDimsMap(files) {
    const map = new Map();
    for (const [name, buf] of files) {
        const dot = name.lastIndexOf('.');
        if (dot < 0) continue;
        const ext = name.slice(dot + 1).toLowerCase();
        if (!['svg', 'png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext)) continue;
        const d = assetDims(buf, ext);
        if (d) map.set(name, d);
    }
    return map;
}

/**
 * Create a headless VM bound to virtual time.
 * opts: {seed, dims: Map (costume dims)}
 */
export function createHeadlessVM({seed = 1, dims = new Map()} = {}) {
    patchTouching();
    patchRedrawGating();
    const vm = new VirtualMachine();
    vm.runtime._vmrunDims = dims;
    // Fixed virtual clock.
    const clock = {now: 1000000};
    vm.runtime.updateCurrentMSecs = () => {
        vm.runtime.currentMSecs = clock.now;
    };
    vm.runtime.currentMSecs = clock.now;
    // Seeded randomness.
    const rand = mulberry32(seed);
    const origRandom = Math.random;
    Math.random = rand;
    patchSaySecs(vm);
    patchBubbleRedraw(vm);
    return {
        vm,
        clock,
        restoreRandom: () => {
            Math.random = origRandom;
        },
    };
}

/**
 * Warning capture: scratch-vm logs via @turbowarp/nanolog, which binds
 * console methods at import time, so console patching cannot intercept it.
 * Instead we intercept process.stderr.write while the VM loads/steps,
 * parse warning lines, dedupe with counts, and keep them out of stderr.
 */
const _ANSI_RE = /\x1b\[[0-9;]*m/g;
const _SUPPRESSED_RE = /No (storage|rendering) module present/;
let _captureDepth = 0;
let _captureOrigWrite = null;
const _captureCounts = new Map(); // message -> {message, count, blockId, target}

function _extractIds(message) {
    // Best-effort: some VM warnings name a block id or target.
    const out = {};
    const b = message.match(/\b[Bb]lock (?:with )?id ["']?([\w$-]+)["']?/);
    if (b) out.blockId = b[1];
    const t = message.match(/\b[Tt]arget ["']([\w $-]+)["']/) || message.match(/\bfor target ([\w $-]+)/);
    if (t) out.target = t[1];
    return out;
}

function _recordStderrLine(line) {
    const clean = String(line).replace(_ANSI_RE, '').trim();
    if (!clean || _SUPPRESSED_RE.test(clean)) return;
    const m = clean.match(/^(?:\S+ )?vm\s+(debug|info|warn|warning|error)\s+([\s\S]*)$/) ||
        clean.match(/^(debug|info|warn|warning|error)\s+([\s\S]*)$/);
    const message = m ? m[2].trim() : clean;
    if (!message) return;
    const prev = _captureCounts.get(message);
    if (prev) prev.count++;
    else _captureCounts.set(message, {message, count: 1, ..._extractIds(message)});
}

function beginWarningCapture() {
    if (_captureDepth === 0) {
        _captureOrigWrite = process.stderr.write.bind(process.stderr);
        let pending = '';
        process.stderr.write = (chunk, ...args) => {
            const lines = (pending + String(chunk)).split('\n');
            pending = lines.pop();
            for (const line of lines) _recordStderrLine(line);
            const cb = args.find(a => typeof a === 'function');
            if (cb) cb();
            return true;
        };
        process.stderr.write._vmrunPending = () => pending;
    }
    _captureDepth++;
}

function endWarningCapture() {
    _captureDepth = Math.max(0, _captureDepth - 1);
    if (_captureDepth === 0 && _captureOrigWrite) {
        const pendingFn = process.stderr.write._vmrunPending;
        const pending = typeof pendingFn === 'function' ? pendingFn() : '';
        process.stderr.write = _captureOrigWrite;
        _captureOrigWrite = null;
        if (pending) _recordStderrLine(pending);
    }
}

/**
 * Load an sb3 ArrayBuffer into the VM. Expected headless noise
 * ("No storage/rendering module present": assets resolve from the zip and
 * sizes are parsed separately; there is no renderer or network storage by
 * design) is dropped; everything else the VM logs is captured for
 * takeVmWarnings() instead of reaching stderr.
 */
export async function loadProjectHeadless(vm, arrayBuffer) {
    beginWarningCapture();
    try {
        await vm.loadProject(arrayBuffer);
    } finally {
        endWarningCapture();
    }
}

/** Drain captured warnings (deduped with counts, first-seen order). */
export function takeVmWarnings() {
    const out = [..._captureCounts.values()];
    _captureCounts.clear();
    return out;
}

/** Find first non-stage target whose sprite name matches (originals first), else the stage. */
function findClickTarget(vm, spriteName) {
    if (spriteName === 'Stage') return vm.runtime.getTargetForStage();
    const targets = vm.runtime.targets.filter(t => !t.isStage && t.sprite?.name === spriteName);
    const orig = targets.find(t => t.isOriginal);
    return orig ?? targets[0] ?? null;
}

// Scratch key names (as used in block menus like `sensing_keypressed`) vs
// DOM key names (as delivered by browsers and previously required here).
// Both spellings are accepted in keydown/keyup inputs (case-insensitive).
const SCRATCH_TO_DOM_KEY = new Map([
    ['space', ' '],
    ['left arrow', 'ArrowLeft'],
    ['right arrow', 'ArrowRight'],
    ['up arrow', 'ArrowUp'],
    ['down arrow', 'ArrowDown'],
    ['enter', 'Enter'],
    ['backspace', 'Backspace'],
    ['delete', 'Delete'],
    ['shift', 'Shift'],
    ['caps lock', 'CapsLock'],
    ['scroll lock', 'ScrollLock'],
    ['control', 'Control'],
    ['escape', 'Escape'],
    ['insert', 'Insert'],
    ['home', 'Home'],
    ['end', 'End'],
    ['page up', 'PageUp'],
    ['page down', 'PageDown'],
]);

/** Normalize a keydown/keyup `key` to the DOM-style name scratch-vm expects. */
export function normalizeKey(key) {
    const k = String(key ?? '');
    const mapped = SCRATCH_TO_DOM_KEY.get(k.toLowerCase());
    return mapped !== undefined ? mapped : k;
}

/**
 * Parse an --until probe expression: "<probe> <op> <value>".
 * Returns {probe, op, value} where value is a number/boolean/string.
 */
export function parseUntil(expr) {
    const m = String(expr).match(/^(.*?)\s*(>=|<=|!=|==|>|<|=)\s*([\s\S]*)$/);
    if (!m) throw new Error(`cannot parse --until expression "${expr}" (want "<probe> <op> <value>")`);
    let value = m[3].trim();
    const quoted = value.match(/^(['"])([\s\S]*)\1$/);
    if (quoted) value = quoted[2];
    else if (/^(true|false)$/i.test(value)) value = value.toLowerCase() === 'true';
    else if (value !== '' && Number.isFinite(Number(value))) value = Number(value);
    return {probe: m[1].trim(), op: m[2], value};
}

function untilSatisfied(current, op, expected) {
    if (op === '=' || op === '==') return current === expected || String(current) === String(expected);
    if (op === '!=') return current !== expected && String(current) !== String(expected);
    if (typeof current !== 'number' || typeof expected !== 'number') return false;
    if (op === '>') return current > expected;
    if (op === '<') return current < expected;
    if (op === '>=') return current >= expected;
    if (op === '<=') return current <= expected;
    return false;
}

/**
 * Run a loaded VM for a fixed number of frames with scripted inputs.
 * inputs: [{frame, type, key?, sprite?, x?, y?, isDown?, name?, text?}]
 * onFrame(frame, vm) called after each step (for trace/say polling).
 * until: null or {probe, op, value} (see parseUntil); when set, stepping
 *   stops early once the probe satisfies the condition.
 * Returns {timeline, sayEvents, hatsDropped, sayDropped, framesRun, until}
 * (until is null when no condition was given, else {met, frame, value}).
 * Timelines are capped at MAX_TIMELINE entries (prefix kept, overflow
 * counted) so pathological projects (clone/broadcast spam) cannot produce
 * unbounded output.
 */
const MAX_TIMELINE = 20000;
export async function stepFrames(vm, clock, totalFrames, inputs = [], onFrame, until = null) {
    const sorted = [...inputs].sort((a, b) => a.frame - b.frame);
    let cursor = 0;
    const timeline = [];
    let hatsDropped = 0;
    const origStartHats = vm.runtime.startHats.bind(vm.runtime);
    vm.runtime.startHats = (opcode, fields, optTarget) => {
        // Copy first: startHats uppercases match fields in place.
        const fieldCopy = fields ? {...fields} : {};
        const started = origStartHats(opcode, fields, optTarget);
        // Record hats that started threads. Edge-activated hats are polled
        // every frame and would flood the timeline, so they are recorded only
        // when they fire. Broadcasts are always recorded (even with no
        // receiver) since they are the delivery event itself.
        if ((started && started.length > 0) || opcode === 'event_whenbroadcastreceived') {
            if (timeline.length < MAX_TIMELINE) {
                timeline.push({
                    frame: currentFrame,
                    hat: opcode,
                    target: optTarget ? targetName(optTarget) : null,
                    fields: fieldCopy,
                });
            } else {
                hatsDropped++;
            }
        }
        return started;
    };
    // Wrap greenFlag's hat starts too: call greenFlag after wrapping.
    let currentFrame = 0;
    const mouse = {x: 240, y: 180, isDown: false}; // client px on 480x360 canvas
    const toClient = (sx, sy) => ({x: 240 + sx, y: 180 - sy});
    const postMouse = () => {
        vm.postIOData('mouse', {
            x: mouse.x, y: mouse.y,
            canvasWidth: 480, canvasHeight: 360,
            isDown: mouse.isDown,
        });
    };
    let bubblePrev = new Map();
    const sayEvents = [];
    let sayDropped = 0;
    const pushSay = (e) => {
        if (sayEvents.length < MAX_TIMELINE) sayEvents.push(e);
        else sayDropped++;
    };
    const pollBubbles = (frame) => {
        for (const t of vm.runtime.targets) {
            const b = bubbleOf(t);
            const key = targetName(t) + (t.isOriginal || t.isStage ? '' : `#${vm.runtime.targets.indexOf(t)}`);
            const cur = b ? `${b.type}:${b.text}` : '';
            if (!bubblePrev.has(key)) {
                bubblePrev.set(key, cur);
                if (cur) pushSay({frame, target: targetName(t), type: b.type, text: b.text});
            } else if (bubblePrev.get(key) !== cur) {
                bubblePrev.set(key, cur);
                pushSay({
                    frame,
                    target: targetName(t),
                    type: b?.type ?? null,
                    text: b?.text ?? '',
                });
            }
        }
    };

    vm.greenFlag();
    postMouse();
    pollBubbles(-1);
    beginWarningCapture();
    let framesRun = 0;
    let untilState = until ? {met: false, frame: null, value: undefined} : null;
    try {
    for (let f = 0; f < totalFrames; f++) {
        currentFrame = f;
        while (cursor < sorted.length && sorted[cursor].frame <= f) {
            const inp = sorted[cursor++];
            if (inp.type === 'keydown' || inp.type === 'keypress') {
                vm.postIOData('keyboard', {key: normalizeKey(inp.key ?? ''), isDown: true});
            } else if (inp.type === 'keyup') {
                vm.postIOData('keyboard', {key: normalizeKey(inp.key ?? ''), isDown: false});
            } else if (inp.type === 'mouse') {
                if (typeof inp.x === 'number' || typeof inp.y === 'number') {
                    const c = toClient(inp.x ?? 0, inp.y ?? 0);
                    mouse.x = c.x;
                    mouse.y = c.y;
                }
                if (typeof inp.isDown === 'boolean') mouse.isDown = inp.isDown;
                postMouse();
            } else if (inp.type === 'click') {
                if (typeof inp.x === 'number' || typeof inp.y === 'number') {
                    const c = toClient(inp.x ?? 0, inp.y ?? 0);
                    mouse.x = c.x;
                    mouse.y = c.y;
                    postMouse();
                }
                const t = inp.sprite ? findClickTarget(vm, inp.sprite) : null;
                if (t) {
                    if (t.isStage) vm.runtime.startHats('event_whenstageclicked', {}, t);
                    else vm.runtime.startHats('event_whenthisspriteclicked', {}, t);
                } else {
                    timeline.push({frame: f, hat: '(click-missed)', target: inp.sprite ?? null, fields: {}});
                }
            } else if (inp.type === 'broadcast') {
                // Inject a broadcast as if an event_broadcast block ran it.
                vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: inp.name ?? ''});
            } else if (inp.type === 'greenflag') {
                vm.greenFlag();
            } else if (inp.type === 'stop') {
                vm.stopAll();
            } else if (inp.type === 'answer') {
                // Resolve a waiting sensing_askandwait, like typing in the
                // ask box and pressing return.
                vm.runtime.emit('ANSWER', String(inp.text ?? ''));
                // The ask primitive continues in a promise microtask; let it
                // run before stepping so the following blocks execute next frame.
                await Promise.resolve();
            } else {
                throw new Error(`unknown input type "${inp.type}"`);
            }
        }
        clock.now += FRAME_MS;
        vm.runtime._step();
        pollBubbles(f);
        if (onFrame) onFrame(f, vm);
        framesRun = f + 1;
        if (until) {
            const state = dumpState(vm);
            const current = resolveProbe(state, until.probe);
            if (untilSatisfied(current, until.op, until.value)) {
                untilState = {met: true, frame: f, value: current ?? null};
                break;
            }
        }
    }
    } finally {
        endWarningCapture();
    }
    if (until && !untilState.met) {
        const state = dumpState(vm);
        untilState = {met: false, frame: null, value: resolveProbe(state, until.probe) ?? null};
    }
    vm.runtime.startHats = origStartHats;
    return {timeline, sayEvents, hatsDropped, sayDropped, framesRun, until: untilState};
}

/** Resolve a dot-path probe against the state object (numeric parts index arrays).
 * Bare sprite/stage names resolve against state.targets by name, e.g.
 * "Sprite1.x", "Stage.score" (stage variables live on the Stage target),
 * "clones.Cookie", "monitors.<id>.value", "broadcasts.0.name". */
export function resolveProbe(state, expr) {
    const parts = String(expr).split('.');
    let cur = state;
    for (const p of parts) {
        if (cur === null || cur === undefined) return undefined;
        if (Array.isArray(cur) && /^\d+$/.test(p)) cur = cur[Number(p)];
        else if (cur !== null && typeof cur === 'object' && !Array.isArray(cur) && !(p in cur) &&
            Array.isArray(cur.targets)) {
            // bare target name: search state.targets
            const found = cur.targets.find(e => e && e.name === p && !e.isClone);
            if (found === undefined) return undefined;
            cur = found;
        } else if (Array.isArray(cur)) {
            // search targets by name
            const found = cur.find(e => e && e.name === p);
            if (found === undefined) return undefined;
            cur = found;
        } else if (typeof cur === 'object' && p in cur) cur = cur[p];
        else return undefined;
    }
    return cur;
}
