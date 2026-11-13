import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { blankProject, buildScript, type BlockSpec, type ProjectIR } from '@scratch-agent/ir'

type AnyBlock = any
const V = (name: string, id: string) => ({ var: name, id })

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
function absOf(expr: any) {
  return { reporter: { opcode: 'operator_mathop', fields: { OPERATOR: ['abs', null] }, inputs: { NUM: expr } } }
}

// store tok into the fld-th rect field (px py pw ph)
function storeTok(px: string, py: string, pw: string, ph: string, tok: any, fld: any): BlockSpec[] {
  const targets = [px, py, pw, ph]
  return targets.map((t, k) => ({
    opcode: 'control_if',
    inputs: {
      CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: fld, OPERAND2: k + 1 } } },
      SUBSTACK: { substack: [{ opcode: 'data_setvariableto', fields: { VARIABLE: [t, (V as any).__ids[t]] }, inputs: { VALUE: tok } }] },
    },
  }))
}

const VAR_IDS: Record<string, string> = {}
function reg(obj: any, name: string, value: any = 0): string {
  const id = obj.addVariable(name, value)
  VAR_IDS[name] = id
  return id
}

const ir = blankProject()

// ---------- Stage ----------
const stage = ir.stage!
const levelId = reg(stage, 'level', 0)
const scrollXId = reg(stage, 'scrollX', 0)
const goalXId = reg(stage, 'goalX', 220)
const platformsId = stage.addList('platforms')
const bcLevel1 = stage.addBroadcast('level1')
const bcLevel2 = stage.addBroadcast('level2')

const L1 = ['-180 -160 120 20', '-60 -160 120 20', '60 -160 120 20', '180 -160 120 20', '-60 -60 120 20', '60 30 120 20']
const L2 = ['-120 -160 120 20', '0 -160 120 20', '120 -160 120 20', '240 -160 120 20', '0 -40 120 20', '120 50 120 20']

function levelSetupScript(bcName: string, bcId: string, n: number, rects: string[], goal: number): BlockSpec[] {
  return [
    { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: [bcName, bcId] } },
    { opcode: 'data_deletealloflist', fields: { LIST: ['platforms', platformsId] } },
    ...rects.map((r) => ({ opcode: 'data_addtolist', fields: { LIST: ['platforms', platformsId] }, inputs: { ITEM: r } })),
    { opcode: 'data_setvariableto', fields: { VARIABLE: ['level', levelId] }, inputs: { VALUE: n } },
    { opcode: 'data_setvariableto', fields: { VARIABLE: ['goalX', goalXId] }, inputs: { VALUE: goal } },
  ]
}

stage.addScript([
  { opcode: 'event_whenflagclicked' },
  { opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { broadcast: 'level1', id: bcLevel1 } } },
])
stage.addScript(levelSetupScript('level1', bcLevel1, 1, L1, 220), { x: 0, y: 300 })
stage.addScript(levelSetupScript('level2', bcLevel2, 2, L2, 260), { x: 0, y: 700 })

// ---------- Player ----------
const player = ir.addSprite('Player', { x: 0, y: -100 })
{
  const c = svgAsset('player', 30, 30, '<rect width="30" height="30" fill="#4c97ff"/>')
  player.addCostume(c.entry as never, c.bytes)
}
const worldXId = reg(player, 'worldX', -180)
const worldYId = reg(player, 'worldY', -100)
const velYId = reg(player, 'velY', 0)
const onGroundId = reg(player, 'onGround', 0)
const iId = reg(player, 'i', 0)
const SId = reg(player, 'S', '')
const tokId = reg(player, 'tok', '')
const chId = reg(player, 'ch', '')
const idxId = reg(player, 'idx', 0)
const fldId = reg(player, 'fld', 0)
const pxId = reg(player, 'px', 0)
const pyId = reg(player, 'py', 0)
const pwId = reg(player, 'pw', 0)
const phId = reg(player, 'ph', 0)
const penId = reg(player, 'pen', 0)
for (const [n, id] of Object.entries(VAR_IDS)) { ((V as any).__ids ??= {})[n] = id }

// procedure arg ids (stable, readable)
const DX = 'collide-dx', DY = 'collide-dy', PS = 'parse-S'
const sArg = () => ({ reporter: { opcode: 'argument_reporter_string_number', fields: { VALUE: ['S', null] } } })
const dxArg = () => ({ reporter: { opcode: 'argument_reporter_string_number', fields: { VALUE: ['dx', null] } } })
const dyArg = () => ({ reporter: { opcode: 'argument_reporter_string_number', fields: { VALUE: ['dy', null] } } })

