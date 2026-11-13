import { Project } from 'hikkaku'
import { IMAGES } from 'hikkaku/assets'
import {
  gotoXY,
  moveSteps,
  sayForSecs,
  whenFlagClicked,
} from 'hikkaku/blocks'

const project = new Project()

const sprite1 = project.createSprite('Sprite1')
const cat = sprite1.addCostume({ ...IMAGES.CAT_A, name: 'cat' })

sprite1.run(() => {
  whenFlagClicked(() => {
    gotoXY(0, 0)
    moveSteps(10)
    sayForSecs('Hello!', 2)
  })
})

export default project
