/**
 * Function names for the ts format: curated natural camelCase for core
 * blocks, deterministic automatic fallback for everything else.
 *
 * One canonical map (built over the whole catalog) is shared by the printer,
 * the parser, and the d.ts generator, so the three always agree.
 */
import { allBlockSpecs } from '../../packages/core/catalog/index.ts';

const RESERVED = new Set(
    `break case catch class const continue debugger default delete do else enum export extends
     false finally for function if import in instanceof new null return super switch this throw
     true try typeof var void while with as implements interface let package private protected
     public static yield any boolean constructor declare get module require number set string
     symbol type from of`.split(/\s+/),
);

/** Curated natural names (opcode -> function name). */
const CURATED: Record<string, string> = {
    // hats
    event_whenflagclicked: 'whenFlagClicked',
    event_whenkeypressed: 'whenKeyPressed',
    event_whenthisspriteclicked: 'whenThisSpriteClicked',
    event_whenstageclicked: 'whenStageClicked',
    event_whenbroadcastreceived: 'whenBroadcastReceived',
    event_whenbackdropswitchesto: 'whenBackdropSwitchesTo',
    event_whentouchingobject: 'whenTouchingObject',
    event_whengreaterthan: 'whenGreaterThan',
    control_start_as_clone: 'whenStartAsClone',
    videoSensing_whenMotionGreaterThan: 'whenVideoMotionGreaterThan',
    makeymakey_whenMakeyKeyPressed: 'whenMakeyKeyPressed',
    makeymakey_whenCodePressed: 'whenCodePressed',
    // control
    control_forever: 'forever',
    control_repeat: 'repeat',
    control_repeat_until: 'repeatUntil',
    control_while: 'whileLoop',
    control_if: 'ifThen',
    control_if_else: 'ifElse',
    control_wait: 'wait',
    control_wait_until: 'waitUntil',
    control_stop: 'stop',
    control_create_clone_of: 'createCloneOf',
    control_delete_this_clone: 'deleteThisClone',
    control_all_at_once: 'allAtOnce',
    control_for_each: 'forEach',
    control_get_counter: 'getCounter',
    control_incr_counter: 'incrementCounter',
    control_clear_counter: 'clearCounter',
    procedures_return: 'returnValue',
    // motion
    motion_movesteps: 'moveSteps',
    motion_turnright: 'turnRight',
    motion_turnleft: 'turnLeft',
    motion_goto: 'goTo',
    motion_gotoxy: 'goToXY',
    motion_glidesecstoxy: 'glideSecsToXY',
    motion_glideto: 'glideTo',
    motion_pointindirection: 'pointInDirection',
    motion_pointtowards: 'pointTowards',
    motion_changexby: 'changeX',
    motion_changeyby: 'changeY',
    motion_setx: 'setX',
    motion_sety: 'setY',
    motion_ifonedgebounce: 'ifOnEdgeBounce',
    motion_setrotationstyle: 'setRotationStyle',
    motion_xposition: 'xPosition',
    motion_yposition: 'yPosition',
    motion_direction: 'direction',
    motion_scroll_right: 'scrollRight',
    motion_scroll_up: 'scrollUp',
    motion_align_scene: 'alignScene',
    motion_xscroll: 'xScroll',
    motion_yscroll: 'yScroll',
    // looks
    looks_say: 'say',
    looks_sayforsecs: 'sayFor',
    looks_think: 'think',
    looks_thinkforsecs: 'thinkFor',
    looks_switchcostumeto: 'switchCostumeTo',
    looks_nextcostume: 'nextCostume',
    looks_switchbackdropto: 'switchBackdropTo',
    looks_switchbackdroptoandwait: 'switchBackdropToAndWait',
    looks_nextbackdrop: 'nextBackdrop',
    looks_changesizeby: 'changeSizeBy',
    looks_setsizeto: 'setSizeTo',
    looks_changeeffectby: 'changeLookEffectBy',
    looks_seteffectto: 'setLookEffectTo',
    looks_cleargraphiceffects: 'clearGraphicEffects',
    looks_show: 'show',
    looks_hide: 'hide',
    looks_hideallsprites: 'hideAllSprites',
    looks_gotofrontback: 'goToFrontBack',
    looks_goforwardbackwardlayers: 'goForwardBackwardLayers',
    looks_costumenumbername: 'costumeNumberName',
    looks_backdropnumbername: 'backdropNumberName',
    looks_size: 'size',
    looks_changestretchby: 'changeStretchBy',
    looks_setstretchto: 'setStretchTo',
    // sound
    sound_play: 'startSound',
    sound_playuntildone: 'playSoundUntilDone',
    sound_stopallsounds: 'stopAllSounds',
    sound_changevolumeby: 'changeVolumeBy',
    sound_setvolumeto: 'setVolumeTo',
    sound_volume: 'volume',
    sound_changeeffectby: 'changeSoundEffectBy',
    sound_seteffectto: 'setSoundEffectTo',
    sound_cleareffects: 'clearSoundEffects',
    // event
    event_broadcast: 'broadcast',
    event_broadcastandwait: 'broadcastAndWait',
    // data
    data_setvariableto: 'setVariableTo',
    data_changevariableby: 'changeVariableBy',
    data_showvariable: 'showVariable',
    data_hidevariable: 'hideVariable',
    data_addtolist: 'addToList',
    data_deleteoflist: 'deleteOfList',
    data_deletealloflist: 'deleteAllOfList',
    data_insertatlist: 'insertAtList',
    data_replaceitemoflist: 'replaceItemOfList',
    data_itemoflist: 'itemOfList',
    data_itemnumoflist: 'itemNumberOfList',
    data_lengthoflist: 'lengthOfList',
    data_listcontainsitem: 'listContains',
    data_showlist: 'showList',
    data_hidelist: 'hideList',
    // operators
    operator_add: 'add',
    operator_subtract: 'subtract',
    operator_multiply: 'multiply',
    operator_divide: 'divide',
    operator_mod: 'mod',
    operator_round: 'round',
    operator_mathop: 'mathOp',
    operator_join: 'join',
    operator_letter_of: 'letterOf',
    operator_length: 'lengthOf',
    operator_contains: 'contains',
    operator_random: 'random',
    operator_equals: 'equals',
    operator_lt: 'lessThan',
    operator_gt: 'greaterThan',
    operator_and: 'and',
    operator_or: 'or',
    operator_not: 'not',
    // sensing
    sensing_touchingobject: 'touching',
    sensing_touchingcolor: 'touchingColor',
    sensing_coloristouchingcolor: 'colorTouchingColor',
    sensing_distanceto: 'distanceTo',
    sensing_askandwait: 'askAndWait',
    sensing_answer: 'answer',
    sensing_keypressed: 'keyPressed',
    sensing_mousedown: 'mouseDown',
    sensing_mousex: 'mouseX',
    sensing_mousey: 'mouseY',
    sensing_loudness: 'loudness',
    sensing_loud: 'isLoud',
    sensing_timer: 'timer',
    sensing_resettimer: 'resetTimer',
    sensing_current: 'current',
    sensing_dayssince2000: 'daysSince2000',
    sensing_username: 'username',
    sensing_userid: 'userId',
    sensing_online: 'isOnline',
    sensing_setdragmode: 'setDragMode',
    sensing_of: 'attributeOf',
    // pen
    pen_pendown: 'penDown',
    pen_penup: 'penUp',
    pen_clear: 'eraseAll',
    pen_stamp: 'stamp',
    pen_setpensizeto: 'setPenSizeTo',
    pen_changepensizeby: 'changePenSizeBy',
    pen_setpencolortocolor: 'setPenColor',
    pen_setpenhuetonumber: 'setPenHueTo',
    pen_changepenhueby: 'changePenHueBy',
    pen_setpenshadetonumber: 'setPenShadeTo',
    pen_changepenshadeby: 'changePenShadeBy',
    pen_setpencolorparamto: 'setPenColorParamTo',
    pen_changepencolorparamby: 'changePenColorParamBy',
    extension_pen_down: 'penDownExt',
    extension_pen_up: 'penUpExt',
    extension_wedo_motor: 'wedoMotor',
    extension_wedo_hat: 'whenWearingHat',
    extension_wedo_boolean: 'wedoBoolean',
    extension_wedo_tilt_reporter: 'wedoTilt',
    extension_microbit_display: 'microbitDisplay',
    extension_music_play_note: 'musicPlayNote',
    extension_music_drum: 'musicPlayDrum',
    extension_music_reporter: 'musicReporter',
    // music
    music_playNoteForBeats: 'playNoteForBeats',
    music_playDrumForBeats: 'playDrumForBeats',
    music_midiPlayDrumForBeats: 'midiPlayDrumForBeats',
    music_midiSetInstrument: 'midiSetInstrument',
    music_setInstrument: 'setInstrument',
    music_restForBeats: 'restForBeats',
    music_setTempo: 'setTempo',
    music_changeTempo: 'changeTempo',
    music_getTempo: 'getTempo',
    // video sensing
    videoSensing_videoOn: 'videoOn',
    videoSensing_videoToggle: 'videoToggle',
    videoSensing_setVideoTransparency: 'setVideoTransparency',
    // speech / translate
    text2speech_speakAndWait: 'speak',
    text2speech_setVoice: 'setVoice',
    text2speech_setLanguage: 'setLanguage',
    translate_getTranslate: 'translateWords',
    translate_getViewerLanguage: 'viewerLanguage',
};

