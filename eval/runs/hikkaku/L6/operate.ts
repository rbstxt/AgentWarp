/**
 * L6 workaround: hikkaku cannot import an existing .sb3 (no sb3->text direction),
 * so the L6 edits are done as direct project.json surgery with bun.
 * The fixture itself is never modified; output goes to L6/out.sb3.
 *
 * Edits:
 *  (b) P toggles pause (new Stage var `paused`); the player game loop freezes
 *      at the top of its forever while paused and the player says "PAUSED".
 *  (c) jump velocity 17 -> 25.5 (1.5x); second jump allowed while airborne
 *      via a new player var `jumps` (reset on landing/init).
 *  (d) Scratch comments attached to every new/changed block.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { unzipSync, zipSync } from 'fflate'

const FIXTURE = '/path/to/agentwarp/eval/fixtures/scrolltutorial-378587848.sb3'
const OUT = `${import.meta.dir}/out.sb3`

const zip = unzipSync(readFileSync(FIXTURE))
const project = JSON.parse(new TextDecoder().decode(zip['project.json']))

const stage = project.targets.find((t: any) => t.isStage)
const player = project.targets.find((t: any) => t.name === 'player')

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
const varRef = (name: string, id: string) => [3, [12, name, id], [10, '']] as any
const eq = (name: string, id: string, value: string, parent: string) =>
  B('operator_equals', {
    parent,
    inputs: { OPERAND1: varRef(name, id), OPERAND2: [1, [10, value]] },
  })

// ---- new variables ----
const PAUSED_ID = 'L6-paused-var'
stage.variables[PAUSED_ID] = ['paused', 0]
const JUMPS_ID = 'L6-jumps-var'
player.variables[JUMPS_ID] = ['jumps', 0]

// ---- (b) pause toggle script (new, cleanly placed) ----
const H1 = 'L6-p-toggle'
const IF1 = 'L6-p-ifelse'
const S1 = 'L6-p-set1'
const S0 = 'L6-p-set0'
player.blocks[H1] = B('event_whenkeypressed', {
  topLevel: true, x: -700, y: -300, next: IF1,
  fields: { KEY_OPTION: ['p', null] },
})
player.blocks[IF1] = B('control_if_else', {
  parent: H1,
  inputs: { CONDITION: [2, 'L6-p-cond'], SUBSTACK: [2, S1], SUBSTACK2: [2, S0] },
})
player.blocks['L6-p-cond'] = eq('paused', PAUSED_ID, '0', IF1)
player.blocks[S1] = B('data_setvariableto', {
  parent: IF1,
  inputs: { VALUE: [1, [10, '1']] },
  fields: { VARIABLE: ['paused', PAUSED_ID] },
})
player.blocks[S0] = B('data_setvariableto', {
  parent: IF1,
  inputs: { VALUE: [1, [10, '0']] },
  fields: { VARIABLE: ['paused', PAUSED_ID] },
})

// ---- (b) freeze point: prepend pause gate to the game-loop forever ----
// forever block: :_o_1(*p$,#qWJ_XO1@G, SUBSTACK -> V{]o+d7Vt!-]0{8ZiDK,
const FOREVER = ':_o_1(*p$,#qWJ_XO1@G'
const OLD_FIRST = 'V{]o+d7Vt!-]0{8ZiDK,'
const P1 = 'L6-pause-if'
const SAY1 = 'L6-pause-say'
const WAIT1 = 'L6-pause-wait'
const CLR1 = 'L6-pause-clr'
player.blocks[P1] = B('control_if', {
  parent: FOREVER,
  next: OLD_FIRST,
  inputs: { CONDITION: [2, 'L6-pause-cond'], SUBSTACK: [2, SAY1] },
})
player.blocks['L6-pause-cond'] = eq('paused', PAUSED_ID, '1', P1)
player.blocks[SAY1] = B('looks_say', {
  parent: P1, next: WAIT1,
  inputs: { MESSAGE: [1, [10, 'PAUSED']] },
})
player.blocks[WAIT1] = B('control_wait_until', {
  parent: SAY1, next: CLR1,
  inputs: { CONDITION: [2, 'L6-pause-cond0'] },
})
player.blocks['L6-pause-cond0'] = eq('paused', PAUSED_ID, '0', WAIT1)
player.blocks[CLR1] = B('looks_say', {
  parent: WAIT1,
  inputs: { MESSAGE: [1, [10, '']] },
})
player.blocks[FOREVER].inputs.SUBSTACK = [2, P1]
player.blocks[OLD_FIRST].parent = P1

// The forever body above runs Reset/Setup once, then spins in a long
// repeat_until (player physics + tick). Gating only the loop head would not
// freeze mid-cycle, so gate the repeat body too.
const REPEAT = '?.3D})C9j(C_CWz:rQJu'
const R_FIRST = 'Wiw8yvKNg(:!4A(^X3)S'
const P2 = 'L6-pause2-if'
const SAY2 = 'L6-pause2-say'
const WAIT2 = 'L6-pause2-wait'
const CLR2 = 'L6-pause2-clr'
player.blocks[P2] = B('control_if', {
  parent: REPEAT,
  next: R_FIRST,
  inputs: { CONDITION: [2, 'L6-pause2-cond'], SUBSTACK: [2, SAY2] },
})
player.blocks['L6-pause2-cond'] = eq('paused', PAUSED_ID, '1', P2)
player.blocks[SAY2] = B('looks_say', {
  parent: P2, next: WAIT2,
  inputs: { MESSAGE: [1, [10, 'PAUSED']] },
})
player.blocks[WAIT2] = B('control_wait_until', {
  parent: SAY2, next: CLR2,
  inputs: { CONDITION: [2, 'L6-pause2-cond0'] },
})
player.blocks['L6-pause2-cond0'] = eq('paused', PAUSED_ID, '0', WAIT2)
player.blocks[CLR2] = B('looks_say', {
  parent: WAIT2,
  inputs: { MESSAGE: [1, [10, '']] },
})
player.blocks[REPEAT].inputs.SUBSTACK = [2, P2]
player.blocks[R_FIRST].parent = P2

// ---- (c) 1.5x jump: 17 -> 25.5 ----
const SETVY = '%MoM+%oOR-*DMp~)uxd3'
player.blocks[SETVY].inputs.VALUE = [1, [10, '25.5']]

// ---- (c) double jump: `in air < 4` -> `jumps < 2`, count jumps, reset ----
const COND = 'r([ia+5=^=d+cfqO}/E_'
player.blocks[COND].inputs = {
  OPERAND1: varRef('jumps', JUMPS_ID),
  OPERAND2: [1, [10, '2']],
}
const J2 = 'L6-jumps-inc'
player.blocks[J2] = B('data_changevariableby', {
  parent: SETVY, next: null,
  inputs: { VALUE: [1, [4, '1']] },
  fields: { VARIABLE: ['jumps', JUMPS_ID] },
})
player.blocks[SETVY].next = J2
// landing reset (after `set in air 0`)
const LAND = 'Z*~Y(5!nnX]b3P[hHQ!7'
const J3 = 'L6-jumps-reset-land'
player.blocks[J3] = B('data_setvariableto', {
  parent: LAND, next: null,
  inputs: { VALUE: [1, [10, '0']] },
  fields: { VARIABLE: ['jumps', JUMPS_ID] },
})
player.blocks[LAND].next = J3
// init reset (after `set in air 0` in the reset block)
const INIT = '/0[6x2j)HMT6,)X`KDJE'
const J4 = 'L6-jumps-reset-init'
player.blocks[J4] = B('data_setvariableto', {
  parent: INIT, next: 'Pd%~_9BPsXcP+Jm]ADVE',
  inputs: { VALUE: [1, [10, '0']] },
  fields: { VARIABLE: ['jumps', JUMPS_ID] },
})
player.blocks['Pd%~_9BPsXcP+Jm]ADVE'].parent = J4
player.blocks[INIT].next = J4

// ---- (d) comments on new/changed scripts (existing 11 untouched) ----
const comment = (id: string, blockId: string, x: number, y: number, text: string) => {
  player.comments[id] = { blockId, x, y, width: 260, height: 64, minimized: false, text }
}
comment('L6-c-pause', P1, 230, -300, 'Pause gate 1/2 (loop head): while paused = 1 the player says PAUSED and the game loop waits here, so nothing moves.')
comment('L6-c-pause2', P2, 230, 60, 'Pause gate 2/2 (inside the per-frame repeat): same freeze, mid-cycle. Both gates share the paused variable.')
comment('L6-c-toggle', H1, -430, -300, 'Press P to toggle pause (paused 0/1).')
comment('L6-c-jump', SETVY, 660, -330, 'Jump velocity 25.5 = 1.5x the original 17; a second air jump is allowed while jumps < 2.')
comment('L6-c-cond', COND, 500, 60, 'Double jump: allow jumping while fewer than 2 jumps used since landing (was: in air < 4).')
comment('L6-c-land', LAND, 1000, 420, 'Landing resets jumps to 0 (next block), re-arming the double jump.')

zip['project.json'] = new TextEncoder().encode(JSON.stringify(project))
writeFileSync(OUT, zipSync(zip, { level: 6 }))
console.log('wrote', OUT)
