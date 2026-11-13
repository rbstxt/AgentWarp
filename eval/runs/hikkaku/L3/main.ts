import { Project } from 'hikkaku'
import {
  broadcast,
  changeVariableBy,
  equals,
  getVariable,
  gt,
  ifThen,
  playSound,
  setVariableTo,
  switchBackdropTo,
  switchCostumeTo,
  wait,
  whenBroadcastReceived,
  whenFlagClicked,
  whenThisSpriteClicked,
} from 'hikkaku/blocks'
import { or } from 'hikkaku/blocks'
import { popSound, svgCostume } from '../shared/pack.ts'

const project = new Project()

const STAGE_START = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#e8f4ff"/><text x="240" y="180" font-size="28" text-anchor="middle" fill="#336699">Click the cookie!</text></svg>`
const STAGE_WIN = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#ffd700"/><text x="240" y="180" font-size="36" text-anchor="middle" fill="#663300">YOU WIN!</text></svg>`

const stage = project.stage
stage.addCostume(svgCostume('start', STAGE_START))
stage.addCostume(svgCostume('win', STAGE_WIN))

const COOKIE = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="#c98a4b"/><circle cx="28" cy="30" r="5" fill="#5b3a1e"/><circle cx="50" cy="26" r="4" fill="#5b3a1e"/><circle cx="55" cy="50" r="5" fill="#5b3a1e"/><circle cx="35" cy="55" r="4" fill="#5b3a1e"/><circle cx="45" cy="42" r="3" fill="#5b3a1e"/></svg>`
const COOKIE_PRESSED = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" fill="#a06a35"/><circle cx="28" cy="30" r="5" fill="#4a2f18"/><circle cx="50" cy="26" r="4" fill="#4a2f18"/><circle cx="55" cy="50" r="5" fill="#4a2f18"/><circle cx="35" cy="55" r="4" fill="#4a2f18"/></svg>`

const cookie = project.createSprite('Cookie')
const normal = cookie.addCostume(svgCostume('cookie', COOKIE))
const pressed = cookie.addCostume(svgCostume('pressed', COOKIE_PRESSED))
const pop = cookie.addSound(popSound('pop'))

const score = cookie.createVariable('score', 0, {
  monitor: { visible: true },
})

stage.run(() => {
  whenFlagClicked(() => {
    switchBackdropTo('start')
  })
  whenBroadcastReceived('win', () => {
    switchBackdropTo('win')
  })
})

cookie.run(() => {
  whenFlagClicked(() => {
    setVariableTo(score, 0)
    switchCostumeTo(normal)
  })
  whenThisSpriteClicked(() => {
    changeVariableBy(score, 1)
    playSound(pop)
    switchCostumeTo(pressed)
    wait(0.1)
    switchCostumeTo(normal)
    ifThen(
      or(gt(getVariable(score), 10), equals(getVariable(score), 10)),
      () => {
        broadcast('win')
      },
    )
  })
})

export default project
