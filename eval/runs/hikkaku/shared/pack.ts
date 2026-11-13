/**
 * Shared sb3 packer for the hikkaku P1 eval runs.
 *
 * Hikkaku gap #1 (assets): `Project.toScratch()` references default-asset
 * costumes/sounds by assetId but ships no bytes, and the vite builder is the
 * only thing that assembles an .sb3 (needs `vite build`, slow + opaque).
 * This helper packs project.json + resolved asset bytes directly.
 *
 * Hikkaku gap #2 (layout): every top-level script is emitted at x:0,y:0 with
 * no API to move it, so any multi-script sprite scores ~0 on `vmrun layout`.
 * This helper stacks scripts in a column (the documented workaround).
 *
 * Hikkaku gap #3 (comments): hikkaku always emits `comments: {}` — there is
 * no comment API at all. This helper injects workspace comments post-hoc.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { zipSync } from 'fflate'
import type { Project } from 'hikkaku'

const SCRATCH_CDN = 'https://assets.scratch.mit.edu/internalapi/asset'

export interface WorkspaceComment {
  /** target name ('Stage' or sprite name) */
  target: string
  text: string
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface PackOptions {
  /**
   * Stack each target's scripts in a left column (default false).
   * Hikkaku itself auto-layouts scripts created within one run() at
   * x=64, y=72+260*i (composer.ts layoutTopLevelBlocks), which already avoids
   * overlaps; scripts from separate run() calls on the same target restart
   * the counter and CAN overlap. Leave false to evaluate hikkaku faithfully.
   */
  layout?: boolean
  /** workspace comments to inject (hikkaku cannot author comments) */
  comments?: WorkspaceComment[];
  outPath: string
}

const md5 = (data: Uint8Array) =>
  createHash('md5').update(data).digest('hex')

/** Build a custom SVG costume with correct md5/asset bytes. */
export function svgCostume(
  name: string,
  svg: string,
  rotationCenterX = 0,
  rotationCenterY = 0,
) {
  const data = new TextEncoder().encode(svg)
  const id = md5(data)
  return {
    name,
    assetId: id,
    dataFormat: 'svg' as const,
    md5ext: `${id}.svg`,
    rotationCenterX,
    rotationCenterY,
    _data: data,
  }
}

/** Build a custom WAV sound with correct md5/asset bytes. */
export function wavSound(
  name: string,
  pcm16: Int16Array,
  rate = 22050,
) {
  const data = encodeWav(pcm16, rate)
  const id = md5(data)
  return {
    name,
    assetId: id,
    dataFormat: 'wav' as const,
    md5ext: `${id}.wav`,
    rate,
    sampleCount: pcm16.length,
    _data: data,
  }
}

