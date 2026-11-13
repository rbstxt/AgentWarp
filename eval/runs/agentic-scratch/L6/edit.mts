import { readFileSync, writeFileSync } from 'node:fs'
import { ProjectIR } from '@scratch-agent/ir'

type B = any
const FIX = '/path/to/agentwarp/eval/fixtures/scrolltutorial-378587848.sb3'
const OUT = new URL('./out.sb3', import.meta.url)

const ir = await ProjectIR.fromSb3(new Uint8Array(readFileSync(FIX)))
const player = ir.target('player')!
const blocks = player.raw.blocks as Record<string, B>

const varId = (name: string): string => {
  for (const [id, v] of Object.entries(player.raw.variables as Record<string, [string, any]>)) {
    if (v[0] === name) return id
  }
  throw new Error('no var ' + name)
}
const inAirId = varId('in air')
const speedYId = varId('speed y')
const jumpsId = player.addVariable('jumps', 0)
const pausedId = player.addVariable('paused', 0)

// find a custom-block definition top by proccode
function defTop(proccode: string): B {
  for (const b of Object.values(blocks)) {
    if (b?.opcode === 'procedures_definition') {
      const proto = blocks[b.inputs.custom_block[1]]
      if (proto?.mutation?.proccode === proccode) return b
    }
  }
  throw new Error('no def ' + proccode)
}
function chain(firstId: string): B[] {
  const out: B[] = []
  let cur: B | undefined = blocks[firstId]
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.push(cur)
    cur = typeof cur.next === 'string' ? blocks[cur.next] : undefined
  }
  return out
}
// block ids are not stored on the block objects; index them
for (const [id, b] of Object.entries(blocks)) if (b && typeof b === 'object') b.id = id

function insertAfter(prev: B, nb: B): void {
  const id = ir.uids.next()
  nb.parent = prev.id
  nb.next = prev.next ?? null
  blocks[id] = nb
  if (typeof prev.next === 'string' && blocks[prev.next]) blocks[prev.next].parent = id
  prev.next = id
}
function addComment(text: string, blockId: string, x: number, y: number): void {
  const id = ir.uids.next()
  ;(player.raw.comments as any)[id] = {
    blockId, x, y, width: 220, height: 100, minimized: false, text,
  }
}

// ---- (c) jump 1.5x higher: speed y 17 -> 21 ----
const tickDef = defTop('tick')
const allPlayer = Object.values(blocks)
const setSy = allPlayer.find((b) => b.opcode === 'data_setvariableto' && b.fields?.VARIABLE?.[0] === 'speed y' && b.inputs?.VALUE?.[1]?.[1] === '17')
if (!setSy) throw new Error('jump set block not found')
setSy.inputs.VALUE[1][1] = '23'
// gate: in air < 4  ->  jumps < 2
let gate: B | undefined
for (const b of Object.values(blocks)) {
  if (b?.opcode === 'operator_lt' && Array.isArray(b.inputs?.OPERAND1) && b.inputs.OPERAND1[1]?.[1] === 'in air' && b.inputs?.OPERAND2?.[1]?.[1] === '4') gate = b
}
if (!gate) throw new Error('jump gate not found')
gate.inputs.OPERAND1 = [3, [12, 'jumps', jumpsId], [10, '']]
gate.inputs.OPERAND2[1][1] = '2'
// double jump: count jumps; allow 2 per airtime
insertAfter(setSy, {
  opcode: 'data_changevariableby', next: null, parent: null,
  inputs: { VALUE: [1, [4, '1']] }, fields: { VARIABLE: ['jumps', jumpsId] },
  shadow: false, topLevel: false,
})

function subtree(firstId: string): B[] {
  const out: B[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const b: B = blocks[id]
    if (!b || typeof b !== 'object' || Array.isArray(b)) return
    out.push(b)
    if (typeof b.next === 'string') visit(b.next)
    for (const v of Object.values(b.inputs ?? {})) {
      if (Array.isArray(v) && typeof v[1] === 'string' && blocks[v[1]]) visit(v[1] as string)
    }
  }
  visit(firstId)
  return out
}

