# LOG.md — refactor (Lightcube Platformer 改造)

## TODO
- [x] unpack して check（既存エラー2件を確認）
- [ ] 既存エラーの最小修正（Collectables "Door Open Mold"→"Door Opened" / SpringBoard "variant1"→"variant1-1"）
- [ ] Stage変数追加（Score / TimeLeft / Paused）+ モニター表示
- [ ] タイマー・スコアの新規スクリプト（Stage、追加のみ）
- [ ] 一時停止メニュー（PauseMenuスプライト新設、P/SPACE/R）
- [ ] 既存ループにポーズ対応1行追加（Hitbox/Tile、@a2 のみ）
- [ ] 再開/リスタート用 broadcast 追加（restart / stage31test）
- [ ] 新ステージ31（Part8 + Lv30衣装をTile/Tile Bgに追加、Tile30は31への出口に変更）
- [ ] EXPLAIN.md 作成
- [ ] tests/*.test.json 作成 → test 全パス
- [ ] shot 目視確認
- [ ] pack + diff → REPORT.md

## Friction log
- 2026-11-13 作業開始。`bin/agentwarp` は相対パスで届かず絶対パスで実行（セッションのcwdがリポジトリ直下のため）。
- check は既知のエラー2件（存在しない衣装名）で FAILED。unpack直後の素の状態でも失敗＝pre-existing。
  → 最小修正（Collectables "Door Open Mold"→"Door Opened"、SpringBoard "variant1"→"variant1-1"）で check 成功。
- 新規 broadcast 名（restart/stage31test）は Stage/target.json に宣言しないと tsc エラー。pack は自動追加しない。
  → 宣言後に check が .d.ts を再生成して解消。
- ヘッドレス実行はグライド系が極端に遅い（100超のクローンスレッドがステップ予算を消費）。
  stage31test の遷移経由ワープが時間内に終わらず、直接スポーン方式に切替。検証は test プローブで代替。
- `shot` は本環境でハング（5フレームでも出力なし・タイムアウトでkill）。画像検証は断念、REPORTに記録。
- pack 後の new-overlap 警告（Hitbox +1）。`tidy` は既存配置まで動かす恐れがあるため不使用。
  diff で moved=0 を維持することを優先（Tile は元から overlap 4組あり）。
- 終了時 check: 警告75件（すべて既存パターン）、エラー0。test: 6/6 PASS。
