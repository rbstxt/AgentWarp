import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { blankProject, type ProjectIR } from '@scratch-agent/ir'

function svgAsset(name: string, w: number, h: number, inner: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}" height="${h}">${inner}</svg>`
  const bytes = Buffer.from(svg, 'utf-8')
  const assetId = createHash('md5').update(bytes).digest('hex')
  return {
    entry: {
      name, assetId, md5ext: `${assetId}.svg`, dataFormat: 'svg',
      bitmapResolution: 1, rotationCenterX: w / 2, rotationCenterY: h / 2,
    },
    bytes: new Uint8Array(bytes),
  }
}

function keyHeld(key: string) {
  return { boolean: { opcode: 'sensing_keypressed', inputs: { KEY_OPTION: key } } }
}

function touching(sprite: string) {
  return {
    boolean: {
      opcode: 'sensing_touchingobject',
      inputs: {
        TOUCHINGOBJECTMENU: {
          reporter: { opcode: 'sensing_touchingobjectmenu', fields: { TOUCHINGOBJECTMENU: [sprite, null] } },
        },
      },
    },
  }
}

function shadowifyMenus(ir: ProjectIR, menuOpcodes: string[]) {
  for (const t of ir.json.targets) {
    for (const [id, b] of Object.entries(t.blocks)) {
      if (typeof b !== 'object' || b === null || Array.isArray(b)) continue
      const blk = b as any
      if (!menuOpcodes.includes(blk.opcode)) continue
      blk.shadow = true
      const parent = (t.blocks as any)[blk.parent]
      if (parent?.inputs) {
        for (const [k, v] of Object.entries(parent.inputs as any)) {
          if (Array.isArray(v) && (v as any[])[1] === id) (parent.inputs as any)[k] = [1, id]
        }
      }
    }
  }
}

const ir = blankProject()
const stage = ir.stage!
const scoreId = stage.addVariable('score', 0)
const livesId = stage.addVariable('lives', 3)
const bcGameover = stage.addBroadcast('gameover')

stage.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['score', scoreId] }, inputs: { VALUE: 0 } },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['lives', livesId] }, inputs: { VALUE: 3 } },
])
stage.addScript([
  { opcode: 'event_whenflagclicked' },
  {
    opcode: 'control_forever', inputs: {
      SUBSTACK: {
        substack: [
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_lt', inputs: { OPERAND1: { var: 'lives', id: livesId }, OPERAND2: 1 } } },
              SUBSTACK: { substack: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { broadcast: 'gameover', id: '__gameover__' } } }] },
            },
          },
        ],
      },
    },
  },
], { x: 0, y: 250 })

