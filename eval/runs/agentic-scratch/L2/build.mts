import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { blankProject } from '@scratch-agent/ir'

function svgCostume(name: string, inner: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="60" height="60">${inner}</svg>`
  const bytes = Buffer.from(svg, 'utf-8')
  const assetId = createHash('md5').update(bytes).digest('hex')
  return {
    costume: {
      name, assetId, md5ext: `${assetId}.svg`, dataFormat: 'svg',
      bitmapResolution: 1, rotationCenterX: 30, rotationCenterY: 30,
    },
    bytes: new Uint8Array(bytes),
  }
}

function keyHeld(key: string) {
  return { boolean: { opcode: 'sensing_keypressed', inputs: { KEY_OPTION: key } } }
}

const ir = blankProject()

const cat = ir.addSprite('Sprite1')
{
  const { costume, bytes } = svgCostume('cat', '<circle cx="30" cy="30" r="25" fill="#ff8c1a"/>')
  cat.addCostume(costume as never, bytes)
}
cat.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
  {
    opcode: 'control_forever',
    inputs: {
      SUBSTACK: {
        substack: [
          { opcode: 'control_if', inputs: { CONDITION: keyHeld('right arrow'), SUBSTACK: { substack: [{ opcode: 'motion_changexby', inputs: { DX: 5 } }] } } },
          { opcode: 'control_if', inputs: { CONDITION: keyHeld('left arrow'), SUBSTACK: { substack: [{ opcode: 'motion_changexby', inputs: { DX: -5 } }] } } },
        ],
      },
    },
  },
])

const ball = ir.addSprite('Ball')
{
  const { costume, bytes } = svgCostume('ball', '<circle cx="30" cy="30" r="20" fill="#ff0000"/>')
  ball.addCostume(costume as never, bytes)
}
ball.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
  { opcode: 'motion_pointindirection', inputs: { DIRECTION: 45 } },
  {
    opcode: 'control_forever',
    inputs: {
      SUBSTACK: {
        substack: [
          { opcode: 'motion_movesteps', inputs: { STEPS: 5 } },
          { opcode: 'motion_ifonedgebounce' },
        ],
      },
    },
  },
], { x: 0, y: 0 })

const out = await ir.toSb3()
writeFileSync(new URL('./out.sb3', import.meta.url), out)
console.log('wrote out.sb3', out.length, 'bytes')
