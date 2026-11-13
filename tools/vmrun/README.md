# vmrun — headless Scratch verification harness

Node ESM harness around TurboWarp's `scratch-vm` (`github:TurboWarp/scratch-vm#develop`).
All commands print JSON to stdout and exit non-zero on failure.

```sh
npm install          # inside tools/vmrun
node cli.mjs check <file.sb3>
node cli.mjs run <file.sb3> --seconds N | --frames N [options]
node cli.mjs layout <file.sb3> [--cleanup <out.sb3>]
node cli.mjs costumes <file.sb3>
npm test             # builds fixtures + runs all assertions
```

## `check <file.sb3>`

Structural validation of `project.json` plus zip asset integrity. Output
`{file, ok, errors, warnings}`; exit 0 iff no errors (warnings don't fail).

Checked:

- every block's `parent` / `next` / input block references resolve within the
  same target; substack inputs (`SUBSTACK`, `SUBSTACK2`) included;
- top-level blocks carry numeric `x`/`y`;
- every non-top-level block is reachable from a top-level script (no orphans);
- opcodes: known core + pen/music/videoSensing/text2speech/translate/
  makeymakey/microbit/ev3/boost/wedo2/gdxfor opcodes pass, as do all menu /
  shadow opcodes (anything containing `menu`, plus `looks_costume`,
  `looks_backdrops`, `note`, `music_menu_DRUM`, `music_menu_INSTRUMENT` and the
  `math_number` / `colour_picker` / `text` / `matrix` literal shadows);
  anything else warns (does not fail);
- input names: each block's input names are checked against the valid inputs
  for its opcode (derived from scratch-vm's block implementations, e.g.
  `operator_subtract` takes `NUM1`/`NUM2`, not `OPERAND1`); `SUBSTACK` /
  `SUBSTACK2` substack slots are always allowed; unknown opcodes and dynamic
  blocks (`procedures_call`, …) are skipped. Bad names warn;
- variable / list / broadcast `fields` reference declared ids (stage-level or
  sprite-level; `null` ids such as custom-block args are skipped), with two
  silent-failure warnings instead of errors: a broadcast menu pointing at an
  undeclared broadcast id (the VM silently does nothing), and a variable/list
  id declared on a *different* sprite than the one using it;
- comments with a `blockId` point at an existing block;
- every costume/sound `md5ext` exists in the zip **and** the file content hashes
  to the md5 in its name;
- monitors reference known opcodes; unknown `extensions` entries warn.

Errors look like `{target, blockId, opcode, message}`.

Policy note: two kinds of real-world editor cruft are *warnings*, not errors,
because the Scratch editor and VM both tolerate them and `check` must pass on
human-made projects: detached `shadow` blocks unreachable from any script
(stale menu/shadow inputs left behind by editing), and comments whose
`blockId` points at a deleted block (shown floating, treated as workspace
comments). Unreachable *non-shadow* blocks are still errors.

## `run <file.sb3> --seconds N | --frames N [--input script.json] [--probe expr...] [--trace A,B] [--seed N] [--until "<probe> <op> <value>" --max-frames N]`

Loads the sb3 into scratch-vm headlessly and steps it deterministically.
Output: per-target state plus `clones`, `broadcasts`, `hats`, `sayEvents`,
`monitors`, `vmWarnings`, and optional `probes` / `trace` / `until`.
Exit non-zero on load/step failure.

State per target: `{name, isStage, isClone, x, y, direction, size, visible,
costumeIndex, costumeName, variables, lists, bubble}` where `bubble` is
`{type, text} | null`. `variables` holds only scalar variables and `lists`
only lists (scratch-vm stores both plus broadcasts in one map; broadcasts are
excluded from both). `clones` maps sprite name → live clone count.
`hats` lists every hat that started a thread (`{frame, hat, target, fields}`)
plus every broadcast delivery. `sayEvents` records bubble text transitions
with frame numbers. `monitors` dumps the VM monitor state.
`vmWarnings` collects scratch-vm log warnings seen during load + run as
`{message, count, blockId?, target?}` (deduped with counts) instead of
printing them to stderr.
Timelines are capped at 20,000 entries (prefix kept; overflow reported as
`hatsDropped` / `sayDropped`) so clone/broadcast-spam projects can't produce
unbounded output.

### Time model

Fixed **30 fps virtual time**. No wall-clock stepping: the harness never starts
the runtime frame loop. Before each frame it advances a virtual clock by
1000/30 ms and overrides `runtime.updateCurrentMSecs`, so `wait`, `say for
secs`, `glide`, and the project timer all follow virtual time (verified:
a `say … for 2 secs` block shows for exactly 60 frames). `--seconds N` is
converted to `round(N*30)` frames. `--seed N` (default 1) seeds `Math.random`
(mulberry32) for the whole run: clone scatter, `pick random`, etc. are
reproducible. Repeated runs of the same project are byte-for-byte identical
(verified on all fixtures, including three real Scratch projects).

Two deliberate emulations keep headless timing faithful to on-screen TurboWarp:

- **Virtual `say/think … for secs`**: upstream implements these with
  wall-clock `setTimeout`; the harness reimplements them on the stack timer
  (same mechanism as `control_wait`).
- **Redraw gating**: the VM runs threads until the work budget expires *or* a
  redraw is requested; on screen, every visual mutation (move, turn, show,
  costume, bubble, pen draw, …) requests one, so game loops advance ~once per
  frame. Headless nothing would request redraws and spin-loops would execute
  thousands of machine-speed-dependent iterations per frame. The harness
  requests redraws from the same visual entry points, so motion/looks scripts
  step once per virtual frame exactly as on screen. Pure-compute loops still
  spin to the work budget — same as real Scratch — and remain the one
  machine-speed-dependent corner (documented, not virtualized).

### Input scripts

`--input script.json`: a JSON array (or `{inputs: [...]}`) of events:

```json
[
  {"frame": 0, "type": "keydown", "key": "ArrowRight"},
  {"frame": 30, "type": "keyup", "key": "ArrowRight"},
  {"frame": 5, "type": "click", "sprite": "Cookie"},
  {"frame": 10, "type": "mouse", "x": 100, "y": -50, "isDown": true},
  {"frame": 20, "type": "broadcast", "name": "start"},
  {"frame": 30, "type": "greenflag"},
  {"frame": 40, "type": "stop"},
  {"frame": 2, "type": "answer", "text": "Ada"}
]
```

- `keydown`/`keyup` take a key name (see table below) and feed
  the VM keyboard, firing `when key pressed` hats and `<key pressed?>`.
- `click` triggers `when this sprite clicked` on the named sprite (original
  preferred; `sprite: "Stage"` triggers `when stage clicked`). Optional `x`/`y`
  moves the mouse first.
- `mouse` sets mouse position (Scratch coords) and/or button state, driving
  `mouse x/y`, `<mouse down?>`, and `touching [mouse-pointer]`.
- `broadcast` injects a broadcast delivery (as if an `event_broadcast` block
  ran): every matching `when I receive` hat starts, recorded in `hats` /
  `broadcasts` like a real broadcast.
- `greenflag` clicks the green flag again (restarts the project).
- `stop` clicks the stop sign (halts all threads; the run keeps stepping the
  clock so later inputs still apply).
- `answer` types into the ask box and confirms, resolving a waiting
  `sensing_askandwait` (without it, `ask` blocks wait forever, as in a real
  VM with no answer).

Key names: both Scratch menu names and DOM key names are accepted
(case-insensitive for the Scratch spellings):

| Scratch (block menus) | DOM (browsers / old harness scripts) |
|---|---|
| `space` | ` ` (single space) |
| `left arrow` | `ArrowLeft` |
| `right arrow` | `ArrowRight` |
| `up arrow` | `ArrowUp` |
| `down arrow` | `ArrowDown` |
| `enter` | `Enter` |
| single letters (`a`, …) | same (`a`, …; matched case-insensitively) |
| `backspace`, `delete`, `shift`, `control`, `escape`, `insert`, `home`, `end`, `page up`, `page down`, `caps lock`, `scroll lock` | `Backspace`, `Delete`, `Shift`, `Control`, `Escape`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `CapsLock`, `ScrollLock` |

### Probes, trace and --until

`--probe A.B.C` resolves a dot-path against the output JSON and prints it under
`probes` (repeatable). Bare sprite/stage names resolve by name, numeric parts
index arrays:

- `Sprite1.x`, `Stage.score`, `Cookie.variables.score`
- `clones.Ball`, `broadcasts.0.name`, `monitors.<id>.value`

`--trace` output shape (one entry per frame, only while tracing):

```json
{"trace": [{"frame": 0, "targets": [
  {"name": "Sprite1", "isStage": false, "isClone": false,
   "x": 10, "y": 0, "direction": 90, "size": 100, "visible": true,
   "costumeIndex": 0, "costumeName": "Sprite1-a",
   "bubble": {"type": "say", "text": "Hello!"}}
]}]}
```

Each entry's `targets` holds the traced sprites present that frame (originals
and live clones); `bubble` is `{type, text} | null`.

