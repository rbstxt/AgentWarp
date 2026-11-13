# Agent guide — the `ts` text format

One TypeScript statement per script. The code is never executed; it is parsed
back into Scratch blocks. After editing, run `tsc --noEmit` (catches typos in
names) and re-pack.

```ts
// @a1                        <- script anchor: keep it, never invent new ones
whenFlagClicked(() => {        // hat: event + body callback
  goToXY(0, 0);                // plain stack blocks, one per line
  moveSteps(10);
  sayFor("Hello!", 2);
});

// @a2
script(() => {                  // hat-less stack: wrap in script()
  wait("1");
  broadcast("go");             // string = broadcast / menu / costume / sound
});

// @a3
define("jump %n", { warp: true }, (height = 10) => {  // custom block
  changeY(height);              // proc args are plain parameters
});
call("jump %n", 5);            // call by proccode

// @c1
comment("lone workspace comment");   // workspace comment (its own script)
```

## Values

- Numbers/strings: `moveSteps(10)`, `say("hi")`. Scratch coerces, so both work in most slots. Negative numbers are fine: `changeVariableBy(vars.hp, -1)`.
- Variables/lists: `vars.score`, `vars["スコア"]`, `lists.items`. **Always** use these — never a bare string. Only your own target's plus the Stage's (globals) are visible; another sprite's variable is a `check` error.
- Menus use **stored** values (what's in project.json), not editor labels: `"space"`, `"_myself_"` (clone myself), `"_mouse_"` (mouse-pointer), `"_random_"` (random position), `"_edge_"`, `"_stage_"`, `"Stage"` (the stage), sprite names (`"Player"`), `"all"` / `"this script"` / `"other scripts in sprite"` for stop. Costumes/sounds/backdrops/broadcasts are plain names: `"costume1"`, `"pop"`, `"backdrop1"`, `"go"`.
- Conditions: `ifThen(equals(a, b), () => {...})`, `ifElse(c, t, e)`, `repeatUntil(touching("_edge_"), () => {...})`.
- Loops: `repeat(10, () => {...})`, `forever(() => {...})`, `waitUntil(cond)`.
- Operators are functions: `add`, `subtract`, `multiply`, `divide`, `mod`, `round`, `mathOp("abs" | "floor" | "ceiling" | "sqrt" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "ln" | "log" | "e ^" | "10 ^", x)`, `join`, `letterOf`, `lengthOf`, `contains`, `random(1, 10)`, `equals`, `lessThan`, `greaterThan`, `and`, `or`, `not(x)`. (You may also write `1 + 2`, `a > b`, `a && b`, `!x` — but only on plain numbers: reporter results are `Dyn`, so `add(x, 1) + 2` fails `tsc --noEmit`; use the function form there.)
- Booleans (`equals`, `contains`, `keyPressed`, …) fit condition slots (`ifThen`, `waitUntil`, `and`/`or`/`not`) but not value slots: `say(contains("hi", "i"))` fails `tsc` — branch with `ifElse` instead.
- Cross-target reads: `attributeOf("x position" | "y position" | "direction" | "costume #" | "costume name" | "size" | "volume", "SpriteName")`, and `attributeOf("backdrop #" | "backdrop name" | "volume", "Stage")`.
- Empty input: `undefined`. Empty stack: `() => {}`.

## Declarations (`target.json`)

```json
"variables": [{"name": "score", "value": 0}],
"lists": [{"name": "items", "items": ["a", "b"]}],
"broadcasts": [{"name": "go"}]
```

- `id` is optional: omit it and pack mints a Scratch-style id and writes it back into `target.json`. A duplicate/conflicting id warns and is re-minted. Never invent `id` strings by hand.
- `value` must be a scalar (string/number/boolean); `items` must be an array of scalars. Anything else is a pack error. (A wrapped `items: [[...]]` is the old pre-P3 shape — don't write it.)
- Variable/list scope: a sprite sees its own plus the Stage's. Broadcasts are auto-created on pack (declared on the Stage); you may also declare them anywhere so unpack prints them.
- New costume/sound: drop the file in `costumes/`/`sounds/`, add `{name, file, rotationCenterX, rotationCenterY}` (costume) or `{name, file}` (sound) to `target.json`. Omit the whole `costumes`/`sounds` array and entries are derived from the files on disk (center = image center). `check` validates names: a typo'd costume is an error with file:line.

## Monitors (`agentwarp.json`)

`showVariable(vars.score)` / `hideVariable(...)` / `showList(...)` / `hideList(...)` are only runtime blocks: they do **not** create the on-stage checkbox. The checkbox is a row in `agentwarp.json`'s `monitors` array (packed verbatim into the sb3):

```json
"monitors": [
  {"id": "mon-score", "mode": "default", "opcode": "data_variable",
   "params": {"VARIABLE": "score"}, "spriteName": "Sprite1",
   "value": 0, "width": 0, "height": 0, "x": 5, "y": 5, "visible": true},
  {"id": "mon-items", "mode": "default", "opcode": "data_listcontents",
   "params": {"LIST": "items"}, "spriteName": "Sprite1",
   "value": [], "width": 0, "height": 0, "x": 5, "y": 100, "visible": true}
]
```

- Variable monitors: `opcode: "data_variable"`, `params.VARIABLE` = the variable **name**. List monitors: `opcode: "data_listcontents"`, `params.LIST` = the list **name**.
- `spriteName`: the owning sprite's name, `null` for Stage globals. `visible` = the checkbox. `id`/`x`/`y`/`width`/`height` are free-form (any unique `id`, sensible position).
- To show a value from the start: add the row **and** the block. `run` reports live monitor values under `monitors`.

## Sprites: add / rename / delete

- Add: copy a target directory, rename it, set `name` in its `target.json`, replace `costumes/`+`sounds/` and declare them. New dirs need no anchors; the sprite lands after existing ones.
- Rename: rename the directory **and** `name` in `target.json`. Anchors keep block ids/positions/comments; menu references in *other* targets (`touching("Old")`, `createCloneOf("Old")`, `attributeOf(..., "Old")`) are rewritten automatically.
- Delete: remove the whole target directory. Pack drops the sprite (warns `target "X" removed`); blocks elsewhere that still name it become `check` errors — fix or remove them.
- Sprites are independent: custom blocks (`define`/`call`) live on one sprite; calling another sprite's procedure is a pack error.

## Comments and anchors

- `// text` directly above a statement attaches to that block. Multi-line = several `//` lines with **no blank line inside the group**, and the group must **directly precede** a statement. `//- text` = minimized (collapsed) comment.
- A `//` group with a blank line after it, or with no statement following it, is **dropped silently** — pack gives no warning. Keep one group per statement.
- `// @a1` above a script is its anchor: keep it so the packer reuses the same blocks/positions. New scripts have no anchor. A bare `// @c3` line inside a `//` group pins that block-attached comment's id across edits (it must stand alone — `// @c3 text` is just text, not an anchor).
- `comment("text")` / `comment("text", { minimized: true })` is a workspace comment (its own script).
- `withComment(block, "note")` attaches a comment to a nested reporter, e.g. `moveSteps(withComment(random(1, 10), "jitter"))`; add `{ minimized: true }` and/or `{ anchor: "c2" }` as a third argument to pin it. Reporter-attached comments survive only while their reporter expression is untouched — restructure around them and they drop.
- Generic escape hatch (unknown opcodes, opaque needs): `block("opcode", { inputs: {...}, fields: {...}, mutation: {...} })`, e.g. `block("control_stop", { fields: { STOP_OPTION: "all" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} })`.
- Explicit literal/menu/broadcast in odd slots: `lit("5", 4)`, `menu("x")`, `bcast("y")` (rarely needed).

## Procedures

- `define("collide %n %n", { warp: true }, (dx, dy) => {...})`. `%n` = number arg, `%s` = text arg, `%b` = boolean arg — one JS parameter per placeholder, in order. Defaults are JS defaults. Argument names must be valid JS names; anything else becomes `$arg` with the real name kept in a `/* "…" */` comment — do not touch those comments.
- Calls: `call("collide %n %n", 5, 6)` — positional, same order as the define; arg count mismatches are `check` errors/warnings.

## Types (`tsc --noEmit` + generated `.d.ts`)

- `generateDts(projectDir)` writes `.agentwarp/types/<Target>.d.ts` per target. Type-check with e.g. `tsc --noEmit Stage/scripts.ts .agentwarp/types/Stage.d.ts`.
- `vars`/`lists` only contain declared names; costumes/sounds/backdrops/broadcasts are string-literal unions — a typo like `switchCostumeTo("catt")` is a compile error.
- New variable/list/costume/sound/broadcast? Declare it in `target.json` (+ file for assets), re-run `generateDts`, then use it.

## Scratch gotchas (will bite)

- `broadcast` to a name nobody receives silently does nothing — add the receiver hat.
- `stop all` clears `say`/`think` bubbles; key-press and broadcast hats also run in clones (clone bombs); hidden originals still collide; a variable only decremented by `change by -n` can skip `= 0` — test `< 1` (lint rule `zero-equals-decrement` warns about this, even when a `set` init exists).
- Deleting the last block of a `forever`/`repeat` body is fine; code after `stop("this script")` in the same stack never runs.

## Cheat sheet (most used)

Hats: `whenFlagClicked`, `whenKeyPressed("space")`, `whenThisSpriteClicked`, `whenBroadcastReceived("go")`, `whenStartAsClone`, `whenBackdropSwitchesTo("bg")`, `whenTouchingObject("Player")`.
Motion: `moveSteps`, `turnRight/turnLeft`, `goToXY/goTo/target`, `glideSecsToXY/glideTo`, `pointInDirection/pointTowards`, `changeX/changeY/setX/setY`, `ifOnEdgeBounce`, `setRotationStyle("left-right")`, `xPosition/yPosition`.
Looks: `say/sayFor/think/thinkFor`, `switchCostumeTo/nextCostume`, `switchBackdropTo`, `changeSizeBy/setSizeTo`, `show/hide`, `setLookEffectTo/changeLookEffectBy`.
Sound: `startSound/playSoundUntilDone/stopAllSounds`, `changeVolumeBy/setVolumeTo`.
Data: `setVariableTo(vars.x, v)`, `changeVariableBy`, `showVariable/hideVariable`, `showList/hideList`, `addToList(item, lists.l)`, `deleteOfList/deleteAllOfList/insertAtList/replaceItemOfList`, `itemOfList/itemNumberOfList/lengthOfList/listContains`.
Control: `wait/waitUntil/repeat/repeatUntil/forever/ifThen/ifElse`, `stop("all")`, `createCloneOf/deleteThisClone`, `forEach(vars.x, value, body)`.
Sensing: `touching/touchingColor`, `distanceTo`, `askAndWait/answer`, `keyPressed/mouseDown/mouseX/mouseY`, `timer/resetTimer`, `attributeOf("x position", "Sprite")`.
Events: `broadcast/broadcastAndWait`.