// parseRect body
const parseBody: BlockSpec[] = [
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['tok', tokId] }, inputs: { VALUE: '' } },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['fld', fldId] }, inputs: { VALUE: 1 } },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['idx', idxId] }, inputs: { VALUE: 1 } },
  {
    opcode: 'control_repeat', inputs: {
      TIMES: { reporter: { opcode: 'operator_length', inputs: { STRING: sArg() } } },
      SUBSTACK: {
        substack: [
          { opcode: 'data_setvariableto', fields: { VARIABLE: ['ch', chId] }, inputs: { VALUE: { reporter: { opcode: 'operator_letter_of', inputs: { LETTER: V('idx', idxId), STRING: sArg() } } } } },
          {
            opcode: 'control_if_else', inputs: {
              CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: V('ch', chId), OPERAND2: ' ' } } },
              SUBSTACK: {
                substack: [
                  ...storeTok('px', 'py', 'pw', 'ph', V('tok', tokId), V('fld', fldId)),
                  { opcode: 'data_setvariableto', fields: { VARIABLE: ['tok', tokId] }, inputs: { VALUE: '' } },
                  { opcode: 'data_changevariableby', fields: { VARIABLE: ['fld', fldId] }, inputs: { VALUE: 1 } },
                ],
              },
              SUBSTACK2: { substack: [{ opcode: 'data_setvariableto', fields: { VARIABLE: ['tok', tokId] }, inputs: { VALUE: { reporter: { opcode: 'operator_join', inputs: { STRING1: V('tok', tokId), STRING2: V('ch', chId) } } } } }] },
            },
          },
          { opcode: 'data_changevariableby', fields: { VARIABLE: ['idx', idxId] }, inputs: { VALUE: 1 } },
        ],
      },
    },
  },
  ...storeTok('px', 'py', 'pw', 'ph', V('tok', tokId), V('fld', fldId)),
]