`--until "<probe> <op> <value>" --max-frames N` stops the run early once the
probe condition holds and reports where:

```sh
node cli.mjs run game.sb3 --until "player.variables.hp <= 0" --max-frames 1800
```

Output gains `until: {expression, met, frame, value}` and `frames` counts the
frames actually executed (`frame` is 0-based; `value` is the probe value when
met, else the final value). Operators: `==` (`=` also works), `!=`, `<`,
`<=`, `>`, `>=`. Values parse as number / `true` / `false` / quoted-or-bare
string. The probe resolves against per-frame target state (same paths as
`--probe`, e.g. `Sprite1.x`, `clones.Ball`); `--frames`/`--seconds` may be
used instead of `--max-frames` as the cap.

## `layout <file.sb3> [--cleanup <out.sb3>]`

Reports per-target script bounding boxes, overlaps, and a 0–100 score.
`--cleanup <out.sb3>` writes a new sb3 with scripts rearranged like Scratch's
"Clean up blocks": per target, top-level scripts ordered by `(y, x)` are
stacked in a single left-aligned column (`x=20`, 30px gaps); attached comments
move with their block; workspace comments keep their positions.

### Size model (approximation)

- hat blocks: 180×44; plain stack rows: height 30;
- C-blocks (`repeat`, `forever`, `if`, `if/else`, `while`): 32px header,
  indented body (+8px gaps), 16px footer;
