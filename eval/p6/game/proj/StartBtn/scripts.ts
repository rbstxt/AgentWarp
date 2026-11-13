// StartBtn: タイトル画面のスタートボタン (自作SVG)
// 押すと startGame を送る。クリア・ゲームオーバー後も再挑戦用に出す

// @a1
// 緑旗: タイトルなので見せる
whenFlagClicked(() => {
  goToXY(0, -40);
  show();
});

// @a2
// 押されたらゲーム開始 (タイトルのときだけ)
whenThisSpriteClicked(() => {
  ifThen(equals(vars.state, "title"), () => {
    broadcast("startGame");
  });
});

// @a3
// ゲーム中は隠す
whenBroadcastReceived("startGame", () => {
  hide();
});

// @a4
// 終わった後は再挑戦できるよう出す
whenBroadcastReceived("gameClear", () => {
  wait("2");
  goToXY(0, -40);
  show();
});
whenBroadcastReceived("gameOver", () => {
  wait("2");
  goToXY(0, -40);
  show();
});
