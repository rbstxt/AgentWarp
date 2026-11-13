// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Time, 0);
  switchBackdropTo("Black");
});

// @a2
whenBroadcastReceived("enter game", () => { switchBackdropTo("Cave"); });

// @a3
whenBroadcastReceived("mainmenu", () => {
  switchBackdropTo("Cave");
  setVolumeTo(100);
  playSoundUntilDone("TA-OpeningTheme Intro");
  forever(() => { playSoundUntilDone("TA-OpeningTheme"); });
});

// @a4
whenBroadcastReceived("win!", () => { repeat(100, () => { changeVolumeBy(-1); }); });

// @a5
whenBroadcastReceived("gameend", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in stage" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  setVolumeTo(100);
  wait(1);
  playSoundUntilDone("TA-Game Over");
});

// --- 追加: 緑旗ではモニターを隠してポーズ解除 ---
whenFlagClicked(() => {
  hideVariable(vars.Score);
  hideVariable(vars.TimeLeft);
  setVariableTo(vars.Paused, 0);
});

// --- 追加: スコアと残り時間の初期化・表示（enter game のたびにリセット） ---
whenBroadcastReceived("enter game", () => {
  setVariableTo(vars.Score, 0);
  setVariableTo(vars.TimeLeft, 1200);
  setVariableTo(vars.Paused, 0);
  showVariable(vars.Score);
  showVariable(vars.TimeLeft);
});

// --- 追加: 残り時間カウントダウン（ポーズ中は減らない。0でゲームオーバー） ---
whenBroadcastReceived("enter game", () => {
  repeatUntil(lessThan(vars.TimeLeft, 1), () => {
    wait(1);
    ifThen(equals(vars.Paused, 0), () => { changeVariableBy(vars.TimeLeft, -1); });
  });
  broadcast("gameend");
});

// --- 追加: スコア計算（進んだマップ×100＋集めたカギ×50） ---
whenBroadcastReceived("enter game", () => {
  forever(() => {
    setVariableTo(vars.Score, add(multiply(subtract(vars.Tile, 1), 100), multiply(vars.Key, 50)));
    wait(0.2);
  });
});

// --- 追加: リスタート時の掃除（カウントダウンとスコア更新を止める） ---
whenBroadcastReceived("restart", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in stage" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
});

// --- 追加: テスト用スポーン（Tile31の配置を直接出す。内容は Tile の Part8「Tile31」と同一） ---
// 遷移グライドを経由しないため、ヘッドレス実行でも速く検証できる。
whenBroadcastReceived("stage31test", () => {
  setVariableTo(vars.Tile, 31);
  addToList("-239", lists["Spawn Area X,Y"]);
  addToList("9", lists["Spawn Area X,Y"]);
  addToList("2", lists["Spawn Type"]);
  createCloneOf("Object - Teleporter");
  addToList("-45", lists["Spawn Area X,Y"]);
  addToList("-104", lists["Spawn Area X,Y"]);
  addToList("99", lists["Spawn Type"]);
  createCloneOf("Object - EventZone");
  addToList("100", lists["Spawn Area X,Y"]);
  addToList("-130", lists["Spawn Area X,Y"]);
  addToList("1", lists["Spawn Type"]);
  createCloneOf("Object - Urchin");
  addToList("-100", lists["Spawn Area X,Y"]);
  addToList("60", lists["Spawn Area X,Y"]);
  addToList("1", lists["Spawn Type"]);
  createCloneOf("Object - Torch");
});
