# L6 — scrolltutorial-378587848: what each sprite and script does

Fixture: "tutorial/game scrolling platform tutorial" by unicorn9letsrock
(3 sprites + Stage, 14 scripts, 11 workspace comments).

## Stage — no scripts

- Backdrop `backdrop1`, one `pop` sound (unused).
- Variables (all global): `SCROLL X` / `SCROLL Y` (camera offset shared with
  the sprites), `LEVEL` (set to 1 on green flag, never read — tutorial
  leftover), `EXIT`, `my variable` (declared, never referenced — dead).
- `SCROLL Y` is never written either: this tutorial scrolls horizontally only.

## player — the platforming hero (8 scripts)

World position is kept in the sprite-local `x` / `y` variables (NOT the
sprite's own x/y); the visible sprite is drawn at `x - SCROLL X`. `speed y`
is vertical velocity, `in air` counts ticks since leaving the ground.

1. `onflag` — "this tells it to start". Broadcasts `green flag`, then
   `play game`, sequenced with "and wait".
2. `on "play game"` — "this makes everything run!". Sets `LEVEL = 1`, then an
   outer `forever` (one iteration per life/round): broadcasts `Reset`, then
   `Setup`, runs `game_on`, then the inner game loop `until false`: `tick`
   (input+physics), `SCROLL X = x` (camera follows the player), `position`
   (draw), broadcast `tick` (platforms redraw on the same beat).
3. `proc game_on` (nowarp) — "this sets all the variables to 0". Resets
   `x/y/speed y/in air`, shows the sprite.
4. `proc tick` — "this makes it move and gives it gravity!". Left/right move
   10 px via `change_player_x_by`; `up arrow` jumps (`speed y = 17`) while
   `in air < 4` (4-tick coyote time); gravity `speed y -= 2`; then
   `change_player_y_by speed y`.
5. `proc change_player_y_by` (nowarp) — "this is so it stays on top of the
   ground". Steps `y`, then pixel-walks back out of `platforms` overlap;
   landing (moving down) zeroes `in air` and `speed y`.
6. `proc position` (nowarp) — "this is the position". Draws the sprite at
   `x - SCROLL X, y - SCROLL Y`.
7. `proc change_player_x_by` (nowarp) — "this is wall detection". Steps `x`,
   tries to step up (stairs, max 16 px), otherwise pixel-walks back out.
8. A stray top-level `set [speed y] to 0` block (editor cruft, runs once at
   load, no effect) — dropped by the goboscript importer.

## platforms — the level geometry (4 scripts + 1 stray)

Sprite-local `x`/`y` = world position of the platform group. Two costumes
(`level 1 2`, `level 1 3`); `Setup` spawns one clone per costume.

1. `on "Setup"` — "this makes it scroll" (comment text is misleading; the
   script spawns the level): resets `x/y`, shows costume 1, clones it, moves
   to `x = 360`, clones again, switches to costume 2.
2. `on "tick"` — "this is the position of the platforms". Repositions every
   clone at `x - SCROLL X, y - SCROLL Y`.
3. `proc position` (nowarp) — "this makes the level show when its on the
   screen and hide when its off". `goto`, then show iff the goto landed
   exactly (on-screen check), else hide.
4. A stray top-level `switch costume` block (editor cruft) — dropped by the
   importer. (`Reset` is broadcast but has no receiver — a no-op.)

## mouse pointer — cosmetic particle trail (2 scripts)

1. `onflag`: hides the original, then `forever { clone; }` (full-speed clone
   spawner — original project behavior, each clone is short-lived).
2. `onclone`: shows at the mouse pointer, grows (`repeat 10 { change size }`),
   deletes itself.
