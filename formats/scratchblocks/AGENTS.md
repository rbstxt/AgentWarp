# Agent guide: scratchblocks text format (`.sb`)

One block per line. Indentation is cosmetic (2 spaces per C level). Block text
uses the English Scratch wording. No ids in the text.

## Scripts and anchors

Every script starts with an `@aN` header (the anchor links it to the
underlying block, so edits keep ids/positions/comments). Leave anchors alone.
New scripts need no header — except a new *workspace comment*, which needs
`@newName` + `//` lines (otherwise `//` attaches to the previous block).

```sb
@a1
when clicked
go to x: (0) y: (0)
move (10) steps
say [Hello!] for (2) seconds

@a2
when [space v] key pressed
change x by (5)
```

Hats start a new script automatically (`when clicked`, `when [space v] key
pressed`, `when I receive [go v]`, `when I start as a clone`, ...). A stack of
plain lines always continues the current script — to force a new script, add
`@tmp` (any unused name) or start with a hat.

## Values

- `(10)` `(0.5)` `(-3)` — numbers. `("10")` — text that looks numeric
  (quotes preserve the text-vs-number distinction; both work when writing).
- `[hello]` text. `["10"]` — numeric text in a text slot. `[""]` empty text.
- `[name v]` — dropdowns/menus: `[mouse-pointer v]`, `[(1) Snare Drum v]`,
  `[all v]`, `[space v]`, `[Sprite1 v]`, `[costume1 v]`, `[Meow v]`.
  The `v` is optional when writing (`[space]` works); the printer adds it.
- `(score)` — variable reporter. `[score v]` — variable *field*
  (`set [score v] to (0)`, `show variable [score v]`).
- `[my list v]` — list field (`item (1) of [my list v]`). `(my list)` alone
  is the list reporter.
- `[message1 v]` — broadcast (`broadcast [message1 v]`, `when I receive [message1 v]`).
  New broadcasts are auto-created on the Stage.
- `<...>` — booleans: `<mouse down?>`, `<key [space v] pressed?>`,
  `<(score) > (10)>`, `<<(a) = (b)> and <(c) = (d)>>` (outer `<>` required
  when combining with `and`/`or`/`not`: `not <mouse down?>`).
- `[#ff0000]` — colors (`set pen color to [#ff0000]`).

Name collisions: catalog first, then args, then variables/lists. If a
variable shares a reporter's name, write `(timer :: variables)`;
for lists `(x :: list)`. Inside a custom block, `(height)` is the argument;
`(height :: variables)` forces the variable.

## C blocks, custom blocks, calls, comments

```sb
if <(score) > (10)> then
  say [big]
else
  say [small]
end
repeat (10)
  move (10) steps
end
forever
  move (10) steps
end
repeat until <touching [edge v]?>
  move (1) steps
end
for each [i v] in (my list)
  say (i)
end

define jump (height) :: warp
change y by (height)

when clicked
jump (10)
```

- `define name (num) (text) <flag> (n: number) (x="default")` — args:
  `(n)` string/number, `(n: number)` number (`%n`), `<b>` boolean.
  Append `:: warp` for "run without screen refresh".
- Call: `jump (10)`, `my block [hi] <flag>`. A call whose text also matches a
  builtin, or whose proccode labels contain brackets, prints as a raw
  `! {...}` line — leave those lines alone.
- Trailing `//` is an attached comment: `move (10) steps // note`.
  Full-line `//` lines continue it (first line may carry the anchor:
  `// [c3] note`, minimized: `// [c3 minimized] note`).
- `/* [c4] note */` after a reporter/boolean attaches there:
  `if <key [space v] pressed? /* [c4] debounce */ then`.

## Literals, tags, edge forms (rare)

- `(10 :: 4)` / `["10" :: 10]` — explicit literal tag, only printed when the
  tag differs from the slot default (round-trips weird old projects).
- `turn cw (15) degrees` / `turn ccw (15) degrees` (bare `turn` is an error).
- `stop [all v] :: {"tagName":"mutation",...}` — opaque mutation suffix,
  preserved verbatim; do not edit the JSON.
