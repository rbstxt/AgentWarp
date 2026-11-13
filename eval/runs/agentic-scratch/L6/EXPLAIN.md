# Scroll tutorial — what it does

Fixture: `eval/fixtures/scrolltutorial-378587848.sb3` — a small human-made scrolling
platformer tutorial (comment-dense, hand-placed scripts). 4 targets, 0 extensions,
14 top-level scripts, 11 comments.

Coordinate model: the player lives in **world coordinates** (`x`, `y` sprite
variables). Each frame the custom block `position` maps world → screen with
`go to x: (x − SCROLL X), y: (y − SCROLL Y)`. Platforms store their own world
`x`/`y` and reposition the same way on every `tick` broadcast.

## Stage (no scripts)

Holds shared state and declarations only:

- Variables: `LEVEL`, `EXIT`, `SCROLL X`, `SCROLL Y` (camera), `my variable`
  (unused default variable, never read).
- Broadcasts: `green flag`, `play game`, `Reset`, `Setup`, `tick`.
- One backdrop (`backdrop1`), one `pop` sound (never played by any script).

## player (8 scripts, 4 variables, 5 custom blocks)

Variables: `x`, `y` (world position), `speed y` (vertical velocity), `in air`
(frames-since-touching-ground counter, doubling as a jump gate).

1. `when green flag clicked` (comment: "this tells it to start"): broadcasts
   `green flag` and waits, then broadcasts `play game` and waits. The bootstrap;
   nothing else runs until these finish.
2. `when I receive [play game]` (comment: "this makes everything run!"): sets
   `LEVEL` to 1, then forever: broadcast+wait `Reset`, broadcast+wait `Setup`,
   call `game on`, then `repeat until` (empty condition ⇒ infinite) calling
   `tick`, copying `x` into `SCROLL X`, calling `position`, and
   broadcasting+waiting `tick` so the platforms reposition once per frame.
3. `define game on` (comment: "this sets all the variables to 0"): level init —
   `x/y/speed y/in air` to 0, `show`.
4. `define tick` (**warp**): one physics step. Left/right arrows call
   `change player x by (±10)`; up arrow with `in air < 4` sets `speed y` to 17
   (the jump); then `speed y` decreases by 2 (gravity) and
   `change player y by (speed y)` applies vertical motion with collision.
   Jump height ≈ 17²/(2·2) ≈ 72 px.
5. `define change player y by (sy)` (comment: "this is so it stays on top of the
   ground"): `y += sy`, `in air += 1`, `position`; then while still touching
   `platforms`, nudge `y` back one pixel per iteration (up if falling, down if
   rising — sign picked from `sy`), and on landing (`else` branch) reset
   `in air` to 0; finally `position` and zero `speed y`.
6. `define position` (comment: "this is the position"): the camera transform
   `go to x: (x − SCROLL X), y: (y − SCROLL Y)`.
7. `define change player x by (sx)` (comment: "this is wall detection"): `x += sx`,
   `position`; if touching `platforms`, step up to 16 px looking for headroom
   (stop early once free), else undo the move (`y −= 16`) and push back out
   horizontally one pixel at a time (direction picked from the sign of `sx`).
8. A lone `set [speed y] to 0` with no hat at (588, 1955): detached editor cruft,
   never executes.

## platforms (4 scripts, 2 variables, 1 custom block)

Variables: `x`, `y` (world position of the *template*; each clone inherits a copy).

1. `when I receive [tick]` (comment: "this makes it scroll"): calls
   `position (x − SCROLL X) (y − SCROLL Y)` — follows the camera.
2. `when I receive [Setup]`: `x/y` to 0, costume `level 1 2`, clone self, `x` to
   360, clone self again, `x` to 360 (left-over, harmless), costume `level 1 3`.
   Spawns the two level-geometry clones.
3. `define position (x) (y)` (comment: "this makes the level show when its on the
   screen and hide when its off"): `go to` the args, then show iff the args equal
   the sprite's current position, else hide. Note: as written the preceding `go to`
   makes the equality always true, so the `hide` branch is effectively dead and
   clones always show.
4. A lone `switch costume to [level 1 3]` with no hat: detached cruft, never runs.

## mouse pointer (2 scripts, particle trail)

1. `when green flag clicked`: `hide` the template, then forever `create clone of
   myself` (unbounded spawner — a new clone every frame).
2. `when I start as a clone`: `show`, `go to [mouse-pointer]`, grow 5 % ten
   times, `delete this clone`. A fading sparkle trail behind the cursor.

## Comments (verbatim)

player: "this code needs the play game code and the change player x by sx code to
work", "this makes everything run!", "this sets all the variables to 0",
"this tells it to start", "this is the position", "this is wall detection",
"this is so it stays on top of the ground", "this makes it move and gives it
gravity!". platforms: "this makes it scroll", "this makes the level show when its
on the screen and hide when its off", "this is the position of the platforms".
