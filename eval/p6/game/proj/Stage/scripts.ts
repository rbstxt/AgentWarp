// Stage: ゲーム全体の管理 (状態・ステージ進行・BGM・ハイスコア)
// 変数: score/lives/hiScore/stage/state/enemySpeed/bgmOn/sfx/scrollX/pyV/invT

// @a1
// 緑旗: 最初はタイトル画面にする
whenFlagClicked(() => {
  setVariableTo(vars.score, 0);
  setVariableTo(vars.lives, 3);
  setVariableTo(vars.stage, 1);
  setVariableTo(vars.state, "title");
  setVariableTo(vars.enemySpeed, 2);
  setVariableTo(vars.scrollX, 0);
  setVariableTo(vars.pyV, 0);
  setVariableTo(vars.invT, 0);
  setVariableTo(vars.bgmOn, 0);
  setVariableTo(vars.sfx, "");
  switchBackdropTo("title");
});

// @a2
// BGMをずっと流す (テスト用に bgmOn を立てる)
whenFlagClicked(() => {
  setVariableTo(vars.bgmOn, 1);
  forever(() => {
    playSoundUntilDone("bgm");
  });
});

// @a3
// スタートボタンから呼ばれる: 最初からやり直す
whenBroadcastReceived("startGame", () => {
  setVariableTo(vars.score, 0);
  setVariableTo(vars.lives, 3);
  setVariableTo(vars.stage, 1);
  setVariableTo(vars.enemySpeed, 2);
  setVariableTo(vars.scrollX, 0);
  setVariableTo(vars.invT, 0);
  setVariableTo(vars.state, "playing");
  switchBackdropTo("stage1");
  broadcast("startStage");
});

// @a4
// ゴール旗から呼ばれる: 次ステージへ。3面クリアでエンディング
whenBroadcastReceived("stageClear", () => {
  setVariableTo(vars.sfx, "clear");
  startSound("clear");
  ifElse(greaterThan(vars.stage, 2), () => {
    // 全ステージクリア
    setVariableTo(vars.state, "ending");
    switchBackdropTo("ending");
    ifThen(greaterThan(vars.score, vars.hiScore), () => {
      setVariableTo(vars.hiScore, vars.score);
    });
    broadcast("gameClear");
  }, () => {
    // 次のステージへ (だんだん難しく: 敵が速くなる)
    changeVariableBy(vars.stage, 1);
    setVariableTo(vars.enemySpeed, add(vars.stage, 1));
    setVariableTo(vars.state, "stageclear");
    ifElse(equals(vars.stage, 2), () => {
      switchBackdropTo("stage2");
    }, () => {
      switchBackdropTo("stage3");
    });
    wait("1");
    setVariableTo(vars.scrollX, 0);
    setVariableTo(vars.invT, 0);
    setVariableTo(vars.state, "playing");
    broadcast("startStage");
  });
});

// @a5
// 残機がなくなったらゲームオーバー
whenBroadcastReceived("gameOver", () => {
  setVariableTo(vars.state, "gameover");
  switchBackdropTo("gameover");
  ifThen(greaterThan(vars.score, vars.hiScore), () => {
    setVariableTo(vars.hiScore, vars.score);
  });
  setVariableTo(vars.sfx, "gameover");
});

// @a6
// 念のため: プレイ中に lives が 0 未満になったら必ずゲームオーバーにする
whenFlagClicked(() => {
  forever(() => {
    ifThen(and(equals(vars.state, "playing"), lessThan(vars.lives, 1)), () => {
      broadcast("gameOver");
    });
  });
});
