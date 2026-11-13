# L6 — scrolltutorial-378587848: what each sprite does

Side-scrolling platformer tutorial. The world lives in data variables on
`player` (`x`, `y` = world coords); screen pos = world − SCROLL. The main
driver is `player @a1`: on `play game` it broadcasts `Reset`+`Setup`, runs
`game on` (zero vars, show), then loops forever: `tick` (input/physics),
publish `SCROLL X`, `position` (place sprite on screen), `broadcast tick`
so the platforms reposition.

## player (8 scripts)

- `@a1` `when I receive [play game v]` — main loop (above). MODIFIED: whole
  tick body gated on `paused = 0` (pause feature).
- `@a2` `define change player y by (sy)` — vertical mover with ground
  clamp: applies sy, bumps `in air`, re-places, then steps back 1px at a
  time until out of the platforms (landing resets `in air`, zeroes
  `speed y`). MODIFIED: also resets `jumps` on landing.
- `@a3` `define tick` — per-frame input+physics: left/right move 10px,
  up-jump (MODIFIED: power 17→23 ≈ 1.5× height; plus one air jump via
  `jumps`), gravity −2, integrate y. `:: warp` (atomic).
- `@a4` `define game on` — reset x/y/speed/in-air, show.
- `@a5` `define change player x by (sx)` — horizontal mover with wall
  logic: try step-up 16px (stairs), else push back out pixel by pixel.
- `@a6` stray stack `set [speed y] to 0` (runs on green flag by itself;
  harmless init).
- `@a7` `define position` — screen placement from world−scroll.
- `@a8` `when clicked` — entry: `green flag`, then `play game`.
- NEW `when [p v] key pressed` — pause toggle: sets `paused`, `say
  [PAUSED]` while paused, clears the bubble on resume.

## platforms (4 scripts)

- `@a1` `when I receive [Setup v]` — builds the level: two clones with
  costumes `level 1 2` / `level 1 3` offset at x 0/360 (scrolling segments).
- `@a2` bare `switch costume` stack (runs once on green flag; default look).
- `@a3` `when I receive [tick v]` — reposition from world−scroll each tick.
- `@a4` `define position (x) (y)` — go to screen pos; show only when the
  clone actually moved there (off-screen segments hide).

## Stage — no scripts. Holds `LEVEL`, `SCROLL X/Y`, `EXIT`, broadcasts
(`green flag`, `play game`, `Reset`, `Setup`, `tick`).

## mouse pointer (2 scripts)

- `@a1` spawner: hide original, `forever create clone`.
- `@a2` clone: show, jump to the real mouse, grow 10×5, delete (sparkle
  trail effect).
