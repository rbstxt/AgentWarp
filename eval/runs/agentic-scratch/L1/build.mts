import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { blankProject } from '@scratch-agent/ir'

function svgCostume(name: string, fill: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="60" height="60"><circle cx="30" cy="30" r="25" fill="${fill}"/></svg>`
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

const ir = blankProject()
const sprite = ir.addSprite('Sprite1')
const { costume, bytes } = svgCostume('cat', '#ff8c1a')
sprite.addCostume(costume as never, bytes)

sprite.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
  { opcode: 'motion_movesteps', inputs: { STEPS: 10 } },
  { opcode: 'looks_sayforsecs', inputs: { MESSAGE: 'Hello!', SECS: 2 } },
])

const out = await ir.toSb3()
writeFileSync(new URL('./out.sb3', import.meta.url), out)
console.log('wrote out.sb3', out.length, 'bytes')