// ---- reset jumps on landing ("change player y") and on start ("game on") ----
for (const proccode of ['change player y by %s', 'game on']) {
  const def = defTop(proccode)
  const body = subtree(def.next)
  const setAir = body.find((b) => b.opcode === 'data_setvariableto' && b.fields?.VARIABLE?.[0] === 'in air' && String(b.inputs?.VALUE?.[1]?.[1]) === '0')
  if (!setAir) throw new Error('in-air reset not found in ' + proccode)
  insertAfter(setAir, {
    opcode: 'data_setvariableto', next: null, parent: null,
    inputs: { VALUE: [1, [10, '0']] }, fields: { VARIABLE: ['jumps', jumpsId] },
    shadow: false, topLevel: false,
  })
}

// ---- double jump, rising edge: count only fresh presses (holding Up must not
// burn both jumps in consecutive ticks) ----
const upWasId = player.addVariable('upWas', 0)
{
  // jumpsIf = the `if jumps < 2` block (SUBSTACK ancestor of the jump set)
  let jumpsIf: B | undefined
  for (const b of Object.values(blocks)) {
    if (b?.opcode === 'control_if' && Array.isArray(b.inputs?.SUBSTACK) && b.inputs.SUBSTACK[1] === setSy.id) jumpsIf = b
  }
  if (!jumpsIf) throw new Error('jumps if not found')
  const outerUpIf: B = blocks[jumpsIf.parent]
  const mkShadow = (parentId: string): string => {
    const sid = ir.uids.next()
    blocks[sid] = {
      opcode: 'sensing_keyoptions', next: null, parent: parentId,
      inputs: {}, fields: { KEY_OPTION: ['up arrow', null] }, shadow: true, topLevel: false,
    }
    return sid
  }
  // if upWas = 0 -> [jumpsIf chain..., set upWas 1]
  const eqId = ir.uids.next()
  blocks[eqId] = {
    opcode: 'operator_equals', next: null, parent: null,
    inputs: { OPERAND1: [3, [12, 'upWas', upWasId], [10, '']], OPERAND2: [1, [4, '0']] },
    fields: {}, shadow: false, topLevel: false,
  }
  const ifWasId = ir.uids.next()
  blocks[eqId].parent = ifWasId
  const setWas1Id = ir.uids.next()
  blocks[setWas1Id] = {
    opcode: 'data_setvariableto', next: null, parent: jumpsIf.id,
    inputs: { VALUE: [1, [4, '1']] }, fields: { VARIABLE: ['upWas', upWasId] },
    shadow: false, topLevel: false,
  }
  jumpsIf.next = setWas1Id
  blocks[ifWasId] = {
    opcode: 'control_if', next: null, parent: outerUpIf.id,
    inputs: { CONDITION: [2, eqId], SUBSTACK: [2, jumpsIf.id] },
    fields: {}, shadow: false, topLevel: false,
  }
  jumpsIf.parent = ifWasId
  outerUpIf.inputs.SUBSTACK = [2, ifWasId]
  // sibling: if not up -> upWas = 0 (insert after outer if)
  const keyId = ir.uids.next()
  const shadowId = mkShadow(keyId)
  blocks[keyId] = {
    opcode: 'sensing_keypressed', next: null, parent: null,
    inputs: { KEY_OPTION: [1, shadowId] }, fields: {}, shadow: false, topLevel: false,
  }
  const notId = ir.uids.next()
  blocks[keyId].parent = notId
  blocks[notId] = {
    opcode: 'operator_not', next: null, parent: null,
    inputs: { OPERAND: [2, keyId] }, fields: {}, shadow: false, topLevel: false,
  }
  const setWas0Id = ir.uids.next()
  blocks[setWas0Id] = {
    opcode: 'data_setvariableto', next: null, parent: null,
    inputs: { VALUE: [1, [4, '0']] }, fields: { VARIABLE: ['upWas', upWasId] },
    shadow: false, topLevel: false,
  }
  const ifNotUpId = ir.uids.next()
  blocks[notId].parent = ifNotUpId
  blocks[setWas0Id].parent = ifNotUpId
  blocks[ifNotUpId] = {
    opcode: 'control_if', next: outerUpIf.next ?? null, parent: (outerUpIf as B).id,
    inputs: { CONDITION: [2, notId], SUBSTACK: [2, setWas0Id] },
    fields: {}, shadow: false, topLevel: false,
  }
  if (typeof outerUpIf.next === 'string' && blocks[outerUpIf.next]) blocks[outerUpIf.next].parent = ifNotUpId
  outerUpIf.next = ifNotUpId
  // game on: upWas starts 0
  const gameOnDef = defTop('game on')
  const gameOnBody = subtree(gameOnDef.next)
  const lastSet = gameOnBody.filter((b) => b.opcode === 'data_setvariableto' && b.fields?.VARIABLE?.[0] === 'jumps').pop()
  if (!lastSet) throw new Error('game-on jumps set not found')
  insertAfter(lastSet, {
    opcode: 'data_setvariableto', next: null, parent: null,
    inputs: { VALUE: [1, [4, '0']] }, fields: { VARIABLE: ['upWas', upWasId] },
    shadow: false, topLevel: false,
  })
}
// ---- (b) pause: wrap the whole tick body in `if not paused` ----
{
  const ifId = ir.uids.next()
  const notId = ir.uids.next()
  const eqId = ir.uids.next()
  const firstId = tickDef.next as string
  blocks[eqId] = {
    opcode: 'operator_equals', next: null, parent: notId,
    inputs: { OPERAND1: [3, [12, 'paused', pausedId], [10, '']], OPERAND2: [1, [4, '1']] },
    fields: {}, shadow: false, topLevel: false,
  }
  blocks[notId] = {
    opcode: 'operator_not', next: null, parent: ifId,
    inputs: { OPERAND: [2, eqId] }, fields: {}, shadow: false, topLevel: false,
  }
  blocks[ifId] = {
    opcode: 'control_if', next: null, parent: tickDef.id,
    inputs: { CONDITION: [2, notId], SUBSTACK: [2, firstId] },
    fields: {}, shadow: false, topLevel: false,
  }
  blocks[firstId].parent = ifId
  tickDef.next = ifId
}

