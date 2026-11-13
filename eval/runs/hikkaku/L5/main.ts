import { Project } from 'hikkaku'
import { IMAGES } from 'hikkaku/assets'
import {
  add,
  addToList,
  and,
  broadcast,
  callProcedure,
  changeVariableBy,
  defineProcedure,
  deleteAllOfList,
  divide,
  equals,
  eraseAll,
  forever,
  getItemOfList,
  getKeyPressed,
  getVariable,
  gotoXY,
  gt,
  ifThen,
  lengthOfList,
  lt,
  mathop,
  multiply,
  or,
  penDown,
  penUp,
  procedureLabel,
  procedureStringOrNumber,
  repeat,
  setPenColorTo,
  setPenSizeTo,
  setVariableTo,
  subtract,
  whenBroadcastReceived,
  whenFlagClicked,
  whenKeyPressed,
} from 'hikkaku/blocks'
import type { VariableDefinition } from 'hikkaku'

const project = new Project()
const stage = project.stage

// Level data: flat list of platform rects [x, y, w, h] * N in world coords.
const level = stage.createList('level', [])
// Shared with Painter: must live on the stage (global). Sprite-local
// variables are invisible to other sprites — hikkaku does not check this.
const cameraX = stage.createVariable('cameraX', 0)

// ---- tuning constants (compile-time numbers) ----
const GRAV = -0.6
const JUMP = 12
const SPEED = 4
const MAXFALL = -12
const PW2 = 15 // player half-width
const PH2 = 20 // player half-height
const NRECT = 4

const player = project.createSprite('Player')
player.addCostume({ ...IMAGES.CAT_A, name: 'cat' })

const worldX = player.createVariable('worldX', 0)
const worldY = player.createVariable('worldY', 60)
const vx = player.createVariable('vx', 0)
const vy = player.createVariable('vy', 0)
const onGround = player.createVariable('onGround', 0)
// scratch vars for the collide procedure
const ri = player.createVariable('ri', 1)
const rx = player.createVariable('rx', 0)
const ry = player.createVariable('ry', 0)
const rw = player.createVariable('rw', 0)
const rh = player.createVariable('rh', 0)

const rectItem = (v: VariableDefinition, offset: number) =>
  getItemOfList(
    level,
    add(multiply(subtract(getVariable(ri), 1), 4), offset) as never,
  )

const loadRect = () => {
  setVariableTo(rx, rectItem(rx, 1) as never)
  setVariableTo(ry, rectItem(ry, 2) as never)
  setVariableTo(rw, rectItem(rw, 3) as never)
  setVariableTo(rh, rectItem(rh, 4) as never)
}

const overlapX = () =>
  lt(
    mathop('abs', subtract(getVariable(worldX), add(getVariable(rx), divide(getVariable(rw), 2)))),
    add(PW2, divide(getVariable(rw), 2)),
  )
const overlapY = () =>
  lt(
    mathop('abs', subtract(getVariable(worldY), add(getVariable(ry), divide(getVariable(rh), 2)))),
    add(PH2, divide(getVariable(rh), 2)),
  )
const overlap = () => and(overlapX(), overlapY())

