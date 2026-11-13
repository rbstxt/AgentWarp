/**
 * Height-aware restack pass (L5 workaround).
 *
 * Hikkaku's built-in layout (composer.ts layoutTopLevelBlocks) stacks scripts
 * at a fixed 260px stride, ignores actual script height, and never positions
 * procedures_definition hats at all (left at 0,0). Tall scripts therefore
 * overlap (L5 scored 0/100). There is no API to set positions.
 *
 * This script repositions scripts using the harness's own size model
 * (`vmrun layout` bounding boxes): per target, scripts stacked in a column
 * with 30px gaps; workspace comments moved to a right-hand column.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { unzipSync, zipSync } from 'fflate'

const [sb3Path] = process.argv.slice(2)
if (!sb3Path) {
  console.error('usage: bun restack.ts <out.sb3>')
  process.exit(1)
}

import { resolve } from 'node:path'
const sb3Abs = resolve(sb3Path)
const layoutRaw = await new Response(
  (await import('node:child_process')).execSync(
    `node tools/vmrun/cli.mjs layout "${sb3Abs}"`,
    { cwd: '/path/to/agentwarp' },
  ).toString(),
).json()

const zip = unzipSync(readFileSync(sb3Path))
const project = JSON.parse(new TextDecoder().decode(zip['project.json']))

for (const target of project.targets) {
  const info = layoutRaw.targets[target.name]
  if (!info) continue
  const byId = new Map(info.scripts.map((s: any) => [s.blockId, s]))
  // order scripts by current (y, x), stack with 30px gaps
  const tops = Object.keys(target.blocks)
    .filter((id) => target.blocks[id]?.topLevel)
    .sort((a, b) => {
      const sa = byId.get(a) ?? { x: 0, y: 0 }
      const sb = byId.get(b) ?? { x: 0, y: 0 }
      return sa.y - sb.y || sa.x - sb.x
    })
  let y = 20
  let maxW = 0
  for (const id of tops) {
    const s = byId.get(id) ?? { w: 200, h: 100 }
    target.blocks[id].x = 20
    target.blocks[id].y = y
    y += s.h + 30
    maxW = Math.max(maxW, s.w)
  }
  // comments into a right-hand column
  let cy = 20
  for (const c of Object.values<any>(target.comments ?? {})) {
    c.x = 20 + maxW + 40
    c.y = cy
    cy += (c.height ?? 60) + 30
  }
}

zip['project.json'] = new TextEncoder().encode(JSON.stringify(project))
writeFileSync(sb3Path, zipSync(zip, { level: 6 }))
console.log(`restacked ${sb3Path}`)