// collide body
const overlapX = {
  boolean: {
    opcode: 'operator_lt',
    inputs: {
      OPERAND1: { reporter: { opcode: 'operator_multiply', inputs: { NUM1: absOf({ reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldX', worldXId), NUM2: V('px', pxId) } } }), NUM2: 2 } } },
      OPERAND2: { reporter: { opcode: 'operator_add', inputs: { NUM1: 30, NUM2: V('pw', pwId) } } },
    },
  },
}
const overlapY = {
  boolean: {
    opcode: 'operator_lt',
    inputs: {
      OPERAND1: { reporter: { opcode: 'operator_multiply', inputs: { NUM1: absOf({ reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldY', worldYId), NUM2: V('py', pyId) } } }), NUM2: 2 } } },
      OPERAND2: { reporter: { opcode: 'operator_add', inputs: { NUM1: 30, NUM2: V('ph', phId) } } },
    },
  },
}
const collideBody: BlockSpec[] = [
  { opcode: 'data_changevariableby', fields: { VARIABLE: ['worldX', worldXId] }, inputs: { VALUE: dxArg() } },
  { opcode: 'data_changevariableby', fields: { VARIABLE: ['worldY', worldYId] }, inputs: { VALUE: dyArg() } },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['onGround', onGroundId] }, inputs: { VALUE: 0 } },
  { opcode: 'data_setvariableto', fields: { VARIABLE: ['i', iId] }, inputs: { VALUE: 1 } },
  {
    opcode: 'control_repeat', inputs: {
      TIMES: { reporter: { opcode: 'data_lengthoflist', fields: { LIST: ['platforms', platformsId] } } },
      SUBSTACK: {
        substack: [
          { opcode: 'data_setvariableto', fields: { VARIABLE: ['S', SId] }, inputs: { VALUE: { reporter: { opcode: 'data_itemoflist', fields: { LIST: ['platforms', platformsId] }, inputs: { INDEX: V('i', iId) } } } } },
          {
            opcode: 'procedures_call', inputs: { [PS]: V('S', SId) },
            mutation: { tagName: 'mutation', children: [], proccode: 'parseRect %s', argumentids: `["${PS}"]`, warp: 'true' },
          },
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_and', inputs: { OPERAND1: overlapX, OPERAND2: overlapY } } },
              SUBSTACK: {
                substack: [
                  {
                    opcode: 'control_if', inputs: {
                      CONDITION: { boolean: { opcode: 'operator_not', inputs: { OPERAND: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: dxArg(), OPERAND2: 0 } } } } } },
                      SUBSTACK: {
                        substack: [
                          { opcode: 'data_setvariableto', fields: { VARIABLE: ['pen', penId] }, inputs: { VALUE: { reporter: { opcode: 'operator_subtract', inputs: { NUM1: { reporter: { opcode: 'operator_divide', inputs: { NUM1: { reporter: { opcode: 'operator_add', inputs: { NUM1: 30, NUM2: V('pw', pwId) } } }, NUM2: 2 } } }, NUM2: absOf({ reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldX', worldXId), NUM2: V('px', pxId) } } }) } } } } },
                          {
                            opcode: 'control_if_else', inputs: {
                              CONDITION: { boolean: { opcode: 'operator_gt', inputs: { OPERAND1: V('worldX', worldXId), OPERAND2: V('px', pxId) } } },
                              SUBSTACK: { substack: [{ opcode: 'data_changevariableby', fields: { VARIABLE: ['worldX', worldXId] }, inputs: { VALUE: V('pen', penId) } }] },
                              SUBSTACK2: { substack: [{ opcode: 'data_changevariableby', fields: { VARIABLE: ['worldX', worldXId] }, inputs: { VALUE: { reporter: { opcode: 'operator_multiply', inputs: { NUM1: V('pen', penId), NUM2: -1 } } } } }] },
                            },
                          },
                        ],
                      },
                    },
                  },
                  {
                    opcode: 'control_if', inputs: {
                      CONDITION: { boolean: { opcode: 'operator_not', inputs: { OPERAND: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: dyArg(), OPERAND2: 0 } } } } } },
                      SUBSTACK: {
                        substack: [
                          { opcode: 'data_setvariableto', fields: { VARIABLE: ['pen', penId] }, inputs: { VALUE: { reporter: { opcode: 'operator_subtract', inputs: { NUM1: { reporter: { opcode: 'operator_divide', inputs: { NUM1: { reporter: { opcode: 'operator_add', inputs: { NUM1: 30, NUM2: V('ph', phId) } } }, NUM2: 2 } } }, NUM2: absOf({ reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldY', worldYId), NUM2: V('py', pyId) } } }) } } } } },
                          {
                            opcode: 'control_if_else', inputs: {
                              CONDITION: { boolean: { opcode: 'operator_gt', inputs: { OPERAND1: V('worldY', worldYId), OPERAND2: V('py', pyId) } } },
                              SUBSTACK: {
                                substack: [
                                  { opcode: 'data_changevariableby', fields: { VARIABLE: ['worldY', worldYId] }, inputs: { VALUE: V('pen', penId) } },
                                  { opcode: 'data_setvariableto', fields: { VARIABLE: ['onGround', onGroundId] }, inputs: { VALUE: 1 } },
                                  { opcode: 'data_setvariableto', fields: { VARIABLE: ['velY', velYId] }, inputs: { VALUE: 0 } },
                                ],
                              },
                              SUBSTACK2: {
                                substack: [
                                  { opcode: 'data_changevariableby', fields: { VARIABLE: ['worldY', worldYId] }, inputs: { VALUE: { reporter: { opcode: 'operator_multiply', inputs: { NUM1: V('pen', penId), NUM2: -1 } } } } },
                                  { opcode: 'data_setvariableto', fields: { VARIABLE: ['velY', velYId] }, inputs: { VALUE: 0 } },
                                ],
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
          { opcode: 'data_changevariableby', fields: { VARIABLE: ['i', iId] }, inputs: { VALUE: 1 } },
        ],
      },
    },
  },
]

// attach a procedure definition (raw blocks) around an IR-built body
function defineProcedure(
  target: any, proccode: string, args: { id: string; name: string }[],
  warp: boolean, body: BlockSpec[], pos: { x: number; y: number }, callMutationExtra = {}
) {
  const uids = ir.uids
  const defId = uids.next()
  const protoId = uids.next()
  const pillIds = args.map(() => uids.next())
  const built = buildScript(body, uids)
  const blocks: Record<string, AnyBlock> = {}
  // prototype + arg pills
  const protoInputs: Record<string, any> = {}
  args.forEach((a, k) => {
    protoInputs[a.id] = [1, pillIds[k]]
    blocks[pillIds[k]] = {
      opcode: 'argument_reporter_string_number', next: null, parent: protoId,
      inputs: {}, fields: { VALUE: [a.name, null] }, shadow: true, topLevel: false,
    }
  })
  blocks[protoId] = {
    opcode: 'procedures_prototype', next: null, parent: defId, inputs: protoInputs,
    fields: {}, shadow: true, topLevel: false,
    mutation: {
      tagName: 'mutation', children: [], proccode,
      argumentids: JSON.stringify(args.map((a) => a.id)),
      argumentnames: JSON.stringify(args.map((a) => a.name)),
      argumentdefaults: JSON.stringify(args.map(() => '')),
      warp: warp ? 'true' : 'false',
    },
  }
  blocks[defId] = {
    opcode: 'procedures_definition', next: built.topId, parent: null,
    inputs: { custom_block: [1, protoId] }, fields: {}, shadow: false, topLevel: true,
    x: pos.x, y: pos.y,
  }
  Object.assign(blocks, built.blocks)
  // body top block becomes a child of the definition
  const top = (blocks as any)[built.topId]
  top.parent = defId
  top.topLevel = false
  delete top.x
  delete top.y
  Object.assign(target.raw.blocks, blocks)
  return { defId, callMutation: { tagName: 'mutation', children: [], proccode, argumentids: JSON.stringify(args.map((a) => a.id)), warp: warp ? 'true' : 'false', ...callMutationExtra } }
}

const parseCallMutation = defineProcedure(player, 'parseRect %s', [{ id: PS, name: 'S' }], true, parseBody, { x: 20, y: 2100 }).callMutation

// NOTE: collide body references parseRect call — patch its mutation now (defined above)
for (const b of Object.values(player.raw.blocks)) {
  const blk = b as any
  if (blk?.opcode === 'procedures_call' && blk?.mutation?.proccode === 'parseRect %s') {
    blk.mutation = parseCallMutation
  }
}

const collideMutation = defineProcedure(player, 'collide %n %n', [{ id: DX, name: 'dx' }, { id: DY, name: 'dy' }], true, collideBody, { x: 20, y: 3500 }).callMutation

function collideCall(dx: any, dy: any): BlockSpec {
  return { opcode: 'procedures_call', inputs: { [DX]: dx, [DY]: dy }, mutation: collideMutation as any }
}

// main loop
player.addScript([
  { opcode: 'event_whenflagclicked' },
  {
    opcode: 'control_wait_until', inputs: {
      CONDITION: { boolean: { opcode: 'operator_gt', inputs: { OPERAND1: { reporter: { opcode: 'data_lengthoflist', fields: { LIST: ['platforms', platformsId] } } }, OPERAND2: 0 } } },
    },
  },
  {
    opcode: 'control_forever', inputs: {
      SUBSTACK: {
        substack: [
          { opcode: 'control_if', inputs: { CONDITION: keyHeld('left arrow'), SUBSTACK: { substack: [collideCall(-5, 0)] } } },
          { opcode: 'control_if', inputs: { CONDITION: keyHeld('right arrow'), SUBSTACK: { substack: [collideCall(5, 0)] } } },
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_and', inputs: { OPERAND1: keyHeld('up arrow'), OPERAND2: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: V('onGround', onGroundId), OPERAND2: 1 } } } } } },
              SUBSTACK: {
                substack: [
                  { opcode: 'data_setvariableto', fields: { VARIABLE: ['velY', velYId] }, inputs: { VALUE: 12 } },
                  { opcode: 'data_setvariableto', fields: { VARIABLE: ['onGround', onGroundId] }, inputs: { VALUE: 0 } },
                ],
              },
            },
          },
          { opcode: 'data_changevariableby', fields: { VARIABLE: ['velY', velYId] }, inputs: { VALUE: -0.7 } },
          collideCall(0, V('velY', velYId)),
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_gt', inputs: { OPERAND1: { reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldX', worldXId), NUM2: V('scrollX', scrollXId) } } }, OPERAND2: 100 } } },
              SUBSTACK: { substack: [{ opcode: 'data_setvariableto', fields: { VARIABLE: ['scrollX', scrollXId] }, inputs: { VALUE: { reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldX', worldXId), NUM2: 100 } } } } }] },
            },
          },
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_lt', inputs: { OPERAND1: { reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldX', worldXId), NUM2: V('scrollX', scrollXId) } } }, OPERAND2: -100 } } },
              SUBSTACK: { substack: [{ opcode: 'data_setvariableto', fields: { VARIABLE: ['scrollX', scrollXId] }, inputs: { VALUE: { reporter: { opcode: 'operator_add', inputs: { NUM1: V('worldX', worldXId), NUM2: 100 } } } } }] },
            },
          },
          { opcode: 'motion_gotoxy', inputs: { X: { reporter: { opcode: 'operator_subtract', inputs: { NUM1: V('worldX', worldXId), NUM2: V('scrollX', scrollXId) } } }, Y: V('worldY', worldYId) } },
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_lt', inputs: { OPERAND1: V('worldY', worldYId), OPERAND2: -250 } } },
              SUBSTACK: {
                substack: [
                  {
                    opcode: 'control_if_else', inputs: {
                      CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: V('level', levelId), OPERAND2: 1 } } },
                      SUBSTACK: { substack: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { broadcast: 'level1', id: bcLevel1 } } }] },
                      SUBSTACK2: { substack: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { broadcast: 'level2', id: bcLevel2 } } }] },
                    },
                  },
                ],
              },
            },
          },
          {
            opcode: 'control_if', inputs: {
              CONDITION: { boolean: { opcode: 'operator_gt', inputs: { OPERAND1: V('worldX', worldXId), OPERAND2: V('goalX', goalXId) } } },
              SUBSTACK: {
                substack: [
                  {
                    opcode: 'control_if_else', inputs: {
                      CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: V('level', levelId), OPERAND2: 1 } } },
                      SUBSTACK: { substack: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { broadcast: 'level2', id: bcLevel2 } } }] },
                      SUBSTACK2: { substack: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { broadcast: 'level1', id: bcLevel1 } } }] },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  },
], { x: 20, y: 20 })

