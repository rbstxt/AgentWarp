// Goal: ゴールの旗 (自作SVG)。触れるとステージクリア
// 世界の右端 (x=400) にあり、スクロールして進むと見えてくる

// @a1
// 緑旗: 隠れて待つ
whenFlagClicked(() => {
  goToXY(400, -100);
  hide();
});

// @a2
// ステージ開始: 右端に立つ
whenBroadcastReceived("startStage", () => {
  goToXY(400, -100);
  show();
});

// @a3
// メイン: スクロール追従 + ゴール判定 (1回だけ鳴らす)
whenFlagClicked(() => {
  forever(() => {
    ifThen(equals(vars.state, "playing"), () => {
      // 横スクロールに合わせる (Playerと同条件)
      ifThen(and(and(keyPressed("right arrow"), greaterThan(attributeOf("x position", "Player"), 60)), lessThan(vars.scrollX, 300)), () => {
        changeX(-5);
      });
      ifThen(and(and(keyPressed("left arrow"), lessThan(attributeOf("x position", "Player"), -60)), greaterThan(vars.scrollX, 0)), () => {
        changeX(5);
      });
      // ゴール!
      ifThen(touching("Player"), () => {
        broadcast("stageClear");
        waitUntil(not(equals(vars.state, "playing")));
      });
    });
  });
});

// @a4
// 終了・ゲームオーバーでは隠れる
whenBroadcastReceived("gameClear", () => {
  hide();
});
whenBroadcastReceived("gameOver", () => {
  hide();
});
