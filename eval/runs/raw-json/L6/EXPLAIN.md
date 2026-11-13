# L6 — scrolltutorial-378587848 ("scrolltutorial"): what it does

Fixture: `eval/fixtures/scrolltutorial-378587848.sb3` — a small, comment-dense,
human-made scrolling platformer. 4 targets, no stage scripts.

## Stage
Holds only data, no scripts. Variables: `LEVEL` ("1"), `SCROLL X` (sprite x),
`SCROLL Y`, `EXIT` ("0"), `my variable`. Broadcasts: `green flag`, `play game`,
`Reset`, `Setup`, `tick`. One white backdrop.

## player (the playable character)
Sprite variables: `x`, `y` (world position — the sprite itself is drawn at an
offset by the `position` block), `speed y` (vertical velocity), `in air`
(0 = standing, 1 = airborne).

- Flag script (`flag → broadcast green flag → broadcast play game`): kickstarts
  the whole game. Comment: "this tells it to start".
- `play game` receiver: sets `LEVEL` to 1, then loops forever: broadcast
  `Reset`, broadcast `Setup`, run `game on`, then an (unconditioned, i.e.
  infinite) repeat running once per frame: run `tick`, copy `x` into
  `SCROLL X`, run `position`, broadcast `tick`. Comment: "this makes everything run!"
- `game on`: zeroes x / y / speed y / in air and shows the sprite.
- `tick` (called every frame): left/right arrows shift the player ±10 via
  `change player x`; up arrow jumps **only while `in air < 4`** by setting
  `speed y` to 17; then gravity (`speed y` −= 2) and `change player y by speed y`.
- `change player y by (sy)`: applies vertical motion with tile collision:
  `y` += sy, assume airborne, reposition, then push out of any overlapping
  platform one pixel at a time; landing on top clears `in air` and `speed y`.
  Comment: "this is so it stays on top of the ground".
- `change player x by (sx)`: applies horizontal motion with wall detection:
  `x` += sx, reposition, nudge upward out of 16 px tall steps (stair climbing),
  then push back out of walls horizontally. Comments: "this is wall detection".
- `position`: draws the sprite at the scrolled screen position
  (`goto x − 36, y − 28` style offset). Comment: "this is the position".
- A floating `set speed y 0` block sits unattached at (588, 1955) — leftover
  editor cruft, never runs.

Movement feel: snappy 10 px steps, jump velocity 17 with gravity 2/frame.

## platforms (the level geometry)
Sprite variables `x`, `y` (scroll cursor). Two platform costumes.

- `Setup` receiver: builds the level — resets the cursor, shows costume 1,
  spawns a clone at x = 0, jumps to x = 360, spawns a second clone, switches
  costume. So two platform segments tile the scrolling level.
- `tick` receiver: runs the positioning custom block for every clone each frame
  (scroll + show/hide on/off screen). Comments: "this makes it scroll",
  "this makes the level show when its on the screen and hide when its off".
- A lone `switch costume` block at (−656, 1197) is unattached editor cruft.

## mouse pointer (cursor particle trail)
- Flag script: hides the original, then loops forever (spawning trail clones —
  the loop body repeatedly creates clones; exact cadence is inside the loop).
- `start as clone`: shows, glides to the mouse pointer in 10 steps, deletes
  itself. Net effect: a fading trail that follows the cursor.

## Start-up order
flag → `green flag` → `play game` → per frame: `Reset` → `Setup` (rebuild
platform clones) → `game on` (reset player) → `tick` ×∞ with `position` +
`tick` broadcast interleaved (platforms reposition).