export const BUILTINS = new Set([
    'script',
    'comment',
    'define',
    'call',
    'block',
    'lit',
    'menu',
    'bcast',
    'withComment',
    'vars',
    'lists',
]);

function camelRest(parts: string[]): string {
    return parts
        .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ''))
        .join('')
        .replace(/[^A-Za-z0-9$]+/g, '');
}

/** Deterministic fallback: drop category prefix, camelCase the rest. */
export function autoName(opcode: string): string {
    const rest = opcode.startsWith('extension_') ? opcode.slice('extension_'.length) : opcode;
    const i = rest.indexOf('_');
    const tail = i >= 0 ? rest.slice(i + 1) : rest;
    const parts = tail.split('_').filter(Boolean);
    let base = parts.length > 0 ? parts[0].toLowerCase() + camelRest(parts.slice(1)) : 'block';
    if (!base || RESERVED.has(base) || /^[0-9]/.test(base)) base = 'blk' + base[0].toUpperCase() + base.slice(1);
    if (BUILTINS.has(base)) base = 'blk_' + base;
    return base;
}

function buildMap(): { toFn: Map<string, string>; toOp: Map<string, string> } {
    const toFn = new Map<string, string>();
    const toOp = new Map<string, string>();
    const used = new Map<string, string>(); // name -> opcode
    const claim = (opcode: string, want: string): void => {
        let name = want;
        if (RESERVED.has(name) || BUILTINS.has(name)) name = 'blk_' + name;
        if (used.has(name) && used.get(name) !== opcode) {
            const cat = opcode.split('_')[0];
            const alt = cat + name[0].toUpperCase() + name.slice(1);
            if (!used.has(alt) || used.get(alt) === opcode) name = alt;
            else name = opcode.replace(/[^A-Za-z0-9]+/g, '_');
        }
        used.set(name, opcode);
        toFn.set(opcode, name);
        if (!toOp.has(name)) toOp.set(name, opcode);
    };
    const specs = allBlockSpecs().sort((a, b) => (a.opcode < b.opcode ? -1 : 1));
    for (const s of specs) {
        const c = CURATED[s.opcode];
        if (c) claim(s.opcode, c);
    }
    for (const s of specs) {
        if (toFn.has(s.opcode)) continue;
        claim(s.opcode, autoName(s.opcode));
    }
    return { toFn, toOp };
}

