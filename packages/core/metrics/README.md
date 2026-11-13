# Metrics data

Measured rendering data for `../metrics.ts`. All measurements were collected
from the TurboWarp editor (Playwright Chromium, 1440x900, `en-US`) on the same
machine the model runs on; the editor font is `500 16px "Helvetica Neue"`.
Widths are SVG user units (= workspace units), not screen pixels.

| File | Contents | Source |
|---|---|---|
| `glyphs.json` | Per-character widths (ASCII, Latin-1, Japanese, extras), contextual space width, CJK/fallback averages, in-block emoji advances | `tools/calibrate/glyphs.mjs` (+ `glyphs2.mjs` for chars seen in fixtures) |
| `labels.json` | Whole-string widths for every static block label and static dropdown option | `tools/calibrate/labelprobe.mjs` (reads `structure.json` + the catalog) |
| `pairs.json` | Adjacent-pair kerning corrections over all fixture strings | `tools/calibrate/pairprobe.mjs` (pairs from `/tmp/pairs.txt`) |
| `structure.json` | Per-opcode input structure: ordered inputs, value/statement/dummy kinds, empty-slot shapes, field slots (labels, icons, value fields with width rules) | `tools/calibrate/extract-structure.py` (from `eval/calibration/probe2.json` + the catalog) |

Regeneration is network-dependent (live editor) except `extract-structure.py`,
which is offline. `glyphs.mjs` preserves the existing `extra` map when
re-run. See `eval/calibration/README.md` for the ground-truth data these are
validated against (`packages/core/test/metrics.test.ts`).

Japanese calibration uses `structure-ja.json` and `options-ja.json`, captured from
actual Japanese editor blocks. `glyphs.json` includes browser measurements for
kana, CJK characters and full-width punctuation from the catalog. Pass
`{locale: 'ja'}` as the third argument to `measureScript` to select Japanese;
`{locale: 'en'}` selects English. With no explicit locale, dimensions are
English and comment anchors use the larger English/Japanese right edge. The
Clean up Plus API accepts `{locale: 'en' | 'ja'}` and defaults to English;
new placement reserves the larger dimensions and comment extent in both.