- row width: `56 + 7 × (opcode-length + literal/field text length)` characters.

Overlaps are pairwise rectangle intersections (4px margin) between top-level
scripts and workspace comments. Score = `max(0, 100 − 15 × overlapPairs)`.
This is a heuristic for agent feedback, not a pixel-perfect renderer metric.

## `costumes <file.sb3>`

Prints per target the costumes with their parsed sizes and rotation centers —
the same numbers the collision fallback uses — so authors can see (and fix)
the boxes `touching` runs against:

```json
{"targets": [{"name": "Sprite1", "isStage": false, "costumes": [
  {"name": "Sprite1-a", "asset": "<md5>.svg", "dataFormat": "svg",
   "width": 100, "height": 100,
   "rotationCenterX": 50, "rotationCenterY": 50,
   "collisionWidth": 100, "collisionHeight": 100, "unparseable": false}
]}]}
```

`width`/`height` are the parsed asset dims (SVG units, bitmap pixels);
`collisionWidth`/`collisionHeight` divide by `bitmapResolution` (bitmaps only)
exactly as the `touching` AABB fallback does. Unparseable assets report
`width`/`height`/`collision*` as `null` with `unparseable: true` (0×0 box in
collision).

## Test fixtures

`node make-fixtures.mjs [outDir]` writes seven small sb3s (default
`tools/vmrun/test-fixtures/`): `greenflag` (move+say+broadcast),
`keys` (arrow-key movement, edge bounce), `clones`, `click` (variable+monitor),
`touch` (sprite-vs-sprite touching), `ask` (ask/answer), `lists`
(scalar+list+broadcast separation). `npm test` rebuilds them and asserts
`check`/`run`/`layout`/`costumes` behaviour (50 assertions).

Medium real-world fixtures live in `eval/fixtures/` (see `SOURCES.md` there).

## Limitations (headless vs Scratch/TurboWarp)

- **No renderer/audio.** Sounds and music blocks are no-ops (`play until done`
  does not block); `touching color` / `color touching color` always return
  false (no pixel data); video sensing and text-to-speech have no I/O; `ask`
  blocks wait forever unless an `--input` `answer` event resolves them.
- **Collision is a bounding-box fallback**, not pixel-perfect touching (see
  below). Rotation is ignored; complex/empty costumes degrade to small boxes.
- **Costume sizes** are parsed from assets (SVG viewBox/width-height; PNG/GIF/
  BMP headers; JPEG SOF markers). Unparseable costumes get a 0×0 box.
- **Date blocks** (`current year/month/...`, `days since 2000`) and `username`
  use real wall-clock/user data and are not virtualized.
- **Cloud variables** are inert (no network).

### Did we try real scratch-render headless?

Yes — evaluated, rejected. `scratch-render` needs a real WebGL context.
Headless GL (`headless-gl`) and canvas (`node-canvas`) are native modules that
must compile against system libraries on every machine, which breaks the
"npm install and go" goal and still wouldn't give audio. The AABB fallback
keeps the harness pure JS with zero native dependencies while covering the
cases task-ladder projects need (edge bounce, sprite-vs-sprite touching,
mouse touching). If pixel-perfect touching is ever required, the swap point is
`lib/harness.mjs#patchTouching` plus attaching a real renderer/audio engine in
`createHeadlessVM`.
