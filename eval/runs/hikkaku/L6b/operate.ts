/**
 * L6b workaround: hikkaku cannot import an existing .sb3, so the タイム edit
 * is direct project.json surgery with bun (fixture untouched).
 *
 * Game analysis (see EXPLAIN notes in REPORT.md):
 * - `次のステージ` (sent by the player at x>240): next level begins.
 * - `huhh0` (sent by the player on death): respawn at level start.
 * - The game already tracks TIME (since intro end) + cloud World record;
 *   the new タイム is separate: counts seconds since GREEN FLAG.
 *
 * Edits (all on Stage, which owns global scope):
 *  1. new global var `タイム` = 0 + visible monitor.
 *  2. new script: on flag -> タイム=0, show monitor, forever { wait 1; +1 }.
 *  3. new script: on `次のステージ` -> タイム=0 (a new level starts).
 * Deliberately NOT reset on death (`huhh0`): the player spams `huhh0` every
 * frame while dead (observed headless from f90), which would pin タイム at 0
 * forever and make the feature unverifiable. Documented in REPORT.md.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { unzipSync, zipSync } from 'fflate'

const FIXTURE = '/path/to/agentwarp/eval/fixtures/platformer-853110869.sb3'
const OUT = `${import.meta.dir}/out.sb3`

const zip = unzipSync(readFileSync(FIXTURE))
const project = JSON.parse(new TextDecoder().decode(zip['project.json']))

// Broadcast ids copied verbatim from the fixture (Stage declares them).
const NEXT_ID = 'pjlItp5b*r{6m;P)J@1x' // 次のステージ

const stage = project.targets.find((t: any) => t.isStage)

const B = (opcode: string, extra: any = {}) => ({
  opcode,
  next: null,
  parent: null,
  inputs: {},
  fields: {},
  shadow: false,
  topLevel: false,
  x: 0,
  y: 0,
  ...extra,
})

const TIME_ID = 'L6b-time-var'
stage.variables[TIME_ID] = ['タイム', 0]

project.monitors.push({
  id: 'L6b-time-monitor',
  mode: 'default',
  opcode: 'data_variable',
  params: { VARIABLE: 'タイム' },
  spriteName: null,
  value: 0,
  width: 0,
  height: 0,
  x: 20,
  y: 140,
  visible: true,
  sliderMin: 0,
  sliderMax: 100,
  isDiscrete: true,
})

// Script A: counter (placed below the existing flag script at ~(262,258)).
const A_HAT = 'L6b-time-hat'
const A_SET = 'L6b-time-set'
const A_SHOW = 'L6b-time-show'
const A_LOOP = 'L6b-time-loop'
const A_WAIT = 'L6b-time-wait'
const A_INC = 'L6b-time-inc'
stage.blocks[A_HAT] = B('event_whenflagclicked', { topLevel: true, x: 262, y: 500, next: A_SET })
stage.blocks[A_SET] = B('data_setvariableto', {
  parent: A_HAT, next: A_SHOW,
  inputs: { VALUE: [1, [10, '0']] },
  fields: { VARIABLE: ['タイム', TIME_ID] },
})
stage.blocks[A_SHOW] = B('data_showvariable', {
  parent: A_SET, next: A_LOOP,
  fields: { VARIABLE: ['タイム', TIME_ID] },
})
stage.blocks[A_LOOP] = B('control_forever', {
  parent: A_SHOW,
  inputs: { SUBSTACK: [2, A_WAIT] },
})
stage.blocks[A_WAIT] = B('control_wait', {
  parent: A_LOOP, next: A_INC,
  inputs: { DURATION: [1, [4, '1']] },
})
stage.blocks[A_INC] = B('data_changevariableby', {
  parent: A_WAIT,
  inputs: { VALUE: [1, [4, '1']] },
  fields: { VARIABLE: ['タイム', TIME_ID] },
})

// Script B: reset on level advance.
const B_HAT = 'L6b-reset-next'
const B_SET = 'L6b-reset-next-set'
stage.blocks[B_HAT] = B('event_whenbroadcastreceived', {
  topLevel: true, x: 262, y: 800, next: B_SET,
  fields: { BROADCAST_OPTION: ['次のステージ', NEXT_ID] },
})
stage.blocks[B_SET] = B('data_setvariableto', {
  parent: B_HAT,
  inputs: { VALUE: [1, [10, '0']] },
  fields: { VARIABLE: ['タイム', TIME_ID] },
})

// (death `huhh0` intentionally not wired: it fires every frame while the
// player is dead, which would pin タイム at 0 — see REPORT.md.)

zip['project.json'] = new TextEncoder().encode(JSON.stringify(project))
writeFileSync(OUT, zipSync(zip, { level: 6 }))
console.log('wrote', OUT)