// ---- (b) P key toggles pause + PAUSED bubble (new script) ----
const pTop = player.addScript([
  { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: ['p', null] } },
  {
    opcode: 'control_if_else', inputs: {
      CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: { var: 'paused', id: pausedId }, OPERAND2: 1 } } },
      SUBSTACK: {
        substack: [
          { opcode: 'data_setvariableto', fields: { VARIABLE: ['paused', pausedId] }, inputs: { VALUE: 0 } },
          { opcode: 'looks_say', inputs: { MESSAGE: '' } },
        ],
      },
      SUBSTACK2: {
        substack: [
          { opcode: 'data_setvariableto', fields: { VARIABLE: ['paused', pausedId] }, inputs: { VALUE: 1 } },
          { opcode: 'looks_say', inputs: { MESSAGE: 'PAUSED' } },
        ],
      },
    },
  },
], { x: -500, y: 1100 })

// ---- (d) comments on each new/changed script ----
addComment('L6: pause — skip the whole tick while paused is 1; jumps uses rising-edge (upWas) so holding Up cannot burn both jumps', tickDef.id, 544, -242)
addComment('L6: double jump — reset the jump counter wherever in air resets (landing)',
  defTop('change player y by %s').id, 207, 454)
addComment('L6: double jump — jumps starts at 0 with every game', defTop('game on').id, 996, -292)
addComment('L6: P toggles paused; PAUSED shows while paused', pTop, -250, 1100)

const out = await ir.toSb3()
writeFileSync(OUT, out)
console.log('wrote out.sb3', out.length, 'bytes')
