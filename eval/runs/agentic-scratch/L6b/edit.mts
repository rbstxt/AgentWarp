import { readFileSync, writeFileSync } from 'node:fs'
import { ProjectIR } from '@scratch-agent/ir'

type B = any
const FIX = '/path/to/agentwarp/eval/fixtures/platformer-853110869.sb3'
const OUT = new URL('./out.sb3', import.meta.url)

const ir = await ProjectIR.fromSb3(new Uint8Array(readFileSync(FIX)))
const st = ir.target('ステージ')!
const blocks = st.raw.blocks as Record<string, B>
for (const [id, b] of Object.entries(blocks)) if (b && typeof b === 'object') b.id = id

const timeId = st.addVariable('タイム', 0)

// monitor, shown (TIME's own monitor stays hidden)
ir.json.monitors.push({
  id: timeId, mode: 'default', opcode: 'data_variable',
  params: { VARIABLE: 'タイム' }, spriteName: null,
  value: 0, width: 0, height: 0, x: 195, y: 140, visible: true,
  sliderMin: 0, sliderMax: 100, isDiscrete: true,
} as never)

// new script: count seconds since green flag (timer pattern mirrors TIME logic)
const counterTop = st.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'data_showvariable', fields: { VARIABLE: ['タイム', timeId] } },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['タイム', timeId] }, inputs: { VALUE: 0 } },
  { opcode: 'sensing_resettimer' },
  {
    opcode: 'control_forever', inputs: {
      SUBSTACK: {
        substack: [
          {
            opcode: 'control_wait_until', inputs: {
              CONDITION: { boolean: { opcode: 'operator_gt', inputs: { OPERAND1: { reporter: { opcode: 'sensing_timer' } }, OPERAND2: 1 } } },
            },
          },
          { opcode: 'data_changevariableby', fields: { VARIABLE: ['タイム', timeId] }, inputs: { VALUE: 1 } },
          { opcode: 'sensing_resettimer' },
        ],
      },
    },
  },
], { x: -373, y: 900 })

// reset on level restart: prepend `タイム = 0` to the 次のステージ receiver
const recvId = ':zQjuUj)F+Xg/MM97c*b'
const recv = blocks[recvId]
if (!recv || recv.opcode !== 'event_whenbroadcastreceived') throw new Error('receiver not found')
{
  const id = ir.uids.next()
  const firstId = recv.next as string
  blocks[id] = {
    opcode: 'data_setvariableto', next: firstId ?? null, parent: recvId,
    inputs: { VALUE: [1, [10, '0']] }, fields: { VARIABLE: ['タイム', timeId] },
    shadow: false, topLevel: false,
  }
  if (typeof firstId === 'string' && blocks[firstId]) blocks[firstId].parent = id
  recv.next = id
}

function addComment(text: string, blockId: string, x: number, y: number): void {
  const id = ir.uids.next()
  ;(st.raw.comments as any)[id] = {
    blockId, x, y, width: 220, height: 100, minimized: false, text,
  }
}
addComment('L6b: タイム counts seconds since green flag (shown as a monitor)', counterTop, -123, 900)
addComment('L6b: reset タイム when the next level starts', recvId, 369, 452)

const out = await ir.toSb3()
writeFileSync(OUT, out)
console.log('wrote out.sb3', out.length, 'bytes')