const MAP = buildMap();

/** Canonical function name for an opcode (unknown opcodes get a stable auto name). */
export function fnNameFor(opcode: string): string {
    const hit = MAP.toFn.get(opcode);
    if (hit) return hit;
    let name = autoName(opcode);
    if ([...MAP.toOp.keys()].includes(name)) {
        const cat = opcode.split('_')[0];
        name = cat + name[0].toUpperCase() + name.slice(1);
    }
    return name;
}

/** Reverse lookup: function name -> opcode (specific calls only). */
export function opcodeForFn(name: string): string | undefined {
    return MAP.toOp.get(name);
}

/** All specific function names (for suggestions). */
export function allFnNames(): string[] {
    return [...MAP.toOp.keys(), ...BUILTINS].sort();
}

const IDENT_RE = /^[$_\p{L}][$\u200C\u200D\p{L}\p{N}_]*$/u;

/** True when `vars.<name>` dot access is valid TS. */
export function isDotName(name: string): boolean {
    return IDENT_RE.test(name) && !RESERVED.has(name);
}

/** Sanitize an arbitrary procedure argument name to a JS parameter. */
export function sanitizeParam(name: string, taken: Set<string>): string {
    let base = name.replace(/[^$\u200C\u200D\p{L}\p{N}_]+/gu, '_').replace(/^([0-9])/, '_$1');
    if (!base || RESERVED.has(base) || !IDENT_RE.test(base)) base = '$arg';
    let out = base;
    let i = 0;
    while (taken.has(out)) {
        i++;
        out = `${base}_${i}`;
    }
    taken.add(out);
    return out;
}
