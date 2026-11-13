import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { blankProject, type ProjectIR } from '@scratch-agent/ir'

function svgAsset(name: string, inner: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="80" height="80">${inner}</svg>`
  const bytes = Buffer.from(svg, 'utf-8')
  const assetId = createHash('md5').update(bytes).digest('hex')
  return {
    entry: {
      name, assetId, md5ext: `${assetId}.svg`, dataFormat: 'svg',
      bitmapResolution: 1, rotationCenterX: 40, rotationCenterY: 40,
    },
    bytes: new Uint8Array(bytes),
  }
}

// 8-bit mono 8000 Hz WAV, 0.25 s pop (660 Hz sine w/ exponential decay)
function popWav(): { bytes: Uint8Array; sampleCount: number } {
  const rate = 8000, n = 2000
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const env = Math.exp(-t * 22)
    data[i] = Math.round(128 + 110 * env * Math.sin(2 * Math.PI * 660 * t))
  }
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + n, 4); hdr.write('WAVE', 8)
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20)
  hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate, 28)
  hdr.writeUInt16LE(1, 32); hdr.writeUInt16LE(8, 34); hdr.write('data', 36)
  hdr.writeUInt32LE(n, 40)
  return { bytes: new Uint8Array(Buffer.concat([hdr, Buffer.from(data)])), sampleCount: n }
}

// flip IR-lowered {reporter} menu blocks into real shadow menu blocks:
// parent input [3,id,..] -> [1,id], block.shadow = true
function shadowifyMenus(ir: ProjectIR, menuOpcodes: string[]) {
  for (const t of ir.json.targets) {
    for (const [id, b] of Object.entries(t.blocks)) {
      if (typeof b !== 'object' || b === null || Array.isArray(b)) continue
      if (!menuOpcodes.includes((b as { opcode: string }).opcode)) continue
      const blk = b as { shadow: boolean; parent: string | null; inputs: Record<string, [number, string, unknown?]> }
      blk.shadow = true
      const parent = t.blocks[blk.parent as string] as unknown as
        { inputs?: Record<string, [number, unknown, unknown?]> } | undefined
      if (parent?.inputs) {
        for (const [k, v] of Object.entries(parent.inputs)) {
          if (Array.isArray(v) && v[1] === id) parent.inputs[k] = [1, id]
        }
      }
    }
  }
}

const ir = blankProject()

// stage: extra "win" backdrop
{
  const stage = ir.stage!
  const { entry, bytes } = svgAsset('win', '<rect width="80" height="80" fill="#00c853"/><text x="40" y="45" text-anchor="middle" font-size="16" fill="white">YOU WIN</text>')
  stage.addCostume(entry as never, bytes)
}

const cookie = ir.target('Sprite1') ?? ir.addSprite('Cookie')
cookie.raw.name = 'Cookie'
{
  const normal = svgAsset('cookie', '<circle cx="40" cy="40" r="32" fill="#a5672a"/><circle cx="30" cy="32" r="5" fill="#5b3a15"/><circle cx="48" cy="30" r="5" fill="#5b3a15"/><circle cx="40" cy="50" r="5" fill="#5b3a15"/>')
  cookie.addCostume(normal.entry as never, normal.bytes)
  const pressed = svgAsset('pressed', '<circle cx="40" cy="40" r="32" fill="#6e421a"/><circle cx="30" cy="32" r="5" fill="#3d250c"/><circle cx="48" cy="30" r="5" fill="#3d250c"/><circle cx="40" cy="50" r="5" fill="#3d250c"/>')
  cookie.addCostume(pressed.entry as never, pressed.bytes)
  const { bytes } = popWav()
  const assetId = createHash('md5').update(bytes).digest('hex')
  cookie.addSound({
    name: 'pop', assetId, md5ext: `${assetId}.wav`,
    dataFormat: 'wav', format: '', rate: 8000, sampleCount: 2000,
  } as never, bytes)
}

const scoreId = cookie.addVariable('score', 0)
const winId = cookie.addBroadcast('win')

cookie.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['score', scoreId] }, inputs: { VALUE: 0 } },
  { opcode: 'looks_switchcostumeto', inputs: { COSTUME: { reporter: { opcode: 'looks_costume', fields: { COSTUME: ['cookie', null] } } } } },
  { opcode: 'looks_switchbackdropto', inputs: { BACKDROP: { reporter: { opcode: 'looks_backdrops', fields: { BACKDROP: ['backdrop1', null] } } } } },
])

cookie.addScript([
  { opcode: 'event_whenthisspriteclicked' },
  { opcode: 'data_changevariableby', fields: { VARIABLE: ['score', scoreId] }, inputs: { VALUE: 1 } },
  { opcode: 'sound_play', inputs: { SOUND_MENU: { reporter: { opcode: 'sound_sounds_menu', fields: { SOUND_MENU: ['pop', null] } } } } },
  { opcode: 'looks_switchcostumeto', inputs: { COSTUME: { reporter: { opcode: 'looks_costume', fields: { COSTUME: ['pressed', null] } } } } },
  { opcode: 'control_wait', inputs: { DURATION: 0.1 } },
  { opcode: 'looks_switchcostumeto', inputs: { COSTUME: { reporter: { opcode: 'looks_costume', fields: { COSTUME: ['cookie', null] } } } } },
  {
    opcode: 'control_if',
    inputs: {
      CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: { var: 'score', id: scoreId }, OPERAND2: 10 } } },
      SUBSTACK: {
        substack: [
          { opcode: 'looks_switchbackdropto', inputs: { BACKDROP: { reporter: { opcode: 'looks_backdrops', fields: { BACKDROP: ['win', null] } } } } },
          { opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { broadcast: 'win', id: winId } } },
        ],
      },
    },
  },
], { x: 0, y: 250 })

shadowifyMenus(ir, ['looks_costume', 'looks_backdrops', 'sound_sounds_menu'])

// score monitor
ir.json.monitors.push({
  id: scoreId, mode: 'default', opcode: 'data_variable',
  params: { VARIABLE: 'score' }, spriteName: 'Cookie',
  value: 0, width: 0, height: 0, x: 5, y: 5, visible: true,
} as never)

const out = await ir.toSb3()
writeFileSync(new URL('./out.sb3', import.meta.url), out)
console.log('wrote out.sb3', out.length, 'bytes')
