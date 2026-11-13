// Enemy: 左右に動く敵 (自作SVGモンスター)
// 上から踏むと倒せる。横から当たると残機-1。速さは Stage.enemySpeed (面が進むと速く)
// 変数 dir/dead は自分のもの。state/score/lives/pyV/invT/scrollX は Stage共有

// 自分の初期位置 (面ごと)。Enemy3 は 3面から登場
// @a1
// 緑旗: 隠れて待つ (本物は隠し、動くのは各ステージ配置後)
whenFlagClicked(() => {
  setVariableTo(vars.dead, 1);
  setVariableTo(vars.dir, -1);
  goToXY(0, 999);
  hide();
});

// @a2
// ステージ開始: 3面から登場 (1・2面はお休み)
whenBroadcastReceived("startStage", () => {
  ifElse(equals(vars.stage, 3), () => {
    goToXY(200, -110);
    setVariableTo(vars.dead, 0);
    setVariableTo(vars.dir, -1);
    show();
  }, () => {
    setVariableTo(vars.dead, 1);
    goToXY(0, 999);
    hide();
  });
});

// @a3
// メイン: パトロール + スクロール + 当たり判定
whenFlagClicked(() => {
  forever(() => {
    ifThen(and(equals(vars.state, "playing"), equals(vars.dead, 0)), () => {
      // パトロール (画面端で折り返す)
      changeX(multiply(vars.dir, vars.enemySpeed));
      ifThen(greaterThan(xPosition(), 220), () => {
        setVariableTo(vars.dir, -1);
      });
      ifThen(lessThan(xPosition(), -220), () => {
        setVariableTo(vars.dir, 1);
      });
      // 横スクロールに合わせる (Playerと同条件)
      ifThen(and(and(keyPressed("right arrow"), greaterThan(attributeOf("x position", "Player"), 60)), lessThan(vars.scrollX, 300)), () => {
        changeX(-5);
      });
      ifThen(and(and(keyPressed("left arrow"), lessThan(attributeOf("x position", "Player"), -60)), greaterThan(vars.scrollX, 0)), () => {
        changeX(5);
      });
      // 当たり判定: 上から落ちてきたら踏みつけ成功
      ifThen(touching("Player"), () => {
        ifElse(and(greaterThan(attributeOf("y position", "Player"), add(yPosition(), 20)), lessThan(vars.pyV, 0)), () => {
          // 踏んだ! スコア+効果音
          changeVariableBy(vars.score, 20);
          setVariableTo(vars.sfx, "stomp");
          startSound("stomp");
          setVariableTo(vars.dead, 1);
          hide();
        }, () => {
          // 横から当たった! 無敵時間中でなければダメージ
          ifThen(equals(vars.invT, 0), () => {
            changeVariableBy(vars.lives, -1);
            setVariableTo(vars.invT, 90);
            setVariableTo(vars.sfx, "damage");
            startSound("damage");
            ifThen(lessThan(vars.lives, 1), () => {
              broadcast("gameOver");
            });
          });
        });
      });
    });
  });
});

// @a4
// アニメ: 足パタパタ
whenFlagClicked(() => {
  forever(() => {
    ifThen(and(equals(vars.state, "playing"), equals(vars.dead, 0)), () => {
      nextCostume();
      wait("0.3");
    });
  });
});

// @a5
// 終了・ゲームオーバーでは隠れる
whenBroadcastReceived("gameClear", () => {
  hide();
});
whenBroadcastReceived("gameOver", () => {
  hide();
});
