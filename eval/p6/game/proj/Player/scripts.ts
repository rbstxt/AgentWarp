// Player: 主人公 (自作SVGランナー)
// 左右キーで移動・上/スペースでジャンプ。x>=60 で右へ進むと世界がスクロールする
// 変数 vy は自分のもの。pyV/invT/scrollX/state は Stage(みんな共有) のもの

// @a1
// 緑旗: 定位置で隠れて待つ (タイトル中は操作できない)
whenFlagClicked(() => {
  goToXY(-200, -110);
  setVariableTo(vars.vy, 0);
  setRotationStyle("left-right");
  pointInDirection(90);
  hide();
});

// @a2
// メイン: 移動・ジャンプ・重力 (state が playing の間だけ動く)
whenFlagClicked(() => {
  forever(() => {
    ifThen(equals(vars.state, "playing"), () => {
      // --- 左右移動 + 横スクロール ---
      ifThen(keyPressed("left arrow"), () => {
        pointInDirection(-90);
        ifElse(and(lessThan(xPosition(), -60), greaterThan(vars.scrollX, 0)), () => {
          // カメラ端: 自分は止まって世界を右へ戻す (Enemy/Coin/Goalも同時に動く)
          changeVariableBy(vars.scrollX, -5);
        }, () => {
          changeX(-5);
        });
      });
      ifThen(keyPressed("right arrow"), () => {
        pointInDirection(90);
        ifElse(and(greaterThan(xPosition(), 60), lessThan(vars.scrollX, 300)), () => {
          // カメラ端: 自分は止まって世界を左へ送る
          changeVariableBy(vars.scrollX, 5);
        }, () => {
          changeX(5);
        });
      });
      // --- ジャンプ (地面にいるときだけ) ---
      ifThen(and(or(keyPressed("up arrow"), keyPressed("space")), lessThan(yPosition(), -106)), () => {
        setVariableTo(vars.vy, 13);
        startSound("jump");
      });
      // --- 画面左端で止まる ---
      ifThen(lessThan(xPosition(), -225), () => {
        setX(-225);
      });
      // --- 重力 ---
      changeVariableBy(vars.vy, -1);
      changeY(vars.vy);
      ifThen(lessThan(yPosition(), -110), () => {
        setY(-110);
        setVariableTo(vars.vy, 0);
      });
      // 落下中かどうかを Enemy に教える (踏みつけ判定用)
      setVariableTo(vars.pyV, vars.vy);
      // --- 無敵時間のカウント ---
      ifThen(greaterThan(vars.invT, 0), () => {
        changeVariableBy(vars.invT, -1);
      });
    });
  });
});

// @a3
// 歩きアニメ: 動いている間だけコスチュームを切り替える
whenFlagClicked(() => {
  forever(() => {
    ifThen(and(equals(vars.state, "playing"), or(keyPressed("left arrow"), keyPressed("right arrow"))), () => {
      nextCostume();
      wait("0.2");
    });
  });
});

// @a4
// ダメージ中の点滅 (無敵時間 invT>0 の間だけ隠れたり出たりする)
whenFlagClicked(() => {
  forever(() => {
    ifThen(and(equals(vars.state, "playing"), greaterThan(vars.invT, 0)), () => {
      hide();
      wait("0.1");
      show();
      wait("0.1");
    });
  });
});

// @a5
// ステージ開始: 左端から登場
whenBroadcastReceived("startStage", () => {
  goToXY(-200, -110);
  setVariableTo(vars.vy, 0);
  pointInDirection(90);
  show();
});

// @a6
// 終了・ゲームオーバーでは隠れる
whenBroadcastReceived("gameClear", () => {
  hide();
});
whenBroadcastReceived("gameOver", () => {
  hide();
});
