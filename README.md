# AgentWarp

**Make Scratch as agent-ready as any programming language.**
Coding agents you already pay for (Claude Code, Codex, OpenCode) edit Scratch projects as text,
run and test them headlessly, and work side by side with you inside TurboWarp — with an agent
panel built into the editor.

[日本語](#日本語) | [English](#english)

---

## 日本語

AgentWarp は、Scratch プロジェクトを「エージェントが普通のコードと同じように扱える」ようにする道具一式です。
独自の AI ハーネスは持たず、手持ちのサブスクリプションで動く既存のエージェント（Claude Code / Codex /
OpenCode）をそのまま使います。

### できること

- **テキストで編集**：`.sb3` を 1 スクリプト = 1 文の TypeScript 風テキストに展開（`scratchblocks`、`sbpy` 形式も可）。
  型定義を生成するので、変数名やコスチューム名の打ち間違いは `tsc` で見つかります。
- **元のプロジェクトを壊さない往復変換**：ブロック ID・コメント・配置・モニターを保持し、変更がなければバイト単位で一致。
  新しく足したスクリプトだけを、TurboWarp の「ブロックを整理する」相当の規則で空いた場所に並べます。
- **チェックと実行**：`check`（構文・検証・Scratch のはまりどころの lint・型チェック、`file:line` 付き）、
  `run`/`test`（固定フレーム・乱数固定の決定的なヘッドレス実行と、JSON のテストシナリオ）、
  `shot`（本物の Scratch レンダラでステージを PNG/GIF に）。
- **TurboWarp とライブ同期**：`serve` でテキストとエディタを双方向に同期。人とエージェントが同時に編集しても合流します。
- **TurboWarp 内のエージェントパネル**：エディタの右に、Cursor / T3 Code 風のチャット。
  ACP（Agent Client Protocol）で Claude / Codex / OpenCode をつなぎ、変更されたスクリプトをブロックの見た目でレビュー、
  クリックでジャンプ、ターン単位で元に戻す、@ でスプライトやスクリプトを参照、ブロックの右クリックから「エージェントに聞く」。
  TurboWarp のアクセント色とダークモードに追従します。
- **エージェント向けの手順書**：`skill/agentwarp/SKILL.md`。`new`/`unpack` はプロジェクトに `AGENTS.md` / `CLAUDE.md` を書き出します。

### セットアップ

Node.js 26 以上（`.ts` を直接実行します）。依存は各パッケージで `npm ci`：

```sh
for d in packages/core packages/bridge packages/bridge/client packages/acp packages/panel formats/ts tools/vmrun tools/render; do
  (cd "$d" && npm ci)
done
```

### 使い方

```sh
bin/agentwarp unpack game.sb3 game/     # sb3 → テキスト（新規なら: bin/agentwarp new game/）
bin/agentwarp check game/               # 構文・検証・lint・型チェック
bin/agentwarp test game/                # tests/*.test.json を実行
bin/agentwarp shot game/ --frames 90 --at 0,89 --gif
bin/agentwarp pack game/ -o game.sb3    # テキスト → sb3
bin/agentwarp serve game/               # TurboWarp とライブ同期 + エージェントパネル（ポート 8765）
```

**TurboWarp Desktop にパネルを入れる**：`packages/bridge/client/userscript.js` を
`~/Library/Application Support/turbowarp-desktop/userscript.js`（macOS）に置いて Desktop を再起動。
初回だけ bridge の URL とトークン（`serve` が表示、`~/.config/agentwarp/token` に保存）を入力します。
ローダーは小さく固定で、パネル本体は bridge から読み込むため、更新時に入れ直す必要はありません。
Web 版（turbowarp.org）では開発者ツールに `packages/bridge/client/agentwarp-client.js` を貼り付けます。
詳しくは `packages/bridge/client/README.md`。

### 構成

| 場所 | 中身 |
|---|---|
| `packages/core` | IR、展開・パック（往復変換）、配置、lint、検証、ブロック一覧 |
| `formats/ts`, `formats/scratchblocks`, `formats/sbpy` | テキスト形式（パーサとプリンタ） |
| `packages/cli` | `agentwarp` コマンド |
| `packages/bridge` | ライブ同期サーバ、チェックポイント、変更サマリ |
| `packages/acp` | ACP ホスト（パネルとエージェントの接続） |
| `packages/panel` | エージェントパネル（React 19 + shadcn/ui、Shadow DOM 内） |
| `tools/vmrun`, `tools/render` | ヘッドレス実行（TurboWarp scratch-vm）と描画（scratch-render） |
| `skill/agentwarp` | エージェント向けの手順書 |
| `docs/`, `eval/` | 設計メモ、評価の記録 |

---

## English

AgentWarp is a toolkit that makes Scratch projects workable by coding agents the same way as ordinary
code. It ships no AI harness of its own: it uses the agents you already run on your subscriptions
(Claude Code, Codex, OpenCode).

### Features

- **Edit as text**: unpack an `.sb3` into one-TypeScript-statement-per-script text (`scratchblocks` and
  `sbpy` formats too). Generated type definitions let `tsc` catch typos in variable/costume names.
- **Lossless round trip**: block ids, comments, positions and monitors survive; an unchanged project packs
  byte-identical. Only newly added scripts are placed, using TurboWarp's "Clean up" rules.
- **Check and run**: `check` (parse, validation, Scratch-gotcha lint, type check, with `file:line`),
  `run`/`test` (deterministic headless runs: fixed frames, seeded RNG, JSON test scenarios), `shot`
  (PNG/GIF of the stage with the real Scratch renderer).
- **Live sync with TurboWarp**: `serve` keeps the text directory and the editor in sync both ways; human
  and agent edits merge.
- **Agent panel inside TurboWarp**: a Cursor / T3 Code-style chat docked in the editor. Connects Claude /
  Codex / OpenCode over ACP; review changed scripts rendered as real blocks, click to jump, undo a turn,
  @-mention sprites and scripts, "Ask agent" from a block's context menu. Follows TurboWarp's accent
  colour and dark mode.
- **Agent playbook**: `skill/agentwarp/SKILL.md`; `new`/`unpack` write `AGENTS.md` / `CLAUDE.md` into
  the project.

### Setup

Node.js 26+ (runs `.ts` directly). Install dependencies per package with `npm ci` (see the loop above).

### Usage

```sh
bin/agentwarp unpack game.sb3 game/     # sb3 -> text (new project: bin/agentwarp new game/)
bin/agentwarp check game/
bin/agentwarp test game/
bin/agentwarp shot game/ --frames 90 --at 0,89 --gif
bin/agentwarp pack game/ -o game.sb3
bin/agentwarp serve game/               # live sync + agent panel (port 8765)
```

**Agent panel in TurboWarp Desktop**: copy `packages/bridge/client/userscript.js` to
`~/Library/Application Support/turbowarp-desktop/userscript.js` (macOS) and restart Desktop. Enter the
bridge URL and token once (printed by `serve`, stored in `~/.config/agentwarp/token`). The loader is tiny
and stable; the panel itself is served by the bridge, so updates need no reinstall. On turbowarp.org,
paste `packages/bridge/client/agentwarp-client.js` into devtools. See `packages/bridge/client/README.md`.

---

## License

MIT — see [LICENSE](LICENSE). Third-party Scratch projects under `eval/fixtures/` keep their own
CC BY-SA 2.0 licence and attribution (`eval/fixtures/SOURCES.md`).
