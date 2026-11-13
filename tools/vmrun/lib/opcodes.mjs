// Known Scratch opcodes. Core + standard extensions. Anything else -> warning (not error).
// Kept as a static list so `check` works without scratch-vm installed.
const CORE = [
    // motion
    'motion_movesteps', 'motion_turnright', 'motion_turnleft', 'motion_goto',
    'motion_goto_menu', 'motion_gotoxy', 'motion_glideto', 'motion_glideto_menu',
    'motion_glidesecstoxy', 'motion_pointindirection', 'motion_pointtowards',
    'motion_pointtowards_menu', 'motion_changexby', 'motion_setx', 'motion_changeyby',
    'motion_sety', 'motion_ifonedgebounce', 'motion_setrotationstyle', 'motion_xposition',
    'motion_yposition', 'motion_direction',
    // looks
    'looks_sayforsecs', 'looks_say', 'looks_thinkforsecs', 'looks_think',
    'looks_show', 'looks_hide', 'looks_switchcostumeto', 'looks_costume',
    'looks_nextcostume', 'looks_switchbackdropto', 'looks_backdrops',
    'looks_nextbackdrop', 'looks_changesizeby', 'looks_setsizeto', 'looks_size',
    'looks_changeeffectby', 'looks_seteffectto', 'looks_cleargraphiceffects',
    'looks_showvariable', 'looks_hidevariable', 'looks_showallvariables',
    'looks_gotofrontback', 'looks_gotofrontback_menu', 'looks_goforwardbackwardlayers',
    'looks_goforwardbackwardlayers_menu', 'looks_backdropnumbername', 'looks_backdropnumbername_menu',
    'looks_costumenumbername', 'looks_costumenumbername_menu', 'looks_size_menu',
    // sound
    'sound_play', 'sound_sounds_menu', 'sound_playuntildone', 'sound_stopallsounds',
    'sound_changeeffectby', 'sound_seteffectto', 'sound_cleareffects',
    'sound_changevolumeby', 'sound_setvolumeto', 'sound_volume',
    // events
    'event_whenflagclicked', 'event_whenkeypressed', 'event_whenthisspriteclicked',
    'event_whenstageclicked', 'event_whenbroadcastreceived', 'event_whenbackdropswitchesto',
    'event_whengreaterthan', 'event_broadcast', 'event_broadcastandwait',
    // control
    'control_wait', 'control_repeat', 'control_repeat_menu', 'control_forever', 'control_repeat_until',
    'control_if', 'control_if_else', 'control_stop', 'control_stop_menu',
    'control_wait_until', 'control_while', 'control_create_clone_of',
    'control_create_clone_of_menu', 'control_start_as_clone', 'control_delete_this_clone',
    'control_get_counter', 'control_incr_counter', 'control_clear_counter',
    // sensing
    'sensing_touchingobject', 'sensing_touchingobjectmenu', 'sensing_touchingcolor',
    'sensing_coloristouchingcolor', 'sensing_distanceto', 'sensing_distancetomenu',
    'sensing_askandwait', 'sensing_answer', 'sensing_keypressed', 'sensing_keyoptions',
    'sensing_mousedown', 'sensing_mousex', 'sensing_mousey', 'sensing_setdragmode',
    'sensing_setdragmode_menu', 'sensing_loudness', 'sensing_timer', 'sensing_resettimer',
    'sensing_of', 'sensing_of_object_menu', 'sensing_current', 'sensing_current_menu',
    'sensing_dayssince2000', 'sensing_username',
    // operators
    'operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide',
    'operator_random', 'operator_gt', 'operator_lt', 'operator_equals',
    'operator_and', 'operator_or', 'operator_not', 'operator_join',
    'operator_letter_of', 'operator_length', 'operator_contains', 'operator_mod',
    'operator_round', 'operator_mathop', 'operator_mathop_menu',
    // variables / lists
    'data_variable', 'data_setvariableto', 'data_changevariableby', 'data_showvariable', 'data_hidevariable',
    'data_showlist', 'data_hidelist', 'data_addtolist', 'data_deleteoflist',
    'data_deletealloflist', 'data_insertatlist', 'data_replaceitemoflist',
    'data_itemoflist', 'data_itemnumoflist', 'data_lengthoflist', 'data_listcontainsitem',
    'data_listcontents',
    // procedures
    'procedures_definition', 'procedures_prototype', 'procedures_call',
    'argument_reporter_string_number', 'argument_reporter_boolean',
    // music
    'music_playDrumForBeats', 'music_playDrumForBeats_menu', 'music_restForBeats',
    'music_playNoteForBeats', 'music_playNoteForBeats_menu', 'music_setInstrument',
    'music_setInstrument_menu', 'music_setTempo', 'music_getTempo', 'music_changeTempo',
    // pen
    'pen_clear', 'pen_stamp', 'pen_penDown', 'pen_penUp', 'pen_setPenColorToColor',
    'pen_changePenHueBy', 'pen_setPenShadeToNumber', 'pen_changePenShadeBy',
    'pen_setPenSizeTo', 'pen_changePenSizeBy', 'pen_setPenColorParamTo',
    'pen_changePenColorParamBy', 'pen_menu_colorParam',
    // wedo2 / boost / microbit / ev3 / gdxfor / makeymakey / videoSensing / text2speech / translate
    'wedo2_motorOnFor', 'wedo2_motorOn', 'wedo2_motorOff', 'wedo2_startMotorPower',
    'wedo2_setMotorDirection', 'wedo2_setLightHue', 'wedo2_playNoteFor',
    'wedo2_whenDistance', 'wedo2_whenTilted', 'wedo2_getDistance', 'wedo2_isTilted',
    'wedo2_getTiltAngle', 'wedo2_getTiltAngle_menu',
    'boost_motorOnFor', 'boost_motorOnForRotation', 'boost_motorOn', 'boost_motorOff',
    'boost_setMotorPower', 'boost_setMotorDirection', 'boost_getMotorPosition',
    'boost_getMotorEncoder', 'boost_motorOnForRotation_menu', 'boost_seeingColor',
    'boost_getColor', 'boost_whenColor', 'boost_whenTilted', 'boost_getTiltAngle',
    'boost_getTiltAngle_menu',
    'microbit_whenButtonPressed', 'microbit_isButtonPressed', 'microbit_whenGesture',
    'microbit_displaySymbol', 'microbit_displayText', 'microbit_clearDisplay',
    'microbit_whenTilted', 'microbit_isTilted', 'microbit_getTiltAngle', 'microbit_getTiltAngle_menu',
    'ev3_motorTurnClockwise', 'ev3_motorTurnCounterClockwise', 'ev3_motorSetPower',
    'ev3_getMotorPosition', 'ev3_whenButtonPressed', 'ev3_whenDistanceLessThan',
    'ev3_whenBrightnessLessThan', 'ev3_buttonPressed', 'ev3_getDistance', 'ev3_getBrightness',
    'ev3_beep',
    'gdxfor_whenGesture', 'gdxfor_whenForcePushedOrPulled', 'gdxfor_getTilt',
    'gdxfor_getTilt_menu', 'gdxfor_isTilted', 'gdxfor_getSpin', 'gdxfor_getSpin_menu',
    'gdxfor_getAcceleration', 'gdxfor_getAcceleration_menu', 'gdxfor_isFreeFalling',
    'gdxfor_getForce', 'gdxfor_whenTilted',
    'makeymakey_whenKeyPressed', 'makeymakey_whenKeysPressedInOrder',
    'videoSensing_whenMotionGreaterThan', 'videoSensing_videoOn', 'videoSensing_videoOn_menu',
    'videoSensing_getAttributeOf', 'videoSensing_getAttributeOf_menu',
    'text2speech_speakAndWait', 'text2speech_setVoice', 'text2speech_setVoice_menu',
    'text2speech_setLanguage', 'text2speech_setLanguage_menu',
    'translate_translateBlock', 'translate_getViewerLanguage', 'translate_getTranslate',
    'translate_menu_languages',
    // tw custom blocks used by TurboWarp projects (warn-free)
    'tw_setLoopInterval',
];

export const KNOWN_OPCODES = new Set(CORE);