- `! {"opcode":"...","inputs":{...},"fields":{...}}` — raw escape for unknown
  or unprintable blocks (whole subtree as JSON). New scripts may use it;
  prefer normal syntax otherwise.
- `()` / `[]` / `<>` — missing inputs (printer emits them for absent slots;
  write `[""]` for empty text, not `[]`).
- `("a)b")`, `[a\]b]`, `[line1\nline2]` — `\` escapes `" [ ] ( ) < > n t r`.
- `("10")` in a number slot = text "10"; `(10)` = number 10.

## Diagnostics (file:line:col)

- `unknown block "..." (did you mean "...")` — check spelling/template.
- `unknown var/list "..." (did you mean ...)` — declare it in `target.json`
  first (see below); Scratch matches names exactly (case-sensitive).
- `unknown reporter or variable "..."` — no catalog block, arg, var, or list
  with that name.
- `unknown boolean ...` — a `<...>` that matches nothing (often a missing
  outer `<>` around `and`/`or`).
- `wrong input kind` — e.g. `(...)` where `[.. v]` belongs.
- `"end" without an open block` / missing `end` / duplicate `define`.
- Warnings (duplicate anchors, odd menus) are safe to leave.

## Project layout, variables, assets

```
agentwarp.json  Stage/scripts.sb  Stage/target.json  Sprite1/scripts.sb ...
```

- `target.json` holds `variables`/`lists`/`broadcasts` (`{name, id, value}`),
  `costumes`/`sounds` (`{name, file, ...}`), and scalars (`x y size
  direction visible volume ...`). To ADD a variable/list: append an entry
  with a fresh id (any unique string). Broadcasts may be sprite- or
  Stage-level (new ones land on the Stage automatically).
- To ADD a sprite: copy a target dir, rename, edit `target.json`'s `name`
  (directory name only needs to be unique-ish). Costumes/sounds are files
  under `costumes/`/`sounds/` referenced by `file` — put bytes there, never
  re-encode. Keep `agentwarp.json` and `.agentwarp/` alone.
- Monitors/watchers live in `agentwarp.json`; usually leave them.

## Scratch gotchas (will bite you)

- `say`/`think` then `stop all` in the same or another script clears the
  bubble — the probe may see no text.
- Key-press and broadcast hats ALSO run in clones (clone bombs). Gate clone
  scripts on `when I start as a clone` + `delete this clone` paths.
- Hidden originals still collide (`touching`); `= 0` tests fail when a
  variable is only changed by `change by -n` (use `< 1`).
- `broadcast` with no receiver is a silent no-op; receivers on the wrong
  sprite never fire. Names must match exactly.
- `wait (n) seconds` and key timing race the game tick; clones cost frames.
- `go to [mouse-pointer v]` vs sprite names; `_mouse_`/`_random_` are the
  special values behind the pretty labels.

## Cheat sheet (most used)

```
when clicked | when [space v] key pressed | when I receive [x v]
forever ... end | repeat (10) ... end | repeat until <...> ... end
if <...> then ... else ... end | wait until <...> | wait (1) seconds
move (10) steps | go to x: (0) y: (0) | glide (1) seconds to x: (0) y: (0)
point in direction (90) | turn cw (15) degrees | change x by (5)
say [hi] | say [hi] for (2) seconds | ask [name?] and wait | answer
set [v v] to (0) | change [v v] by (1) | (v) | show/hide variable [v v]
add [x] to [list v] | delete (1) of [list v] | item (1) of [list v] | (list)
reset timer | (timer) | <mouse down?> | (mouse x) | (mouse y)
<[touching [mouse-pointer v]?> | <key [space v] pressed?>
broadcast [x v] | broadcast [x v] and wait | create clone of [myself v]
delete this clone | stop [all v] | ((a) + (b)) | (pick random (1) to (10))
<[a] = [b]> | <<a> and <b>> | <not <a>> | (join [a] [b]) | (length of [x])
switch costume to [c v] | next costume | (costume [name v])
start sound [s v] | start sound [s v] until done | set volume to (100)
define jump (height) ... end-less body | jump (10)
```

Parse-then-print is stable: after editing, only the lines you touched should
change meaning. Keep anchors, keep `::` hints, keep `!` lines as-is.