// level reset receivers
for (const [bcName, bcId, wx, wy, y] of [['level1', bcLevel1, -180, -100, 1300], ['level2', bcLevel2, -160, 0, 1700]] as const) {
  player.addScript([
    { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: [bcName, bcId] } },
    { opcode: 'data_setvariableto', fields: { VARIABLE: ['worldX', worldXId] }, inputs: { VALUE: wx } },
    { opcode: 'data_setvariableto', fields: { VARIABLE: ['worldY', worldYId] }, inputs: { VALUE: wy } },
    { opcode: 'data_setvariableto', fields: { VARIABLE: ['velY', velYId] }, inputs: { VALUE: 0 } },
    { opcode: 'data_setvariableto', fields: { VARIABLE: ['onGround', onGroundId] }, inputs: { VALUE: 0 } },
    { opcode: 'data_setvariableto', fields: { VARIABLE: ['scrollX', scrollXId] }, inputs: { VALUE: 0 } },
    { opcode: 'looks_show' },
    { opcode: 'motion_gotoxy', inputs: { X: wx, Y: wy } },
  ], { x: 20, y })
}

// ---------- Platform sprites (one per list index, fixed literal K) ----------
for (let k = 1; k <= 6; k++) {
  const plat = ir.addSprite(`Platform${k}`, { x: 0, y: -999 })
  const c = svgAsset('platform', 120, 20, '<rect width="120" height="20" fill="#2e9e44"/>')
  plat.addCostume(c.entry as never, c.bytes)
  const pS = plat.addVariable('S', '')
  const pTok = plat.addVariable('tok', '')
  const pCh = plat.addVariable('ch', '')
  const pIdx = plat.addVariable('idx', 0)
  const pFld = plat.addVariable('fld', 0)
  const pPx = plat.addVariable('px', 0)
  const pPy = plat.addVariable('py', 0)
  const Vp = (n: string, id: string) => ({ var: n, id })
  const pv: Record<string, string> = { S: pS, tok: pTok, ch: pCh, idx: pIdx, fld: pFld, px: pPx, py: pPy }
  void pv
  plat.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'control_forever', inputs: {
        SUBSTACK: {
          substack: [
            { opcode: 'data_setvariableto', fields: { VARIABLE: ['S', pS] }, inputs: { VALUE: { reporter: { opcode: 'data_itemoflist', fields: { LIST: ['platforms', platformsId] }, inputs: { INDEX: k } } } } },
            { opcode: 'data_setvariableto', fields: { VARIABLE: ['tok', pTok] }, inputs: { VALUE: '' } },
            { opcode: 'data_setvariableto', fields: { VARIABLE: ['fld', pFld] }, inputs: { VALUE: 1 } },
            { opcode: 'data_setvariableto', fields: { VARIABLE: ['idx', pIdx] }, inputs: { VALUE: 1 } },
            {
              opcode: 'control_repeat', inputs: {
                TIMES: { reporter: { opcode: 'operator_length', inputs: { STRING: Vp('S', pS) } } },
                SUBSTACK: {
                  substack: [
                    { opcode: 'data_setvariableto', fields: { VARIABLE: ['ch', pCh] }, inputs: { VALUE: { reporter: { opcode: 'operator_letter_of', inputs: { LETTER: Vp('idx', pIdx), STRING: Vp('S', pS) } } } } },
                    {
                      opcode: 'control_if_else', inputs: {
                        CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: Vp('ch', pCh), OPERAND2: ' ' } } },
                        SUBSTACK: {
                          substack: [
                            { opcode: 'control_if', inputs: { CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: Vp('fld', pFld), OPERAND2: 1 } } }, SUBSTACK: { substack: [{ opcode: 'data_setvariableto', fields: { VARIABLE: ['px', pPx] }, inputs: { VALUE: Vp('tok', pTok) } }] } } },
                            { opcode: 'control_if', inputs: { CONDITION: { boolean: { opcode: 'operator_equals', inputs: { OPERAND1: Vp('fld', pFld), OPERAND2: 2 } } }, SUBSTACK: { substack: [{ opcode: 'data_setvariableto', fields: { VARIABLE: ['py', pPy] }, inputs: { VALUE: Vp('tok', pTok) } }] } } },
                            { opcode: 'data_setvariableto', fields: { VARIABLE: ['tok', pTok] }, inputs: { VALUE: '' } },
                            { opcode: 'data_changevariableby', fields: { VARIABLE: ['fld', pFld] }, inputs: { VALUE: 1 } },
                          ],
                        },
                        SUBSTACK2: { substack: [{ opcode: 'data_setvariableto', fields: { VARIABLE: ['tok', pTok] }, inputs: { VALUE: { reporter: { opcode: 'operator_join', inputs: { STRING1: Vp('tok', pTok), STRING2: Vp('ch', pCh) } } } } }] },
                      },
                    },
                    { opcode: 'data_changevariableby', fields: { VARIABLE: ['idx', pIdx] }, inputs: { VALUE: 1 } },
                  ],
                },
              },
            },
            { opcode: 'motion_gotoxy', inputs: { X: { reporter: { opcode: 'operator_subtract', inputs: { NUM1: Vp('px', pPx), NUM2: V('scrollX', scrollXId) } } }, Y: Vp('py', pPy) } },
          ],
        },
      },
    },
  ], { x: 20, y: 20 })
}

