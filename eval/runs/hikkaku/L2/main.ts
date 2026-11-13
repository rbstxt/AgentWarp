import { Project } from 'hikkaku'
import { IMAGES } from 'hikkaku/assets'
import {
  changeXBy,
  forever,
  getKeyPressed,
  gotoXY,
  ifOnEdgeBounce,
  ifThen,
  moveSteps,
  pointInDirection,
  random,
  whenFlagClicked,
} from 'hikkaku/blocks'
import { svgCostume } from '../shared/pack.ts'

const project = new Project()

const cat = project.createSprite('Sprite1')
cat.addCostume({ ...IMAGES.CAT_A, name: 'cat' })

const BALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#ff0000"/></svg>`

const ball = project.createSprite('Ball')
ball.addCostume(svgCostume('ball', BALL_SVG))

cat.run(() => {
  whenFlagClicked(() => {
    gotoXY(0, 0)
    forever(() => {
      ifThen(getKeyPressed('right arrow'), () => {
        changeXBy(5)
      })
      ifThen(getKeyPressed('left arrow'), () => {
        changeXBy(-5)
      })
    })
  })
})

ball.run(() => {
  whenFlagClicked(() => {
    gotoXY(0, 0)
    pointInDirection(random(20, 160))
    forever(() => {
      moveSteps(4)
      ifOnEdgeBounce()
    })
  })
})

export default project
