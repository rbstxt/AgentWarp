// Adapted from tools/vmrun/lib/harness.mjs. Keep input and step behavior in sync.
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
import Timer from 'scratch-vm/src/util/timer.js';
import Cast from 'scratch-vm/src/util/cast.js';


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

// Match vmrun's virtual-time glide for both interpreted and compiled threads.
function patchGlide(runtime) {
    const motion = runtime.ext_scratch3_motion;
    const virtualGlide = function (args, util) {
        const nowObj = util.nowObj ?? {now: () => util.runtime.currentMSecs};
        if (util.stackFrame.timer) {
            const timeElapsed = util.stackFrame.timer.timeElapsed();
            if (timeElapsed < util.stackFrame.duration * 1000) {
                const frac = timeElapsed / (util.stackFrame.duration * 1000);
                const dx = frac * (util.stackFrame.endX - util.stackFrame.startX);
                const dy = frac * (util.stackFrame.endY - util.stackFrame.startY);
                util.target.setXY(util.stackFrame.startX + dx, util.stackFrame.startY + dy);
                util.yield();
            } else {
                util.target.setXY(util.stackFrame.endX, util.stackFrame.endY);
            }
        } else {
            util.stackFrame.timer = new Timer(nowObj);
            util.stackFrame.timer.start();
            util.stackFrame.duration = Cast.toNumber(args.SECS);
            util.stackFrame.startX = util.target.x;
            util.stackFrame.startY = util.target.y;
            util.stackFrame.endX = Cast.toNumber(args.X);
            util.stackFrame.endY = Cast.toNumber(args.Y);
            if (util.stackFrame.duration <= 0) {
                util.target.setXY(util.stackFrame.endX, util.stackFrame.endY);
                return;
            }
            util.yield();
        }
    };
    runtime._primitives.motion_glidesecstoxy = virtualGlide;
    runtime._primitives.motion_glideto = function (args, util) {
        const targetXY = motion.getTargetXY(args.TO, util);
        if (targetXY) virtualGlide({SECS: args.SECS, X: targetXY[0], Y: targetXY[1]}, util);
    };
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

export function createRenderedVM(vm, seed = 1) {
    const clock = {now: 1000000};
    vm.runtime.updateCurrentMSecs = () => { vm.runtime.currentMSecs = clock.now; };
    vm.runtime.currentMSecs = clock.now;
    Math.random = mulberry32(seed);
    patchSaySecs(vm);
    patchGlide(vm.runtime);
    patchBubbleRedraw(vm);
    return {vm, clock};
}

/**
 * Warning capture: scratch-vm logs via @turbowarp/nanolog, which binds
 * console methods at import time, so console patching cannot intercept it.
 * Instead we intercept process.stderr.write while the VM loads/steps,
 * parse warning lines, dedupe with counts, and keep them out of stderr.
 */
function beginWarningCapture() {}
function endWarningCapture() {}
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
 * maxMs: optional real-time frame budget for slowFrames diagnostics.
 * Returns {timeline, sayEvents, hatsDropped, sayDropped, framesRun, until, slowFrames}.
 * Timelines are capped at MAX_TIMELINE entries (prefix kept, overflow
 * counted) so pathological projects (clone/broadcast spam) cannot produce
 * unbounded output.
 */
const MAX_TIMELINE = 20000;
export async function stepFrames(vm, clock, totalFrames, inputs = [], onFrame, until = null, maxMs = null) {
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
    const slowFrames = maxMs === null || maxMs === undefined ? null : [];
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
        const stepStart = slowFrames === null ? 0 : performance.now();
        vm.runtime._step();
        if (slowFrames !== null) {
            const dt = performance.now() - stepStart;
            if (dt > maxMs) slowFrames.push({frame: f, ms: Math.round(dt * 1000) / 1000});
        }
        pollBubbles(f);
        if (onFrame) await onFrame(f, vm);
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
    return {timeline, sayEvents, hatsDropped, sayDropped, framesRun, until: untilState, slowFrames};
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
        else if (cur && typeof cur === 'object' && 'variables' in cur && 'lists' in cur) {
            if (cur.variables && p in cur.variables) cur = cur.variables[p];
            else if (cur.lists && p in cur.lists) cur = cur.lists[p];
            else return undefined;
        } else return undefined;
    }
    return cur;
}

/**
 * Explain an unresolved probe: suggest target-prefixed / corrected paths that DO resolve.
 * Returns a short hint string or null.
 */
export function probeHint(state, expr) {
    if (resolveProbe(state, expr) !== undefined) return null;
    const parts = String(expr).split('.');
    const targets = (state?.targets ?? []).filter(t => t && !t.isClone);
    const names = targets.map(t => t.name);
    const ok = [];
    // 1) missing target prefix: "bubble.text" -> "Sprite1.bubble.text"
    for (const n of names) {
        const cand = `${n}.${expr}`;
        if (resolveProbe(state, cand) !== undefined) ok.push(cand);
    }
    // 2) variable/list without the "variables."/"lists." segment: "Sprite1.score" -> "Sprite1.variables.score"
    if (parts.length >= 2 && names.includes(parts[0])) {
        for (const seg of ['variables', 'lists']) {
            const cand = [parts[0], seg, ...parts.slice(1)].join('.');
            if (resolveProbe(state, cand) !== undefined) ok.push(cand);
        }
        // global variable read through a sprite: "Sprite1.score" -> "Stage.variables.score"
        const stage = targets.find(t => t.isStage);
        if (stage) for (const seg of ['variables', 'lists']) {
            const cand = [stage.name, seg, ...parts.slice(1)].join('.');
            if (resolveProbe(state, cand) !== undefined) ok.push(cand);
        }
    }
    if (ok.length) return `did you mean ${[...new Set(ok)].slice(0, 3).map(s => `"${s}"`).join(' or ')}?`;
    if (parts.length && !names.includes(parts[0]) && !(parts[0] in (state ?? {})))
        return `"${parts[0]}" is not a target; targets: ${names.join(', ')}`;
    return null;
}
