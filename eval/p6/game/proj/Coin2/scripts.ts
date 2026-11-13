// Coin: 取るとスコア+10・効果音 (自作SVGコイン)
// Coin2/Coin3 と位置を変えて3枚配置。取られたら隠れて(0,999)へ退避
// (隠れても当たり判定が残るため)。変数 taken は自分のもの

// @a1
// 緑旗: 隠れて待つ
whenFlagClicked(() => {
  setVariableTo(vars.taken, 1);
  goToXY(0, 999);
  hide();
});

// @a2
// ステージ開始: 2枚目の位置に出る (ジャンプで取る高さ)
whenBroadcastReceived("startStage", () => {
  ifElse(equals(vars.stage, 1), () => {
    goToXY(30, -30);
  }, () => {
    ifElse(equals(vars.stage, 2), () => {
      goToXY(50, -30);
    }, () => {
      goToXY(60, -30);
    });
  });
  setVariableTo(vars.taken, 0);
  show();
});

// @a3
// メイン: スクロール追従 + 取得判定
whenFlagClicked(() => {
  forever(() => {
    ifThen(and(equals(vars.state, "playing"), equals(vars.taken, 0)), () => {
      // 横スクロールに合わせる (Playerと同条件)
      ifThen(and(and(keyPressed("right arrow"), greaterThan(attributeOf("x position", "Player"), 60)), lessThan(vars.scrollX, 300)), () => {
        changeX(-5);
      });
      ifThen(and(and(keyPressed("left arrow"), lessThan(attributeOf("x position", "Player"), -60)), greaterThan(vars.scrollX, 0)), () => {
        changeX(5);
      });
      // 取得!
      ifThen(touching("Player"), () => {
        setVariableTo(vars.taken, 1);
        changeVariableBy(vars.score, 10);
        setVariableTo(vars.sfx, "coin");
        startSound("coin");
        goToXY(0, 999);
        hide();
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
