import project from './main.ts'
import { packProject } from '../shared/pack.ts'

const out = `${import.meta.dir}/out.sb3`
await packProject(project, {
  outPath: out,
  comments: [
    {
      target: 'Player',
      text: 'Main loop: read keys, apply gravity, jump only when onGround, then move via the collide custom block (warp) and scroll the camera.',
      y: 20,
    },
    {
      target: 'Player',
      text: 'collide (dx) (dy): axis-separated AABB collision vs every rect in the level list. X pushes out sideways; falling lands (onGround=1), rising bonks. Warp = atomic per frame.',
      y: 110,
    },
    {
      target: 'Stage',
      text: 'Level data: flat list of platform rects [x y w h]*4 in world coords. b/n keys broadcast level switches; setup scripts rebuild the list.',
      y: 20,
    },
    {
      target: 'Painter',
      text: 'Draws each platform rect from the list with the pen every frame (screen x = world x - cameraX). Visual only; collision is analytic in collide.',
      y: 20,
    },
  ],
})
console.log('wrote L5/out.sb3')
// Height-aware restack (hikkaku native layout overlaps tall scripts).
await (await import('node:child_process')).execFileSync('bun', ['../shared/restack.ts', out], {
  cwd: import.meta.dir,
  stdio: 'inherit',
})
