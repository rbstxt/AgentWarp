# Task ladder

Each task produces `out.sb3` and must pass `node tools/vmrun/cli.mjs check out.sb3` plus the behaviour
probe listed. Tasks are written as a user would phrase them to an agent.

## L1 — hello
Green flag: the cat sprite goes to (0,0), moves 10 steps, says "Hello!" for 2 seconds.
Probe: after 1s of virtual time, Sprite1 x == 10 and bubble text "Hello!".

## L2 — keyboard + bounce
Arrow keys move the cat 5 px per frame. A second sprite "Ball" (draw your own SVG costume, a red circle)
moves diagonally and bounces off edges forever.
Probe: holding right arrow for 30 frames moves the cat right ≥ 100 px; Ball stays inside stage for 600 frames.

## L3 — variables, costumes, sounds
Clicker game: a "Cookie" sprite (own SVG), clicking it increases variable `score` by 1, plays a pop sound
(any built-in or generated wav), and switches to a "pressed" costume for 0.1s. Score shown in a monitor.
At score 10 the stage switches to a "win" backdrop and broadcasts `win`.
Probe: 10 simulated clicks → score == 10, backdrop "win".

## L4 — clones game
Shooter: player at bottom moves with left/right, space fires bullets (clones). Enemies (clones) fall from
random x every 1s. Bullet hitting enemy: both deleted, score +1. Enemy reaching bottom: lives −1.
lives 0 → "Game Over" shown, all scripts stop.
Probe: run 1800 frames with scripted inputs; score increases; clone count stays bounded (< 100).

## L5 — custom blocks, lists, multi-sprite architecture
Simple platformer: gravity, jump (only when on ground), level data stored in a list of platform rects,
custom block `collide (dx) (dy)` with "run without screen refresh", camera scroll, 2 levels switched by
broadcast, comments explaining each script.
Probe: player lands on a platform (y stable) within 120 frames; jump raises y.

## L6 — edit an existing human-made project
Take an existing medium-size human project (`eval/fixtures/*.sb3`, with comments and hand-placed scripts).
Tasks: (a) explain what each sprite does; (b) fix an injected bug; (c) add a feature (e.g. high score saved in a
variable, pause key). Constraints: untouched scripts keep their exact positions/IDs, comments preserved,
new scripts laid out cleanly without overlapping.
Probe: diff of project.json limited to edited scripts; vmrun layout check passes.
