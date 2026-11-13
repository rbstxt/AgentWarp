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
comment("lone workspace comment");   // workspace comment (own script)
```

## Values

- Numbers/strings: `moveSteps(10)`, `say("hi")`. Scratch coerces, so both work in most slots.
- Variables/lists: `vars.score`, `vars["スコア"]`, `lists.items`. **Always** use these — never a bare string.
- Menus (key, target, effect…), costumes, sounds, backdrops, broadcasts: plain strings — `"space"`, `"Player"`, `"costume1"`, `"pop"`, `"backdrop1"`, `"go"`.
- Conditions: `ifThen(equals(a, b), () => {...})`, `ifElse(c, t, e)`, `repeatUntil(touching("edge"), () => {...})`.
- Loops: `repeat(10, () => {...})`, `forever(() => {...})`, `waitUntil(cond)`.
- Operators are functions: `add(a, b)`, `subtract`, `multiply`, `divide`, `lessThan`, `greaterThan`, `equals`, `and`, `or`, `not(x)`, `join`, `random(1, 10)`. (You may also write `a + b`, `a > b`, `a && b`, `!x` — they parse to the same blocks.)
- Empty input: `undefined`. Empty stack: `() => {}`.

## Comments and anchors

- `// text` directly above a statement attaches to that block. Multi-line = several `//` lines. `//- text` = minimized (collapsed) comment.
- `// @a1` above a script is its anchor: keep it so the packer reuses the same blocks/positions. New scripts have no anchor.
- `comment("text")` / `comment("text", { minimized: true })` is a workspace comment (its own script).
- `withComment(block, "note")` attaches a comment to a nested reporter, e.g. `moveSteps(withComment(random(1, 10), "jitter"))`.
- Generic escape hatch (unknown opcodes, opaque needs): `block("opcode", { inputs: {...}, fields: {...}, mutation: {...} })`, e.g. `block("control_stop", { fields: { STOP_OPTION: "all" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} })`.
- Explicit literal/menu/broadcast in odd slots: `lit("5", 4)`, `menu("x")`, `bcast("y")` (rarely needed).

## Procedures

- `define("label %s and %n", { warp: true }, (name, n = 1) => {...})`. `%s`/`%n` = text/number arg, `%b` = boolean arg. Defaults are JS defaults. Argument names must be valid JS names; anything else becomes `$arg` with the real name kept in a `/* "…" */` comment — do not touch those comments.
- Calls: `call("label %s and %n", "hi", 1)` — positional, same order as the define.

## Types (`tsc --noEmit` + generated `.d.ts`)

- `generateDts(projectDir)` writes `.agentwarp/types/<Target>.d.ts` per target. Type-check with e.g. `tsc --noEmit Stage/scripts.ts .agentwarp/types/Stage.d.ts`.
- `vars`/`lists` only contain declared names; costumes/sounds/backdrops/broadcasts are string-literal unions — a typo like `switchCostumeTo("catt")` is a compile error.
- New variable/list/costume/sound/broadcast? Declare it in `target.json` (+ file for assets), re-run `generateDts`, then use it.

## Adding things

- New sprite: copy a target directory, rename, set `name` in its `target.json`, add assets under `costumes/`, `sounds/`, declare them in `target.json`.
- New costume/sound: drop the file in `costumes/`/`sounds/`, add `{name, file, rotationCenterX, rotationCenterY}` (costume) or `{name, file}` (sound) to `target.json`.
- New variable: add `{"name": ..., "value": 0}` to `target.json` variables. New list: `{"name": ..., "items": []}`. Broadcasts are auto-created on pack (declared on the Stage).

## Scratch gotchas (will bite)

- `broadcast` to a name nobody receives silently does nothing — add the receiver hat.
- `stop all` clears `say`/`think` bubbles; key-press and broadcast hats also run in clones (clone bombs); hidden originals still collide; a variable only changed by `change by -n` never `= 0` — test `< 1`.
- Deleting the last block of a `forever`/`repeat` body is fine; code after `stop("this script")` in the same stack never runs.

## Cheat sheet (most used)

Hats: `whenFlagClicked`, `whenKeyPressed("space")`, `whenThisSpriteClicked`, `whenBroadcastReceived("go")`, `whenStartAsClone`, `whenBackdropSwitchesTo("bg")`, `whenTouchingObject("Player")`.
Motion: `moveSteps`, `turnRight/turnLeft`, `goToXY/goTo/target`, `glideSecsToXY/glideTo`, `pointInDirection/pointTowards`, `changeX/changeY/setX/setY`, `ifOnEdgeBounce`, `setRotationStyle("left-right")`, `xPosition/yPosition`.
Looks: `say/sayFor/think/thinkFor`, `switchCostumeTo/nextCostume`, `switchBackdropTo`, `changeSizeBy/setSizeTo`, `show/hide`, `setLookEffectTo/changeLookEffectBy`.
Sound: `startSound/playSoundUntilDone/stopAllSounds`, `changeVolumeBy/setVolumeTo`.
Data: `setVariableTo(vars.x, v)`, `changeVariableBy`, `showVariable/hideVariable`, `addToList(item, lists.l)`, `deleteOfList/deleteAllOfList/insertAtList/replaceItemOfList`, `itemOfList/lengthOfList/listContains`.
Control: `wait/waitUntil/repeat/repeatUntil/forever/ifThen/ifElse`, `stop("all")`, `createCloneOf/deleteThisClone`, `forEach(vars.x, value, body)`.
Sensing: `touching/touchingColor`, `distanceTo`, `askAndWait/answer`, `keyPressed/mouseDown/mouseX/mouseY`, `timer/resetTimer`, `attributeOf("x position", "Sprite")`.
Events: `broadcast/broadcastAndWait`.
