# REPORT — game (横スクロールアクションゲーム)

## 作ったもの (要求との対応)
- タイトル画面＋スタートボタン: `title` backdrop + StartBtn (クリックで `startGame`)
- 3ステージ (だんだん難しく): 敵の速さ enemySpeed 2→3→4、敵の数 1→2→3、backdrop切替
- 敵 (左右に動く・上から踏むと倒せる): Enemy/Enemy2/Enemy3。パトロール＋画面端で折り返し。
  `Player.y > 自分.y+20 かつ落下中` で踏みつけ (+20点・stomp音)。横からはダメージ
- コイン (取るとスコア＋効果音): Coin/Coin2/Coin3。各面3枚 (+10点・coin音・sfx記録)
- 残機3: lives。ダメージで-1、無敵時間90F＋点滅。0でゲームオーバー
- ゴールの旗でステージクリア: Goal (世界x=400)。3面クリアでエンディング
- エンディング画面＋ゲームオーバー画面: `ending` / `gameover` backdrop、再挑戦ボタン表示
- ハイスコア保存: Stage変数 hiScore (クリア/ゲームオーバー時に更新)
- BGM: 自作 bgm.wav を `playSoundUntilDone` ループ (bgmOn=1で起動確認)
- SVG自作: player/enemy/coin/flag/button/cloud/背景6枚。効果音も自作WAV (6種)
- コメント整理: 全スクリプト日本語コメント＋ `@a1` アンカー維持
- 横スクロール: Playerがx>60で右に進むと世界 (敵・コイン・旗) が左へ流れる＋雲パララックス

## `bin/agentwarp test` 出力 (12/12 PASS)
```
PASS coin / damage / difficulty / ending / gameover / goal
PASS jump / move_left / move_right / start / stomp / title
12 passed, 0 failed (0 failing expects)
```

## `bin/agentwarp check` 出力
```
warning: target "Sprite1" removed (directory deleted)
check ok
```
(Sprite1は初期テンプレ残骸の注意のみ。エラーなし)

## shot画像 (パス)
- eval/p6/game/shots/frame-000029.png — タイトル
- eval/p6/game/shots/frame-000045.png — 1面プレイ中 (敵・コイン・旗・雲)
- eval/p6/game/shots/frame-000099.png — 2面突入 (ジャンプで旗へ)
- eval/p6/game/shots/end/frame-000300.png — ゲームオーバー＋再挑戦ボタン
- eval/p6/game/shots/end2/frame-000479.png — エンディング (state=ending確認済み)

## 反復回数
- 大きな書き直し: 0回。増分12スクリプト＋微修正 (コイン高さ、左端クランプ、難易度テストF値)。
- `check` 8回、`run` 30回超 (ジャンプ時刻スイープ等)、`test` 3回、`shot` 5回。

## 10大friction (時間順・詳細はLOG.md)
1. costumes/sounds配列省略時の `unknown backdrop/sound` 警告 (明示登録で解消)
2. 素材生成とスプライト複製の順序ミスでSVG消失 (自作ミス・再生成)
3. probe `Stage.state` がnull (`Stage.variables.state` が正。docs差異)
4. コイン判定5px届かず (見た目とBB判定の差。y調整)
5. `run`成功入力が `shot` でズレる (ピクセル精度判定の差)
6. クローン設計を捨て実スプライト化 (順序・attributeOf問題の回避＝正解だった)
7. difficultyテストのF値 (320で既にgameover→305に修正)
8. shotの `No audio engine present` 警告 (無害だが初見で不安)
9. ゲームオーバー後のリトライ導線 (StartBtn再表示を追加)
10. 終盤の敵が画面外に逃げて戻る挙動 (bounceで戻るため詰みなし。仕様として許容)

## 改善提案 (tool/docs/format)
- `check` のlintが導出アセット名を認識しないなら、省略可と書かず「明示推奨」に
- probes.mdのStage省略記法を実装に合わせる (or 両対応)
- `shot` と `run` の当たり判定差をdocsに明記 (テスト戦略に直結)
- 音声なし警告を `shot` では抑制/注記 (初見の混乱を避ける)
- ステージ制ゲームの定番 (scrollX共有パターン) をexamplesに追加
