/** Minimal sb3 -> text disassembler for inspection (L6/L6b workaround tooling). */
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'

const [sb3Path] = process.argv.slice(2)

const zip = unzipSync(readFileSync(sb3Path))
const project = JSON.parse(new TextDecoder().decode(zip['project.json']))

function val(input: any, blocks: any): string {
  if (!Array.isArray(input)) return '?'
  const [shadow, v, v2] = input
  if (typeof v === 'string' && blocks[v]) return `(${block(blocks[v], blocks, 0)})`
  if (Array.isArray(v)) {
    // primitive [code, value, ...]
    if (v[0] === 12 && v[1] && blocks[v[1]]) return `menu:${v[1]}`
    return JSON.stringify(v[1])
  }
  return String(v ?? '')
}

function block(b: any, blocks: any, depth: number): string {
  const pad = '  '.repeat(depth)
  let s = `${pad}${b.opcode}`
  for (const [k, v] of Object.entries(b.fields ?? {})) {
    const f = v as any[]
    s += ` |${k}=${JSON.stringify(f[0])}`
  }
  for (const [k, v] of Object.entries(b.inputs ?? {})) {
    const inp = v as any[]
    if (typeof inp[1] === 'string' && blocks[inp[1]]) {
      s += ` |${k}=[${block(blocks[inp[1]], blocks, depth + 1)}]`
    } else {
      s += ` |${k}=${val(inp, blocks)}`
    }
  }
  if (b.next && blocks[b.next]) s += `\n${block(blocks[b.next], blocks, depth)}`
  return s
}

for (const t of project.targets) {
  console.log(`\n######## ${t.name} ${t.isStage ? '(stage)' : ''}`)
  if (t.variables) for (const [id, v] of Object.entries<any>(t.variables)) {
    if (Array.isArray(v)) console.log(`  var: ${v[0]} = ${JSON.stringify(v[1]).slice(0,80)} (${id})`)
    else if (v.type === 'broadcast_msg') console.log(`  broadcast: ${v.name} (${id})`)
    else console.log(`  var: ${v.name} = ${JSON.stringify(v.value)} (${id})`)
  }
  if (t.lists) for (const [id, v] of Object.entries<any>(t.lists)) {
    if (Array.isArray(v)) console.log(`  list: ${v[0]} (${v[1]?.length} items) (${id})`)
    else console.log(`  list: ${v.name} = ${JSON.stringify(v.value).slice(0, 120)} (${id})`)
  }
  for (const [bid, b] of Object.entries<any>(t.blocks)) {
    if (b && typeof b === 'object' && b.topLevel) {
      console.log(`\n-- script ${bid} @(${b.x},${b.y})`)
      console.log(block(b, t.blocks, 1))
    }
  }
}
