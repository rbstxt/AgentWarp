# L6 — scrolltutorial-378587848 ("tutorial/game scrolling platform tutorial")

Small, comment-dense human project (unicorn9letsrock, after griffpatch's
scrolling-platform tutorial): 4 targets, ~140 blocks, 11 comments.
World model: the player has *world* coords (`x`, `y`); the screen shows
`x − SCROLL X`, `y − SCROLL Y`. `SCROLL X/Y`, `LEVEL`, `EXIT` live on Stage.

## Sprites and scripts

### Stage (no scripts)
Holds `LEVEL` ("1"), `EXIT` ("0"), `SCROLL X` ("0"), `SCROLL Y` (0),
`my variable` (0). Declares broadcasts: `green flag`, `play game`,
`Reset`, `Setup`, `tick`.

### player (world coords `x`, `y`; velocity `speed y`; air timer `in air`)
- `when flag clicked` → `broadcast green flag (wait)`, `broadcast play game (wait)`.
  Entry point; all other player logic runs under `play game`.
- `when play game received`: `LEVEL = 1`; `forever { broadcast Reset (wait);
  broadcast Setup (wait); call game-on (reset custom block); repeat_until {
  call tick; SCROLL X = x; call position; broadcast tick (wait) } }`.
  Main game loop: re-init per cycle, then the per-frame body (physics in
  `tick`, camera follow, drive platforms via `tick`).
- custom `game on`?? — reset block (vars `x/y/speed y/in air = 0`, show).
  Called once per loop cycle.
- custom `tick` (= movement, called every repeat iteration): left/right arrows
  → `change player x by ±10`; up arrow + `in air < 4` → `speed y = 17`
  (the jump); `speed y −= 2` (gravity); `change player y by speed y`.
- custom `change player x by (sx)`: `x += sx`, reposition, wall slide-up/step-up
  logic on touching platforms.
- custom `change player y by (sy)`: `y += sy`, `in air += 1`, reposition, then
  `repeat until not touching platforms`: push out 1px (up if `sy > 0`, down
  otherwise, landing sets `in air = 0`); `speed y = 0`.
- custom `position`: `go to (x − SCROLL X, y − SCROLL Y)` (world → screen).
- stray `set speed y = 0` script at (588,1955) — leftover, never runs (no hat).

### platforms (world `x`, `y`; 3 level pieces + clones)
- `on Setup`: `x=0,y=0`, costume `level 1 2`, clone; `x=360`, clone; `x=360`
  again?? then costume `level 1 3` — spawns 2 clones + original = 3 pieces.
- `on tick`: `go to (x − SCROLL X, y − SCROLL Y)`; show iff the piece's world
  pos matches the clone's screen pos exactly, else hide (per-piece scroll).
- `position (x)(y)` custom block: goto + the same show/hide test.
- stray `switch costume to level 1 3` script (no hat).

### mouse pointer (cosmetic cursor trail)
- `on flag`: hide, `forever { create clone }` (spawns every frame; clones die
  after growing — bounded, ~10 live).
- `on clone`: show, go to mouse, grow 10× (`repeat 10: size += 5`), delete.

## My edits (all in `L6/operate.ts`, applied as JSON surgery)
1. **Pause**: new Stage var `paused`; new player script `when P pressed` toggles
   it; two gate scripts prepended (game-loop head + inside the per-frame
   repeat) do `if paused=1 { say PAUSED; wait until paused=0; say '' }`.
   While paused the player/world does not advance and PAUSED is shown.
2. **Jump 1.5×**: `set speed y to 17` → `25.5` in the `tick` block.
3. **Double jump**: new player var `jumps`; jump condition `in air < 4` →
   `jumps < 2`; `jumps += 1` on every jump; `jumps = 0` on landing and on reset.
4. Six Scratch comments attached to the new/changed blocks. All 11 original
   comments kept with identical ids/positions/text; no existing script moved
   (`diff`: 0 moved, 0 deleted; player: 4 scripts changed, 1 added).

## Verification (see `verify.sh` outputs)
- `check`: ok, no errors/warnings. `layout`: 100/100, 0 overlaps.
- Pause: hold-right 300f → world `x` = 1269 unpaused vs 569 with P at 60/200;
  bubble `PAUSED` while paused; motion resumes after unpause.
- Jump (up-presses at 40+55): baseline peak +64 over ground, second press a
  no-op; edited peaks +272 with a second rise after frame 55 (double jump).
