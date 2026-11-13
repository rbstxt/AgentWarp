# agentwarp

[日本語](#日本語) | [English](#english)

## 日本語

agentwarp は Scratch プロジェクトをテキストとして編集するためのツールです。
`.sb3` をテキストディレクトリに展開し、エージェント（Claude Code / Codex /
OpenCode）がいつもの CLI で編集 → `check` → headless 実行 → テストの
ループを回せるようにします。人間は TurboWarp でそのまま編集できます。

```sh
bin/agentwarp unpack game.sb3 proj/   # sb3 → テキスト展開（標準形式: ts）
cd proj
bin/agentwarp check                   # 構文+検証+lint（file:line付き）
bin/agentwarp run --frames 600 --probe Player.x
bin/agentwarp test                    # tests/*.test.json を一括実行
bin/agentwarp pack -o game.sb3        # テキスト → sb3
bin/agentwarp serve                   # TurboWarp とライブ同期（ human と協業）
```

- 1スクリプト=1文の TypeScript（`formats/ts/AGENTS.md`）。`sbpy`、
  `scratchblocks` 形式も利用可。
- 往復はロスレス（ブロックID・コメント・配置・モニターを保持）、
  新規スクリプトだけ自動整列。重なりは `tidy` で解消。
- エージェント向けガイドは `skill/agentwarp/SKILL.md`（インストール方法は
  `skill/agentwarp/install.md`）。プロジェクト作成時に `AGENTS.md` を自動生成。
- 設計メモは `docs/`（P3 形式選定、P5 ACP パネル構想）。

## English

agentwarp lets you work on Scratch projects as text. Unpack an `.sb3` into a
text directory and let a coding agent (Claude Code / Codex / OpenCode) run
its usual loop — edit → `check` → headless run → test — while a human keeps
editing in TurboWarp.

```sh
bin/agentwarp unpack game.sb3 proj/   # sb3 -> text dir (default format: ts)
cd proj
bin/agentwarp check                   # parse + validate + lint (file:line)
bin/agentwarp run --frames 600 --probe Player.x
bin/agentwarp test                    # run tests/*.test.json scenarios
bin/agentwarp pack -o game.sb3        # text dir -> sb3
bin/agentwarp serve                   # live-sync with TurboWarp (collaborate)
```

- One TypeScript statement per script (`formats/ts/AGENTS.md`); `sbpy` and
  `scratchblocks` formats also supported.
- Lossless round trip (block ids, comments, positions, monitors preserved);
  only new scripts are auto-placed. Fix overlaps with `tidy`.
- Agent guide: `skill/agentwarp/SKILL.md` (install:
  `skill/agentwarp/install.md`). `new`/`unpack` generate `AGENTS.md`.
- Design notes in `docs/` (P3 format decision, P5 ACP panel plan).
