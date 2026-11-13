# L6 — scrolltutorial-378587848: what each sprite does

Side-scrolling platformer ("scroll tutorial"). The world is større than the
stage: the player has world coords (`x`, `y`), the screen shows
`x - SCROLL X`, and the platforms reposition every tick. One full
green-flag run executes: flag → `green flag` → `play game` → per-frame
`Reset` / `Setup` / `tick` broadcasts.

## player (the hero cat)

Owns `x`, `y` (world pos), `speed y` (vertical velocity), `in air`
(frames since last ground contact).

- `@a8` flag: `broadcastAndWait "green flag"` then `"play game"` (kick-off).
- `@a1` on `play game`: `LEVEL = 1`, then forever: `Reset`, `Setup`,
  `game on` (reset pos/vel), then an endless `repeatUntil(false)` frame
  loop: `tick` (input+physics), `SCROLL X = x` (camera follows),
  `position`, broadcast `tick` (platforms follow).
- `@a3` `tick` (warp): left/right move x ±10; up jumps (`speed y = 17`)
  iff `in air < 4`; gravity `speed y -= 2`; `change player y by speed y`.
- `@a2` `change player y by sy`: apply, `in air += 1`, then push back out
  of the platforms pixel by pixel (up if sy > 0 else down, landing sets
  `in air = 0`), zeroing `speed y` on contact.
- `@a5` `change player x by sx`: apply, `position`, wall detection: if
  inside a platform, try stepping up ≤ 16 px (stairs), else push back
  horizontally out of the wall.
- `@a4` `game on`: zero x/y/speed/in-air, `show`.
- `@a6` stray hat-less script: `speed y = 0` (leftover init).
- `@a7` `position`: `goTo(x - SCROLL X, y - SCROLL Y)`.

## platforms (the level geometry)

Own local `x`, `y` (world pos of the original; clones inherit at spawn).

- `@a1` on `Setup`: two clones (level pieces `level 1 2` at x = 0 and
  `level 1 3` at x = 360).
- `@a2` stray hat-less script: `switchCostumeTo "level 1 3"` (leftover).
- `@a3` on `tick`: `position(x - SCROLL X, y - SCROLL Y)` per clone.
- `@a4` `position x y`: go there; `show` iff the goTo actually landed
  (on-screen check), else `hide` (off-screen culling).

## Stage

No scripts. Owns `LEVEL`, `EXIT`, `SCROLL X/Y` (camera), `my variable`.

## mouse pointer (particle burst on click)

- `@a1` flag: `hide`, then forever `createCloneOf myself` (spawns a
  stream of clones every frame).
- `@a2` clone: `show`, jump to the mouse, grow (`changeSizeBy 5` × 10),
  `deleteThisClone` (one-shot sparkle particles).