player.run(() => {
  whenFlagClicked(() => {
    // Custom block: move by (dx, dy) with axis-separated AABB collision
    // against every rect in the `level` list. Runs in warp mode.
    const collide = defineProcedure(
      [procedureLabel('collide'), procedureStringOrNumber('dx'), procedureStringOrNumber('dy')],
      ({ dx, dy }) => {
        // --- X axis ---
        setVariableTo(worldX, add(getVariable(worldX), dx.getter()))
        setVariableTo(ri, 1)
        repeat(divide(lengthOfList(level), 4), () => {
          loadRect()
          ifThen(overlap(), () => {
            ifThen(gt(dx.getter(), 0), () => {
              setVariableTo(worldX, subtract(getVariable(rx), PW2))
            })
            ifThen(lt(dx.getter(), 0), () => {
              setVariableTo(worldX, add(add(getVariable(rx), getVariable(rw)), PW2))
            })
          })
          setVariableTo(ri, add(getVariable(ri), 1))
        })
        // --- Y axis ---
        setVariableTo(worldY, add(getVariable(worldY), dy.getter()))
        setVariableTo(onGround, 0)
        setVariableTo(ri, 1)
        repeat(divide(lengthOfList(level), 4), () => {
          loadRect()
          ifThen(overlap(), () => {
            ifThen(gt(dy.getter(), 0), () => {
              setVariableTo(worldY, subtract(getVariable(ry), PH2))
              setVariableTo(vy, 0)
            })
            ifThen(or(lt(dy.getter(), 0), equals(dy.getter(), 0)), () => {
              setVariableTo(worldY, add(add(getVariable(ry), getVariable(rh)), PH2))
              setVariableTo(vy, 0)
              setVariableTo(onGround, 1)
            })
          })
          setVariableTo(ri, add(getVariable(ri), 1))
        })
      },
      true,
    )

    setVariableTo(worldX, 20)
    setVariableTo(worldY, 60)
    setVariableTo(vy, 0)
    setVariableTo(cameraX, 0)
    forever(() => {
      setVariableTo(vx, 0)
      ifThen(getKeyPressed('left arrow'), () => {
        changeVariableBy(vx, -SPEED)
      })
      ifThen(getKeyPressed('right arrow'), () => {
        changeVariableBy(vx, SPEED)
      })
      changeVariableBy(vy, GRAV)
      ifThen(lt(getVariable(vy), MAXFALL), () => {
        setVariableTo(vy, MAXFALL)
      })
      ifThen(and(equals(getVariable(onGround), 1), getKeyPressed('space')), () => {
        setVariableTo(vy, JUMP)
      })
      // keep the player inside the world
      ifThen(lt(getVariable(worldX), -225), () => {
        setVariableTo(worldX, -225)
      })
      ifThen(gt(getVariable(worldX), 225), () => {
        setVariableTo(worldX, 225)
      })
      callProcedure(
        collide,
        {
          [collide.reference.arguments.dx.id]: getVariable(vx),
          [collide.reference.arguments.dy.id]: getVariable(vy),
        },
        true,
      )
      // camera scroll: world -> screen
      setVariableTo(cameraX, getVariable(worldX))
      gotoXY(subtract(getVariable(worldX), getVariable(cameraX)), getVariable(worldY))
    })
  })

  whenBroadcastReceived('level1', () => {
    setVariableTo(worldX, 20)
    setVariableTo(worldY, 60)
    setVariableTo(vy, 0)
    setVariableTo(cameraX, 0)
  })
  whenBroadcastReceived('level2', () => {
    setVariableTo(worldX, -80)
    setVariableTo(worldY, 60)
    setVariableTo(vy, 0)
    setVariableTo(cameraX, -80)
  })
})

const addRect = (x: number, y: number, w: number, h: number) => {
  addToList(level, x)
  addToList(level, y)
  addToList(level, w)
  addToList(level, h)
}

stage.run(() => {
  whenFlagClicked(() => {
    broadcast('level1')
  })
  whenKeyPressed('b', () => {
    broadcast('level1')
  })
  whenKeyPressed('n', () => {
    broadcast('level2')
  })
  whenBroadcastReceived('level1', () => {
    deleteAllOfList(level)
    addRect(-240, -170, 480, 40) // ground (top -130)
    addRect(-120, -60, 110, 20) // A (top -40)
    addRect(40, 10, 110, 20) // B (top 30)
    addRect(-60, 80, 90, 20) // C (top 100)
  })
  whenBroadcastReceived('level2', () => {
    deleteAllOfList(level)
    addRect(-240, -170, 480, 40) // ground
    addRect(-200, -80, 90, 20) // D (top -60)
    addRect(-60, -20, 90, 20) // E (top 0)
    addRect(80, 50, 100, 20) // F (top 70)
  })
})

// Painter: draws every platform rect from the list with the pen each frame.
const painter = project.createSprite('Painter')
painter.addCostume({ ...IMAGES.BLANK_SVG, name: 'blank' })
const pi = painter.createVariable('pi', 1)
const px = painter.createVariable('px', 0)
const py = painter.createVariable('py', 0)
const pw = painter.createVariable('pw', 0)
const ph = painter.createVariable('ph', 0)

painter.run(() => {
  whenFlagClicked(() => {
    forever(() => {
      eraseAll()
      setPenSizeTo(2)
      setPenColorTo('#00aa00')
      setVariableTo(pi, 1)
      repeat(NRECT, () => {
        setVariableTo(px, getItemOfList(level, add(multiply(subtract(getVariable(pi), 1), 4), 1)) as never)
        setVariableTo(py, getItemOfList(level, add(multiply(subtract(getVariable(pi), 1), 4), 2)) as never)
        setVariableTo(pw, getItemOfList(level, add(multiply(subtract(getVariable(pi), 1), 4), 3)) as never)
        setVariableTo(ph, getItemOfList(level, add(multiply(subtract(getVariable(pi), 1), 4), 4)) as never)
        penUp()
        gotoXY(subtract(getVariable(px), getVariable(cameraX)), getVariable(py))
        penDown()
        gotoXY(subtract(add(getVariable(px), getVariable(pw)), getVariable(cameraX)), getVariable(py))
        gotoXY(subtract(add(getVariable(px), getVariable(pw)), getVariable(cameraX)), add(getVariable(py), getVariable(ph)))
        gotoXY(subtract(getVariable(px), getVariable(cameraX)), add(getVariable(py), getVariable(ph)))
        gotoXY(subtract(getVariable(px), getVariable(cameraX)), getVariable(py))
        penUp()
        setVariableTo(pi, add(getVariable(pi), 1))
      })
    })
  })
})

export default project
