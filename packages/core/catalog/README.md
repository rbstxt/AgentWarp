# Block catalog

`blocks.json` is generated from the real TurboWarp sources — never hand-edit it.
Change the generator (`gen/`) and regenerate instead.

## Sources

All sources live under `<repo>/.cache` (cloned, not submodules):

| Path | Repo | Commit | Used for |
|---|---|---|---|
| `.cache/tw-scratch-blocks` | TurboWarp/scratch-blocks (`develop`) | `7c58de6` | `blocks_vertical/*.js` + `blocks_common/{math,text,colour,matrix,note}.js`: every opcode's `jsonInit` (message0/args0…, shape extensions, static dropdown options, categories); `msg/messages.js` overlaid on `msg/json/en.json` (English label text; `messages.js` is newer — e.g. `PROCEDURES_RETURN`) |
| `.cache/tw-scratch-gui` | TurboWarp/scratch-gui | `7738389` | `src/lib/make-toolbox-xml.js`: toolbox membership (`hidden`), default shadow per input (`shadowOpcode`/`shadowField`) and toolbox default values |
| `.cache/tw-scratch-vm` | TurboWarp/scratch-vm | `0cb82af` | `src/extensions/{scratch3_pen,scratch3_music,scratch3_text2speech,scratch3_translate,scratch3_video_sensing,scratch3_makeymakey}/index.js` `getInfo()`: extension opcodes, block types, argument types/menus/defaults |
| `.cache/tw-scratch-l10n` | TurboWarp/scratch-l10n | `436a7b9` | `editor/blocks/ja.json` (Japanese labels, same message keys) and `editor/extensions/{en,ja}.json` (extension labels) |

(Short hashes; full hashes are recorded in `blocks.json` → `meta.sources`.)

## Regenerate

```sh
node packages/core/catalog/gen/generate.ts   # from the repo root; writes blocks.json
```

Node ≥ 23 runs the `.ts` directly (erasable syntax only, explicit `.ts` imports).
Regeneration is network-free and deterministic, except: the translate
extension picks a random default language at editor runtime, so the generator
records **no** default for its `LANGUAGE` inputs (see notes below).

## How extraction works

- **Core blocks.** Each `Blockly.Blocks['opcode']` chunk is scanned for its
  `this.jsonInit({...})` literal, which is evaluated with `Blockly.*` stubbed
  to marker refs, then resolved against en/ja (`control_stop` has no
  `jsonInit` — it is hardcoded from the same message keys).
  Shape comes from the shape extensions (`shape_hat` → `hat`,
  `shape_statement` → `stack`/`c`/`c2` by statement-input count,
  `shape_end` → `cap`/`end-c`, `output_boolean` → `boolean`,
  `output_*` → `reporter`); single-dropdown `%1` blocks → `menu`.
  `%n` placeholders are renumbered over non-image args (icons such as the
  turn arrows consume no number). Field/variable kinds come from the `field_*`
  types; `dynamic` markers for sprite/costume/sound/backdrop/broadcast menus
  reflect the GUI overrides in `src/lib/blocks.js` (e.g. `motion_goto_menu`
  gains the sprite list at runtime).
- **Extensions.** The real extension classes are loaded with stubbed heavy
  imports; `getInfo()` runs for real (videoSensing's device power-on side
  effect is skipped; makeymakey timers stubbed). Menu shadows are synthesized
  as `<ext>_menu_<Menu>` (matching the VM's `_makeExtensionMenuId`), menus
  unused by any block are reported. English labels come from the `default`
  messages; `format-message` is stubbed (en locale ⇒ `default`), so no npm
  install is needed. Translate language names are vendored in
  `gen/vendor-translate-languages.json` (extracted from
  `scratch-translate-extension-languages`, English viewer locale).
- **Procedures** (`procedures_definition/call/prototype`, `argument_reporter_*`)
  are mutation-driven: fixed specs with `shape` and empty inputs, plus a
  `notes` entry in `blocks.json` explaining the mutation layout. Editor-only
  blocks (`procedures_declaration`, `argument_editor_*`) are included as
  `hidden`.
- `hidden` = valid but absent from the default toolbox (obsolete Scratch 2.0
  blocks such as `motion_xscroll`, `looks_hideallsprites`, `sensing_userid`,
  `control_all_at_once`, `event_whentouchingobject`; TurboWarp-only blocks
  not in the toolbox such as `motion_scroll_right`, `looks_changestretchby`,
  `control_for_each`, menu shadows, literal holders).
- Known source quirks, kept as-is: `sensing_online`'s text is a hardcoded
  English literal upstream (`online?`, with a translation TODO — hence no ja);
  `translate` language defaults are random per editor load (no default
  recorded); literal-holder blocks (`math_*`, `text`, …) are grouped under a
  synthetic `literals` category; `data_showvariable`/`data_hidevariable` have
  no stack connections upstream and are typed `stack`.

## Test

```sh
node --test "packages/core/catalog/**/*.test.ts"
```

`catalog.test.ts` scans every `project.json` in `eval/fixtures/*.sb3`,
`tools/vmrun/test-fixtures/*.sb3` and `eval/runs/*/L*/out.sb3` and asserts:
every opcode has a spec; every input/field name used is in the spec (except
mutation-driven `procedures_*`); every type-1 shadow found under an input
matches `spec.shadowOpcode`. It also checks `LITERAL_TYPES`, `isMenuShadow`
spot values, and internal consistency (args ↔ `%n` ↔ inputs/fields), and
prints coverage stats.
