# EXPLAIN.md — Lightcube Platformer 全体解説

対象: `eval/fixtures/lightcube-134430880.sb3`（本改造のベース）

## 1. ゲーム概要

光るキューブ（Block/DarkCircle）が洞窟ステージを進む横スクロール系プラットフォーマー。
全30マップ（本改造で31に拡張）。マップ移動はスクロール式で、プレイヤーが
テレポーターに触れると地形ごとスライドして次のマップへ遷移する。

## 2. 登場スプライトと役割

| スプライト | 役割 |
|---|---|
| Stage | グローバル変数・リストの保持、背景（Cave/Black/End）切替、BGM |
| Tile / Tile Bg | マップ本体。`Tile`変数の値ごとに衣装（Lv1〜Lv29）を切り替え、全マップの配置データを保持 |
| Hitbox（非表示） | プレイヤーの当たり判定・物理（落下・ジャンプ・左右移動）を担当する本体 |
| Block | 見た目の光キューブ。`Hitbox`に追従するだけ（瞬き演出つき） |
| DarkCircle | 残像エフェクト。`Hitbox`周辺に多数クローンを出す |
| Object - Teleporter | マップ間ワープ装置。`Spawn Type` 1〜7 で移動方向と `Tile±1` が決まる |
| Object - KillZone | 触れるとチェックポイントにリスポーン（`tryagain!`） |
| Object - EventZone | 矢印ガイド（type 1〜3）とゴール（type 99→`win!`） |
| Object - Collectables | カギ（Key+1）とドア（Key 2で開く） |
| Object - Sign | 看板テキスト表示 |
| Object - SpringBoard | ジャンプ台（`spring!`で大ジャンプ） |
| Object - Torch / Urchin | 松明（飾り）/ ウニ（KillZone系の障害物として配置） |
| Object - Water / Water2 / Bubble / Water Effect | 水・泡エフェクト。水中は移動が鈍くなる |
| Object - Wood Platform | 木の足場（Tileと同様に乗れる） |
| GameName | タイトル画面とクリア画面（クリアタイム表示） |
| PauseMenu（本改造で追加） | 一時停止メニュー |
| Dev / Dev Intro / FadeBlack / Welcome! / Report | 開発者クレジット・暗転・デバッグ報告用 |

## 3. マップシステム（最重要）

- Stage変数 `Tile` が現在マップ番号（1〜30、改造後は31）。
- `Tile` スプライトの `enter game` ハンドラが `Tile=1` に初期化し、無限ループで
  `Part1`〜`Part8`（define）を毎周回すべて呼ぶ。各Partは `Tile` 値ごとの
  `ifThen` 群で、該当マップの配置だけを実行する。
- 配置は2つのStageリスト経由：`Spawn Area X,Y` に座標を2つずつ、`Spawn Type` に
  種別を1つずつ積み、対応オブジェクトを `createCloneOf` する。
  クローン側の `QuickDelete` がリスト先頭を消費して自分の座標・種別を受け取る。
- 遷移：Teleporterに触れる → `Next?`（方向: 1右/-1左/2上下/-2）と `Tile±1` をセット →
  `next` 放送 → Hitboxがプレイヤーを画面端へグライド → `done` 放送 →
  `Map ScrollFinished?=1` → Tileループが新マップ配置をスポーン →
  Tileクローンが旧マップをスライドアウト・新クローンがスライドイン。
- `Saved X/Y/Jump/Glide...` はチェックポイント（KillZoneで `tryagain!` を受けると復帰）。

## 4. 物理（Hitbox の CheckCollison）

- `Glide Y` が落下速度（負=落下）。毎tick `TouchWater?` で重力を加算し、
  水中なら上限を抑える。
- 着地判定は `touching(Tile / Wood Platform)`。めり込み補正ループあり
  （300回抜け出せないと `Data` にデバッグ情報を残して `error` 放送＋`stop all`）。
- 左右移動は `Glide Left/Right` の加速・減速式。ジャンプは `space/上/w` で
  `Glide Y=17`（水中は別値）。`Time` 変数を1tickごとに+1（=経過フレーム数）。

## 5. タイマー・スコア（本改造の追加仕様）

- 従来は `Time`（フレーム数）だけが裏で数えられ、クリア時に `TimeFinal`（秒）表示のみ。
- 追加した Stage変数：
  - `TimeLeft`（初期1200秒、1秒ごとに-1、0で `gameend`＝時間切れゲームオーバー）
  - `Score = (Tile-1)×100 + Key×50`（0.2秒ごとに再計算）
  - `Paused`（1の間だけ Hitbox/Tile のメインループが `waitUntil` で待機）
- `Score`・`TimeLeft` はモニター（画面左上）を可視化＋`showVariable` 済み。

## 6. ポーズ・リスタート（本改造の追加仕様）

- `P`キー：`Paused` を反転し、PauseMenuを表示/非表示（SPACEでも再開可）。
- `R`キー（ポーズ中のみ）：`done`→`deletecc`→`restart`→`enter game` の順に放送し、
  各スプライトの `restart` ハンドラが自ループ停止＋クローン掃除をしてから
  最初からやり直す（タイトル経由の `deletecc` 流用で残像クローンも消える）。

## 7. ステージ追加ルール（Tile31 の作り方に準拠）

1. 新しい衣装 `Lv30.svg` を `Tile/costumes` と `Tile Bg/costumes` に追加し、
   両 `target.json` に登録（`switchCostumeTo(Tile番号)` で番号指定のため必須）。
2. `Tile/scripts.ts` の `Part8` に `ifThen(equals(vars.Tile, "31"), ...)` ブロック追加。
   既存ブロックと同じ書式：座標2つ＋種別1つの組をリストに積み `createCloneOf`。
3. 前マップ（Tile30）のゴールを出口テレポーター（右端 `(239,9)` type 1＝右へ `Tile+1`）
   に置き換え、新マップに戻りテレポーター（左端 `(-239,9)` type 2＝左へ `Tile-1`）を置く。
   最終マップはゴール用 `EventZone` type 99 を置く（`win!`→クリア画面）。
4. 追加分と既存分の対応表は `Stage` の `stage31test` ハンドラのコメントにも記載
   （テスト用直接スポーン。内容は Part8 と同一に保つこと）。
