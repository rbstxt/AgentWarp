# sbpy — agent guide

sbpy is a Python-like text format for Scratch projects. One block per line,
suites by indentation (4 spaces, no tabs). File: `<Target>/scripts.sbpy`.
Variables/lists/broadcasts are referenced **by name**; ids never appear.

## Why function calls (not English text)

Statements are Python calls named by **catalog opcode**: `motion_movesteps`,
not `move (10) steps`. English text is ambiguous (`turn left` and
`turn right` are both `turn %1 degrees`), opcodes are exact and greppable.
Short aliases work when unambiguous (`movesteps(10)` = `motion_movesteps`);
the printer always writes full opcodes.

## Scripts

Blank lines separate scripts. Hat/define lines always start a new script.
Consecutive plain statements form one chain. New scripts have no anchors.

```sbpy
@a1
event_whenflagclicked():
    motion_gotoxy(X=0, Y=0)
    motion_movesteps(STEPS=10)
    looks_sayforsecs(MESSAGE="Hello!", SECS=2)

@a2
motion_movesteps(STEPS=5)
motion_turnright(DEGREES=15)
```

`@a1` is the script anchor (from unpack; leave it alone). Omit anchors on
new scripts. Two `@a` lines before one script = error (first wins).

## Statements

```sbpy
motion_movesteps(STEPS=10)        # keywords...
motion_movesteps(10)              # ...or positional (catalog % order)
control_repeat(TIMES=10):
    motion_movesteps(STEPS=10)
control_if_else(CONDITION=operator_equals(OPERAND1=var("score"), OPERAND2="0")):
    looks_say(MESSAGE="hi")
else:
    looks_say(MESSAGE="bye")
control_forever():
    motion_movesteps(STEPS=10)
```

- Hats end with `:` and their body is indented. Hat with empty body: put `pass`.
- `else:` pairs with the nearest `control_if_else` above it (same indent).
- C-block headers need `:` (`"... opens a body; add ':'"` otherwise).
- A stack block with `:` is an error; reporters as statements are errors
  (kept, so nothing is lost). Everything packs; diagnostics tell you.
- `pass` = explicit empty body. `pass` with a `#` remark attaches it to the
  enclosing header.

## Expressions (values)

```sbpy
10  -3  4.5                    # numbers (int/float, JSON)
"hi 😀"  'also ok'             # strings, either quotes, \" \\ \n \u00e9 escapes
var("score")                   # variable reporter (any Unicode/spaces)
list("items")                  # list reporter
broadcast("go")                # broadcast message (auto-created on Stage)
arg("height")  barg("flag")    # custom-block arguments (string-number / boolean)
lit("10", tag=4)               # literal with explicit tag (see below)
menu("backdrop1")              # a menu value outside a menu slot (rare)
operator_add(NUM1=1, NUM2=var("x"))
true  false                    # become "true"/"false" text
```

`var()`/`list()`/`broadcast()` work in **any** value input (they are
reporters). `broadcast()` is only valid in broadcast inputs. `arg()` only
makes sense inside a custom-block body.

### Literals and tags

Every value input has a default shadow type. Plain `10` / `"hi"` uses it;
`lit(v, tag=4)` forces tag 4..13 (number types) or 10 (text). You need `lit`
only when the value's type differs from the slot default, e.g. a string in
a number slot or `"1"` in a text-checked slot. The printer adds `lit()`
automatically where needed; copy its form.

### Fields vs inputs

`NAME="x"` where NAME is a **field** (VARIABLE, LIST, EFFECT, STYLE,
STOP_OPTION, KEY_OPTION, BACKDROP...) sets the dropdown/variable by name.
`NAME=<expr>` where NAME is an **input** (STEPS, TIMES, MESSAGE, CONDITION...)
takes any expression. Unknown names error with `did you mean …?`.

```sbpy
data_setvariableto(VARIABLE="score", VALUE="0")
event_whenkeypressed(KEY_OPTION="space"):
looks_seteffectto(EFFECT="COLOR", VALUE=25)
```

## Menus: use stored values