// ---------- comments (one workspace comment per script) ----------
function addComment(target: any, text: string, x: number, y: number) {
  const id = ir.uids.next()
  target.raw.comments[id] = { blockId: null, x, y, width: 220, height: 100, minimized: false, text }
}
const scriptComments: [string, string][] = [
  ['Stage', 'Green flag: start level 1'],
  ['Stage', 'Level 1 data: five platform rects (cx cy w h) in the platforms list'],
  ['Stage', 'Level 2 data: harder platform layout + farther goal'],
  ['Player', 'Main loop: arrow keys, gravity, jump on ground, camera scroll, goal check'],
  ['Player', 'Level 1 reset: place the player at the start'],
  ['Player', 'Level 2 reset: place the player at the start'],
  ['Player', 'parseRect: split one "cx cy w h" string into px py pw ph'],
  ['Player', 'collide dx dy: move, then push out of every overlapping platform rect'],
]
for (const [tname, text] of scriptComments) {
  const t = ir.target(tname)!
  const n = Object.keys(t.raw.comments ?? {}).length
  addComment(t, text, 1400, 30 + n * 260)
}
for (let k = 1; k <= 6; k++) {
  addComment(ir.target(`Platform${k}`)!, `Platform display ${k}: draw list item ${k} at (px - scrollX, py)`, 1400, 30)
}

function shadowifyMenus(menuOpcodes: string[]) {
  for (const t of ir.json.targets) {
    for (const [id, b] of Object.entries(t.blocks)) {
      if (typeof b !== 'object' || b === null || Array.isArray(b)) continue
      const blk = b as any
      if (!menuOpcodes.includes(blk.opcode)) continue
      blk.shadow = true
      const parent = (t.blocks as any)[blk.parent]
      if (parent?.inputs) {
        for (const [kk, v] of Object.entries(parent.inputs as any)) {
          if (Array.isArray(v) && (v as any[])[1] === id) (parent.inputs as any)[kk] = [1, id]
        }
      }
    }
  }
}
shadowifyMenus([])

const out = await ir.toSb3()
writeFileSync(new URL('./out.sb3', import.meta.url), out)
console.log('wrote out.sb3', out.length, 'bytes')
