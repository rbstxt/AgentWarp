# L6 — scrolltutorial-378587848 explained

Side-view platform tutorial: the player runs left/right and jumps across
scrolling platform segments. World position lives in variables (`x`, `y`);
the screen shows world-minus-scroll (`SCROLL X`, `SCROLL Y`).

## Stage — no scripts
Holds the shared globals `LEVEL`, `EXIT`, `SCROLL X`, `SCROLL Y`
(plus an unused `my variable`) and declares the broadcasts
`green flag`, `play game`, `Reset`, `Setup`, `tick`. Backdrop only.

## player — the hero
- `@a8` green flag: broadcasts `green flag`, then `play game` to start.
- `@a1` on `play game`: sets `LEVEL` 1, then forever: `Reset` (all clear),
  `Setup` (build level), `game on` (reset pos/shown), then an endless
  `repeat_until` (empty condition = forever) of `tick` (input + gravity),
  `SCROLL X = x`, `position`, and `tick` broadcast (platforms follow).
- `@a3` `tick` (warp): left/right arrows move x ±10 (right via a normal
  `if`, left via an equivalent block the printer kept as `raw`);
  up arrow sets upward speed 17 when nearly grounded (`in air < 4`,
  a coyote timer); gravity −2/frame; then `change player y`.
- `@a2` `change player y by sy`: steps y by sy and walks back pixel by
  pixel until out of the platforms (landing zeroes `speed y`, sets
  `in air` 0; rising out the top is a head-bonk). `position` after each step.
- `@a5` `change player x by sx`: steps x, then wall handling — tries to
  step up 16 px (stairs), else pushes back out pixel by pixel.
- `@a4` `game on`: resets x/y/speed/in-air, shows the sprite.
- `@a7` `position`: `goto(world − scroll)` — the camera transform.
- `@a6` hatless one-liner `speed y = 0` (kept verbatim from the original).

## platforms — level geometry (2 clones)
- `@a1` on `Setup`: resets x/y, shows segment `level 1 2`, spawns a clone,
  moves to x 360 and spawns a second clone (scrolling segments), ends on
  `level 1 3`.
- `@a3` on `tick`: repositions from world-minus-scroll (follows the player).
- `@a4` `position x y`: goto, then show iff the goto landed exactly
  (on-screen check), else hide.
- `@a2` hatless one-liner switching to `level 1 3` (kept verbatim).

## mouse pointer — click sparkle
- `@a1` green flag: hide, then forever spawn clones.
- `@a2` on clone start: show at the mouse, grow 10×, delete (a 10-frame
  pop effect; purely cosmetic, unrelated to gameplay).