Menu inputs take the **stored** value (what's in project.json), not the
label. Most important ones:

| Write this | Not this |
|---|---|
| `TOUCHINGOBJECTMENU="_edge_"` | `"edge"` |
| `TOUCHINGOBJECTMENU="_mouse_"` | `"mouse-pointer"` |
| `CLONE_OPTION="_myself_"` | `"myself"` |
| `OBJECT="_stage_"` | `"Stage"` |
| `KEY_OPTION="left arrow"` | (labels == values here, fine) |

`_random_`, `_myself_`, `_mouse_`, `_edge_`, `_stage_` start with underscore.
The parser warns on unknown dropdown values and lists the valid options.

## Custom blocks

```sbpy
define "jump %n" (height) [warp]:
    motion_changeyby(DY=arg("height"))

define "weird %b and %s" (<flag>, name="dflt"):
    pass

call("jump %n", height=10)
```

- `define "proccode" (params) [warp]:` — proccode quoted verbatim with
  `%n`/`%s`/`%b` placeholders; `(name)` = string/number arg, `<name>` =
  boolean arg, `name="d"` = non-empty default. Counts must match (warns).
  `[warp]` = run without screen refresh; omit for normal.
- Param names print bare unless they contain `,()=<>#@"` or edge spaces,
  then quoted (`"my, name"`). Empty names print as `""`.
- `call("proccode", argname=value, ...)` — args by **name**.
- Rare wild files carry extra `argumentdefaults`; the printer appends
  `defaults=["", ...]` verbatim — leave it alone.
- `arg()`/`barg()` in bodies refer to the enclosing definition's params.

## Comments and anchors

```sbpy
@a1
@c2
# leading lines go above the statement...
motion_movesteps(STEPS=10)  # ...single-line remarks go at end of line
```

- Trailing `# text` attaches to that line's block; `#` lines directly
  above a statement (same indent; blank lines break, `@` anchor lines do
  not) prepend to it (multi-line = joined with `\n`).
- A `#` run NOT directly above code (blank line, dedent, EOF after it)
  becomes a **workspace comment** (own script). End-of-body remarks become
  workspace notes — put remarks above the line they describe.
- First line `[min] ` marks minimized (literal leading `[min]` escapes as
  `\[min]` automatically).
- `@aN` = script anchor, `@cN` = comment anchor. Leave them; new scripts and
  new comments omit them (ids are assigned on pack; attached comments keep
  position right of the block, workspace comments go to layout).

## The `raw` escape (unknown/odd blocks)

Opcodes outside the catalog, or nests the one-line form can't hold
(commented nested values, C-blocks inside values), print as:

```sbpy
raw "weird_ext_opcode":
    field NAME = "value"
    input NAME = expression
    input OTHER:
        operator_add(NUM1=1, NUM2=2)  # a nested value with a comment
    stack SUBSTACK:
        motion_movesteps(STEPS=1)
    mutation = {"tagName": "mutation", "children": []}
```

`raw` is exact (fields/inputs/mutation preserved verbatim). Prefer normal
calls; use `raw` only when told to or when the printer emits it.

## Variables, lists, broadcasts, assets

`target.json` holds declarations; edit it to add/remove:

```json
"variables": [{"name": "score", "id": "var-score", "value": 0}],
"lists": [{"name": "items", "id": "list-items", "items": []}],
"broadcasts": [{"name": "go", "id": "bc-go"}]
```

- Unknown `var()`/`list()` names are **warnings** with nearest names: the
  parser sees only this target's `target.json`, but Stage (global) vars
  are visible to all sprites. Reconcile still errors on truly undeclared
  names, so double-check spelling.
- `broadcast()` names are never validated — new broadcasts are created on
  the Stage automatically.
- Costumes/sounds: files under `costumes/`/`sounds/`, listed in
  `target.json` with `name`, `file`, `rotationCenterX/Y` (match the real
  center or touching/rotation looks wrong), `bitmapResolution`.
- New sprite: copy an existing sprite dir, rename in `target.json`
  (`name`, `x`, `y`), replace costumes, write scripts. New targets need no
  anchors.

## Scratch gotchas (from experience)

- `say` then `stop all` clears the bubble. Prefer loops that exit over
  `stop all` for end screens.
- Hat blocks (`when key pressed`, `when I receive`) also fire in **clones**;
  guard clone-only code with `when I start as a clone`.
- Hidden originals still collide (`touching [sprite]` sees them). Park
  unused originals off-stage (e.g. x=300) and `hide` them.
- `= 0` checks with multi-decrement skip over 0; use `< 1` for lives/counters.
- Key state is per-frame; tap keys with keydown+keyup in scripted inputs,
  use Scratch names (`"left arrow"`, `"space"`).
- Backdrop menus need existing backdrops; sprite menus need existing sprites.
- `repeat_until` with `pass` body = clean "wait until" for stage logic.

## Cheat sheet (opcodes you will use most)

```
event_whenflagclicked(): / event_whenkeypressed(KEY_OPTION="space"):
control_forever(): / control_repeat(TIMES=10): / control_repeat_until(CONDITION=...):
control_if(CONDITION=...): ... else: ...
motion_movesteps(STEPS=10) motion_gotoxy(X=0, Y=0) motion_changexby(DX=8) motion_setx(X=220)
motion_pointindirection(DIRECTION=90) motion_ifonedgebounce()
looks_say(MESSAGE="hi") looks_sayforsecs(MESSAGE="Hi!", SECS=2) looks_show() looks_hide()
looks_switchcostumeto(COSTUME="name") looks_switchbackdropto(BACKDROP="backdrop1")
sound_play(SOUND_MENU="pop") sound_setvolumeto(VOLUME=100)
sensing_keypressed(KEY_OPTION="left arrow") sensing_touchingobject(TOUCHINGOBJECTMENU="_edge_")
sensing_touchingobject(TOUCHINGOBJECTMENU="Enemy") motion_xposition() motion_yposition() sensing_timer()
data_setvariableto(VARIABLE="score", VALUE="0") data_changevariableby(VARIABLE="score", VALUE=1)
operator_add(NUM1=1, NUM2=2) operator_equals(OPERAND1=a, OPERAND2=b)
operator_lt/gt(OPERAND1=, OPERAND2=) operator_and/or/not(...) operator_random(FROM=-200, TO=200)
operator_join(STRING1="a", STRING2="b") operator_length(STRING="hi")
event_broadcast(BROADCAST_INPUT=broadcast("go")) event_whenbroadcastreceived(BROADCAST_OPTION="go")
control_create_clone_of(CLONE_OPTION="_myself_") control_start_as_clone(): control_delete_this_clone()
control_wait(DURATION=1) control_wait_until(CONDITION=...)
```

Short aliases (`movesteps`, `say`, `gotoxy`...) are accepted when unique;
`call("…")`, `define`, `raw`, `var`, `list`, `broadcast`, `arg`, `barg`,
`lit`, `menu` are reserved syntax, not blocks.