// Player
const player = ir.addSprite('Player', { x: 0, y: -150 })
{
  const c = svgAsset('player', 50, 30, '<rect width="50" height="30" fill="#4c97ff"/>')
  player.addCostume(c.entry as never, c.bytes)
}
player.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'motion_gotoxy', inputs: { X: 0, Y: -150 } },
  { opcode: 'looks_show' },
  {
    opcode: 'control_forever', inputs: {
      SUBSTACK: {
        substack: [
          { opcode: 'control_if', inputs: { CONDITION: keyHeld('left arrow'), SUBSTACK: { substack: [{ opcode: 'motion_changexby', inputs: { DX: -8 } }] } } },
          { opcode: 'control_if', inputs: { CONDITION: keyHeld('right arrow'), SUBSTACK: { substack: [{ opcode: 'motion_changexby', inputs: { DX: 8 } }] } } },
        ],
      },
    },
  },
], { x: 20, y: 20 })
player.addScript([
  { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: ['space', null] } },
  {
    opcode: 'control_create_clone_of', inputs: {
      CLONE_OPTION: { reporter: { opcode: 'control_create_clone_of_menu', fields: { CLONE_OPTION: ['Bullet', null] } } },
    },
  },
], { x: 20, y: 450 })
// GameOver banner (a say bubble would be cleared by stop-all: the VM resets
// bubbles on PROJECT_STOP_ALL, so visibility must carry the message)
const gameover = ir.addSprite('GameOver', { x: 0, y: 0 })
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="300" height="80"><rect width="300" height="80" fill="#111111"/><text x="150" y="52" text-anchor="middle" font-size="36" fill="#ff3333" font-family="sans-serif">GAME OVER</text></svg>`
  const bytes = Buffer.from(svg, 'utf-8')
  const assetId = createHash('md5').update(bytes).digest('hex')
  gameover.addCostume({
    name: 'gameover', assetId, md5ext: `${assetId}.svg`, dataFormat: 'svg',
    bitmapResolution: 1, rotationCenterX: 150, rotationCenterY: 40,
  } as never, new Uint8Array(bytes))
}
gameover.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'looks_hide' },
])
gameover.addScript([
  { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: ['gameover', bcGameover] } },
  { opcode: 'looks_show' },
  { opcode: 'control_stop', fields: { STOP_OPTION: ['all', null] } },
], { x: 20, y: 300 })

// fix broadcast id reference (declared id above)
for (const t of ir.json.targets) {
  for (const b of Object.values(t.blocks)) {
    const blk = b as any
    if (blk?.opcode === 'event_broadcast' && blk.inputs?.BROADCAST_INPUT?.[1]?.[2] === '__gameover__') {
      blk.inputs.BROADCAST_INPUT = [1, [11, 'gameover', bcGameover]]
    }
  }
}

// Bullet (template hidden; clones fly up)
const bullet = ir.addSprite('Bullet', { x: 0, y: -150 })
{
  const c = svgAsset('bullet', 10, 24, '<rect width="10" height="24" fill="#ffff00"/>')
  bullet.addCostume(c.entry as never, c.bytes)
}
bullet.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'looks_hide' },
])
bullet.addScript([
  { opcode: 'control_start_as_clone' },
  { opcode: 'looks_show' },
  { opcode: 'motion_goto', inputs: { TO: { reporter: { opcode: 'motion_goto_menu', fields: { TO: ['Player', null] } } } } },
  { opcode: 'motion_sety', inputs: { Y: -130 } },
  { opcode: 'motion_pointindirection', inputs: { DIRECTION: 0 } },
  {
    opcode: 'control_forever', inputs: {
      SUBSTACK: {
        substack: [
          { opcode: 'motion_movesteps', inputs: { STEPS: 15 } },
          {
            opcode: 'control_if', inputs: {
              CONDITION: touching('Enemy'),
              SUBSTACK: {
                substack: [
                  { opcode: 'data_changevariableby', fields: { VARIABLE: ['score', scoreId] }, inputs: { VALUE: 1 } },
                  { opcode: 'control_delete_this_clone' },
                ],
              },
            },
          },
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_gt', inputs: { OPERAND1: { reporter: { opcode: 'motion_yposition' } }, OPERAND2: 180 } } },
              SUBSTACK: { substack: [{ opcode: 'control_delete_this_clone' }] },
            },
          },
        ],
      },
    },
  },
], { x: 0, y: 250 })

// Enemy (template hidden; spawns a clone of itself every 1s)
const enemy = ir.addSprite('Enemy', { x: 0, y: 170 })
{
  const c = svgAsset('enemy', 50, 40, '<rect width="50" height="40" fill="#ff0000"/>')
  enemy.addCostume(c.entry as never, c.bytes)
}
enemy.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'looks_hide' },
  {
    opcode: 'control_forever', inputs: {
      SUBSTACK: {
        substack: [
          { opcode: 'control_wait', inputs: { DURATION: 1 } },
          {
            opcode: 'control_create_clone_of', inputs: {
              CLONE_OPTION: { reporter: { opcode: 'control_create_clone_of_menu', fields: { CLONE_OPTION: ['_myself_', null] } } },
            },
          },
        ],
      },
    },
  },
])
enemy.addScript([
  { opcode: 'control_start_as_clone' },
  { opcode: 'looks_show' },
  {
    opcode: 'motion_gotoxy', inputs: {
      X: { reporter: { opcode: 'operator_random', inputs: { FROM: -200, TO: 200 } } }, Y: 170,
    },
  },
  {
    opcode: 'control_forever', inputs: {
      SUBSTACK: {
        substack: [
          { opcode: 'motion_changeyby', inputs: { DY: -3 } },
          {
            opcode: 'control_if', inputs: {
              CONDITION: touching('Bullet'),
              SUBSTACK: { substack: [{ opcode: 'control_delete_this_clone' }] },
            },
          },
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_lt', inputs: { OPERAND1: { reporter: { opcode: 'motion_yposition' } }, OPERAND2: -160 } } },
              SUBSTACK: {
                substack: [
                  { opcode: 'data_changevariableby', fields: { VARIABLE: ['lives', livesId] }, inputs: { VALUE: -1 } },
                  { opcode: 'control_delete_this_clone' },
                ],
              },
            },
          },
        ],
      },
    },
  },
], { x: 0, y: 300 })

shadowifyMenus(ir, ['control_create_clone_of_menu', 'sensing_touchingobjectmenu', 'motion_goto_menu'])

const out = await ir.toSb3()
writeFileSync(new URL('./out.sb3', import.meta.url), out)
console.log('wrote out.sb3', out.length, 'bytes')
