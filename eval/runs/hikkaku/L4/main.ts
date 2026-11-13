import { Project } from 'hikkaku'
import { IMAGES } from 'hikkaku/assets'
import {
  broadcast,
  changeVariableBy,
  changeXBy,
  changeYBy,
  controlStartAsClone,
  CREATE_CLONE_MYSELF,
  createClone,
  deleteThisClone,
  equals,
  forever,
  getAttributeOf,
  getKeyPressed,
  getVariable,
  getY,
  gotoXY,
  gt,
  hide,
  ifThen,
  lt,
  or,
  random,
  say,
  setVariableTo,
  show,
  stop,
  switchCostumeTo,
  touchingObject,
  wait,
  whenBroadcastReceived,
  whenFlagClicked,
  whenKeyPressed,
} from 'hikkaku/blocks'
import { add } from 'hikkaku/blocks'
import { svgCostume } from '../shared/pack.ts'

const project = new Project()
const stage = project.stage

// Shared game state lives on the stage; sprites reference these objects.
const score = stage.createVariable('score', 0, {
  monitor: { visible: true },
})
const lives = stage.createVariable('lives', 3, {
  monitor: { visible: true },
})

const BULLET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="24" viewBox="0 0 12 24"><rect x="2" y="0" width="8" height="24" rx="4" fill="#3388ff"/></svg>`
const ENEMY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><rect x="2" y="2" width="56" height="56" rx="10" fill="#33aa33"/><circle cx="20" cy="24" r="6" fill="#ffffff"/><circle cx="40" cy="24" r="6" fill="#ffffff"/><circle cx="20" cy="24" r="2.5" fill="#000000"/><circle cx="40" cy="24" r="2.5" fill="#000000"/></svg>`
const GAMEOVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80"><rect x="0" y="0" width="300" height="80" rx="12" fill="#111111"/><text x="150" y="52" font-size="36" text-anchor="middle" fill="#ffffff">Game Over</text></svg>`

const player = project.createSprite('Player')
player.addCostume({ ...IMAGES.CAT_A, name: 'cat' })

const bullet = project.createSprite('Bullet')
bullet.addCostume(svgCostume('bullet', BULLET_SVG))

const enemy = project.createSprite('Enemy')
enemy.addCostume(svgCostume('enemy', ENEMY_SVG))

const banner = project.createSprite('Banner')
banner.addCostume({ ...IMAGES.CAT_A, name: 'cat' })
const gameoverCostume = banner.addCostume(
  svgCostume('gameover', GAMEOVER_SVG),
)

stage.run(() => {
  whenFlagClicked(() => {
    setVariableTo(score, 0)
    setVariableTo(lives, 3)
  })
})

player.run(() => {
  whenFlagClicked(() => {
    gotoXY(0, -140)
    show()
    forever(() => {
      ifThen(getKeyPressed('left arrow'), () => {
        changeXBy(-6)
      })
      ifThen(getKeyPressed('right arrow'), () => {
        changeXBy(6)
      })
    })
  })
  // NOTE: the fire button lives on Player (which is never cloned). A
  // `when key pressed` hat on Bullet would also fire on every live clone and
  // fork-bomb exponentially — classic Scratch clone trap.
  whenKeyPressed('space', () => {
    createClone('Bullet')
  })
})

bullet.run(() => {
  whenFlagClicked(() => {
    // Park the hidden original off the play area: hidden sprites still
    // collide with `touching` checks, so (0,0) would eat real collisions.
    gotoXY(230, 200)
    hide()
  })
  controlStartAsClone(() => {
    gotoXY(getAttributeOf('x position', 'Player'), -120)
    show()
    forever(() => {
      changeYBy(10)
      ifThen(touchingObject('Enemy'), () => {
        deleteThisClone()
      })
      ifThen(gt(getY(), 180), () => {
        deleteThisClone()
      })
    })
  })
})

enemy.run(() => {
  whenFlagClicked(() => {
    gotoXY(-230, 200)
    hide()
    forever(() => {
      wait(1)
      createClone(CREATE_CLONE_MYSELF)
    })
  })
  controlStartAsClone(() => {
    gotoXY(add(getAttributeOf('x position', 'Player'), random(-15, 15)), 170)
    show()
    forever(() => {
      changeYBy(-4)
      ifThen(touchingObject('Bullet'), () => {
        changeVariableBy(score, 1)
        deleteThisClone()
      })
      ifThen(lt(getY(), -160), () => {
        changeVariableBy(lives, -1)
        ifThen(or(lt(getVariable(lives), 0), equals(getVariable(lives), 0)), () => {
          broadcast('gameover')
        })
        deleteThisClone()
      })
    })
  })
})

banner.run(() => {
  whenFlagClicked(() => {
    hide()
  })
  whenBroadcastReceived('gameover', () => {
    gotoXY(0, 0)
    switchCostumeTo(gameoverCostume)
    show()
    say('Game Over')
    stop('all')
  })
})

export default project
