import project from './main.ts'
import { packProject } from '../shared/pack.ts'

await packProject(project, { outPath: `${import.meta.dir}/out.sb3` })
console.log('wrote L3/out.sb3')