function encodeWav(pcm: Int16Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const wstr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  wstr(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  wstr(8, 'WAVE')
  wstr(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  wstr(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true)
  return new Uint8Array(buf)
}

/** Generate a short "pop" blip (sine burst with exponential decay). */
export function popSound(name = 'pop', rate = 22050): ReturnType<typeof wavSound> {
  const dur = 0.12
  const n = Math.floor(rate * dur)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const f = 880 - t * 2000 // falling pitch 880 -> ~640Hz
    const env = Math.exp(-t * 30)
    pcm[i] = Math.floor(28000 * env * Math.sin(2 * Math.PI * f * t))
  }
  return wavSound(name, pcm, rate)
}

export async function packProject(
  project: Project,
  opts: PackOptions,
): Promise<string> {
  const scratch = project.toScratch() as unknown as {
    targets: Array<{
      name: string
      isStage: boolean
      blocks: Record<string, any>
      costumes: Array<Record<string, any>>
      sounds: Array<Record<string, any>>
      comments: Record<string, any>
    }>
  }
  const extra = project.getAdditionalAssets() as Map<string, Uint8Array>
  const files: Record<string, Uint8Array> = {}
  const netCache = new Map<string, Uint8Array>()

  const getBytes = async (
    assetId: string,
    ext: string,
  ): Promise<Uint8Array> => {
    const local = extra.get(`${assetId}.${ext}`)
    if (local) return local
    const key = `${assetId}.${ext}`
    if (!netCache.has(key)) {
      const res = await fetch(`${SCRATCH_CDN}/${assetId}/get/`)
      if (!res.ok) {
        throw new Error(`asset fetch failed for ${key}: HTTP ${res.status}`)
      }
      netCache.set(key, new Uint8Array(await res.arrayBuffer()))
    }
    return netCache.get(key)!
  }

  for (const target of scratch.targets) {
    for (const c of target.costumes) {
      const data = await getBytes(c.assetId, c.dataFormat)
      const id = md5(data)
      c.assetId = id
      c.md5ext = `${id}.${c.dataFormat}`
      delete c._data
      files[c.md5ext as string] = data
    }
    for (const s of target.sounds) {
      const data = await getBytes(s.assetId, s.dataFormat)
      const id = md5(data)
      s.assetId = id
      s.md5ext = `${id}.${s.dataFormat}`
      delete s._data
      files[s.md5ext as string] = data
    }
  }

  // Workaround for hikkaku gap #1b (broadcasts): hikkaku emits
  // `BROADCAST_INPUT: [1, [11, name, name]]` with empty `broadcasts: {}` maps,
  // so scratch-vm's lookupBroadcastMsg(id) finds nothing and the broadcast is
  // silently dropped. Declare every broadcast on the stage (where the VM
  // looks them up) and rewrite ids to match. Real Scratch files do this.
  {
    const names = new Set<string>()
    for (const target of scratch.targets) {
      for (const b of Object.values(target.blocks)) {
        if (!b || typeof b !== 'object') continue
        const inp = (b as any).inputs?.BROADCAST_INPUT
        if (Array.isArray(inp) && Array.isArray(inp[1]) && inp[1][0] === 11) {
          names.add(String(inp[1][1]))
        }
        const opt = (b as any).fields?.BROADCAST_OPTION
        if (Array.isArray(opt)) names.add(String(opt[0]))
      }
    }
    const sorted = [...names].sort()
    const ids = new Map(sorted.map((n, i) => [n, `hikkaku-bc-${i}`]))
    const stage = scratch.targets.find((t) => t.isStage)
    const declTarget = stage ?? scratch.targets[0]
    for (const [name, id] of ids) {
      ;(declTarget as any).broadcasts ??= {}
      ;(declTarget as any).broadcasts[id] = name
    }
    for (const target of scratch.targets) {
      for (const b of Object.values(target.blocks)) {
        if (!b || typeof b !== 'object') continue
        const inp = (b as any).inputs?.BROADCAST_INPUT
        if (Array.isArray(inp) && Array.isArray(inp[1]) && inp[1][0] === 11) {
          inp[1][2] = ids.get(String(inp[1][1]))
        }
        const opt = (b as any).fields?.BROADCAST_OPTION
        if (Array.isArray(opt) && ids.has(String(opt[0]))) {
          opt[1] = ids.get(String(opt[0]))
        }
      }
    }
  }

  // Optional restack (default off): hikkaku has no positioning API and no way
  // to set explicit coordinates; per-run() auto-layout can overlap across runs.
  if (opts.layout === true) {
    for (const target of scratch.targets) {
      const tops = Object.entries(target.blocks)
        .filter(([, b]) => b && typeof b === 'object' && b.topLevel)
        .map(([id]) => id)
        .sort()
      tops.forEach((id, i) => {
        target.blocks[id].x = 20
        target.blocks[id].y = 20 + i * 220
      })
      // move injected comments out of the way (right side)
      for (const c of Object.values(target.comments ?? {})) {
        if (c.x === 20 || c.x === undefined) {
          c.x = 320
        }
      }
    }
  }

  // Workaround for hikkaku gap #3: inject workspace comments.
  if (opts.comments) {
    let n = 0
    for (const c of opts.comments) {
      const target = scratch.targets.find((t) => t.name === c.target)
      if (!target) throw new Error(`comment target not found: ${c.target}`)
      const id = `hikkaku-comment-${++n}`
      target.comments[id] = {
        blockId: null,
        x: c.x ?? 320,
        y: c.y ?? 20 + (n - 1) * 90,
        width: c.width ?? 280,
        height: c.height ?? 60,
        minimized: false,
        text: c.text,
      }
    }
  }

  files['project.json'] = new TextEncoder().encode(JSON.stringify(scratch))
  writeFileSync(opts.outPath, zipSync(files, { level: 6 }))
  return opts.outPath
}
